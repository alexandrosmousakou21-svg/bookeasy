create table public.working_hour_breaks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  exception_date date not null,
  is_closed boolean not null default false,
  start_time time,
  end_time time,
  check (
    (is_closed and start_time is null and end_time is null)
    or (not is_closed and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create unique index working_hour_breaks_business_unique
  on public.working_hour_breaks(business_id, day_of_week, start_time)
  where staff_id is null;
create unique index working_hour_breaks_staff_unique
  on public.working_hour_breaks(staff_id, day_of_week, start_time)
  where staff_id is not null;
create unique index availability_exceptions_business_unique
  on public.availability_exceptions(business_id, exception_date)
  where staff_id is null;
create unique index availability_exceptions_staff_unique
  on public.availability_exceptions(staff_id, exception_date)
  where staff_id is not null;
create index availability_exceptions_date_idx
  on public.availability_exceptions(business_id, exception_date);

alter table public.working_hour_breaks enable row level security;
alter table public.availability_exceptions enable row level security;

create policy "public reads working hour breaks"
on public.working_hour_breaks for select using (true);
create policy "owners manage working hour breaks"
on public.working_hour_breaks for all to authenticated
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));
create policy "public reads availability exceptions"
on public.availability_exceptions for select using (true);
create policy "owners manage availability exceptions"
on public.availability_exceptions for all to authenticated
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

grant select on public.working_hour_breaks, public.availability_exceptions to anon, authenticated;
grant insert, update, delete on public.working_hour_breaks, public.availability_exceptions to authenticated;

create or replace function public.replace_working_hour_breaks(
  p_business uuid,
  p_staff uuid,
  p_breaks jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_breaks) is distinct from 'array' or jsonb_array_length(p_breaks) > 28 then
    raise exception 'Breaks must be an array of at most 28 intervals' using errcode = '22023';
  end if;
  if not public.is_business_owner(p_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_staff is not null and not exists (
    select 1 from public.staff where id = p_staff and business_id = p_business
  ) then
    raise exception 'Staff member does not belong to this business' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_breaks) as b(day_of_week smallint, start_time time, end_time time)
    where b.day_of_week not between 0 and 6 or b.start_time is null or b.end_time is null or b.end_time <= b.start_time
  ) then
    raise exception 'Break interval is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_breaks) as b(day_of_week smallint, start_time time, end_time time)
    left join lateral (
      select h.*
      from public.working_hours h
      where h.business_id = p_business
        and h.day_of_week = b.day_of_week
        and (h.staff_id is not distinct from p_staff or (p_staff is not null and h.staff_id is null))
      order by (h.staff_id is null)
      limit 1
    ) schedule on true
    where schedule.id is null or schedule.is_closed
      or b.start_time < schedule.start_time or b.end_time > schedule.end_time
  ) then
    raise exception 'Break must be within open working hours' using errcode = '22023';
  end if;

  delete from public.working_hour_breaks
  where business_id = p_business and staff_id is not distinct from p_staff;
  insert into public.working_hour_breaks (business_id, staff_id, day_of_week, start_time, end_time)
  select p_business, p_staff, b.day_of_week, b.start_time, b.end_time
  from jsonb_to_recordset(p_breaks) as b(day_of_week smallint, start_time time, end_time time);
end;
$$;

create or replace function public.replace_availability_exceptions(
  p_business uuid,
  p_staff uuid,
  p_exceptions jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_exceptions) is distinct from 'array' or jsonb_array_length(p_exceptions) > 180 then
    raise exception 'Availability exceptions must be an array of at most 180 dates' using errcode = '22023';
  end if;
  if not public.is_business_owner(p_business) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_staff is not null and not exists (
    select 1 from public.staff where id = p_staff and business_id = p_business
  ) then
    raise exception 'Staff member does not belong to this business' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_exceptions) as e(exception_date date, is_closed boolean, start_time time, end_time time)
    where e.exception_date is null
      or e.is_closed is null
      or (e.is_closed and (e.start_time is not null or e.end_time is not null))
      or (not e.is_closed and (e.start_time is null or e.end_time is null or e.end_time <= e.start_time))
  ) then
    raise exception 'Availability exception is invalid' using errcode = '22023';
  end if;

  delete from public.availability_exceptions
  where business_id = p_business and staff_id is not distinct from p_staff;
  insert into public.availability_exceptions (business_id, staff_id, exception_date, is_closed, start_time, end_time)
  select p_business, p_staff, e.exception_date, e.is_closed, e.start_time, e.end_time
  from jsonb_to_recordset(p_exceptions) as e(exception_date date, is_closed boolean, start_time time, end_time time);
