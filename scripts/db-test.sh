#!/usr/bin/env bash
# מריץ את כל המיגרציות על מסד חד-פעמי ואז את בדיקות כללי העסק.
# שימוש:  ./scripts/db-test.sh          (מסד מקומי זמני)
#         DATABASE_URL=... ./scripts/db-test.sh   (מסד קיים)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${DATABASE_URL:-}" ]]; then
  for f in supabase/migrations/*.sql; do
    echo "→ $(basename "$f")"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/business_rules.sql
  exit 0
fi

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}

# Postgres מסרב לרוץ תחת root. אם זה המצב, מריצים מחדש כמשתמש postgres.
if [[ "$(id -u)" == "0" && "${HR_TEST_REEXEC:-}" != "1" ]]; then
  WORK=$(mktemp -d); cp -r supabase scripts "$WORK/"; chmod -R a+rX "$WORK"
  chown -R postgres:postgres "$WORK" 2>/dev/null || true
  HR_TEST_REEXEC=1 exec su postgres -c "cd '$WORK' && HR_TEST_REEXEC=1 PGBIN='$PGBIN' bash scripts/db-test.sh"
fi

DIR=$(mktemp -d); SOCK=$(mktemp -d); PORT=${PORT:-$(( 5500 + RANDOM % 400 ))}
cleanup() { "$PGBIN/pg_ctl" -D "$DIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR" "$SOCK"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$DIR" -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DIR" -o "-k $SOCK -p $PORT" -l "$DIR/log" start >/dev/null
export PGHOST=$SOCK PGPORT=$PORT PGDATABASE=postgres
"$PGBIN/psql" -q -c 'create database hr' >/dev/null
export PGDATABASE=hr
for f in supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"; "$PGBIN/psql" -v ON_ERROR_STOP=1 -q -f "$f"
done
"$PGBIN/psql" -v ON_ERROR_STOP=1 -f supabase/tests/business_rules.sql
echo "כל המיגרציות והבדיקות עברו."
