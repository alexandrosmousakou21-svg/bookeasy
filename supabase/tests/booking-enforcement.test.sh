#!/usr/bin/env bash
# Local DB tests for server-side appointment enforcement (book_appointment + guard trigger).
# Needs a local Postgres and a superuser (default: sudo -u postgres). Roles/auth.* are stubbed.
# Usage: bash supabase/tests/booking-enforcement.test.sh
set -u
cd "$(dirname "$0")/../.."
DB=bookeasy_booking_test
PSQL=${PSQL:-"sudo -u postgres psql"}
q(){ $PSQL -d $DB -At -q -v ON_ERROR_STOP=1 "$@" 2>&1; }
fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2', want '$3')"; fail=1; fi; }
rej(){ if echo "$3" | grep -q "$2"; then echo "PASS $1"; else echo "FAIL $1 (expected '$2', got: $3)"; fail=1; fi; }
as(){ q -c "set role authenticated; set request.jwt.sub='$1'; $2"; }

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
q -f supabase/migrations/20261009000000_appointment_booking_enforcement.sql >/dev/null 2>&1 && echo "PASS migration idempotent" || { echo "FAIL migration rerun"; fail=1; }

OWN=00000000-0000-0000-0000-0000000000a1; OWN2=00000000-0000-0000-0000-0000000000a2
U2=00000000-0000-0000-0000-000000000002; U3=00000000-0000-0000-0000-000000000003
U4=00000000-0000-0000-0000-000000000004; U5=00000000-0000-0000-0000-000000000005; U6=00000000-0000-0000-0000-000000000006
B=10000000-0000-0000-0000-000000000001; B2=10000000-0000-0000-0000-000000000002
S=20000000-0000-0000-0000-000000000001; S2=20000000-0000-0000-0000-000000000002; S3=20000000-0000-0000-0000-000000000003; SB=20000000-0000-0000-0000-0000000000b1
ST=30000000-0000-0000-0000-000000000001; ST2=30000000-0000-0000-0000-000000000002; ST3=30000000-0000-0000-0000-000000000003; STB=30000000-0000-0000-0000-0000000000b1
D=$(date -u -d '+10 days' +%F); D1=$(date -u -d '+11 days' +%F); D2=$(date -u -d '+12 days' +%F); PAST=$(date -u -d '-2 days' +%F)
DOW=$(date -u -d "$D" +%w); DOW1=$(date -u -d "$D1" +%w)
q -c "insert into auth.users(id,email) values ('$OWN','o@x.com'),('$OWN2','o2@x.com'),('$U2','u2@example.com'),('$U3','u3@example.com'),('$U4','u4@example.com'),('$U5','u5@example.com'),('$U6','u6@example.com')" \
  -c "insert into businesses(id,owner_id,name,slug,timezone) values ('$B','$OWN','Biz','biz','Europe/Athens'),('$B2','$OWN2','Biz2','biz2','Asia/Tokyo')" \
  -c "insert into services(id,business_id,name,duration_minutes,price,is_active) values ('$S','$B','Cut',30,10,true),('$S2','$B','Long',60,20,true),('$S3','$B','Off',30,5,false),('$SB','$B2','Other',30,5,true)" \
  -c "insert into staff(id,business_id,name,is_active) values ('$ST','$B','Nik',true),('$ST2','$B','Ann',true),('$ST3','$B','Gone',false),('$STB','$B2','Tok',true)" \
  -c "insert into working_hours(business_id,day_of_week,start_time,end_time) select '$B',g,'09:00','17:00' from generate_series(0,6) g" \
  -c "insert into working_hours(business_id,day_of_week,start_time,end_time) select '$B2',g,'09:00','17:00' from generate_series(0,6) g" \
  -c "update working_hours set is_closed=true where business_id='$B' and day_of_week=$DOW1 and staff_id is null" \
  -c "insert into working_hours(business_id,staff_id,day_of_week,start_time,end_time) values ('$B','$ST2',$DOW,'12:00','14:00')" >/dev/null
book(){ as "$1" "select book_appointment('$B','${3:-$ST}','${4:-$S}','${5:-$D}','$2','Cu','+30 6900000000')"; }
bookB(){ as "$1" "select book_appointment('$2','$3','$4','$5','$6','Cu',null)"; }
cnt(){ q -c "select count(*) from appointments where $1"; }

