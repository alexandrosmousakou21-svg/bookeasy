\set ON_ERROR_STOP on

create or replace function pg_temp.expect_state(statement text, expected text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'expected SQLSTATE % but statement succeeded', expected;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'expected SQLSTATE%' then raise; end if;
  if sqlstate <> expected then
    raise exception 'expected SQLSTATE % but got % (%): %', expected, sqlstate, sqlerrm, left(statement, 120);
  end if;
end $$;
grant execute on function pg_temp.expect_state(text, text) to public;

insert into auth.users (id) values
  ('e4000000-0000-4000-8000-000000000001'),
  ('e4000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-000000000003');
insert into public.businesses (id, owner_id, name, slug) values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'Schedule test', 'schedule-test');
insert into public.services (id, business_id, name, duration_minutes, is_active) values
  ('e6000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'Consultation', 30, true);
insert into public.staff (id, business_id, name, is_active) values
  ('e7000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'Staff', true);
insert into public.business_contact_settings (business_id, professional_email, time_zone) values
  ('e5000000-0000-4000-8000-000000000001', 'owner@example.test', 'America/New_York');
select set_config('test.reschedule_day', (current_date + 20)::text, false);
insert into public.working_hours (business_id, staff_id, day_of_week, start_time, end_time, is_closed)
values (
  'e5000000-0000-4000-8000-000000000001',
  null,
  extract(dow from (current_setting('test.reschedule_day'))::date),
  '09:00', '17:00', false
);
insert into public.appointments (
  id, business_id, customer_id, staff_id, service_id, appointment_date,
  start_time, end_time, status, customer_name, starts_at, ends_at
) values
  ('e8000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002',
   'e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', current_setting('test.reschedule_day')::date,
   '10:00', '10:30', 'confirmed', 'Customer',
  ((current_setting('test.reschedule_day')::date + time '10:00') at time zone 'America/New_York'),
  ((current_setting('test.reschedule_day')::date + time '10:30') at time zone 'America/New_York')),
  ('e8000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000003',
   'e7000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', current_setting('test.reschedule_day')::date,
   '11:00', '11:30', 'booked', 'Other customer',
  ((current_setting('test.reschedule_day')::date + time '11:00') at time zone 'America/New_York'),
  ((current_setting('test.reschedule_day')::date + time '11:30') at time zone 'America/New_York'));

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', false);

-- Customer rescheduling uses the business timezone, becomes pending, and is revalidated by the booking trigger.
select public.reschedule_appointment('e8000000-0000-4000-8000-000000000001', current_setting('test.reschedule_day')::date, '12:00');
do $$ begin
  if not exists (
    select 1 from public.appointments
    where id = 'e8000000-0000-4000-8000-000000000001'
      and start_time = '12:00'
      and status = 'pending'
      and customer_name = 'Customer'
      and starts_at = ((current_setting('test.reschedule_day')::date + time '12:00') at time zone 'America/New_York')
  ) then raise exception 'customer reschedule did not persist safely'; end if;
end $$;

-- Overlapping, outside-hours and another customer's reschedules are rejected atomically.
select pg_temp.expect_state(
  $q$select public.reschedule_appointment('e8000000-0000-4000-8000-000000000001', current_setting('test.reschedule_day')::date, '11:00')$q$,
  '23P01'
);
select pg_temp.expect_state(
  $q$select public.reschedule_appointment('e8000000-0000-4000-8000-000000000001', current_setting('test.reschedule_day')::date, '16:45')$q$,
  'BK002'
);
select pg_temp.expect_state(
  $q$select public.reschedule_appointment('e8000000-0000-4000-8000-000000000002', current_setting('test.reschedule_day')::date, '13:00')$q$,
  '42501'
);
reset role;

-- The owner may reschedule, and the active request status remains unchanged.
set role authenticated;
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', false);
select public.reschedule_appointment('e8000000-0000-4000-8000-000000000001', current_setting('test.reschedule_day')::date, '13:00');
reset role;
do $$ begin
  if not exists (
    select 1 from public.appointments
    where id = 'e8000000-0000-4000-8000-000000000001'
      and start_time = '13:00'
      and status = 'pending'
  ) then raise exception 'professional reschedule did not preserve appointment status'; end if;
end $$;