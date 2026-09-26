#!/usr/bin/env bash
# Runs every automated test against a fresh local database.
set -euo pipefail
cd "$(dirname "$0")/.."
npx supabase db reset
npx supabase test db
npx vitest run
npx playwright test "$@"
