#!/usr/bin/env bash
# Local DB tests for get_booked_intervals (E1). Needs a local Postgres and a superuser (default: sudo -u postgres).
# Usage: bash supabase/tests/booked-intervals.test.sh
set -u
cd "$(dirname "$0")/../.."
DB=bookeasy_intervals_test
PSQL=${PSQL:-"sudo -u postgres psql"}
q(){ $PSQL -d $DB -At -q -v ON_ERROR_STOP=1 "$@" 2>&1; }
fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2', want '$3')"; fail=1; fi; }
role(){ q -c "set role $1; $2"; }
gbi(){ echo "select to_char(starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||'>'||to_char(ends_at at time zone 'UTC','HH24:MI') from get_booked_intervals('$1','$2','$3')"; }

$PSQL -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
q -c "do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$;
 do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$;
 do \$\$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end \$\$;
 create schema if not exists auth;
 create table auth.users(id uuid primary key default gen_random_uuid(), email text);
 create or replace function auth.uid() returns uuid language sql stable as \$f\$ select nullif(current_setting('request.jwt.sub',true),'')::uuid \$f\$;"
q -f supabase/schema.sql >/dev/null
q -f supabase/migrations/20261008130000_subscriptions.sql >/dev/null 2>&1
q -c "grant usage on schema public to anon,authenticated,service_role; grant usage on schema auth to anon,authenticated,service_role; grant all on all tables in schema public to anon,authenticated,service_role" >/dev/null
q -f supabase/migrations/20261008_notifications_system.sql >/dev/null 2>&1 || { echo "FAIL notifications migration"; exit 1; }
q -f supabase/migrations/20261009000000_appointment_booking_enforcement.sql >/dev/null 2>&1 || { echo "FAIL enforcement migration"; exit 1; }
q -f supabase/migrations/20261009010000_get_booked_intervals.sql >/dev/null 2>&1 || { echo "FAIL intervals migration"; exit 1; }
q -f supabase/migrations/20261009010000_get_booked_intervals.sql >/dev/null 2>&1 && echo "PASS migration idempotent" || { echo "FAIL migration rerun"; fail=1; }

OWN=00000000-0000-0000-0000-0000000000a1; OWN2=00000000-0000-0000-0000-0000000000a2; C=00000000-0000-0000-0000-000000000002
B=10000000-0000-0000-0000-000000000001; B2=10000000-0000-0000-0000-000000000002
S=20000000-0000-0000-0000-000000000001; S2=20000000-0000-0000-0000-000000000002
ST=30000000-0000-0000-0000-000000000001; STI=30000000-0000-0000-0000-000000000002; STB=30000000-0000-0000-0000-0000000000b1
NONE=99999999-9999-9999-9999-999999999999
q -c "insert into auth.users(id,email) values ('$OWN','o@x.com'),('$OWN2','o2@x.com'),('$C','c@x.com')" \
  -c "insert into businesses(id,owner_id,name,slug,timezone) values ('$B','$OWN','Biz','biz','Europe/Athens'),('$B2','$OWN2','Biz2','biz2','America/New_York')" \
  -c "insert into services(id,business_id,name,duration_minutes) values ('$S','$B',  'Cut',30),('$S2','$B2','Cut2',30)" \
  -c "insert into staff(id,business_id,name,is_active) values ('$ST','$B','Nik',true),('$STI','$B','Off',false),('$STB','$B2','Tok',true)" >/dev/null
# appt <id-suffix> <business> <staff> <service> <status> <start utc> <end utc>   (inserted as superuser: bypasses RLS/guard)
n=0
appt(){ n=$((n+1)); q -c "insert into appointments(business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,customer_email,customer_phone,starts_at,ends_at) values ('$2','$C','$3','$4',(('$6')::timestamptz at time zone 'UTC')::date,'00:00','00:30','$5','SECRET NAME','secret@x.com','6999999999','$6','$7')" >/dev/null; }

