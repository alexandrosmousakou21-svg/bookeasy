#!/usr/bin/env bash
# Local DB tests for the notification outbox. Needs a local Postgres and a superuser (default: sudo -u postgres).
# Usage: bash supabase/tests/notifications.test.sh
set -u
cd "$(dirname "$0")/../.."
DB=bookeasy_notif_test
PSQL=${PSQL:-"sudo -u postgres psql"}
q(){ $PSQL -d $DB -At -q -v ON_ERROR_STOP=1 "$@" 2>&1; }
fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2', want '$3')"; fail=1; fi; }
denied(){ if echo "$2" | grep -qi "permission denied\|row-level security\|violates"; then echo "PASS $1"; else echo "FAIL $1 ($2)"; fail=1; fi; }

$PSQL -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
q -c "do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$;
 do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$;
 do \$\$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end \$\$;
 create schema if not exists auth;
 create table auth.users(id uuid primary key default gen_random_uuid(), email text);
 create or replace function auth.uid() returns uuid language sql stable as \$f\$ select nullif(current_setting('request.jwt.sub',true),'')::uuid \$f\$;" 
q -f supabase/schema.sql >/dev/null
q -f supabase/migrations/20261008130000_subscriptions.sql >/dev/null 2>&1
q -c "grant usage on schema public to anon,authenticated,service_role; grant all on all tables in schema public to anon,authenticated,service_role" >/dev/null
q -f supabase/migrations/20261008_notifications_system.sql >/dev/null 2>&1 || { echo "FAIL migration"; exit 1; }
q -f supabase/migrations/20261008_notifications_system.sql >/dev/null 2>&1 && echo "PASS migration idempotent" || { echo "FAIL migration rerun"; fail=1; }

U1=00000000-0000-0000-0000-000000000001; U2=00000000-0000-0000-0000-000000000002
B=10000000-0000-0000-0000-000000000001; S=20000000-0000-0000-0000-000000000001; ST=30000000-0000-0000-0000-000000000001
q -c "insert into auth.users(id) values ('$U1'),('$U2')" \
  -c "insert into businesses(id,owner_id,name,slug) values ('$B','$U1','Biz','biz')" \
  -c "insert into services(id,business_id,name,duration_minutes,price) values ('$S','$B','Cut',30,10)" \
  -c "insert into staff(id,business_id,name) values ('$ST','$B','Nik')" >/dev/null
ok "timezone default" "$(q -c "select timezone from businesses")" "Europe/Athens"
A=40000000-0000-0000-0000-000000000001
ins="insert into appointments(id,business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,customer_email,starts_at,ends_at) values ('$A','$B','$U2','$ST','$S','2030-01-01','10:00','10:30','pending','Cu','c@x','2030-01-01 10:00+00','2030-01-01 10:30+00')"
q -c "$ins" >/dev/null
ok "1 new appointment -> 1 booking_confirmation (email,pending)" "$(q -c "select count(*),min(channel),min(status),min(user_id::text) from notification_outbox where type='booking_confirmation'")" "1|email|pending|$U2"
ok "1b payload has service+timezone" "$(q -c "select payload->>'service_name'||'/'||(payload->>'timezone') from notification_outbox where type='booking_confirmation'")" "Cut/Europe/Athens"
q -c "update appointments set status='confirmed' where id='$A'" -c "update appointments set status='pending' where id='$A'" >/dev/null
ok "2 other status updates don't duplicate" "$(q -c "select count(*) from notification_outbox")" "1"
ok "2b same dedupe key re-insert ignored" "$(q -c "insert into notification_outbox(type,channel,dedupe_key) values ('x','email','appointment:$A:booking_confirmation') on conflict (dedupe_key) do nothing; select count(*) from notification_outbox where dedupe_key='appointment:$A:booking_confirmation'")" "1"
q -c "update appointments set status='cancelled' where id='$A'" >/dev/null
ok "3 cancellation -> cancellation notification" "$(q -c "select count(*) from notification_outbox where dedupe_key='appointment:$A:booking_cancellation'")" "1"
q -c "update appointments set status='cancelled', customer_name='Z' where id='$A'" -c "update appointments set status='cancelled' where id='$A'" >/dev/null
ok "4 update on already-cancelled -> no 2nd cancellation" "$(q -c "select count(*) from notification_outbox where type='booking_cancellation'")" "1"
q -c "update appointments set status='pending' where id='$A'" -c "update appointments set status='cancelled' where id='$A'" >/dev/null
ok "4b re-cancel after reopen stays deduped" "$(q -c "select count(*) from notification_outbox where type='booking_cancellation'")" "1"
r=$(q -c "insert into notification_outbox(type,channel,dedupe_key) values ('a','email','dup'),('a','email','dup')"); denied "5 dedupe_key unique" "$r"
r=$(q -c "insert into notification_outbox(type,channel,dedupe_key) values ('a','sms','k1')"); denied "5b channel check" "$r"
r=$(q -c "insert into notification_outbox(type,channel,dedupe_key,status) values ('a','email','k2','done')"); denied "5c status check" "$r"
q -c "insert into notification_preferences(user_id,business_id) values ('$U2','$B')" >/dev/null
r=$(q -c "insert into notification_preferences(user_id,business_id) values ('$U2','$B')"); denied "6 preferences unique(user,business)" "$r"
q -c "insert into push_devices(user_id,device_token) values ('$U2','tok')" >/dev/null
r=$(q -c "insert into push_devices(user_id,device_token) values ('$U2','tok')"); denied "7 push_devices unique(user,token)" "$r"
as(){ q -c "set role authenticated; set request.jwt.sub='$1'; $2"; }
r=$(as $U2 "insert into notification_outbox(type,channel,dedupe_key) values ('a','email','hack')"); denied "8 outbox insert denied (authenticated)" "$r"
r=$(as $U2 "select count(*) from notification_outbox"); denied "8b outbox select denied" "$r"
r=$(as $U2 "update notification_outbox set status='sent'"); denied "8c outbox update denied" "$r"
r=$(q -c "set role anon; insert into notification_outbox(type,channel,dedupe_key) values ('a','email','h2')"); denied "8d outbox insert denied (anon)" "$r"
ok "8e own preferences visible" "$(as $U2 "select count(*) from notification_preferences" | tail -1)" "1"
ok "8f others' preferences hidden" "$(as $U1 "select count(*) from notification_preferences" | tail -1)" "0"
r=$(as $U1 "insert into push_devices(user_id,device_token) values ('$U2','x')"); denied "8g cannot create device for other user" "$r"
r=$(as $U2 "select claim_notification_outbox()"); denied "8h clients cannot call claim function" "$r"
ok "8i trigger works for customer (RLS user) booking" "$(as $U2 "insert into appointments(business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,starts_at,ends_at) values ('$B','$U2','$ST','$S','2030-01-02','10:00','10:30','booked','Cu','2030-01-02 10:00+00','2030-01-02 10:30+00'); select 'ok'" | tail -1)" "ok"
ok "8j ...and enqueued" "$(q -c "select count(*) from notification_outbox where type='booking_confirmation'")" "2"

