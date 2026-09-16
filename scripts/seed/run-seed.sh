#!/usr/bin/env bash
# טעינת דאטה ניסיונית לבדיקות עומס אל מסד **בדיקות/סטייג׳ינג בלבד**.
#
# שימוש:
#   DATABASE_URL=postgres://... ./scripts/seed/run-seed.sh          # שלב קטן (~5k מועמדים)
#   DATABASE_URL=postgres://... ./scripts/seed/run-seed.sh --full   # נפח מלא (~80k מועמדים)
#   הוסיפו --yes כדי לדלג על אישור אינטראקטיבי.
#   אפשר לעקוף כמויות דרך סביבה: N_CANDIDATES, N_JOBS, N_COMPANIES, N_EMPLOYEES, N_TEAMS.
#
# בטיחות: מסרב לרוץ אם DATABASE_URL מצביע על פרויקט הייצור. דורש שהסכימה כבר
# הוחלה על המסד (supabase/schema.sql או המיגרציות עד 0037 ומעלה).
set -euo pipefail
cd "$(dirname "$0")"

PROD_REF="jsxkwosjtjdypwedzxwx"   # ה-ref של פרויקט הייצור — חסום קשיח.

FULL=0; YES=0
for a in "$@"; do
  case "$a" in
    --full) FULL=1 ;;
    --yes)  YES=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "ארגומנט לא מוכר: $a" >&2; exit 2 ;;
  esac
done

: "${DATABASE_URL:?צריך DATABASE_URL של מסד הבדיקות/סטייג׳ינג}"
command -v psql >/dev/null 2>&1 || { echo "שגיאה: psql אינו מותקן (postgresql-client)." >&2; exit 1; }

if [[ "$DATABASE_URL" == *"$PROD_REF"* ]]; then
  echo "סירוב: DATABASE_URL מצביע על פרויקט הייצור ($PROD_REF)." >&2
  echo "       דאטה ניסיונית נטענת אך ורק למסד בדיקות/סטייג׳ינג נפרד." >&2
  exit 1
fi

if (( FULL )); then
  N_COMPANIES=${N_COMPANIES:-180}; N_TEAMS=${N_TEAMS:-8}; N_EMPLOYEES=${N_EMPLOYEES:-25}
  N_JOBS=${N_JOBS:-700}; N_CANDIDATES=${N_CANDIDATES:-80000}
else
  N_COMPANIES=${N_COMPANIES:-180}; N_TEAMS=${N_TEAMS:-6}; N_EMPLOYEES=${N_EMPLOYEES:-20}
  N_JOBS=${N_JOBS:-700}; N_CANDIDATES=${N_CANDIDATES:-5000}
fi

# הצגת היעד (מארח בלבד, בלי סיסמה) לפני אישור.
rest=${DATABASE_URL#*://}; rest=${rest#*@}; host=${rest%%[:/?]*}
echo "טעינת דאטה ניסיונית אל  $host"
echo "  companies=$N_COMPANIES · teams=$N_TEAMS · employees=$N_EMPLOYEES · jobs=$N_JOBS · candidates=$N_CANDIDATES"

if (( ! YES )); then
  read -r -p 'להמשיך? הקלידו yes: ' ans
  [[ "$ans" == "yes" ]] || { echo "בוטל."; exit 1; }
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v n_companies="$N_COMPANIES" -v n_teams="$N_TEAMS" -v n_employees="$N_EMPLOYEES" \
  -v n_jobs="$N_JOBS" -v n_candidates="$N_CANDIDATES" \
  -f seed.sql
