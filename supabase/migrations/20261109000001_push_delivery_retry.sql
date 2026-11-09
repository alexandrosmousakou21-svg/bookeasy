-- PREPARED, NOT APPLIED. Lets transient professional push failures be retried without double delivery.
alter table public.professional_push_deliveries
  add column if not exists attempt_count integer not null default 1;

-- Re-dispatches notifications that have a failed (never delivered) push attempt.
-- The edge function atomically re-claims a failed row, so concurrent runs cannot send twice.
create or replace function public.retry_failed_professional_pushes(max_attempts integer default 5)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_url text;
  service_role_key text;
  queued integer := 0;
  item record;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'supabase_url';
  select decrypted_secret into service_role_key from vault.decrypted_secrets where name = 'service_role_key';
  if project_url is null or service_role_key is null then
    return 0;
  end if;

  for item in
    select distinct d.notification_id
    from public.professional_push_deliveries d
    where d.delivered_at is null
      and d.last_error_code is not null
      and d.last_error_code not in ('push_400', 'push_404', 'push_410')
      and d.attempt_count < max_attempts
      and d.attempted_at < now() - interval '5 minutes'
      and d.attempted_at > now() - interval '2 hours'
    limit 50
  loop
    perform net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/send-professional-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', service_role_key,
        'Authorization', 'Bearer ' || service_role_key
      ),
      body := jsonb_build_object('notification_id', item.notification_id, 'retry', true),
      timeout_milliseconds := 15000
    );
    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

revoke all on function public.retry_failed_professional_pushes(integer) from public, anon, authenticated;
grant execute on function public.retry_failed_professional_pushes(integer) to service_role;

-- Scheduled only where pg_cron exists; otherwise call the function from any external scheduler.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('retry-professional-pushes', '*/10 * * * *', 'select public.retry_failed_professional_pushes()');
  end if;
end $$;
