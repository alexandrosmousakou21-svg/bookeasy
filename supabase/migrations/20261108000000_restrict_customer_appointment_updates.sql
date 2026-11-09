create or replace function public.restrict_customer_appointment_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'authenticated'
    and not public.is_business_owner(old.business_id) then
    if auth.uid() is distinct from old.customer_id
      or new.status is distinct from 'cancelled'
      or old.status not in ('booked', 'pending', 'confirmed', 'cancelled')
      or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'Customers may only cancel their own appointments'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists restrict_customer_appointment_update on public.appointments;
create trigger restrict_customer_appointment_update
before update on public.appointments
for each row execute function public.restrict_customer_appointment_update();

drop policy if exists "customers update own appointments" on public.appointments;
create policy "customers update own appointments"
on public.appointments for update
to authenticated
using (customer_id = auth.uid())
with check (customer_id = auth.uid() and status = 'cancelled');