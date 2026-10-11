-- NOTIFICATION FOUNDATION PHASE
-- Production-grade outbox architecture without external service integration yet.

-- ============================================================================
-- 1. ADD TIMEZONE TO BUSINESSES
-- ============================================================================

alter table public.businesses
add column timezone text not null default 'Europe/Athens';

-- Verify column was added
alter table public.businesses
add constraint timezone_not_empty check (char_length(timezone) > 0);

-- ============================================================================
-- 2. NOTIFICATION OUTBOX TABLE
-- ============================================================================

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,
  recipient_phone text,
  event_type text not null check (event_type in (
    'appointment_created',
    'appointment_confirmed',
    'appointment_cancelled',
    'appointment_rescheduled',
    'appointment_completed',
    'appointment_deleted'
  )),
  channel text not null check (channel in ('email', 'sms', 'push', 'in_app')),
  payload jsonb not null default '{}',
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in (
    'pending',
    'scheduled',
    'sent',
    'failed',
    'cancelled'
  )),
  attempts integer not null default 0,
  last_error text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- At least one recipient field must be set
  constraint has_recipient check (
    recipient_user_id is not null 
    or recipient_email is not null 
    or recipient_phone is not null
  )
);

-- Indexes for outbox processing
create index notification_outbox_pending_idx on public.notification_outbox(status, scheduled_for)
  where status in ('pending', 'scheduled');
create index notification_outbox_appointment_idx on public.notification_outbox(appointment_id);
create index notification_outbox_business_idx on public.notification_outbox(business_id);
create index notification_outbox_recipient_user_idx on public.notification_outbox(recipient_user_id);
create index notification_outbox_created_idx on public.notification_outbox(created_at desc);

-- ============================================================================
-- 3. NOTIFICATION PREFERENCES TABLE
-- ============================================================================

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'push', 'in_app')),
  notification_type text not null check (notification_type in (
    'appointment_created',
    'appointment_confirmed',
    'appointment_cancelled',
    'appointment_rescheduled',
    'appointment_completed',
    'appointment_deleted'
  )),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique (user_id, channel, notification_type)
);

create index notification_preferences_user_idx on public.notification_preferences(user_id);

alter table public.notification_preferences enable row level security;

-- Users can read and update only their own notification preferences
create policy "users read own notification preferences"
on public.notification_preferences for select
using (user_id = auth.uid());

create policy "users update own notification preferences"
on public.notification_preferences for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users insert own notification preferences"
on public.notification_preferences for insert
with check (user_id = auth.uid());

-- ============================================================================
-- 4. PUSH DEVICES TABLE
-- ============================================================================

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('web', 'ios', 'android')),
  token text not null unique,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_devices_user_idx on public.push_devices(user_id);
create index push_devices_active_idx on public.push_devices(user_id, disabled_at)
  where disabled_at is null;

alter table public.push_devices enable row level security;

-- Users can read and manage only their own devices
create policy "users read own push devices"
on public.push_devices for select
using (user_id = auth.uid());

create policy "users insert own push devices"
on public.push_devices for insert
with check (user_id = auth.uid());

create policy "users update own push devices"
on public.push_devices for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users delete own push devices"
on public.push_devices for delete
using (user_id = auth.uid());

-- ============================================================================
-- 5. OUTBOX RLS (SERVICE ROLE ONLY)
-- ============================================================================

alter table public.notification_outbox enable row level security;

-- Authenticated users cannot access outbox
create policy "service_role_only_outbox_select"
on public.notification_outbox for select
using (false);

create policy "service_role_only_outbox_insert"
on public.notification_outbox for insert
with check (false);

create policy "service_role_only_outbox_update"
on public.notification_outbox for update
using (false)
with check (false);

create policy "service_role_only_outbox_delete"
on public.notification_outbox for delete
using (false);

-- ============================================================================
-- 6. APPOINTMENT TRIGGERS
-- ============================================================================

-- Helper function: generate deterministic dedupe key
create or replace function public.generate_dedupe_key(
  p_appointment_id uuid,
  p_event_type text,
  p_recipient_id uuid,
  p_version_hash text default ''
)
returns text
language sql
immutable
as $$
  select concat(
    p_appointment_id::text,
    ':',
    p_event_type,
    ':',
    p_recipient_id::text,
    ':',
    p_version_hash
  );
$$;

