-- Booking integrity and atomic-save tests. Runs only against the disposable local database.
\set ON_ERROR_STOP on

create or replace function pg_temp.expect_state(statement text, expected text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'expected SQLSTATE % but statement succeeded: %', expected, left(statement, 120);
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'expected SQLSTATE%' then raise; end if;
  if sqlstate <> expected then
    raise exception 'expected SQLSTATE % but got % (%): %', expected, sqlstate, sqlerrm, left(statement, 120);
  end if;
end $$;
grant execute on function pg_temp.expect_state(text, text) to public;

insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000001'),  -- owner A
  ('a0000000-0000-4000-8000-000000000002'),  -- owner B
  ('a0000000-0000-4000-8000-000000000003'),  -- customer
  ('a0000000-0000-4000-8000-000000000004');  -- other customer

insert into public.businesses (id, owner_id, name, slug) values
  ('b0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 'A', 'a'),
  ('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000002', 'B', 'b');
insert into public.services (id, business_id, name, duration_minutes, is_active) values
  ('c0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'Cut', 30, true),
  ('c0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'Other', 30, true);
insert into public.staff (id, business_id, name, is_active) values
  ('d0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000a', 'Anna', true),
  ('d0000000-0000-4000-8000-00000000000c', 'b0000000-0000-4000-8000-00000000000a', 'Inactive', false),
  ('d0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b', 'Bob', true);
insert into public.working_hours (business_id, staff_id, day_of_week, start_time, end_time, is_closed)
select 'b0000000-0000-4000-8000-00000000000a', null, d, '09:00', '17:00', false from generate_series(0, 6) d;

select set_config('test.day', (current_date + 14)::text, false);

-- Helper that builds an insert for business A with overridable values.
create or replace function pg_temp.book(
  p_start time, p_minutes int default 30, p_day date default (current_setting('test.day'))::date,
  p_staff uuid default 'd0000000-0000-4000-8000-00000000000a',
  p_service uuid default 'c0000000-0000-4000-8000-00000000000a',
  p_customer uuid default 'a0000000-0000-4000-8000-000000000003',
  p_end_shift int default 0
) returns text language sql as $$
  select format($f$insert into public.appointments
    (business_id, customer_id, staff_id, service_id, appointment_date, start_time, end_time, starts_at, ends_at, customer_name)
    values ('b0000000-0000-4000-8000-00000000000a', %L, %L, %L, %L, %L, %L,
            ((%L::date + %L::time) at time zone 'Europe/Athens'),
            ((%L::date + %L::time) at time zone 'Europe/Athens') + make_interval(mins => %s), 'Customer')$f$,
    p_customer, p_staff, p_service, p_day, p_start, p_start + make_interval(mins => p_minutes),
    p_day, p_start, p_day, p_start, p_minutes + p_end_shift)
$$;
grant execute on function pg_temp.book(time, int, date, uuid, uuid, uuid, int) to public;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', false);

-- Valid booking is accepted.
select pg_temp.book('10:00') \gexec

-- Overlap with the same staff member is rejected by the exclusion constraint, adjacent slot is fine.
select pg_temp.expect_state(pg_temp.book('10:15'), '23P01');
select pg_temp.book('10:30') \gexec

-- Outside working hours / too early / too late.
select pg_temp.expect_state(pg_temp.book('07:00'), 'BK002');
select pg_temp.expect_state(pg_temp.book('16:45'), 'BK002');
-- Duration mismatch (45 minutes for a 30-minute service) and inconsistent end timestamp.
select pg_temp.expect_state(pg_temp.book('12:00', 45), 'BK003');
select pg_temp.expect_state(pg_temp.book('12:00', 30, (current_setting('test.day'))::date, 'd0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000003', 15), 'BK003');
-- Wrong business for service or staff, inactive staff.
select pg_temp.expect_state(pg_temp.book('12:00', 30, (current_setting('test.day'))::date, 'd0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000b'), 'BK001');
select pg_temp.expect_state(pg_temp.book('12:00', 30, (current_setting('test.day'))::date, 'd0000000-0000-4000-8000-00000000000b'), 'BK001');
select pg_temp.expect_state(pg_temp.book('12:00', 30, (current_setting('test.day'))::date, 'd0000000-0000-4000-8000-00000000000c'), 'BK001');
-- Past date.
select pg_temp.expect_state(pg_temp.book('10:00', 30, current_date - 3), 'BK004');
-- Impersonating another customer is blocked by RLS.
select pg_temp.expect_state(pg_temp.book('13:00', 30, (current_setting('test.day'))::date, 'd0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004'), '42501');

-- Customer can cancel, which frees the slot for the other customer.
update public.appointments set status = 'cancelled'
where customer_id = 'a0000000-0000-4000-8000-000000000003' and start_time = '10:00';
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000004', false);
select pg_temp.book('10:00', 30, (current_setting('test.day'))::date, 'd0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000004') \gexec

reset role;
do $$ begin
  if not exists (
    select 1 from public.appointments
    where customer_id = 'a0000000-0000-4000-8000-000000000003'
      and start_time = '10:00'
      and status = 'cancelled'
  ) then
    raise exception 'cancellation must preserve appointment history';
  end if;
end $$;

-- Closed day and staff-specific hours override business hours.
update public.working_hours set is_closed = true
where business_id = 'b0000000-0000-4000-8000-00000000000a'
  and day_of_week = extract(dow from (current_setting('test.day'))::date) and staff_id is null;
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', false);
select pg_temp.expect_state(pg_temp.book('14:00'), 'BK002');
reset role;
insert into public.working_hours (business_id, staff_id, day_of_week, start_time, end_time, is_closed)
values ('b0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a',
        extract(dow from (current_setting('test.day'))::date), '13:00', '15:00', false);
set role authenticated;
select pg_temp.book('14:00') \gexec
select pg_temp.expect_state(pg_temp.book('12:00'), 'BK002');
reset role;

-- Atomic saves: a failing replace keeps the previous hours; strangers cannot replace them.
create temp table hours_snapshot as
select count(*) as n from public.working_hours where business_id = 'b0000000-0000-4000-8000-00000000000a' and staff_id is null;
grant select on hours_snapshot to public;
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select pg_temp.expect_state($q$select public.replace_working_hours('b0000000-0000-4000-8000-00000000000a', null,
  '[{"day_of_week":1,"start_time":"09:00","end_time":"17:00","is_closed":false},{"day_of_week":2,"start_time":"18:00","end_time":"09:00","is_closed":false}]'::jsonb)$q$, '23514');
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', false);
select pg_temp.expect_state($q$select public.replace_working_hours('b0000000-0000-4000-8000-00000000000a', null, '[]'::jsonb)$q$, '42501');
reset role;
do $$ begin
  if (select n from hours_snapshot) <> (select count(*) from public.working_hours where business_id = 'b0000000-0000-4000-8000-00000000000a' and staff_id is null) then
    raise exception 'failed save destroyed working hours';
  end if;
end $$;

-- save_business_profile is all-or-nothing: a duplicate slug rolls back hours and media too.
insert into public.business_media (business_id, url, sort_order) values ('b0000000-0000-4000-8000-00000000000a', 'https://example.test/keep.jpg', 0);
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select pg_temp.expect_state($q$select public.save_business_profile('b0000000-0000-4000-8000-00000000000a',
  '{"name":"A2","slug":"b","primary_color":"#A78BFA"}'::jsonb,
  '{"professional_email":"a@example.test","time_zone":"Europe/Athens"}'::jsonb,
  '[]'::jsonb, array['https://example.test/new.jpg'])$q$, '23505');
reset role;
do $$ begin
  if (select count(*) from public.business_media where business_id = 'b0000000-0000-4000-8000-00000000000a' and url = 'https://example.test/keep.jpg') <> 1 then
    raise exception 'failed profile save lost existing media';
  end if;
  if (select count(*) from public.working_hours where business_id = 'b0000000-0000-4000-8000-00000000000a' and staff_id is null) = 0 then
    raise exception 'failed profile save lost working hours';
  end if;
  if (select name from public.businesses where id = 'b0000000-0000-4000-8000-00000000000a') <> 'A' then
    raise exception 'failed profile save changed the business';
  end if;
end $$;

-- A successful save replaces everything together.
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
select public.save_business_profile('b0000000-0000-4000-8000-00000000000a',
  '{"name":"A2","slug":"a2","primary_color":"#A78BFA"}'::jsonb,
  '{"professional_email":"a@example.test","time_zone":"Europe/Athens"}'::jsonb,
  '[{"day_of_week":1,"start_time":"09:00","end_time":"17:00","is_closed":false}]'::jsonb,
  array['https://example.test/new.jpg']);
reset role;
do $$ begin
  if (select count(*) from public.working_hours where business_id = 'b0000000-0000-4000-8000-00000000000a' and staff_id is null) <> 1 then raise exception 'hours not replaced'; end if;
  if (select url from public.business_media where business_id = 'b0000000-0000-4000-8000-00000000000a') <> 'https://example.test/new.jpg' then raise exception 'media not replaced'; end if;
end $$;