# Athens, 2030-06-15 (EEST = UTC+3): local day = 2030-06-14 21:00Z .. 2030-06-15 21:00Z
appt 1 $B $ST $S booked    "2030-06-15 07:00+00" "2030-06-15 07:30+00"
appt 2 $B $ST $S pending   "2030-06-15 06:00+00" "2030-06-15 06:30+00"
appt 3 $B $ST $S confirmed "2030-06-15 08:00+00" "2030-06-15 08:30+00"
appt 4 $B $ST $S completed "2030-06-15 09:00+00" "2030-06-15 09:30+00"
appt 5 $B $ST $S cancelled "2030-06-15 10:00+00" "2030-06-15 10:30+00"
ok "1 returns booked/pending/confirmed/completed, excludes cancelled, ordered by starts_at" \
  "$(q -c "$(gbi $B $ST 2030-06-15)" | paste -sd, -)" \
  "2030-06-15 06:00>06:30,2030-06-15 07:00>07:30,2030-06-15 08:00>08:30,2030-06-15 09:00>09:30"

# Boundaries (Athens local day 2030-06-16 = 2030-06-15 21:00Z .. 2030-06-16 21:00Z)
appt 6 $B $ST $S booked "2030-06-15 20:00+00" "2030-06-15 20:30+00"   # ends 23:30 local on 15th: not on 16th
appt 7 $B $ST $S booked "2030-06-15 20:30+00" "2030-06-15 21:00+00"   # ends exactly at local midnight: excluded (end > start is strict)
appt 8 $B $ST $S booked "2030-06-15 21:00+00" "2030-06-15 21:30+00"   # starts exactly at local midnight: included
appt 9 $B $ST $S booked "2030-06-16 20:30+00" "2030-06-16 21:00+00"   # ends exactly at next local midnight: included
appt 10 $B $ST $S booked "2030-06-16 21:00+00" "2030-06-16 21:30+00"  # starts exactly at next midnight: excluded
ok "2 local-date boundaries (end==midnight excluded, start==midnight included, start==next midnight excluded)" \
  "$(q -c "$(gbi $B $ST 2030-06-16)" | paste -sd, -)" "2030-06-15 21:00>21:30,2030-06-16 20:30>21:00"
ok "2b the previous local day includes the 20:00Z and 20:30Z ones" \
  "$(q -c "select count(*) from get_booked_intervals('$B','$ST','2030-06-15') where starts_at >= '2030-06-15 20:00+00'")" "2"

# Overlapping local midnight: 22:45Z (01:45 local on 16th, 21:45Z is local midnight -> start before) -> use 21:45
appt 11 $B $ST $S booked "2030-06-17 20:45+00" "2030-06-17 21:15+00"   # straddles Athens midnight 17th/18th
ok "3 appointment straddling local midnight is returned for the day it begins in" \
  "$(q -c "select count(*) from get_booked_intervals('$B','$ST','2030-06-17') where starts_at='2030-06-17 20:45+00'")" "1"
ok "3b ...and for the following day" \
  "$(q -c "select count(*) from get_booked_intervals('$B','$ST','2030-06-18') where starts_at='2030-06-17 20:45+00'")" "1"

# Business timezone matters: same instant, different business tz
appt 12 $B2 $STB $S2 booked "2030-06-15 02:00+00" "2030-06-15 02:30+00"   # New York EDT = UTC-4: 2030-06-14 22:00 local
ok "4 New York business: 02:00Z belongs to local 06-14" "$(q -c "select count(*) from get_booked_intervals('$B2','$STB','2030-06-14')")" "1"
ok "4b ...not to local 06-15" "$(q -c "select count(*) from get_booked_intervals('$B2','$STB','2030-06-15')")" "0"

# DST: Athens spring forward 2030-03-31 (23h day, 00:00+02 .. 24:00+03 = 03-30 22:00Z .. 03-31 21:00Z)
appt 13 $B $ST $S booked "2030-03-30 22:00+00" "2030-03-30 22:30+00"   # first minute of 03-31 local
appt 14 $B $ST $S booked "2030-03-31 20:30+00" "2030-03-31 21:00+00"   # last 30 min of 03-31 local (23:30-24:00 EEST)
appt 15 $B $ST $S booked "2030-03-31 21:00+00" "2030-03-31 21:30+00"   # first of 04-01 (a 24h-later window would still include it)
ok "5 DST spring-forward (23h day): exact local-day membership" \
  "$(q -c "$(gbi $B $ST 2030-03-31)" | paste -sd, -)" "2030-03-30 22:00>22:30,2030-03-31 20:30>21:00"
