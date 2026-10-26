#!/usr/bin/env bash
# Runs the database tests against a throwaway local Postgres database.
# Needs PostgreSQL 15+ and Node.js. Usage: database/tests/run-local.sh [psql connection options]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="bowl_lab_test_$$"

[ -n "${SKIP_SEED_GEN:-}" ] || node "$here/../generate-seed.mjs" > /dev/null
createdb "$@" "$db"
trap 'dropdb "$@" --if-exists "$db"' EXIT

psql "$@" -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/00_supabase_stubs.sql"
psql "$@" -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/../schema.sql"
psql "$@" -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/../supabase.sql" > /dev/null
psql "$@" -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/../seed.sql"
psql "$@" -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/10_behaviour.sql" 2>&1 | sed -n 's/^psql:.*NOTICE:  //p; /ALL TESTS PASSED/p; /ERROR/p'