# --- PASS: valid booking, no staff_services rows yet (all staff eligible, as in the UI)
r=$(book $U2 10:00)
ok "1 valid booking created" "$(echo "$r" | grep -c '"status": "booked"')" "1"
ok "1b status booked, customer_id from auth, email from account" "$(q -c "select status||'|'||customer_id||'|'||customer_email||'|'||customer_name from appointments where business_id='$B'")" "booked|$U2|u2@example.com|Cu"
ok "1c duration from service (30m) and end_time local" "$(q -c "select (ends_at-starts_at)::text||'|'||end_time::text from appointments where business_id='$B'")" "00:30:00|10:30:00"
ok "1d starts_at uses business timezone (Europe/Athens)" "$(q -c "select starts_at = (('$D 10:00')::timestamp at time zone 'Europe/Athens') from appointments where business_id='$B'")" "t"
ok "1e one confirmation notification, email from account" "$(q -c "select count(*)||'|'||min(payload->>'customer_email') from notification_outbox where type='booking_confirmation'")" "1|u2@example.com"

q -c "insert into staff_services(staff_id,service_id,business_id) values ('$ST','$S','$B'),('$ST','$S2','$B'),('$ST2','$S2','$B')" >/dev/null
r=$(book $U3 11:00 $ST $S2); ok "2 assigned staff+service booking, 60m duration" "$(q -c "select (ends_at-starts_at)::text from appointments where customer_id='$U3'")" "01:00:00"
r=$(book $U3 12:00 $ST2 $S2); ok "2b staff-level working hours allow 12:00 for 60m" "$(cnt "customer_id='$U3' and staff_id='$ST2'")" "1"
r=$(book $U4 13:30 $ST2 $S2); rej "3 staff-level hours enforced (13:30+60m > 14:00)" outside_working_hours "$r"
r=$(book $U4 11:00 $ST2 $S2); rej "3b staff-level hours override business hours (11:00)" outside_working_hours "$r"
r=$(book $U4 12:00 $ST2 $S); rej "4 staff does not offer service" staff_service_mismatch "$r"
r=$(as $U4 "select book_appointment('$B','$STB','$S','$D','10:00','Cu',null)"); rej "5 staff from another business" staff_unavailable "$r"
r=$(as $U4 "select book_appointment('$B','$ST','$SB','$D','10:00','Cu',null)"); rej "6 service from another business" service_unavailable "$r"
r=$(as $U4 "select book_appointment('$B','$ST3','$S','$D','10:00','Cu',null)"); rej "7 inactive staff" staff_unavailable "$r"
r=$(as $U4 "select book_appointment('$B','$ST','$S3','$D','10:00','Cu',null)"); rej "7b inactive service" service_unavailable "$r"
r=$(as $U4 "select book_appointment('$B2','$ST','$S','$D','10:00','Cu',null)"); rej "7c business/staff mismatch" staff_unavailable "$r"
r=$(as $U4 "select book_appointment('00000000-0000-0000-0000-00000000dead','$ST','$S','$D','10:00','Cu',null)"); rej "7d unknown business" business_not_found "$r"
r=$(book $U4 10:00 $ST $S $PAST); rej "8 past booking rejected" slot_in_past "$r"
r=$(book $U4 08:00); rej "9 before opening" outside_working_hours "$r"
r=$(book $U4 16:45); rej "9b ends after closing" outside_working_hours "$r"
r=$(book $U4 10:00 $ST $S $D1); rej "9c closed day" outside_working_hours "$r"
r=$(book $U4 10:00); rej "10 overlap -> slot_unavailable (no_staff_overlap)" slot_unavailable "$r"
r=$(book $U4 10:15); rej "10b partial overlap rejected" slot_unavailable "$r"
r=$(book $U4 10:30); ok "10c adjacent slot ok" "$(echo "$r" | grep -c booked)" "1"
r=$(as $U4 "select book_appointment('$B','$ST','$S','2030-03-31','03:30','Cu',null)"); rej "11 nonexistent local time (DST gap)" invalid_local_time "$r"
r=$(as $U4 "select book_appointment('$B','$ST','$S','$D','10:00','',null)"); rej "12 empty name" invalid_customer_name "$r"
r=$(as $U4 "select book_appointment('$B','$ST','$S','$D','14:00','Cu','<script>')"); rej "12b bad phone" invalid_customer_phone "$r"
r=$(q -c "set role authenticated; select book_appointment('$B','$ST','$S','$D','15:00','Cu',null)"); rej "13 no auth.uid -> not_authenticated" not_authenticated "$r"
r=$(q -c "set role anon; select book_appointment('$B','$ST','$S','$D','15:00','Cu',null)"); rej "13b anon cannot execute RPC" "permission denied" "$r"
# Timezone authority is the business, not server/browser: Tokyo business, 10:00 local = 01:00Z
r=$(bookB $U4 $B2 $STB $SB $D 10:00)
ok "14 starts_at uses business timezone (Asia/Tokyo)" "$(q -c "select to_char(starts_at at time zone 'UTC','HH24:MI') from appointments where business_id='$B2'")" "01:00"

