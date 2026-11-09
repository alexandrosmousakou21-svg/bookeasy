#!/bin/sh
# Applies schema.sql and every migration in order to a disposable local Postgres, then runs each tests/db/*.sql.
# Never connects to a remote database.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
docker run --rm --user postgres \
  -v "${SUPABASE_DIR:-$ROOT/supabase}:/supabase:ro" -v "$ROOT/tests/db:/tests:ro" \
  postgres:16-alpine sh -c '
set -eu
initdb -D /tmp/pgdata -A trust >/dev/null 2>&1
pg_ctl -D /tmp/pgdata -o "-k /tmp" -w start >/dev/null
P="psql -h /tmp -d postgres -v ON_ERROR_STOP=1 -q"
$P -f /tests/00_supabase_stubs.sql
$P -f /supabase/schema.sql
for f in $(ls /supabase/migrations/*.sql | sort); do echo "apply $(basename $f)"; sed "/^create extension if not exists pg_net/d" "$f" | $P >/dev/null; done
$P -f /tests/01_after_migrations.sql
for t in $(ls /tests/[1-9]*_*.sql 2>/dev/null | sort); do echo "run $(basename $t)"; $P -f "$t" >/dev/null; done
echo "DB TESTS PASSED"
'
