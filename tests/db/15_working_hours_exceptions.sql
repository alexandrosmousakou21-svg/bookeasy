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
  ('f4000000-0000-4000-8000-000000000001'),
  ('f4000000-0000-4000-8000-000000000002'),
  ('f4000000-0000-4000-8000-000000000003');
insert into public.businesses (id, owner_id, name, slug) values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Availability test', 'availability-test');
insert into public.services (id, business_id, name, duration_minutes, is_active) values
  ('f6000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'Consultation', 30, true);
insert into public.staff (id, business_id, name, is_active) values
  ('f7000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'Staff', true);
select set_config('test.availability_day', (current_date + 20)::text, false);

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', false);
select public.replace_availability_schedule(
  'f5000000-0000-4000-8000-000000000001',
  null,
  jsonb_build_array(jsonb_build_object(
    'day_of_week', extract(dow from current_setting('test.availability_day')::date)::integer,
    'start_time', '09:00', 'end_time', '17:00', 'is_closed', false
  )),
  jsonb_build_array(jsonb_build_object(
    'day_of_week', extract(dow from current_setting('test.availability_day')::date)::integer,
    'start_time', '12:00', 'end_time', '13:00'
  )),
  jsonb_build_array(
    jsonb_build_object('exception_date', (current_setting('test.availability_day')::date + 1), 'is_closed', true, 'start_time', null, 'end_time', null),
    jsonb_build_object('exception_date', (current_setting('test.availability_day')::date + 2), 'is_closed', false, 'start_time', '11:00', 'end_time', '14:00')
  )
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000002', false);
select pg_temp.expect_state($q$
  insert into public.appointments
    (business_id, customer_id, staff_id, service_id, appointment_date, start_time, end_time, starts_at, ends_at, customer_name)
  values
    ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002',
     'f7000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001',
     current_setting('test.availability_day')::date, '12:00', '12:30',
     ((current_setting('test.availability_day')::date + time '12:00') at time zone 'Europe/Athens'),
     ((current_setting('test.availability_day')::date + time '12:30') at time zone 'Europe/Athens'), 'Customer')
$q$, 'BK006');
select pg_temp.expect_state($q$
  insert into public.appointments
    (business_id, customer_id, staff_id, service_id, appointment_date, start_time, end_time, starts_at, ends_at, customer_name)
  values
    ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002',
     'f7000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001',
     current_setting('test.availability_day')::date + 1, '10:00', '10:30',
     (((current_setting('test.availability_day')::date + 1) + time '10:00') at time zone 'Europe/Athens'),
     (((current_setting('test.availability_day')::date + 1) + time '10:30') at time zone 'Europe/Athens'), 'Customer')
$q$, 'BK006');
select pg_temp.expect_state($q$
  insert into public.appointments
    (business_id, customer_id, staff_id, service_id, appointment_date, start_time, end_time, starts_at, ends_at, customer_name)
  values
    ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002',
     'f7000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001',
     current_setting('test.availability_day')::date + 2, '10:00', '10:30',
     (((current_setting('test.availability_day')::date + 2) + time '10:00') at time zone 'Europe/Athens'),
     (((current_setting('test.availability_day')::date + 2) + time '10:30') at time zone 'Europe/Athens'), 'Customer')
$q$, 'BK002');
insert into public.appointments
  (business_id, customer_id, staff_id, service_id, appointment_date, start_time, end_time, starts_at, ends_at, customer_name)
values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002',
   'f7000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001',
   current_setting('test.availability_day')::date + 2, '11:00', '11:30',
   (((current_setting('test.availability_day')::date + 2) + time '11:00') at time zone 'Europe/Athens'),
   (((current_setting('test.availability_day')::date + 2) + time '11:30') at time zone 'Europe/Athens'), 'Customer');
reset role;

create temp table availability_snapshot as
select count(*) as breaks from public.working_hour_breaks where business_id = 'f5000000-0000-4000-8000-000000000001';
grant select on availability_snapshot to public;
set role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000003', false);
select pg_temp.expect_state($q$select public.replace_availability_schedule(
  'f5000000-0000-4000-8000-000000000001', null, '[]'::jsonb,
  '[{"day_of_week":1,"start_time":"13:00","end_time":"12:00"}]'::jsonb, '[]'::jsonb)$q$, '42501');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', false);
select pg_temp.expect_state($q$select public.save_business_profile_with_schedule(
  'f5000000-0000-4000-8000-000000000001',
  '{"name":"Changed","slug":"availability-changed","primary_color":"#A78BFA"}'::jsonb,
  '{"professional_email":"owner@example.test","time_zone":"Europe/Athens"}'::jsonb,
  '[]'::jsonb,
  '[{"day_of_week":1,"start_time":"14:00","end_time":"13:00"}]'::jsonb,
  '[]'::jsonb,
  array[]::text[])$q$, '22023');
reset role;
do $$ begin
  if (select breaks from availability_snapshot) <> (
    select count(*) from public.working_hour_breaks where business_id = 'f5000000-0000-4000-8000-000000000001'
  ) then raise exception 'unauthorized schedule save changed persisted breaks'; end if;
  if (select name from public.businesses where id = 'f5000000-0000-4000-8000-000000000001') <> 'Availability test' then
    raise exception 'failed profile+schedule save changed business data';
  end if;
end $$;