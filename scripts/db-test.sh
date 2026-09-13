#!/usr/bin/env bash
# מריץ את כל המיגרציות ואז את כל בדיקות כללי העסק.
#
# שני מצבים:
#   ./scripts/db-test.sh                 מקים Postgres זמני משלו, מריץ, ומוחק. בטוח.
#   DATABASE_URL=... ./scripts/db-test.sh --yes-destroy
#                                        מריץ מול מסד קיים — **פעולה הרסנית**.
#
# אזהרה למצב DATABASE_URL: המיגרציות אינן idempotent (עשרות `create table`
# רגילים) והבדיקות מכניסות שורות ואינן מגלגלות אותן לאחור. המסד חייב להיות
# ריק וחד-פעמי. לעולם לא מול מסד הייצור.
#
# הסקריפט אוסף את קבצי הבדיקה ב-glob (supabase/tests/*.sql), כך שקובץ בדיקה
# חדש נכלל אוטומטית בלי לערוך כאן.
set -euo pipefail
cd "$(dirname "$0")/.."

YES_DESTROY=0
for arg in "$@"; do
  case "$arg" in
    --yes-destroy) YES_DESTROY=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "ארגומנט לא מוכר: $arg" >&2; exit 2 ;;
  esac
done
if [[ "${HR_DB_TEST_YES_DESTROY:-}" == "1" ]]; then YES_DESTROY=1; fi

# רולים ש-Supabase מספקת מובנית ושהמיגרציות מעניקות להם הרשאות.
# על Postgres נקי לבדיקות יוצרים אותם כאן; על Supabase הם כבר קיימים.
ROLES_SQL="do \$\$ begin
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='anon')          then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='service_role')  then create role service_role nologin; end if;
end \$\$;"

shopt -s nullglob
MIGRATIONS=(supabase/migrations/*.sql)
TESTS=(supabase/tests/*.sql)
shopt -u nullglob

if (( ${#MIGRATIONS[@]} == 0 )); then
  echo "שגיאה: לא נמצאה אף מיגרציה ב-supabase/migrations/*.sql." >&2
  exit 1
fi
if (( ${#TESTS[@]} == 0 )); then
  echo "שגיאה: לא נמצא אף קובץ בדיקה ב-supabase/tests/*.sql." >&2
  exit 1
fi

# ------------------------------------------------------------------ מצב מסד קיים
if [[ -n "${DATABASE_URL:-}" ]]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "שגיאה: הפקודה psql אינה מותקנת. התקינו postgresql-client (Debian/Ubuntu:" >&2
    echo "       sudo apt-get install postgresql-client · macOS: brew install libpq)." >&2
    exit 1
  fi

  # זיהוי יעד חד-פעמי: מארח מקומי, או שם מסד שמכיל test/tmp/scratch/ci.
  rest=${DATABASE_URL#*://}; rest=${rest#*@}
  host=${rest%%[:/?]*}
  dbname=${rest#*/}; dbname=${dbname%%\?*}; [[ "$dbname" == "$rest" ]] && dbname=""
  disposable=0
  case "$host" in localhost|127.0.0.1|::1|[Pp]ostgres|db) disposable=1 ;; esac
  case "$dbname" in *test*|*tmp*|*scratch*|*_ci) disposable=1 ;; esac

  if (( ! disposable && ! YES_DESTROY )); then
    cat >&2 <<MSG
שגיאה: סירוב להריץ מול "$host/$dbname".

הרצה במצב DATABASE_URL היא **הרסנית**: המיגרציות אינן idempotent והבדיקות
מכניסות שורות ללא גלגול לאחור. הסקריפט מריץ אוטומטית רק מול יעד שנראה
חד-פעמי (מארח מקומי, או שם מסד עם test/tmp/scratch/_ci).

אם היעד באמת חד-פעמי וריק — הריצו שוב עם --yes-destroy
(או HR_DB_TEST_YES_DESTROY=1). לעולם לא מול מסד הייצור.
ללא DATABASE_URL הסקריפט מקים Postgres זמני משלו וזה הבטוח ביותר.
MSG
    exit 1
  fi

  echo "⚠ מריץ מיגרציות ובדיקות (הרסני) מול $host/$dbname"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "$ROLES_SQL"
  for f in "${MIGRATIONS[@]}"; do
    echo "→ $(basename "$f")"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
  for f in "${TESTS[@]}"; do
    echo "✔ $(basename "$f")"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
  echo "כל המיגרציות והבדיקות עברו."
  exit 0
fi

# ------------------------------------------------------- מצב Postgres זמני מקומי
# איתור הבינאריים של Postgres: PGBIN מפורש → pg_config → נתיב Debian → PATH.
find_pgbin() {
  if [[ -n "${PGBIN:-}" ]]; then echo "$PGBIN"; return; fi
  if command -v pg_config >/dev/null 2>&1; then
    local d; d=$(pg_config --bindir 2>/dev/null || true)
    if [[ -n "$d" && -x "$d/initdb" ]]; then echo "$d"; return; fi
  fi
  local d
  for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin; do
    [[ -x "$d/initdb" ]] && { echo "$d"; return; }
  done
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return; fi
  echo ""
}

PGBIN=$(find_pgbin)
if [[ -z "$PGBIN" || ! -x "$PGBIN/initdb" || ! -x "$PGBIN/pg_ctl" || ! -x "$PGBIN/psql" ]]; then
  cat >&2 <<'MSG'
שגיאה: לא נמצאו הבינאריים של Postgres (initdb / pg_ctl / psql).

הסקריפט מקים מסד זמני משלו ולכן דורש שרת Postgres מותקן (לא רק לקוח):
  Debian/Ubuntu : sudo apt-get install postgresql-16
  macOS (brew)  : brew install postgresql@16
  אחר           : לוודא ש-pg_config נמצא ב-PATH, או להגדיר ידנית
                  PGBIN=/נתיב/אל/bin ./scripts/db-test.sh

לחלופין, מול מסד חד-פעמי קיים (למשל container):
  DATABASE_URL=postgres://... ./scripts/db-test.sh --yes-destroy
MSG
  exit 1
fi

# Postgres מסרב לרוץ תחת root. אם זה המצב, מריצים מחדש כמשתמש postgres.
if [[ "$(id -u)" == "0" && "${HR_TEST_REEXEC:-}" != "1" ]]; then
  if ! id postgres >/dev/null 2>&1; then
    echo "שגיאה: הסקריפט רץ כ-root ו-Postgres מסרב לכך, אך המשתמש postgres אינו קיים." >&2
    echo "       הריצו כמשתמש רגיל, או השתמשו במצב DATABASE_URL מול container." >&2
    exit 1
  fi
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
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -c "$ROLES_SQL"
for f in "${MIGRATIONS[@]}"; do
  echo "→ $(basename "$f")"; "$PGBIN/psql" -v ON_ERROR_STOP=1 -q -f "$f"
done
for f in "${TESTS[@]}"; do
  echo "✔ $(basename "$f")"; "$PGBIN/psql" -v ON_ERROR_STOP=1 -f "$f"
done
echo "כל המיגרציות והבדיקות עברו."
