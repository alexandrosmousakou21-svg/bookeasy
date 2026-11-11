\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('f0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000002'),
  ('f0000000-0000-4000-8000-000000000003'),
  ('f0000000-0000-4000-8000-000000000004'),
  ('f0000000-0000-4000-8000-000000000005'),
  ('f0000000-0000-4000-8000-000000000006'),
  ('f0000000-0000-4000-8000-000000000007');

insert into public.businesses (id, owner_id, name, slug) values
  ('e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Paid Plus', 'paid-plus'),
  ('e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'Basic', 'basic'),
  ('e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003', 'Past Due Plus', 'past-due-plus'),
  ('e0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000004', 'Unpaid Plus', 'unpaid-plus'),
  ('e0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000005', 'Scheduled Cancellation Plus', 'scheduled-cancel-plus'),
  ('e0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000006', 'Expired Plus', 'expired-plus'),
  ('e0000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000007', 'No Subscription', 'no-subscription');

insert into public.business_subscriptions (
  business_id, owner_id, plan, status, current_period_start, current_period_end, cancel_at_period_end
) values
  ('e0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'plus', 'active', now() - interval '1 day', now() + interval '20 days', false),
  ('e0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'basic', 'active', now() - interval '1 day', now() + interval '20 days', false),
  ('e0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003', 'plus', 'past_due', now() - interval '1 day', now() + interval '20 days', false),
  ('e0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000004', 'plus', 'unpaid', now() - interval '1 day', now() + interval '20 days', false),
  ('e0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000005', 'plus', 'active', now() - interval '1 day', now() + interval '20 days', true),
  ('e0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000006', 'plus', 'active', now() - interval '31 days', now() - interval '1 day', false);

do $$
declare
  visible_ids uuid[];
begin
  select array_agg(id order by id)
  into visible_ids
  from public.list_active_plus_businesses();

  if visible_ids is distinct from array[
    'e0000000-0000-4000-8000-000000000001'::uuid,
    'e0000000-0000-4000-8000-000000000005'::uuid
  ] then
    raise exception 'public directory must include only in-period active Plus subscriptions; got %', visible_ids;
  end if;
end $$;