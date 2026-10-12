-- Server-side enforcement for customer-created appointments (E2 + F2).
--
-- Model:
--   * Customers book ONLY through public.book_appointment(...). The function derives every protected
--     value on the server (business timezone, ends_at from the service duration, status, customer_id,
--     customer_email) and validates staff/service/business consistency, working hours, past dates and an
--     anti-abuse limit. The existing no_staff_overlap exclusion constraint remains the final overlap guard.
--   * The direct customer INSERT policy is removed, and a BEFORE trigger rejects direct customer INSERTs and
--     any customer UPDATE other than cancelling their own active appointment (defence in depth).
--   * Business owners keep their existing "owners manage appointments" policy and flows (dashboard booking,
--     status changes); the guard trigger does not restrict them. Service role / SQL editor are not restricted.
--
-- Depends on: schema.sql (appointments, staff, services, staff_services, working_hours, businesses,
-- is_business_owner) and 20261008_notifications_system.sql (businesses.timezone). The file name sorts after
-- both existing 20261008* migrations under lexical and numeric ordering.
--
-- Timezone: appointment_date / start_time / end_time keep meaning "wall-clock time in the business timezone"
-- (what the UI slot picker already produces). starts_at / ends_at are computed from them using
-- businesses.timezone, never the browser or server timezone.

-- Maximum number of future active (booked/pending/confirmed) appointments one customer may hold at one
-- business. No existing business rule/column exists for this; the limit is a fixed constant inside
-- book_appointment (v_max_future_active). Change it by replacing the function.

create or replace function public.book_appointment(
  p_business_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_date date,
  p_time time,
  p_customer_name text,
  p_customer_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_future_active constant integer := 5;
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_phone text := nullif(btrim(coalesce(p_customer_phone, '')), '');
  v_tz text;
  v_duration integer;
  v_start_local timestamp;
  v_starts timestamptz;
  v_ends timestamptz;
  v_end_local timestamp;
  v_dow integer;
  v_staff_hours integer;
  v_fits boolean;
  v_active integer;
  v_email text;
  v_row public.appointments;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_business_id is null or p_staff_id is null or p_service_id is null or p_date is null or p_time is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid_customer_name' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+()\- ]{6,20}$' then
    raise exception 'invalid_customer_phone' using errcode = '22023';
  end if;

  select b.timezone into v_tz from public.businesses b where b.id = p_business_id;
  if not found then
    raise exception 'business_not_found' using errcode = 'P0002';
  end if;

  perform 1 from public.staff s
   where s.id = p_staff_id and s.business_id = p_business_id and s.is_active;
  if not found then
    raise exception 'staff_unavailable' using errcode = 'P0002';
  end if;

  select sv.duration_minutes into v_duration from public.services sv
   where sv.id = p_service_id and sv.business_id = p_business_id and sv.is_active;
  if not found then
    raise exception 'service_unavailable' using errcode = 'P0002';
  end if;

  -- Same rule as the booking UI: if the business has no staff/service assignments at all every staff member
  -- may perform every service; otherwise the pair must be assigned.
  if exists (select 1 from public.staff_services ss where ss.business_id = p_business_id)
     and not exists (
       select 1 from public.staff_services ss
        where ss.business_id = p_business_id and ss.staff_id = p_staff_id and ss.service_id = p_service_id
     ) then
    raise exception 'staff_service_mismatch' using errcode = 'P0002';
  end if;

  -- Wall-clock time in the business timezone -> instant. Reject local times that do not exist (DST gap).
  v_start_local := p_date + p_time;
  v_starts := v_start_local at time zone v_tz;
  if (v_starts at time zone v_tz) <> v_start_local then
    raise exception 'invalid_local_time' using errcode = '22023';
  end if;
  v_ends := v_starts + make_interval(mins => v_duration);
  v_end_local := v_ends at time zone v_tz;
  if v_end_local::date <> p_date then
    raise exception 'outside_working_hours' using errcode = '22023';
  end if;

  if v_starts <= now() then
    raise exception 'slot_in_past' using errcode = '22023';
  end if;

  -- Working hours: staff-specific rows for that weekday override business-wide rows (as getSlots does).
  v_dow := extract(dow from p_date)::integer;  -- 0 = Sunday, same as JS getDay()
  select count(*) into v_staff_hours from public.working_hours wh
   where wh.business_id = p_business_id and wh.staff_id = p_staff_id and wh.day_of_week = v_dow;
  select exists (
    select 1 from public.working_hours wh
     where wh.business_id = p_business_id
       and wh.day_of_week = v_dow
       and not wh.is_closed
       and ((v_staff_hours > 0 and wh.staff_id = p_staff_id) or (v_staff_hours = 0 and wh.staff_id is null))
       and wh.start_time <= p_time
       and wh.end_time >= v_end_local::time
  ) into v_fits;
  if not v_fits then
    raise exception 'outside_working_hours' using errcode = '22023';
  end if;

  -- Anti-abuse: serialise per (customer, business) so concurrent calls cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_business_id::text, 0));
  select count(*) into v_active from public.appointments a
   where a.customer_id = v_uid
     and a.business_id = p_business_id
     and a.status in ('booked', 'pending', 'confirmed')
     and a.starts_at > now();
  if v_active >= v_max_future_active then
    raise exception 'booking_limit_reached' using errcode = '54000';
  end if;

  -- customer_email comes from the authenticated account, never from the client.
  select u.email into v_email from auth.users u where u.id = v_uid;

  begin
    insert into public.appointments (
      business_id, customer_id, staff_id, service_id,
      appointment_date, start_time, end_time, status,
      customer_name, customer_phone, customer_email, starts_at, ends_at
    ) values (
      p_business_id, v_uid, p_staff_id, p_service_id,
      p_date, p_time, v_end_local::time, 'booked',
      v_name, v_phone, v_email, v_starts, v_ends
    ) returning * into v_row;
  exception when exclusion_violation then
    -- no_staff_overlap is the authority; this only translates its error.
    raise exception 'slot_unavailable' using errcode = '23P01';
  end;

  return jsonb_build_object(
    'id', v_row.id,
    'appointment_date', v_row.appointment_date,
    'start_time', v_row.start_time,
    'end_time', v_row.end_time,
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.book_appointment(uuid, uuid, uuid, date, time, text, text) from public, anon;
grant execute on function public.book_appointment(uuid, uuid, uuid, date, time, text, text) to authenticated;

-- Guard trigger: SECURITY INVOKER on purpose, so current_user is the API role ('anon'/'authenticated') for
-- direct client writes, and the function owner when called from book_appointment (SECURITY DEFINER).
create or replace function public.guard_appointment_client_writes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if public.is_business_owner(new.business_id) then
      return new;
    end if;
    raise exception 'direct_insert_not_allowed' using errcode = '42501';
  end if;

  -- UPDATE
  if public.is_business_owner(old.business_id) then
    return new;
  end if;
  if old.customer_id is distinct from auth.uid() then
    raise exception 'not_your_appointment' using errcode = '42501';
  end if;
  -- Every column except status is immutable for customers (includes any column added later).
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'appointment_field_immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('booked', 'pending', 'confirmed') and new.status = 'cancelled') then
    raise exception 'status_change_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_appointment_client_writes() from public, anon, authenticated;

drop trigger if exists appointments_guard_client_writes on public.appointments;
create trigger appointments_guard_client_writes
before insert or update on public.appointments
for each row execute function public.guard_appointment_client_writes();

-- Customers can no longer insert appointments directly; they use book_appointment().
drop policy if exists "customers create own appointments" on public.appointments;