# --- anti-abuse limit (5 future active per customer per business)
for t in 09:00 09:30 10:00 10:30 11:00; do book $U5 $t $ST $S $D2 >/dev/null; done
ok "15 five future bookings allowed" "$(cnt "customer_id='$U5'")" "5"
r=$(book $U5 11:30 $ST $S $D2); rej "15b 6th future booking rejected" booking_limit_reached "$r"
r=$(bookB $U5 $B2 $STB $SB $D 11:00); ok "15c limit is per business" "$(echo "$r" | grep -c booked)" "1"
q -c "update appointments set status='completed' where id=(select id from appointments where customer_id='$U5' and business_id='$B' order by starts_at limit 1)" >/dev/null
r=$(book $U5 11:30 $ST $S $D2); ok "15d completed does not count as active" "$(echo "$r" | grep -c booked)" "1"
r=$(book $U5 12:00 $ST $S $D2); rej "15e back at limit" booking_limit_reached "$r"
AID=$(q -c "select id from appointments where customer_id='$U5' and business_id='$B' and status='booked' limit 1")
as $U5 "update appointments set status='cancelled' where id='$AID'" >/dev/null
r=$(book $U5 12:00 $ST $S $D2); ok "15f cancelled does not count as active" "$(echo "$r" | grep -c booked)" "1"
q -c "update appointments set starts_at=starts_at - interval '60 days', ends_at=ends_at - interval '60 days', appointment_date=appointment_date-60 where id=(select id from appointments where customer_id='$U5' and business_id='$B' and status='booked' limit 1)" >/dev/null
r=$(book $U5 12:30 $ST $S $D2); ok "15g past appointment does not count" "$(echo "$r" | grep -c booked)" "1"

# --- direct client writes
r=$(as $U4 "insert into appointments(business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,starts_at,ends_at) values ('$B','$U4','$ST','$S','$D','15:00','15:30','booked','Cu','$D 12:00+00','$D 12:30+00')"); rej "16 direct INSERT denied (valid-looking row)" "direct_insert_not_allowed\|row-level security" "$r"
r=$(as $U4 "insert into appointments(business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,starts_at,ends_at) values ('$B','$U4','$ST','$S','$D','15:00','16:30','confirmed','Cu','$D 12:00+00','$D 13:30+00')"); rej "16b direct INSERT with confirmed status / arbitrary ends_at denied" "direct_insert_not_allowed\|row-level security" "$r"
r=$(as $U4 "insert into appointments(business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,starts_at,ends_at) values ('$B','$U3','$ST','$S','$D','15:00','15:30','booked','Cu','$D 12:00+00','$D 12:30+00')"); rej "16c direct INSERT for another customer denied" "direct_insert_not_allowed\|row-level security" "$r"
# Guard trigger is an independent layer: even if an INSERT policy were re-added it still blocks customers.
q -c "create policy tmp_insert on appointments for insert to authenticated with check (true)" >/dev/null
r=$(as $U4 "insert into appointments(business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,customer_email,starts_at,ends_at) values ('$B','$U4','$ST','$S','$D','15:00','15:30','booked','Cu','evil@x.com','$D 12:00+00','$D 12:30+00')"); rej "16d guard trigger blocks direct INSERT even with permissive policy" direct_insert_not_allowed "$r"
q -c "drop policy tmp_insert on appointments" >/dev/null
ok "16e dropped customer INSERT policy" "$(q -c "select count(*) from pg_policies where tablename='appointments' and policyname='customers create own appointments'")" "0"