-- Helper function: generate appointment snapshot payload
create or replace function public.generate_appointment_payload(p_appointment record)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'appointment_id', p_appointment.id,
    'business_id', p_appointment.business_id,
    'customer_id', p_appointment.customer_id,
    'customer_name', p_appointment.customer_name,
    'customer_email', p_appointment.customer_email,
    'customer_phone', p_appointment.customer_phone,
    'staff_id', p_appointment.staff_id,
    'service_id', p_appointment.service_id,
    'status', p_appointment.status,
    'appointment_date', p_appointment.appointment_date,
    'start_time', p_appointment.start_time,
    'end_time', p_appointment.end_time,
    'starts_at', p_appointment.starts_at,
    'ends_at', p_appointment.ends_at,
    'created_at', p_appointment.created_at
  );
$$;

-- Main trigger function: handle all appointment events
create or replace function public.handle_appointment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_owner_id uuid;
  v_staff_email text;
  v_version_hash text;
  v_dedupe_key text;
  v_event_type text;
  v_payload jsonb;
begin
  -- Get business owner
  select owner_id into v_business_owner_id
  from public.businesses
  where id = (case when tg_op = 'DELETE' then old.business_id else new.business_id end);
  
  if tg_op = 'INSERT' then
    -- INSERT: appointment_created
    v_event_type := 'appointment_created';
    v_payload := generate_appointment_payload(new);
    v_version_hash := md5(concat(new.id::text, new.created_at::text));
    
    -- Insert outbox entries for business owner
    if v_business_owner_id is not null then
      v_dedupe_key := generate_dedupe_key(new.id, v_event_type, v_business_owner_id, v_version_hash);
      insert into public.notification_outbox (
        business_id, appointment_id, recipient_user_id, 
        event_type, channel, payload, dedupe_key, status
      ) values (
        new.business_id, new.id, v_business_owner_id,
        v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
      )
      on conflict (dedupe_key) do nothing;
    end if;
    
    -- Insert outbox entries for customer
    if new.customer_id is not null then
      v_dedupe_key := generate_dedupe_key(new.id, v_event_type, new.customer_id, v_version_hash);
      insert into public.notification_outbox (
        business_id, appointment_id, recipient_user_id, recipient_email,
        event_type, channel, payload, dedupe_key, status
      ) values (
        new.business_id, new.id, new.customer_id, new.customer_email,
        v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
      )
      on conflict (dedupe_key) do nothing;
    end if;
    
    -- Insert outbox entries for staff (only if email exists)
    select email into v_staff_email from public.staff where id = new.staff_id;
    if v_staff_email is not null then
      v_dedupe_key := generate_dedupe_key(new.id, v_event_type, new.staff_id, v_version_hash);
      insert into public.notification_outbox (
        business_id, appointment_id, recipient_email,
        event_type, channel, payload, dedupe_key, status
      ) values (
        new.business_id, new.id, v_staff_email,
        v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
      )
      on conflict (dedupe_key) do nothing;
    end if;
    
    return new;
    
  elsif tg_op = 'UPDATE' then
    v_payload := generate_appointment_payload(new);
    
    -- Status transitions
    if old.status <> new.status then
      if new.status = 'confirmed' and old.status <> 'confirmed' then
        v_event_type := 'appointment_confirmed';
        v_version_hash := md5(concat(new.id::text, new.status, new.updated_at::text));
        
        -- Business owner
        if v_business_owner_id is not null then
          v_dedupe_key := generate_dedupe_key(new.id, v_event_type, v_business_owner_id, v_version_hash);
          insert into public.notification_outbox (
            business_id, appointment_id, recipient_user_id,
            event_type, channel, payload, dedupe_key, status
          ) values (
            new.business_id, new.id, v_business_owner_id,
            v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
          )
          on conflict (dedupe_key) do nothing;
        end if;
        
        -- Customer
        if new.customer_id is not null then
          v_dedupe_key := generate_dedupe_key(new.id, v_event_type, new.customer_id, v_version_hash);
          insert into public.notification_outbox (
            business_id, appointment_id, recipient_user_id, recipient_email,
            event_type, channel, payload, dedupe_key, status
          ) values (
            new.business_id, new.id, new.customer_id, new.customer_email,
            v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
          )
          on conflict (dedupe_key) do nothing;
        end if;
        
      elsif new.status = 'cancelled' and old.status <> 'cancelled' then
        v_event_type := 'appointment_cancelled';
        v_version_hash := md5(concat(new.id::text, new.status, new.updated_at::text));
        
        -- Business owner
        if v_business_owner_id is not null then
          v_dedupe_key := generate_dedupe_key(new.id, v_event_type, v_business_owner_id, v_version_hash);
          insert into public.notification_outbox (
            business_id, appointment_id, recipient_user_id,
            event_type, channel, payload, dedupe_key, status
          ) values (
            new.business_id, new.id, v_business_owner_id,
            v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
          )
          on conflict (dedupe_key) do nothing;
        end if;
        
        -- Customer
        if new.customer_id is not null then
          v_dedupe_key := generate_dedupe_key(new.id, v_event_type, new.customer_id, v_version_hash);
          insert into public.notification_outbox (
            business_id, appointment_id, recipient_user_id, recipient_email,
            event_type, channel, payload, dedupe_key, status
          ) values (
            new.business_id, new.id, new.customer_id, new.customer_email,
            v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
          )
          on conflict (dedupe_key) do nothing;
        end if;
        
      elsif new.status = 'completed' and old.status <> 'completed' then
        v_event_type := 'appointment_completed';
        v_version_hash := md5(concat(new.id::text, new.status, new.updated_at::text));
        
        -- Business owner
        if v_business_owner_id is not null then
          v_dedupe_key := generate_dedupe_key(new.id, v_event_type, v_business_owner_id, v_version_hash);
          insert into public.notification_outbox (
            business_id, appointment_id, recipient_user_id,
            event_type, channel, payload, dedupe_key, status
          ) values (
            new.business_id, new.id, v_business_owner_id,
            v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
          )
          on conflict (dedupe_key) do nothing;
        end if;
        
        -- Customer
        if new.customer_id is not null then
          v_dedupe_key := generate_dedupe_key(new.id, v_event_type, new.customer_id, v_version_hash);
          insert into public.notification_outbox (
            business_id, appointment_id, recipient_user_id, recipient_email,
            event_type, channel, payload, dedupe_key, status
          ) values (
            new.business_id, new.id, new.customer_id, new.customer_email,
            v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
          )
          on conflict (dedupe_key) do nothing;
        end if;
      end if;
    end if;
    
    -- Rescheduling: detect meaningful time change
    if (old.starts_at::date <> new.starts_at::date or 
        old.starts_at::time <> new.starts_at::time or
        old.ends_at::time <> new.ends_at::time) and
       new.status <> 'cancelled' then
      v_event_type := 'appointment_rescheduled';
      v_version_hash := md5(concat(new.id::text, new.starts_at::text, new.ends_at::text));
      
      -- Business owner
      if v_business_owner_id is not null then
        v_dedupe_key := generate_dedupe_key(new.id, v_event_type, v_business_owner_id, v_version_hash);
        insert into public.notification_outbox (
          business_id, appointment_id, recipient_user_id,
          event_type, channel, payload, dedupe_key, status
        ) values (
          new.business_id, new.id, v_business_owner_id,
          v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
        )
        on conflict (dedupe_key) do nothing;
      end if;
      
      -- Customer
      if new.customer_id is not null then
        v_dedupe_key := generate_dedupe_key(new.id, v_event_type, new.customer_id, v_version_hash);
        insert into public.notification_outbox (
          business_id, appointment_id, recipient_user_id, recipient_email,
          event_type, channel, payload, dedupe_key, status
        ) values (
          new.business_id, new.id, new.customer_id, new.customer_email,
          v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
        )
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
    
    return new;
    
  elsif tg_op = 'DELETE' then
    -- DELETE: appointment_deleted
    v_event_type := 'appointment_deleted';
    v_payload := generate_appointment_payload(old);
    v_version_hash := md5(concat(old.id::text, old.deleted_at_marker::text));
    
    -- Business owner
    if v_business_owner_id is not null then
      v_dedupe_key := generate_dedupe_key(old.id, v_event_type, v_business_owner_id, v_version_hash);
      insert into public.notification_outbox (
        business_id, appointment_id, recipient_user_id,
        event_type, channel, payload, dedupe_key, status
      ) values (
        old.business_id, old.id, v_business_owner_id,
        v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
      )
      on conflict (dedupe_key) do nothing;
    end if;
    
    -- Customer
    if old.customer_id is not null then
      v_dedupe_key := generate_dedupe_key(old.id, v_event_type, old.customer_id, v_version_hash);
      insert into public.notification_outbox (
        business_id, appointment_id, recipient_user_id, recipient_email,
        event_type, channel, payload, dedupe_key, status
      ) values (
        old.business_id, old.id, old.customer_id, old.customer_email,
        v_event_type, 'email', v_payload, v_dedupe_key, 'pending'
      )
      on conflict (dedupe_key) do nothing;
    end if;
    
    return old;
  end if;
  
  return null;
end;
$$;

-- Attach trigger to appointments table
drop trigger if exists trigger_appointment_events on public.appointments;
create trigger trigger_appointment_events
after insert or update or delete on public.appointments
for each row
execute function public.handle_appointment_events();

-- ============================================================================
-- END NOTIFICATION FOUNDATION
-- ============================================================================
