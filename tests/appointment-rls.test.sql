\set ON_ERROR_STOP on
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
grant usage on schema auth, public to authenticated, service_role;
grant execute on all functions in schema auth to authenticated, service_role;
\i /schema.sql
alter table public.appointments add column request_key uuid;
\i /migration.sql
grant select, update on public.appointments to authenticated, service_role;
grant select on public.businesses to authenticated, service_role;

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003');
insert into public.businesses (id, owner_id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Test', 'test');
insert into public.staff (id, business_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Staff');
insert into public.services (id, business_id, name, duration_minutes) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Service', 30);
insert into public.appointments (id, business_id, customer_id, staff_id, service_id, appointment_date, start_time, end_time, starts_at, ends_at, customer_name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '2026-11-09', '09:00', '09:30', '2026-11-09 09:00+00', '2026-11-09 09:30+00', 'Customer'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '2026-11-09', '10:00', '10:30', '2026-11-09 10:00+00', '2026-11-09 10:30+00', 'Other');

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$
declare affected integer;
begin
  update public.appointments set status = 'cancelled' where id = '40000000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Updated another customer appointment'; end if;
  begin
    update public.appointments set status = 'cancelled', customer_name = 'Changed' where id = '40000000-0000-0000-0000-000000000001';
    raise exception 'Protected field update succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.appointments set status = 'confirmed' where id = '40000000-0000-0000-0000-000000000001';
    raise exception 'Customer status escalation succeeded';
  exception when insufficient_privilege then null;
  end;
  update public.appointments set status = 'cancelled' where id = '40000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own cancellation failed'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
update public.appointments set customer_name = 'Owner edit' where id = '40000000-0000-0000-0000-000000000001';
reset role;
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
update public.appointments set customer_name = 'Service edit' where id = '40000000-0000-0000-0000-000000000001';
reset role;