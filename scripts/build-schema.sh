#!/usr/bin/env bash
# מאחד את כל המיגרציות לקובץ אחד להדבקה ב-Supabase SQL Editor.
#
# הקובץ המאוחד אינו idempotent: הוא מכיל `create table` רגילים, ולכן הוא מיועד
# להקמת מסד *חדש וריק* בלבד. על מסד קיים מריצים רק את המיגרציות החדשות.
#
# שימוש:  ./scripts/build-schema.sh [קובץ-פלט]
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=${1:-supabase/schema.sql}

shopt -s nullglob
migrations=(supabase/migrations/*.sql)
shopt -u nullglob

if (( ${#migrations[@]} == 0 )); then
  echo "שגיאה: לא נמצאה אף מיגרציה ב-supabase/migrations/*.sql." >&2
  exit 1
fi

# המיגרציות ממוספרות בתחילת שם הקובץ; מיון לקסיקוגרפי = סדר ההרצה.
IFS=$'\n' migrations=($(printf '%s\n' "${migrations[@]}" | sort))
unset IFS

lo=$(basename "${migrations[0]}" .sql | cut -d_ -f1)
hi=$(basename "${migrations[${#migrations[@]}-1]}" .sql | cut -d_ -f1)

{
  # הפלט חייב להישאר זהה ביט-לביט לקובץ שבריפו — ה-CI משווה אותם
  # (npm run db:schema && git diff --exit-code). לא להוסיף כאן שורות כותרת.
  echo "-- HR schema (${lo}..${hi} merged for Supabase SQL Editor)"
  for f in "${migrations[@]}"; do
    echo
    echo "-- === $(basename "$f") ==="
    cat "$f"
  done
} > "$OUT"

echo "נכתב $OUT מתוך ${#migrations[@]} מיגרציות."
