create or replace function public.save_professional_push_subscription(
  target_business uuid,
  target_endpoint text,
  target_p256dh text,
  target_auth text,
  target_expiration timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_owner uuid := auth.uid();
  saved_subscription uuid;
begin
  if request_owner is null or not exists (
    select 1
    from public.businesses
    where id = target_business
      and owner_id = request_owner
  ) then
    raise exception 'Business ownership could not be verified' using errcode = '42501';
  end if;

  if target_endpoint is null
     or target_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com)(/|$)'
     or target_p256dh is null
     or target_p256dh !~ '^[A-Za-z0-9_-]+$'
     or char_length(target_p256dh) not between 80 and 100
     or target_auth is null
     or target_auth !~ '^[A-Za-z0-9_-]+$'
     or char_length(target_auth) not between 20 and 30
     or (target_expiration is not null and target_expiration <= now()) then
    raise exception 'Push subscription is invalid' using errcode = '22023';
  end if;

  insert into public.professional_push_subscriptions (
    business_id,
    owner_id,
    endpoint,
    p256dh,
    auth_secret,
    expiration_time,
    enabled,
    updated_at
  ) values (
    target_business,
    request_owner,
    target_endpoint,
    target_p256dh,
    target_auth,
    target_expiration,
    true,
    now()
  )
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    expiration_time = excluded.expiration_time,
    enabled = true,
    updated_at = now()
  where public.professional_push_subscriptions.owner_id = request_owner
    and public.professional_push_subscriptions.business_id = target_business
  returning id into saved_subscription;

  if saved_subscription is null then
    raise exception 'Push endpoint is already registered to another account' using errcode = '23505';
  end if;

  return saved_subscription;
end;
$$;

revoke all on function public.save_professional_push_subscription(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_professional_push_subscription(uuid, text, text, text, timestamptz)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'appointments'
     ) then
    alter publication supabase_realtime add table public.appointments;
  end if;
end;
$$;