# Worker claim
q -c "delete from notification_outbox" >/dev/null
q -c "insert into notification_outbox(type,channel,dedupe_key) select 'w','email','w'||g from generate_series(1,6) g" -c "insert into notification_outbox(type,channel,dedupe_key,available_at) values ('w','email','future', now()+interval '1 hour')" >/dev/null
ok "9 claim returns pending due rows only, sets processing+attempts" "$(q -c "select count(*),min(status),min(attempts) from claim_notification_outbox(4,5,300)")" "4|processing|1"
ok "9b future record not claimed" "$(q -c "select status from notification_outbox where dedupe_key='future'")" "pending"
ok "9c second claim only gets remaining (no re-claim of leased)" "$(q -c "select count(*) from claim_notification_outbox(10,5,300)")" "2"
q -c "update notification_outbox set available_at=now()-interval '1 second' where dedupe_key='w1'" >/dev/null
ok "9d expired lease reclaimed (attempts=2)" "$(q -c "select attempts from claim_notification_outbox(10,5,300)")" "2"
q -c "update notification_outbox set available_at=now()-interval '1 second', attempts=5 where dedupe_key='w2'" >/dev/null
q -c "select count(*) from claim_notification_outbox(10,5,300)" >/dev/null
ok "9e max attempts -> failed" "$(q -c "select status from notification_outbox where dedupe_key='w2'")" "failed"
ok "9f service_role can claim" "$(q -c "set role service_role; select count(*) from claim_notification_outbox(1,5,300)" | tail -1)" "0"

# Concurrency: two sessions claim at the same time
q -c "delete from notification_outbox" >/dev/null
q -c "insert into notification_outbox(type,channel,dedupe_key) select 'c','email','c'||g from generate_series(1,6) g" >/dev/null
( $PSQL -d $DB -At -q -c "begin; create temp table a as select id from claim_notification_outbox(3,5,300); select pg_sleep(2); select id from a order by id; commit;" > /tmp/wa.txt 2>&1 ) &
sleep 0.7
$PSQL -d $DB -At -q -c "begin; create temp table b as select id from claim_notification_outbox(6,5,300); select id from b order by id; commit;" > /tmp/wb.txt 2>&1
wait
ids(){ grep -E '^[0-9a-f]{8}-' "$1"; }
na=$(ids /tmp/wa.txt | wc -l); nb=$(ids /tmp/wb.txt | wc -l); overlap=$( (ids /tmp/wa.txt; ids /tmp/wb.txt) | sort | uniq -d | wc -l)
ok "10 concurrent workers: no overlap" "$overlap" "0"
ok "10b concurrent workers: together claim all 6" "$((na+nb))" "6"
ok "10c each claimed once (attempts=1)" "$(q -c "select count(*) from notification_outbox where attempts=1 and status='processing'")" "6"
exit $fail