end;
$$;

create or replace function public.replace_availability_schedule(
  p_business uuid,
  p_staff uuid,
  p_hours jsonb,
  p_breaks jsonb,
  p_exceptions jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.replace_working_hours(p_business, p_staff, p_hours);
  perform public.replace_working_hour_breaks(p_business, p_staff, p_breaks);
  perform public.replace_availability_exceptions(p_business, p_staff, p_exceptions);
end;
$$;

create or replace function public.save_business_profile_with_schedule(
  p_business uuid,
  p_profile jsonb,
  p_contact jsonb,
  p_hours jsonb,
  p_breaks jsonb,
  p_exceptions jsonb,
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
  values (
    p_business,
    p_contact->>'professional_email',
    coalesce((p_contact->>'email_is_public')::boolean, false),
    coalesce(p_contact->>'time_zone', 'Europe/Athens'),
    now()
  )
  on conflict (business_id) do update set
    professional_email = excluded.professional_email,
    email_is_public = excluded.email_is_public,
    time_zone = excluded.time_zone,
    updated_at = excluded.updated_at;

  perform public.replace_availability_schedule(p_business, null, p_hours, p_breaks, p_exceptions);
  perform public.replace_business_media(p_business, p_urls);
end;
$$;

revoke all on function public.replace_working_hour_breaks(uuid, uuid, jsonb) from public, anon;
revoke all on function public.replace_availability_exceptions(uuid, uuid, jsonb) from public, anon;
revoke all on function public.replace_availability_schedule(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.save_business_profile_with_schedule(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.replace_working_hour_breaks(uuid, uuid, jsonb) to authenticated;
grant execute on function public.replace_availability_exceptions(uuid, uuid, jsonb) to authenticated;
grant execute on function public.replace_availability_schedule(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.save_business_profile_with_schedule(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text[]) to authenticated;

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
  v_exception public.availability_exceptions%rowtype;
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
  if not found then raise exception 'Service is unavailable' using errcode = 'BK001'; end if;
  select * into v_staff from public.staff
  where id = new.staff_id and business_id = new.business_id and is_active;
  if not found then raise exception 'Staff is unavailable' using errcode = 'BK001'; end if;

  if exists (select 1 from public.staff_services where business_id = new.business_id)
     and not exists (
       select 1 from public.staff_services
       where business_id = new.business_id and staff_id = new.staff_id and service_id = new.service_id
     ) then
    raise exception 'Staff member does not perform this service' using errcode = 'BK001';
  end if;

  v_zone := coalesce(public.get_business_time_zone(new.business_id), 'Europe/Athens');
  if not exists (select 1 from pg_timezone_names where name = v_zone) then v_zone := 'Europe/Athens'; end if;
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

  select * into v_exception
  from public.availability_exceptions e
  where e.business_id = new.business_id
    and e.exception_date = new.appointment_date
    and (e.staff_id = new.staff_id or e.staff_id is null)
  order by (e.staff_id is null)
  limit 1;

  if found then
    if v_exception.is_closed then
      raise exception 'This date is closed' using errcode = 'BK006';
    end if;
    if new.start_time < v_exception.start_time or new.end_time > v_exception.end_time then
      raise exception 'Appointment is outside the date exception hours' using errcode = 'BK002';
    end if;
  else
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
  end if;

  v_dow := extract(dow from new.appointment_date)::integer;
  if exists (
    select 1 from public.working_hour_breaks b
    where b.business_id = new.business_id
      and b.day_of_week = v_dow
      and (b.staff_id = new.staff_id or b.staff_id is null)
      and new.start_time < b.end_time
      and new.end_time > b.start_time
  ) then
    raise exception 'Appointment overlaps a working-hours break' using errcode = 'BK006';
  end if;

  return new;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'working_hour_breaks'
    ) then
      alter publication supabase_realtime add table public.working_hour_breaks;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'availability_exceptions'
    ) then
      alter publication supabase_realtime add table public.availability_exceptions;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';