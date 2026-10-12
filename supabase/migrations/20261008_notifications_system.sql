-- Notification foundation: outbox pattern. No provider/sending is part of this migration.
-- Additive and idempotent. Depends on schema.sql (businesses, appointments, services, staff).

-- D. business timezone (default only applies to new rows / fallback)
alter table public.businesses
  add column if not exists timezone text not null default 'Europe/Athens';

-- A. notification_outbox
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  type text not null,
  channel text not null check (channel in ('email', 'push', 'in_app')),
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint notification_outbox_dedupe_key_key unique (dedupe_key)
);
create index if not exists notification_outbox_status_available_idx
  on public.notification_outbox (status, available_at);
create index if not exists notification_outbox_business_created_idx
  on public.notification_outbox (business_id, created_at);
create index if not exists notification_outbox_user_created_idx
  on public.notification_outbox (user_id, created_at);

-- B. notification_preferences
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  booking_confirmation boolean not null default true,
  booking_cancellation boolean not null default true,
  booking_reminder boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_user_business_key unique (user_id, business_id)
);

-- C. push_devices
create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  device_token text not null,
  platform text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_devices_user_token_key unique (user_id, device_token)
);

create or replace function public.notifications_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch
before update on public.notification_preferences
for each row execute function public.notifications_touch_updated_at();

drop trigger if exists push_devices_touch on public.push_devices;
create trigger push_devices_touch
before update on public.push_devices
for each row execute function public.notifications_touch_updated_at();

-- 2. RLS
alter table public.notification_outbox enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_devices enable row level security;

-- Outbox: no policies for clients -> not readable/writable by anon/authenticated. Service role bypasses RLS.
revoke all on public.notification_outbox from anon, authenticated;

drop policy if exists "users manage own notification preferences" on public.notification_preferences;
create policy "users manage own notification preferences"
on public.notification_preferences for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users manage own push devices" on public.push_devices;
create policy "users manage own push devices"
on public.push_devices for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on public.notification_preferences from anon;
revoke all on public.push_devices from anon;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_devices to authenticated;

-- 3. Appointment events -> outbox (idempotent via dedupe_key; reminders are NOT created here)
-- SECURITY DEFINER is required so customer/owner writes can enqueue into the client-locked outbox;
-- search_path is pinned and all objects are schema-qualified.
create or replace function public.enqueue_appointment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_service text;
  v_staff text;
  v_timezone text;
begin
  if tg_op = 'INSERT' then
    v_type := 'booking_confirmation';
  elsif tg_op = 'UPDATE'
    and new.status = 'cancelled'
    and old.status is distinct from 'cancelled' then
    v_type := 'booking_cancellation';
  else
    return new;
  end if;

  select s.name into v_service from public.services s where s.id = new.service_id;
  select st.name into v_staff from public.staff st where st.id = new.staff_id;
  select b.timezone into v_timezone from public.businesses b where b.id = new.business_id;

  insert into public.notification_outbox (business_id, user_id, type, channel, dedupe_key, payload)
  values (
    new.business_id,
    new.customer_id,
    v_type,
    'email',
    'appointment:' || new.id::text || ':' || v_type,
    jsonb_build_object(
      'appointment_id', new.id,
      'business_id', new.business_id,
      'service_id', new.service_id,
      'service_name', v_service,
      'staff_id', new.staff_id,
      'staff_name', v_staff,
      'appointment_date', new.appointment_date,
      'start_time', new.start_time,
      'end_time', new.end_time,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'status', new.status,
      'timezone', coalesce(v_timezone, 'Europe/Athens'),
      'customer_name', new.customer_name,
      'customer_email', new.customer_email,
      'customer_phone', new.customer_phone
    )
  )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function public.enqueue_appointment_notification() from public, anon, authenticated;

drop trigger if exists appointments_enqueue_notification on public.appointments;
create trigger appointments_enqueue_notification
after insert or update of status on public.appointments
for each row execute function public.enqueue_appointment_notification();

-- 5. Worker helpers. Claim = FOR UPDATE SKIP LOCKED; available_at doubles as a lease so records
-- left in 'processing' by a crashed worker become claimable again after p_lease_seconds.
create or replace function public.claim_notification_outbox(
  p_batch_size integer default 10,
  p_max_attempts integer default 5,
  p_lease_seconds integer default 300
)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Exhausted records (stale lease with attempts used up) are failed instead of retried forever.
  update public.notification_outbox
     set status = 'failed',
         processed_at = now(),
         last_error = coalesce(last_error, 'max attempts exceeded')
   where status = 'processing'
     and available_at <= now()
     and attempts >= p_max_attempts;

  return query
  with picked as (
    select id
      from public.notification_outbox
     where (status = 'pending' or status = 'processing')
       and available_at <= now()
       and attempts < p_max_attempts
     order by available_at, created_at
     limit greatest(p_batch_size, 0)
     for update skip locked
  )
  update public.notification_outbox o
     set status = 'processing',
         attempts = o.attempts + 1,
         available_at = now() + make_interval(secs => p_lease_seconds)
    from picked
   where o.id = picked.id
  returning o.*;
end;
$$;

revoke all on function public.claim_notification_outbox(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_notification_outbox(integer, integer, integer) to service_role;
grant all on public.notification_outbox to service_role;
