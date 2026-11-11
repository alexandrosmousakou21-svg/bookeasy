create or replace function public.restrict_customer_appointment_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'authenticated'
    and not public.is_business_owner(old.business_id) then
    if auth.uid() is distinct from old.customer_id
      or old.status not in ('booked', 'pending', 'confirmed', 'cancelled') then
      raise exception 'Customers may only change their own active appointments'
        using errcode = '42501';
    end if;

    if new.status = 'cancelled' then
      if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
        raise exception 'Customer cancellation may only change appointment status'
          using errcode = '42501';
      end if;
    elsif new.status = 'pending'
      and old.status in ('booked', 'pending', 'confirmed') then
      if old.starts_at <= now() then
        raise exception 'Past appointments cannot be rescheduled' using errcode = 'BK004';
      end if;
      if (new.appointment_date, new.start_time, new.end_time, new.starts_at, new.ends_at)
         is not distinct from
         (old.appointment_date, old.start_time, old.end_time, old.starts_at, old.ends_at) then
        raise exception 'Rescheduling must change the appointment time' using errcode = '22023';
      end if;
      if (to_jsonb(new) - array['status', 'appointment_date', 'start_time', 'end_time', 'starts_at', 'ends_at'])
         is distinct from
         (to_jsonb(old) - array['status', 'appointment_date', 'start_time', 'end_time', 'starts_at', 'ends_at']) then
        raise exception 'Customers may only change their appointment time'
          using errcode = '42501';
      end if;
    else
      raise exception 'Customers may only cancel or reschedule their own appointments'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "customers update own appointments" on public.appointments;
create policy "customers update own appointments"
on public.appointments for update
to authenticated
using (customer_id = auth.uid())
with check (customer_id = auth.uid() and status in ('cancelled', 'pending'));

create or replace function public.reschedule_appointment(
  p_appointment uuid,
  p_date date,
  p_start_time time
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_appointment public.appointments%rowtype;
  service_duration integer;
  business_time_zone text;
  appointment_starts_at timestamptz;
  appointment_ends_at timestamptz;
  is_owner boolean;
begin
  select * into current_appointment
  from public.appointments
  where id = p_appointment
  for update;

  if not found then
    raise exception 'Appointment not found or not accessible' using errcode = '42501';
  end if;

  is_owner := public.is_business_owner(current_appointment.business_id);
  if not is_owner and current_appointment.customer_id is distinct from auth.uid() then
    raise exception 'Not allowed to reschedule this appointment' using errcode = '42501';
  end if;

  if current_appointment.status in ('cancelled', 'completed') then
    raise exception 'This appointment can no longer be rescheduled' using errcode = 'BK005';
  end if;

  if not is_owner and current_appointment.starts_at <= now() then
    raise exception 'Past appointments cannot be rescheduled' using errcode = 'BK004';
  end if;

  select duration_minutes into service_duration
  from public.services
  where id = current_appointment.service_id
    and business_id = current_appointment.business_id
    and is_active;
  if not found then
    raise exception 'The appointment service is unavailable' using errcode = 'BK001';
  end if;

  business_time_zone := public.get_business_time_zone(current_appointment.business_id);
  business_time_zone := coalesce(business_time_zone, 'Europe/Athens');
  if not exists (select 1 from pg_timezone_names where name = business_time_zone) then
    business_time_zone := 'Europe/Athens';
  end if;

  appointment_starts_at := (p_date + p_start_time) at time zone business_time_zone;
  appointment_ends_at := appointment_starts_at + make_interval(mins => service_duration);

  update public.appointments
  set appointment_date = p_date,
      start_time = p_start_time,
      end_time = (appointment_ends_at at time zone business_time_zone)::time,
      starts_at = appointment_starts_at,
      ends_at = appointment_ends_at,
      status = case when is_owner then current_appointment.status else 'pending' end
  where id = p_appointment;
end;
$$;

revoke all on function public.reschedule_appointment(uuid, date, time) from public, anon;
grant execute on function public.reschedule_appointment(uuid, date, time) to authenticated;

notify pgrst, 'reload schema';