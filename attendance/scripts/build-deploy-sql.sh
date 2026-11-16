#!/usr/bin/env bash
# Builds the copy-and-paste SQL files used when setting up Supabase by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
out=supabase/deploy/1_create_database.sql
{
  echo "-- YAM Staff Attendance: complete database setup."
  echo "-- Paste this whole file into Supabase > SQL Editor and press Run. Run it ONCE on a new project."
  echo "-- Generated from supabase/migrations by scripts/build-deploy-sql.sh"
  for f in supabase/migrations/*.sql; do
    echo
    echo "-- ===================== $(basename "$f") ====================="
    cat "$f"
  done
} > "$out"
{
  echo "-- OPTIONAL: sample staff and data for trying the app. All sample passwords: YamTest#2026"
  echo "-- Remove it before real use with 3_remove_sample_data.sql"
  echo
  cat supabase/seed.sql
} > supabase/deploy/2_sample_data_optional.sql
echo "Wrote $out and supabase/deploy/2_sample_data_optional.sql"
