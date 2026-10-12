create table if not exists public.business_subscriptions (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  checkout_request_id uuid,
  checkout_expires_at timestamptz,
  stripe_price_id text,
  plan text not null check (plan in ('basic', 'plus')),
  status text not null check (status in (
    'active',
    'canceled',
    'checkout_pending',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'paused',
    'trialing',
    'unpaid'
  )),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_event_created_at timestamptz not null default now(),
  last_stripe_event_id text,
  last_stripe_event_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_subscriptions_owner_idx
  on public.business_subscriptions(owner_id);
create index if not exists business_subscriptions_entitlement_idx
  on public.business_subscriptions(plan, status, current_period_end);

create table if not exists public.stripe_processed_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.business_subscriptions enable row level security;
alter table public.stripe_processed_events enable row level security;

revoke all on public.business_subscriptions from public, anon, authenticated;
revoke all on public.stripe_processed_events from public, anon, authenticated;

grant select (
  business_id,
  owner_id,
  plan,
  status,
  current_period_start,
  current_period_end,
  cancel_at_period_end,
  checkout_expires_at,
  created_at,
  updated_at
) on public.business_subscriptions to authenticated;
grant all on public.business_subscriptions to service_role;
grant all on public.stripe_processed_events to service_role;

drop policy if exists "business owners read own subscription" on public.business_subscriptions;
create policy "business owners read own subscription"
on public.business_subscriptions for select to authenticated
using (
  owner_id = auth.uid()
  and public.is_business_owner(business_id)
);

create or replace function public.sync_stripe_subscription_state(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_business_id uuid,
  p_owner_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_plan text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_events integer;
  event_time timestamptz := coalesce(p_event_created_at, clock_timestamp());
begin
  if p_event_id is not null then
    if length(p_event_id) > 255 or p_event_type is null or length(p_event_type) > 128 then
      raise exception 'Invalid Stripe event metadata';
    end if;

    insert into public.stripe_processed_events(event_id, event_type)
    values (p_event_id, p_event_type)
    on conflict (event_id) do nothing;
    get diagnostics inserted_events = row_count;
    if inserted_events = 0 then
      return false;
    end if;
  end if;

  if p_business_id is null then
    return true;
  end if;

  if p_owner_id is null
     or p_stripe_customer_id is null
     or p_stripe_subscription_id is null
     or p_stripe_price_id is null
      or p_plan is null
      or p_status is null
      or p_current_period_start is null
      or p_current_period_end is null
      or p_cancel_at_period_end is null
      or (p_plan = 'basic' and p_stripe_price_id <> 'price_1UJHObQfYqQ6BGmE9CqD61td')
      or (p_plan = 'plus' and p_stripe_price_id <> 'price_1UJHPAQfYqQ6BGmENDRIFPCF')
     or p_plan not in ('basic', 'plus')
     or p_status not in (
       'active', 'canceled', 'incomplete', 'incomplete_expired',
       'past_due', 'paused', 'trialing', 'unpaid'
     ) then
    raise exception 'Invalid Stripe subscription state';
  end if;

  if not exists (
    select 1 from public.businesses b
    where b.id = p_business_id
      and b.owner_id = p_owner_id
  ) then
    raise exception 'Stripe subscription owner mismatch';
  end if;

  insert into public.business_subscriptions (
    business_id,
    owner_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    plan,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    stripe_event_created_at,
    last_stripe_event_id,
    last_stripe_event_type,
    updated_at
  ) values (
    p_business_id,
    p_owner_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_price_id,
    p_plan,
    p_status,
    p_current_period_start,
    p_current_period_end,
    coalesce(p_cancel_at_period_end, false),
    event_time,
    p_event_id,
    p_event_type,
    clock_timestamp()
  )
  on conflict (business_id) do update set
    owner_id = excluded.owner_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_checkout_session_id = null,
    checkout_request_id = null,
    checkout_expires_at = null,
    stripe_price_id = excluded.stripe_price_id,
    plan = excluded.plan,
    status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_event_created_at = excluded.stripe_event_created_at,
    last_stripe_event_id = excluded.last_stripe_event_id,
    last_stripe_event_type = excluded.last_stripe_event_type,
    updated_at = clock_timestamp()
  where public.business_subscriptions.stripe_event_created_at <= excluded.stripe_event_created_at;

  return true;
end;
$$;

revoke all on function public.sync_stripe_subscription_state(
  text, text, timestamptz, uuid, uuid, text, text, text, text, text,
  timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.sync_stripe_subscription_state(
  text, text, timestamptz, uuid, uuid, text, text, text, text, text,
  timestamptz, timestamptz, boolean
) to service_role;

create or replace function public.reserve_stripe_checkout(
  target_business uuid,
  target_owner uuid,
  target_request uuid,
  target_plan text,
  target_price text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved boolean;
  now_at timestamptz := clock_timestamp();
begin
  if target_plan not in ('basic', 'plus')
     or (target_plan = 'basic' and target_price <> 'price_1UJHObQfYqQ6BGmE9CqD61td')
     or (target_plan = 'plus' and target_price <> 'price_1UJHPAQfYqQ6BGmENDRIFPCF') then
    return false;
  end if;

  if not exists (
    select 1 from public.businesses b
    where b.id = target_business and b.owner_id = target_owner
  ) then
    return false;
  end if;

  insert into public.business_subscriptions (
    business_id, owner_id, stripe_customer_id, stripe_subscription_id,
    stripe_checkout_session_id, checkout_request_id, checkout_expires_at,
    stripe_price_id, plan, status, current_period_start, current_period_end,
    cancel_at_period_end, stripe_event_created_at, updated_at
  ) values (
    target_business, target_owner, null, null, null, target_request,
    now_at + interval '24 hours', target_price, target_plan, 'checkout_pending',
    null, null, false, now_at, now_at
  )
  on conflict (business_id) do update set
    owner_id = excluded.owner_id,
    stripe_subscription_id = null,
    stripe_checkout_session_id = case
      when public.business_subscriptions.status = 'checkout_pending'
       and public.business_subscriptions.checkout_request_id = target_request
       and public.business_subscriptions.checkout_expires_at > now_at
        then public.business_subscriptions.stripe_checkout_session_id
      else null
    end,
    checkout_request_id = target_request,
    checkout_expires_at = case
      when public.business_subscriptions.status = 'checkout_pending'
       and public.business_subscriptions.checkout_request_id = target_request
       and public.business_subscriptions.checkout_expires_at > now_at
        then public.business_subscriptions.checkout_expires_at
      else now_at + interval '24 hours'
    end,
    stripe_price_id = target_price,
    plan = target_plan,
    status = 'checkout_pending',
    current_period_start = null,
    current_period_end = null,
    cancel_at_period_end = false,
    stripe_event_created_at = now_at,
    updated_at = now_at
  where (
    public.business_subscriptions.status = 'checkout_pending'
    and (
      public.business_subscriptions.checkout_expires_at <= now_at
      or (
        public.business_subscriptions.checkout_request_id = target_request
        and public.business_subscriptions.plan = target_plan
        and public.business_subscriptions.stripe_price_id = target_price
      )
    )
  ) or (
    public.business_subscriptions.status in ('canceled', 'incomplete_expired')
    and (
      public.business_subscriptions.current_period_end is null
      or public.business_subscriptions.current_period_end <= now_at
    )
  )
  returning true into reserved;

  return coalesce(reserved, false);
end;
$$;

create or replace function public.attach_stripe_checkout_session(
  target_business uuid,
  target_owner uuid,
  target_request uuid,
  target_session text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_rows integer;
begin
  update public.business_subscriptions
  set stripe_checkout_session_id = target_session,
      updated_at = clock_timestamp()
  where business_id = target_business
    and owner_id = target_owner
    and status = 'checkout_pending'
    and checkout_request_id = target_request
    and checkout_expires_at > clock_timestamp();
  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

create or replace function public.release_stripe_checkout_reservation(
  target_business uuid,
  target_owner uuid,
  target_request uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.business_subscriptions
  set checkout_expires_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where business_id = target_business
    and owner_id = target_owner
    and status = 'checkout_pending'
    and checkout_request_id = target_request;
$$;

revoke all on function public.reserve_stripe_checkout(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.attach_stripe_checkout_session(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_stripe_checkout_reservation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_stripe_checkout(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.attach_stripe_checkout_session(uuid, uuid, uuid, text) to service_role;
grant execute on function public.release_stripe_checkout_reservation(uuid, uuid, uuid) to service_role;

create or replace function public.expire_stripe_checkout(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_business_id uuid,
  p_owner_id uuid,
  p_request_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_events integer;
begin
  insert into public.stripe_processed_events(event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do nothing;
  get diagnostics inserted_events = row_count;
  if inserted_events = 0 then
    return false;
  end if;

  if not exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.owner_id = p_owner_id
  ) then
    raise exception 'Stripe checkout owner mismatch';
  end if;

  update public.business_subscriptions
  set status = 'incomplete_expired',
      stripe_checkout_session_id = null,
      checkout_request_id = null,
      checkout_expires_at = null,
      stripe_event_created_at = coalesce(p_event_created_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where business_id = p_business_id
    and owner_id = p_owner_id
    and status = 'checkout_pending'
    and checkout_request_id = p_request_id
    and stripe_checkout_session_id = p_session_id;

  return true;
end;
$$;

revoke all on function public.expire_stripe_checkout(text, text, timestamptz, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.expire_stripe_checkout(text, text, timestamptz, uuid, uuid, uuid, text) to service_role;

create or replace function public.list_active_plus_businesses()
returns table (
  id uuid,
  name text,
  slug text,
  description text,
  address text,
  city text,
  category text,
  phone text,
  logo_url text,
  cover_image_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.name,
    b.slug,
    b.description,
    b.address,
    b.city,
    b.category,
    b.phone,
    b.logo_url,
    b.cover_image_url
  from public.businesses b
  join public.business_subscriptions s on s.business_id = b.id
  where s.plan = 'plus'
    and s.status = 'active'
    and s.current_period_end > now()
  order by b.name;
$$;

revoke all on function public.list_active_plus_businesses() from public;
grant execute on function public.list_active_plus_businesses() to anon, authenticated;
