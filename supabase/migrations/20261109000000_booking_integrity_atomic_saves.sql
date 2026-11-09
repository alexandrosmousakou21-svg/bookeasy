-- PREPARED, NOT APPLIED. Review against production before running.
-- 1) Server-side booking validation  2) atomic, all-or-nothing profile/hours/media saves.
-- Non-destructive: only adds functions, triggers and NOT VALID constraints (existing rows are not rewritten).

create or replace function public.validate_appointment_booking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service public.services%rowtype;
  v_staff public.staff%rowtype;
  v_hours public.working_hours%rowtype;
  v_zone text;
  v_dow integer;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status <> 'cancelled'
     and (new.business_id, new.staff_id, new.service_id, new.appointment_date,
          new.start_time, new.end_time, new.starts_at, new.ends_at)
         is not distinct from
         (old.business_id, old.staff_id, old.service_id, old.appointment_date,
          old.start_time, old.end_time, old.starts_at, old.ends_at) then
    return new;
  end if;

  select * into v_service from public.services
  where id = new.service_id and business_id = new.business_id and is_active;
  if not found then
    raise exception 'Service does not belong to this business or is inactive' using errcode = 'BK001';
  end if;

  select * into v_staff from public.staff
  where id = new.staff_id and business_id = new.business_id and is_active;
  if not found then
    raise exception 'Staff member does not belong to this business or is inactive' using errcode = 'BK001';
  end if;

  if exists (select 1 from public.staff_services where business_id = new.business_id)
     and not exists (
       select 1 from public.staff_services
       where business_id = new.business_id and staff_id = new.staff_id and service_id = new.service_id
     ) then
    raise exception 'Staff member does not perform this service' using errcode = 'BK001';
  end if;

  select coalesce(
    (select time_zone from public.business_contact_settings where business_id = new.business_id),
    'Europe/Athens'
  ) into v_zone;
  if not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'Europe/Athens';
  end if;

  if new.ends_at <> new.starts_at + make_interval(mins => v_service.duration_minutes) then
    raise exception 'Appointment length does not match the service duration' using errcode = 'BK003';
  end if;
  if (new.starts_at at time zone v_zone)::date <> new.appointment_date
     or (new.starts_at at time zone v_zone)::time <> new.start_time
     or (new.ends_at at time zone v_zone)::date <> new.appointment_date
     or (new.ends_at at time zone v_zone)::time <> new.end_time then
    raise exception 'Appointment date and time are inconsistent with the business time zone' using errcode = 'BK003';
  end if;

  if new.starts_at < now() - interval '5 minutes' then
    raise exception 'Appointments cannot be created in the past' using errcode = 'BK004';
  end if;

  v_dow := extract(dow from new.appointment_date)::integer;
  select * into v_hours from public.working_hours
  where business_id = new.business_id and day_of_week = v_dow and staff_id = new.staff_id;
  if not found then
    select * into v_hours from public.working_hours
    where business_id = new.business_id and day_of_week = v_dow and staff_id is null;
  end if;
  if not found or v_hours.is_closed
     or new.start_time < v_hours.start_time or new.end_time > v_hours.end_time then
    raise exception 'Appointment is outside working hours' using errcode = 'BK002';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_appointment_booking() from public, anon, authenticated;

drop trigger if exists validate_appointment_booking on public.appointments;
create trigger validate_appointment_booking
before insert or update on public.appointments
for each row execute function public.validate_appointment_booking();

alter table public.appointments
  drop constraint if exists appointment_contact_lengths;
alter table public.appointments
  add constraint appointment_contact_lengths check (
    char_length(customer_name) between 1 and 120
    and (customer_phone is null or char_length(customer_phone) <= 40)
    and (customer_email is null or char_length(customer_email) <= 254)
  ) not valid;

-- Atomic replacement helpers: SECURITY INVOKER, so existing RLS ("owners manage ...") still decides access.
create or replace function public.replace_working_hours(
  p_business uuid,
  p_staff uuid,
  p_hours jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_hours) is distinct from 'array' or jsonb_array_length(p_hours) > 7 then
    raise exception 'Working hours must be an array of at most 7 days' using errcode = '22023';
  end if;
  if p_staff is not null
     and not exists (select 1 from public.staff where id = p_staff and business_id = p_business) then
    raise exception 'Staff member does not belong to this business' using errcode = '22023';
  end if;
  if not public.is_business_owner(p_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  delete from public.working_hours
  where business_id = p_business and staff_id is not distinct from p_staff;

  insert into public.working_hours (business_id, staff_id, day_of_week, start_time, end_time, is_closed)
  select p_business, p_staff, h.day_of_week, h.start_time, h.end_time, coalesce(h.is_closed, false)
  from jsonb_to_recordset(p_hours) as h(day_of_week smallint, start_time time, end_time time, is_closed boolean);
end;
$$;

create or replace function public.replace_business_media(p_business uuid, p_urls text[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if coalesce(array_length(p_urls, 1), 0) > 30 then
    raise exception 'Too many media items' using errcode = '22023';
  end if;
  if not public.is_business_owner(p_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.business_media where business_id = p_business;
  insert into public.business_media (business_id, url, sort_order)
  select p_business, u.url, u.ordinality - 1
  from unnest(coalesce(p_urls, array[]::text[])) with ordinality as u(url, ordinality)
  where nullif(btrim(u.url), '') is not null;
end;
$$;

create or replace function public.save_business_profile(
  p_business uuid,
  p_profile jsonb,
  p_contact jsonb,
  p_hours jsonb,
  p_urls text[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.is_business_owner(p_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.businesses set
    name = p_profile->>'name',
    slug = p_profile->>'slug',
    description = p_profile->>'description',
    address = p_profile->>'address',
    phone = p_profile->>'phone',
    city = p_profile->>'city',
    category = p_profile->>'category',
    logo_url = p_profile->>'logo_url',
    cover_image_url = p_profile->>'cover_image_url',
    primary_color = p_profile->>'primary_color'
  where id = p_business;

  insert into public.business_contact_settings (business_id, professional_email, email_is_public, time_zone, updated_at)
  values (p_business, p_contact->>'professional_email', coalesce((p_contact->>'email_is_public')::boolean, false),
          coalesce(p_contact->>'time_zone', 'Europe/Athens'), now())
  on conflict (business_id) do update set
    professional_email = excluded.professional_email,
    email_is_public = excluded.email_is_public,
    time_zone = excluded.time_zone,
    updated_at = excluded.updated_at;

  perform public.replace_working_hours(p_business, null, p_hours);
  perform public.replace_business_media(p_business, p_urls);
end;
$$;

revoke all on function public.replace_working_hours(uuid, uuid, jsonb) from public, anon;
revoke all on function public.replace_business_media(uuid, text[]) from public, anon;
revoke all on function public.save_business_profile(uuid, jsonb, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.replace_working_hours(uuid, uuid, jsonb) to authenticated;
grant execute on function public.replace_business_media(uuid, text[]) to authenticated;
grant execute on function public.save_business_profile(uuid, jsonb, jsonb, jsonb, text[]) to authenticated;

notify pgrst, 'reload schema';