# --- UPDATE protection (as customer U2 on own appointment)
A=$(q -c "select id from appointments where customer_id='$U2' and business_id='$B'")
for col in "business_id='$B2'" "staff_id='$ST2'" "service_id='$S2'" "starts_at=starts_at+interval '1 hour'" "ends_at=ends_at+interval '1 hour'" "customer_id='$U3'" "customer_email='evil@x.com'" "customer_phone='123456'" "customer_name='X'" "appointment_date=appointment_date+1" "start_time='11:00'" "end_time='11:00'"; do
  r=$(as $U2 "update appointments set $col where id='$A'"); rej "17 UPDATE $col rejected" "appointment_field_immutable\|row-level security" "$r"
done
for st in confirmed completed pending; do
  r=$(as $U2 "update appointments set status='$st' where id='$A'"); rej "18 booked -> $st rejected" status_change_not_allowed "$r"
done
q -c "update appointments set status='cancelled' where false" >/dev/null
as $U3 "update appointments set status='cancelled' where id='$A'" >/dev/null
ok "19 other customer cannot cancel it" "$(q -c "select status from appointments where id='$A'")" "booked"
r=$(as $U2 "update appointments set status='cancelled' where id='$A'")
ok "20 legitimate cancellation works" "$(q -c "select status from appointments where id='$A'")" "cancelled"
ok "20b cancellation notification still created" "$(q -c "select count(*) from notification_outbox where dedupe_key='appointment:$A:booking_cancellation'")" "1"
for st in booked confirmed completed pending; do
  r=$(as $U2 "update appointments set status='$st' where id='$A'"); rej "21 cancelled -> $st rejected" status_change_not_allowed "$r"
done
ok "21b still cancelled" "$(q -c "select status from appointments where id='$A'")" "cancelled"
r=$(as $U2 "update appointments set status='cancelled' where id='$A'"); ok "21c cancel of cancelled is a harmless no-op" "$(echo "$r" | grep -c ERROR)" "0"
r=$(as $U2 "delete from appointments where id='$A'"); ok "22 customer cannot delete" "$(q -c "select count(*) from appointments where id='$A'")" "1"

# --- owner flows are preserved
OA=$(q -c "select id from appointments where customer_id='$U3' and service_id='$S2' limit 1")
r=$(as $OWN "update appointments set status='confirmed' where id='$OA'"); ok "23 owner can confirm" "$(q -c "select status from appointments where id='$OA'")" "confirmed"
r=$(as $OWN "insert into appointments(business_id,customer_id,staff_id,service_id,appointment_date,start_time,end_time,status,customer_name,customer_email,starts_at,ends_at) values ('$B','$OWN','$ST','$S','$D','15:00','15:30','pending','Walk-in','o@x.com','$D 12:00+00','$D 12:30+00')"); ok "23b owner direct insert (dashboard flow) still allowed" "$(echo "$r" | grep -c ERROR)" "0"
r=$(as $OWN2 "update appointments set status='cancelled' where id='$OA'"); ok "23c another business owner cannot touch it" "$(q -c "select status from appointments where id='$OA'")" "confirmed"

# --- concurrency: two valid bookings for the same staff/time; exclusion constraint is the final authority
( $PSQL -d $DB -At -q -c "set role authenticated; set request.jwt.sub='$U4'; begin; select book_appointment('$B','$ST','$S','$D','16:00','A',null); select pg_sleep(2); commit;" > /tmp/ba.txt 2>&1 ) &
sleep 0.7
$PSQL -d $DB -At -q -c "set role authenticated; set request.jwt.sub='$U6'; select book_appointment('$B','$ST','$S','$D','16:00','B',null);" > /tmp/bb.txt 2>&1
wait
ok "24 concurrent same-slot bookings: exactly one succeeds" "$(q -c "select count(*) from appointments a where staff_id='$ST' and starts_at=(('$D 16:00')::timestamp at time zone 'Europe/Athens') and status<>'cancelled'")" "1"
ok "24b the loser got slot_unavailable" "$(grep -c slot_unavailable /tmp/bb.txt)" "1"
ok "24c no_staff_overlap constraint still present" "$(q -c "select count(*) from pg_constraint where conname='no_staff_overlap'")" "1"

# --- function hardening
ok "25 book_appointment is SECURITY DEFINER with fixed search_path" "$(q -c "select prosecdef::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='book_appointment'")" "true|search_path=public, pg_temp"
ok "25b guard trigger is invoker with fixed search_path" "$(q -c "select prosecdef::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='guard_appointment_client_writes'")" "false|search_path=public, pg_temp"
exit $fail
