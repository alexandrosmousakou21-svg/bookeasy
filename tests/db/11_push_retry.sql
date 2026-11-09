-- Push retry sweeper: only transient, undelivered, non-exhausted failures are re-dispatched.
\set ON_ERROR_STOP on
insert into auth.users (id) values ('e0000000-0000-4000-8000-000000000001') on conflict do nothing;
insert into public.businesses (id, owner_id, name, slug) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Push', 'push-biz');
insert into public.professional_notifications (id, business_id, recipient_user_id, category, event_type, title, body, source_key)
select ('e2000000-0000-4000-8000-00000000000' || n)::uuid, 'e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
       'system', 't', 't', 'b', 'k' || n
from generate_series(1, 5) n;
insert into public.professional_push_subscriptions (id, business_id, owner_id, endpoint, p256dh, auth_secret)
values ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
        'https://fcm.googleapis.com/x', repeat('a', 30), repeat('b', 20));
insert into vault.decrypted_secrets values ('supabase_url', 'https://example.supabase.co'), ('service_role_key', 'test-key');

insert into public.professional_push_deliveries (notification_id, subscription_id, attempted_at, delivered_at, last_error_code, attempt_count) values
  ('e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', now() - interval '20 minutes', null, 'push_503', 1),        -- retry
  ('e2000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001', now() - interval '20 minutes', now(), null, 1),              -- delivered: never retried
  ('e2000000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001', now() - interval '20 minutes', null, 'push_410', 1),        -- permanent failure
  ('e2000000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000001', now() - interval '20 minutes', null, 'push_500', 5),        -- exhausted
  ('e2000000-0000-4000-8000-000000000005', 'e3000000-0000-4000-8000-000000000001', now() - interval '1 minute', null, 'push_500', 1);          -- too recent

delete from net.calls;
do $$
declare queued integer;
begin
  queued := public.retry_failed_professional_pushes();
  if queued <> 1 then raise exception 'expected exactly 1 retry, got %', queued; end if;
  if (select count(*) from net.calls where body->>'notification_id' = 'e2000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'transient failure was not re-dispatched';
  end if;
end $$;

-- Not callable by clients.
set role authenticated;
do $$ begin
  begin
    perform public.retry_failed_professional_pushes();
    raise exception 'authenticated role could execute the retry sweeper';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