ok "5b window length is 23h" "$(q -c "select ((('2030-04-01')::timestamp at time zone 'Europe/Athens') - (('2030-03-31')::timestamp at time zone 'Europe/Athens'))::text")" "23:00:00"
# DST: fall back 2030-10-27 (25h day, 2030-10-26 21:00Z .. 2030-10-27 22:00Z)
appt 16 $B $ST $S booked "2030-10-27 21:30+00" "2030-10-27 22:00+00"   # 23:30-24:00 EET: still on 10-27 (a 24h window would miss it)
appt 17 $B $ST $S booked "2030-10-27 22:00+00" "2030-10-27 22:30+00"   # 10-28
ok "6 DST fall-back (25h day): last half hour included, next day excluded" \
  "$(q -c "$(gbi $B $ST 2030-10-27)" | paste -sd, -)" "2030-10-27 21:30>22:00"
ok "6b window length is 25h" "$(q -c "select ((('2030-10-28')::timestamp at time zone 'Europe/Athens') - (('2030-10-27')::timestamp at time zone 'Europe/Athens'))::text")" "25:00:00"

# Empty results, no differing errors
ok "7 staff of another business -> empty (business_id and staff_id both enforced)" "$(q -c "select count(*) from get_booked_intervals('$B','$STB','2030-06-15')")" "0"
ok "7b reverse mismatch -> empty" "$(q -c "select count(*) from get_booked_intervals('$B2','$ST','2030-06-15')")" "0"
ok "7c nonexistent business -> empty" "$(q -c "select count(*) from get_booked_intervals('$NONE','$ST','2030-06-15')")" "0"
ok "7d nonexistent staff -> empty" "$(q -c "select count(*) from get_booked_intervals('$B','$NONE','2030-06-15')")" "0"
ok "7e both nonexistent -> empty" "$(q -c "select count(*) from get_booked_intervals('$NONE','$NONE','2030-06-15')")" "0"
appt 18 $B $STI $S booked "2030-06-15 07:00+00" "2030-06-15 07:30+00"
ok "7f inactive staff -> empty" "$(q -c "select count(*) from get_booked_intervals('$B','$STI','2030-06-15')")" "0"
ok "7g NULL arguments -> empty, no error" "$(q -c "select count(*) from get_booked_intervals(null,null,null)")" "0"

# Privileges and PII
ok "8 anon can execute" "$(role anon "select count(*) from get_booked_intervals('$B','$ST','2030-06-15')" | tail -1)" "4"
ok "8b authenticated can execute" "$(role authenticated "select count(*) from get_booked_intervals('$B','$ST','2030-06-15')" | tail -1)" "4"
ok "8c PUBLIC has no execute grant" "$(q -c "select count(*) from information_schema.routine_privileges where routine_name='get_booked_intervals' and grantee='PUBLIC'")" "0"
ok "9 returns exactly starts_at, ends_at columns (no PII/id/status)" \
  "$(q -c "select string_agg(a.attname, ',' order by a.attnum) from pg_proc p join pg_type t on t.oid=p.prorettype, lateral (select attname, attnum from pg_attribute where attrelid=t.typrelid and attnum>0) a where p.proname='get_booked_intervals' and t.typrelid<>0")" "")" 2>/dev/null
ok "9 result columns are only starts_at,ends_at" "$(q -c "select array_to_string(proargnames,',') ||'|'|| array_to_string(proargmodes,',') from pg_proc where proname='get_booked_intervals'")" "target_business,target_staff,target_date,starts_at,ends_at|i,i,i,t,t"
ok "9b output text has no customer data" "$(role anon "select count(*) from (select (g::text) t from get_booked_intervals('$B','$ST','2030-06-15') g) x where t ~* 'SECRET|secret@|6999999999|$C'" | tail -1)" "0"
ok "9c function is SECURITY DEFINER, STABLE, fixed search_path" "$(q -c "select prosecdef::text||'|'||provolatile||'|'||array_to_string(proconfig,',') from pg_proc where proname='get_booked_intervals'")" "true|s|search_path=public, pg_temp"
# Direct table access does not bypass the contract
ok "10 anon cannot read appointments directly (RLS)" "$(role anon "select count(*) from appointments" | tail -1)" "0"
ok "10b authenticated customer sees only own rows; others' intervals only via RPC" "$(q -c "set role authenticated; set request.jwt.sub='$OWN2'; select count(*) from appointments")" "1"
ok "10c ...while RPC returns the staff's occupied slots to that user" "$(q -c "set role authenticated; set request.jwt.sub='$OWN2'; select count(*) from get_booked_intervals('$B','$ST','2030-06-15')" | tail -1)" "4"
exit $fail
