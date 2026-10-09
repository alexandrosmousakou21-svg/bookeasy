-- Monetization + security: subscriptions, server-only writes, locked businesses.subscription_plan.
-- Additive and idempotent: no existing data is dropped.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'basic' check (plan in ('basic', 'plus')),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused')),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_stripe_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_business_idx on public.subscriptions(business_id);
create unique index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions(stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists subscriptions_stripe_subscription_idx
  on public.subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;
alter table public.subscriptions add column if not exists last_stripe_event_at timestamptz;
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

-- Idempotency log for Stripe webhook events (service role only).
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;

drop policy if exists "owners read own subscription" on public.subscriptions;
create policy "owners read own subscription"
on public.subscriptions for select
using (public.is_business_owner(business_id));

-- No insert/update/delete policies: only the service role (which bypasses RLS) may write.
revoke insert, update, delete, truncate on public.subscriptions from anon, authenticated;
revoke all on public.stripe_events from anon, authenticated;

create or replace function public.touch_subscription_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch
before update on public.subscriptions
for each row execute function public.touch_subscription_updated_at();

-- Lock businesses.subscription_plan: only trusted (non anon/authenticated) roles may change it.
create or replace function public.lock_business_subscription_plan()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.subscription_plan = 'basic';
    elsif new.subscription_plan is distinct from old.subscription_plan then
      new.subscription_plan = old.subscription_plan;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_lock_plan on public.businesses;
create trigger businesses_lock_plan
before insert or update on public.businesses
for each row execute function public.lock_business_subscription_plan();

-- Every new business starts a trial. DEFAULT TRIAL LENGTH: 14 days (technical default, not a
-- confirmed commercial policy - change the interval below if the product decides otherwise).
create or replace function public.start_business_trial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (business_id, user_id, plan, status, trial_start, trial_end)
  values (new.id, new.owner_id, 'basic', 'trialing', now(), now() + interval '14 days')
  on conflict (business_id) do nothing;
  return new;
end;
$$;

drop trigger if exists businesses_start_trial on public.businesses;
create trigger businesses_start_trial
after insert on public.businesses
for each row execute function public.start_business_trial();

-- Backfill: existing businesses get a trial starting at migration time. An existing 'plus'
-- business keeps plan 'plus' (it is NOT downgraded to a basic trial). No data is removed.
insert into public.subscriptions (business_id, user_id, plan, status, trial_start, trial_end)
select b.id, b.owner_id,
  case when b.subscription_plan = 'plus' then 'plus' else 'basic' end,
  'trialing', now(), now() + interval '14 days'
from public.businesses b
on conflict (business_id) do nothing;
