#!/usr/bin/env sh
# Runs each *.test.sql on its own throwaway database with the platform and every Type migration applied.
# Needs psql and a server you can create databases on (PGHOST, PGUSER and so on).
#
# supabase/platform/ holds copies of the migrations Type builds on (Write's and the ELUM platform's,
# from the Write repository). They are applied here for testing only; production gets them from Write.
# supabase/platform-changes/ holds platform fixes Type needs that have not moved to Write yet.
set -eu
cd "$(dirname "$0")"
for test in *.test.sql; do
  DB="elum_type_test_$$"
  createdb "$DB"
  trap 'dropdb --if-exists "$DB" 2>/dev/null' EXIT
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase-stub.sql >/dev/null 2>&1
  for migration in ../platform/*.sql ../platform-changes/*.sql ../migrations/*.sql; do
    psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
  done
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f helpers.sql
  echo "-- $test"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f "$test"
  dropdb "$DB"
done
