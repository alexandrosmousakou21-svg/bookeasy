alter table public.appointments
  add column if not exists request_key uuid;

create unique index if not exists appointments_request_key_unique
  on public.appointments(request_key)
  where request_key is not null;

create table if not exists public.business_contact_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  professional_email text,
  email_is_public boolean not null default false,
  time_zone text not null default 'Europe/Athens',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_contact_email_format check (
    professional_email is null or
    professional_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  )
);

create table if not exists public.customer_support_conversations (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  access_token_hash text not null,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'completed')),
  channel text not null default 'human'
    check (channel in ('ai', 'human')),
  unread_for_business boolean not null default true,
  unread_for_customer boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_conversation_contact check (
    customer_email is not null or customer_phone is not null
  )
);

create table if not exists public.customer_support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.customer_support_conversations(id) on delete cascade,
  client_message_id uuid unique,
  sender_type text not null check (sender_type in ('customer', 'assistant', 'professional')),
  sender_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_conversations_business_updated_idx
  on public.customer_support_conversations(business_id, updated_at desc);
create index if not exists support_conversations_contact_recent_idx
  on public.customer_support_conversations(business_id, customer_email, created_at desc);
create index if not exists support_messages_conversation_created_idx
  on public.customer_support_messages(conversation_id, created_at);

create table if not exists public.api_rate_limits (
  bucket_hash text primary key check (char_length(bucket_hash) = 64),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);

create index if not exists api_rate_limits_window_idx
  on public.api_rate_limits(window_started_at);

alter table public.business_contact_settings enable row level security;
alter table public.customer_support_conversations enable row level security;
alter table public.customer_support_messages enable row level security;
alter table public.api_rate_limits enable row level security;

revoke all on public.business_contact_settings from public, anon, authenticated;
revoke all on public.customer_support_conversations from public, anon, authenticated;
revoke all on public.customer_support_messages from public, anon, authenticated;
revoke all on public.api_rate_limits from public, anon, authenticated;

grant select, insert, update, delete on public.business_contact_settings to authenticated;
grant select (
  id,
  business_id,
  customer_name,
  customer_email,
  customer_phone,
  status,
  channel,
  unread_for_business,
  unread_for_customer,
  last_message_at,
  created_at,
  updated_at
) on public.customer_support_conversations to authenticated;
grant update (
  status,
  unread_for_business,
  unread_for_customer,
  last_message_at,
  updated_at
) on public.customer_support_conversations to authenticated;
grant select (id, conversation_id, sender_type, body, created_at)
  on public.customer_support_messages to authenticated;
grant insert (conversation_id, client_message_id, sender_type, sender_user_id, body)
  on public.customer_support_messages to authenticated;
grant all on public.business_contact_settings to service_role;
grant all on public.customer_support_conversations to service_role;
grant all on public.customer_support_messages to service_role;

create or replace function public.consume_api_rate_limit(
  target_bucket_hash text,
  window_seconds integer,
  max_requests integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  allowed boolean;
begin
  if char_length(target_bucket_hash) <> 64
     or window_seconds < 1
     or max_requests < 1 then
    return false;
  end if;

  insert into public.api_rate_limits(bucket_hash, window_started_at, request_count)
  values (target_bucket_hash, v_now, 1)
  on conflict (bucket_hash) do update
    set window_started_at = case
          when public.api_rate_limits.window_started_at + make_interval(secs => window_seconds) <= v_now
            then v_now
          else public.api_rate_limits.window_started_at
        end,
        request_count = case
          when public.api_rate_limits.window_started_at + make_interval(secs => window_seconds) <= v_now
            then 1
          else public.api_rate_limits.request_count + 1
        end
  returning request_count <= max_requests into allowed;

  if random() < 0.01 then
    delete from public.api_rate_limits
    where window_started_at < v_now - interval '1 day';
  end if;

  return coalesce(allowed, false);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

 drop policy if exists "owners manage business contact settings" on public.business_contact_settings;
create policy "owners manage business contact settings"
on public.business_contact_settings for all to authenticated
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

drop policy if exists "owners read support conversations" on public.customer_support_conversations;
create policy "owners read support conversations"
on public.customer_support_conversations for select to authenticated
using (public.is_business_owner(business_id));

drop policy if exists "owners update support conversations" on public.customer_support_conversations;
create policy "owners update support conversations"
on public.customer_support_conversations for update to authenticated
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

drop policy if exists "owners read support messages" on public.customer_support_messages;
create policy "owners read support messages"
on public.customer_support_messages for select to authenticated
using (
  exists (
    select 1
    from public.customer_support_conversations c
    where c.id = conversation_id
      and public.is_business_owner(c.business_id)
  )
);

drop policy if exists "owners reply to support messages" on public.customer_support_messages;
create policy "owners reply to support messages"
on public.customer_support_messages for insert to authenticated
with check (
  sender_type = 'professional'
  and sender_user_id = auth.uid()
  and exists (
    select 1
    from public.customer_support_conversations c
    where c.id = conversation_id
      and public.is_business_owner(c.business_id)
  )
);

create or replace function public.get_booked_intervals(
  target_business uuid,
  target_staff uuid,
  target_date date
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.starts_at, a.ends_at
  from public.appointments a
  join public.staff s on s.id = a.staff_id and s.business_id = a.business_id
  where a.business_id = target_business
    and a.staff_id = target_staff
    and a.appointment_date = target_date
    and a.status <> 'cancelled'
    and s.is_active = true;
$$;

revoke all on function public.get_booked_intervals(uuid, uuid, date) from public;
grant execute on function public.get_booked_intervals(uuid, uuid, date) to anon, authenticated;

create or replace function public.get_business_time_zone(target_business uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select settings.time_zone
      from public.business_contact_settings settings
      where settings.business_id = target_business
    ),
    'Europe/Athens'
  );
$$;

revoke all on function public.get_business_time_zone(uuid) from public;
grant execute on function public.get_business_time_zone(uuid) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'customer_support_conversations'
     ) then
    alter publication supabase_realtime add table public.customer_support_conversations;
  end if;
end;
$$;
