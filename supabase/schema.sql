create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  cover_image_url text,
  primary_color text not null default '#1664d9',
  address text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  price numeric(10,2) not null default 0,
  is_active boolean not null default true
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  email text,
  phone text,
  avatar_url text,
  is_active boolean not null default true
);

create table public.staff_services (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  primary key (staff_id, service_id)
);

create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_closed boolean not null default false,
  check (end_time > start_time)
);

create table public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  unique (user_id, business_id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'booked' check (status in ('booked', 'pending', 'confirmed', 'cancelled', 'completed')),
  customer_name text not null,
  customer_phone text,
  customer_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint appointment_time_order check (ends_at > starts_at)
);

create table public.business_media (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  url text not null,
  alt_text text,
  sort_order integer not null default 0
);

create index services_business_idx on public.services(business_id);
create index staff_business_idx on public.staff(business_id);
create index staff_services_business_idx on public.staff_services(business_id);
create index working_hours_business_idx on public.working_hours(business_id, day_of_week);
create index appointments_staff_time_idx on public.appointments(staff_id, starts_at, ends_at);
create index appointments_customer_date_idx on public.appointments(customer_id, appointment_date, start_time);
create index appointments_business_date_idx on public.appointments(business_id, appointment_date, start_time);
create unique index working_hours_business_day_idx on public.working_hours(business_id, day_of_week) where staff_id is null;

alter table public.appointments
  add constraint no_staff_overlap
  exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled');

create or replace function public.is_business_owner(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.businesses
    where id = target_business
      and owner_id = auth.uid()
  );
$$;

alter table public.businesses enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.staff_services enable row level security;
alter table public.working_hours enable row level security;
alter table public.customer_profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.business_media enable row level security;

create policy "public can read businesses"
on public.businesses for select
using (true);

create policy "owners manage businesses"
on public.businesses for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "public reads active services"
on public.services for select
using (is_active = true);

create policy "owners manage services"
on public.services for all
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

create policy "public reads active staff"
on public.staff for select
using (is_active = true);

create policy "owners manage staff"
on public.staff for all
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

create policy "public reads staff services"
on public.staff_services for select
using (true);

create policy "owners manage staff services"
on public.staff_services for all
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

create policy "public reads working hours"
on public.working_hours for select
using (true);

create policy "owners manage working hours"
on public.working_hours for all
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

create policy "customers read own profile"
on public.customer_profiles for select
using (user_id = auth.uid());

create policy "customers create own profile"
on public.customer_profiles for insert
with check (user_id = auth.uid());

create policy "customers update own profile"
on public.customer_profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "owners read business customers"
on public.customer_profiles for select
using (public.is_business_owner(business_id));

create policy "customers read own appointments"
on public.appointments for select
using (customer_id = auth.uid());

create policy "customers create own appointments"
on public.appointments for insert
with check (customer_id = auth.uid());

create policy "customers update own appointments"
on public.appointments for update
using (customer_id = auth.uid())
with check (customer_id = auth.uid());

create policy "owners manage appointments"
on public.appointments for all
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));

create policy "public reads business media"
on public.business_media for select
using (true);

create policy "owners manage business media"
on public.business_media for all
using (public.is_business_owner(business_id))
with check (public.is_business_owner(business_id));
