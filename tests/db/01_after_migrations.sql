-- Sanity checks that every migration applied cleanly and key objects exist.
do $$
begin
  if to_regprocedure('public.list_active_plus_businesses()') is null then raise exception 'list_active_plus_businesses missing'; end if;
  if to_regprocedure('public.consume_api_rate_limit(text,integer,integer)') is null then raise exception 'consume_api_rate_limit missing'; end if;
  if to_regclass('public.business_subscriptions') is null then raise exception 'business_subscriptions missing'; end if;
  if to_regclass('public.notification_outbox') is null then raise exception 'notification_outbox missing'; end if;
end $$;
