create extension if not exists pg_net with schema net;

alter table public.business_subscriptions
  add column if not exists last_stripe_event_id text,
  add column if not exists last_stripe_event_type text;

create table if not exists public.professional_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('appointment', 'system', 'subscription', 'payment', 'support')),
  event_type text not null,
  title text not null,
  body text not null,
  source_key text not null unique,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists professional_notifications_inbox_idx
  on public.professional_notifications(recipient_user_id, created_at desc);
create index if not exists professional_notifications_business_unread_idx
  on public.professional_notifications(business_id, recipient_user_id, created_at desc)
  where read_at is null;

create table if not exists public.professional_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  expiration_time timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_push_endpoint_length check (char_length(endpoint) between 1 and 2048),
  constraint professional_push_p256dh_length check (char_length(p256dh) between 20 and 256),
  constraint professional_push_auth_length check (char_length(auth_secret) between 16 and 128)
);

create index if not exists professional_push_owner_idx
  on public.professional_push_subscriptions(business_id, owner_id)
  where enabled;

create table if not exists public.professional_push_deliveries (
  notification_id uuid not null references public.professional_notifications(id) on delete cascade,
  subscription_id uuid not null references public.professional_push_subscriptions(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error_code text,
  primary key (notification_id, subscription_id)
);

alter table public.professional_notifications enable row level security;
alter table public.professional_push_subscriptions enable row level security;
alter table public.professional_push_deliveries enable row level security;

revoke all on public.professional_notifications from public, anon, authenticated;
revoke all on public.professional_push_subscriptions from public, anon, authenticated;
revoke all on public.professional_push_deliveries from public, anon, authenticated;

grant select (id, business_id, recipient_user_id, category, event_type, title, body, source_key, data, read_at, created_at)
  on public.professional_notifications to authenticated;
grant update (read_at) on public.professional_notifications to authenticated;
grant select (id, business_id, owner_id, enabled, created_at, updated_at)
  on public.professional_push_subscriptions to authenticated;
grant insert (business_id, owner_id, endpoint, p256dh, auth_secret, expiration_time, enabled, updated_at)
  on public.professional_push_subscriptions to authenticated;
grant update (endpoint, p256dh, auth_secret, expiration_time, enabled, updated_at)
  on public.professional_push_subscriptions to authenticated;
grant delete on public.professional_push_subscriptions to authenticated;
grant all on public.professional_notifications to service_role;
grant all on public.professional_push_subscriptions to service_role;
grant all on public.professional_push_deliveries to service_role;

drop policy if exists "professionals read own notifications" on public.professional_notifications;
create policy "professionals read own notifications"
on public.professional_notifications for select to authenticated
using (
  recipient_user_id = auth.uid()
  and public.is_business_owner(business_id)
);

drop policy if exists "professionals mark own notifications read" on public.professional_notifications;
create policy "professionals mark own notifications read"
on public.professional_notifications for update to authenticated
using (
  recipient_user_id = auth.uid()
  and public.is_business_owner(business_id)
)
with check (
  recipient_user_id = auth.uid()
  and public.is_business_owner(business_id)
);

drop policy if exists "professionals manage own push subscriptions" on public.professional_push_subscriptions;
create policy "professionals manage own push subscriptions"
on public.professional_push_subscriptions for all to authenticated
using (
  owner_id = auth.uid()
  and public.is_business_owner(business_id)
)
with check (
  owner_id = auth.uid()
  and public.is_business_owner(business_id)
);

create or replace function public.insert_professional_notification(
  target_business uuid,
  target_category text,
  target_event_type text,
  target_title text,
  target_body text,
  target_source_key text,
  target_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_owner uuid;
  notification_id uuid;
begin
  select owner_id into target_owner
  from public.businesses
  where id = target_business;
  if target_owner is null then return null; end if;

  insert into public.professional_notifications (
    business_id, recipient_user_id, category, event_type, title, body, source_key, data
  ) values (
    target_business, target_owner, target_category, target_event_type,
    left(target_title, 120), left(target_body, 1000), target_source_key,
    coalesce(target_data, '{}'::jsonb)
  )
  on conflict (source_key) do nothing
  returning id into notification_id;
  return notification_id;
end;
$$;

revoke all on function public.insert_professional_notification(uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_professional_notification(uuid, text, text, text, text, text, jsonb)
  to service_role;

create or replace function public.notify_professional_appointment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_owner uuid;
  notification_type text;
  notification_title text;
  notification_body text;
  source text;
  payload jsonb;
begin
  select owner_id into target_owner from public.businesses where id = new.business_id;
  if target_owner is null then return new; end if;

  if tg_op = 'INSERT' then
    if new.customer_id = target_owner then return new; end if;
    notification_type := 'appointment_new';
    notification_title := 'Νέο ραντεβού';
    notification_body := coalesce(new.customer_name, 'Πελάτης') || ' · ' ||
      new.appointment_date::text || ' ' || left(new.start_time::text, 5);
    source := 'appointment:' || new.id::text || ':created';
  else
    if row(new.status, new.appointment_date, new.start_time, new.end_time)
       is not distinct from
       row(old.status, old.appointment_date, old.start_time, old.end_time) then
      return new;
    end if;
    notification_type := case new.status
      when 'confirmed' then 'appointment_confirmed'
      when 'cancelled' then 'appointment_cancelled'
      else 'appointment_changed'
    end;
    notification_title := case new.status
      when 'confirmed' then 'Το ραντεβού επιβεβαιώθηκε'
      when 'cancelled' then 'Το ραντεβού ακυρώθηκε'
      else 'Το ραντεβού άλλαξε'
    end;
    notification_body := coalesce(new.customer_name, 'Πελάτης') || ' · ' ||
      new.appointment_date::text || ' ' || left(new.start_time::text, 5);
    source := 'appointment:' || new.id::text || ':' || md5(
      jsonb_build_array(
        old.status, old.appointment_date, old.start_time, old.end_time,
        new.status, new.appointment_date, new.start_time, new.end_time
      )::text
    );
  end if;

  payload := jsonb_build_object('appointment_id', new.id);
  begin
    perform public.insert_professional_notification(
      new.business_id, 'appointment', notification_type,
      notification_title, notification_body, source, payload
    );
  exception when others then
    raise warning 'Professional appointment notification could not be recorded';
  end;
  return new;
end;
$$;

create or replace trigger appointments_professional_notification
  after insert or update of status, appointment_date, start_time, end_time
  on public.appointments
  for each row execute function public.notify_professional_appointment_event();

create or replace function public.notify_professional_subscription_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_category text;
  event_title text;
  event_body text;
  event_key text;
begin
  if new.status = 'checkout_pending' or new.stripe_subscription_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.stripe_event_created_at is not distinct from new.stripe_event_created_at then
    return new;
  end if;

  event_category := case
    when new.status in ('past_due', 'unpaid', 'incomplete', 'incomplete_expired') then 'payment'
    else 'subscription'
  end;
  event_title := case
    when new.status in ('past_due', 'unpaid', 'incomplete', 'incomplete_expired') then 'Πρόβλημα πληρωμής συνδρομής'
    when new.cancel_at_period_end then 'Η ακύρωση συνδρομής προγραμματίστηκε'
    when new.last_stripe_event_type = 'invoice.paid' then 'Η συνδρομή πληρώθηκε'
    when new.status = 'canceled' then 'Η συνδρομή ολοκληρώθηκε'
    else 'Η συνδρομή ενημερώθηκε'
  end;
  event_body := case
    when new.cancel_at_period_end and new.current_period_end is not null then
      'Η πρόσβαση παραμένει έως ' || to_char(new.current_period_end at time zone 'UTC', 'DD Mon YYYY') || '. Δεν θα γίνει νέα χρέωση.'
    when new.status in ('past_due', 'unpaid', 'incomplete', 'incomplete_expired') then
      'Η premium πρόσβαση δεν είναι ενεργή μέχρι να επιβεβαιωθεί ενεργή συνδρομή από το Stripe.'
    when new.last_stripe_event_type = 'invoice.paid' then
      'Η πληρωμή της συνδρομής επιβεβαιώθηκε από το Stripe.'
    else 'Η κατάσταση της συνδρομής ενημερώθηκε από το Stripe.'
  end;
  event_key := coalesce(
    'stripe:' || new.last_stripe_event_id,
    'subscription:' || new.business_id::text || ':' || new.stripe_event_created_at::text
  );
  begin
    perform public.insert_professional_notification(
      new.business_id, event_category, coalesce(new.last_stripe_event_type, 'subscription.updated'),
      event_title, event_body, event_key,
      jsonb_build_object('plan', new.plan, 'status', new.status, 'route', '/dashboard/plan')
    );
  exception when others then
    raise warning 'Professional subscription notification could not be recorded';
  end;
  return new;
end;
$$;

create or replace trigger business_subscription_professional_notification
  after insert or update of status, cancel_at_period_end, current_period_end, stripe_event_created_at
  on public.business_subscriptions
  for each row execute function public.notify_professional_subscription_event();

create or replace function public.queue_professional_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_url text;
  service_role_key text;
begin
  begin
    select decrypted_secret into project_url
    from vault.decrypted_secrets
    where name = 'supabase_url';
    select decrypted_secret into service_role_key
    from vault.decrypted_secrets
    where name = 'service_role_key';
    if project_url is null or service_role_key is null then return new; end if;

    perform net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/send-professional-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', service_role_key,
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object('notification_id', new.id),
      timeout_milliseconds := 15000
    );
  exception when others then
    raise warning 'Push dispatch could not be queued';
  end;
  return new;
end;
$$;

revoke all on function public.notify_professional_appointment_event() from public, anon, authenticated;
revoke all on function public.notify_professional_subscription_event() from public, anon, authenticated;
revoke all on function public.queue_professional_push() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'professional_notifications'
     ) then
    alter publication supabase_realtime add table public.professional_notifications;
  end if;
end;
$$;

create or replace trigger professional_notification_queue_push
  after insert on public.professional_notifications
  for each row execute function public.queue_professional_push();
