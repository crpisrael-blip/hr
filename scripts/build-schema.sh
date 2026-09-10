#!/usr/bin/env bash
# מאחד את כל המיגרציות לקובץ אחד להדבקה ב-Supabase SQL Editor.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=supabase/schema.sql
first=$(ls supabase/migrations/*.sql | head -1)
last=$(ls supabase/migrations/*.sql | tail -1)
lo=$(basename "$first" .sql | cut -d_ -f1)
hi=$(basename "$last"  .sql | cut -d_ -f1)

{
  echo "-- HR schema (${lo}..${hi} merged for Supabase SQL Editor)"
  for f in supabase/migrations/*.sql; do
    echo
    echo "-- === $(basename "$f") ==="
    cat "$f"
  done
} > "$OUT"

echo "נכתב $OUT מתוך $(ls supabase/migrations/*.sql | wc -l) מיגרציות."
