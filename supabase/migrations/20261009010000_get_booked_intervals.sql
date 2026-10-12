-- get_booked_intervals: lets the public booking page (anon or authenticated) learn which time ranges of one
-- staff member are occupied on one calendar day, without exposing appointment rows or any customer data.
--
-- Contract (matches src/customer.jsx supabase.rpc("get_booked_intervals", {target_business, target_staff, target_date})):
--   returns table(starts_at timestamptz, ends_at timestamptz), ordered by starts_at.
--   target_date is a calendar date in the TARGET BUSINESS timezone (businesses.timezone), not browser/server time.
--   The window is [local midnight of target_date, local midnight of target_date + 1 day), each converted with
--   AT TIME ZONE, so DST days (23/25 hours) are handled. Appointments overlapping the window are returned,
--   including ones that start before / end after local midnight.
--   Everything except status = 'cancelled' is occupied (same rule as the no_staff_overlap constraint).
--   Unknown business, unknown staff, staff of another business or inactive staff all return an empty set
--   (no error), so the function does not reveal whether an id exists.
--
-- Index: appointments_staff_time_idx (staff_id, starts_at, ends_at) from schema.sql serves this query.
-- Intentionally CREATE OR REPLACE only (no DROP): it is not known whether a version already exists in a live DB.
-- Depends on: schema.sql, 20261008_notifications_system.sql (businesses.timezone).

create or replace function public.get_booked_intervals(
  target_business uuid,
  target_staff uuid,
  target_date date
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with biz as (
    select b.timezone as tz
      from public.businesses b
     where b.id = target_business
  ),
  win as (
    select (target_date::timestamp) at time zone biz.tz as w_start,
           ((target_date + 1)::timestamp) at time zone biz.tz as w_end
      from biz
  )
  select a.starts_at, a.ends_at
    from public.appointments a
    join public.staff s
      on s.id = a.staff_id
     and s.business_id = a.business_id
    cross join win
   where a.business_id = target_business
     and a.staff_id = target_staff
     and s.is_active
     and a.status <> 'cancelled'
     and a.starts_at < win.w_end
     and a.ends_at > win.w_start
   order by a.starts_at;
$$;

revoke all on function public.get_booked_intervals(uuid, uuid, date) from public;
grant execute on function public.get_booked_intervals(uuid, uuid, date) to anon, authenticated;
