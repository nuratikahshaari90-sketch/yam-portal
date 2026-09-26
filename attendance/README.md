# YAM Staff: attendance, leave, outstation and claims

A mobile-first Progressive Web App (PWA) for Yayasan Amal Malaysia staff. Staff install it from the browser (no app store). It is built on trust: there is no GPS or selfie check, and staff type where they are.

- **Deploying (non-technical, step by step):** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **User guides:** [staff](docs/USER_GUIDE_STAFF.md) · [supervisors and HR](docs/USER_GUIDE_SUPERVISOR_HR.md)

## Stack
| Layer | Choice |
|---|---|
| Front end | React 19 + TypeScript + Vite, `vite-plugin-pwa` (Workbox service worker) |
| Offline | IndexedDB via Dexie: an outbox queue plus a read cache |
| Back end | Supabase: Postgres, Auth (email/password), Storage (receipts/MCs) |
| Security | Row Level Security on every table; all writes go through `security definer` functions |
| Exports | ExcelJS and jsPDF (lazy-loaded, not pre-cached for offline) |
| Hosting | Netlify (`netlify.toml`) or Vercel (`vercel.json`) |

## Folder layout
```
src/
  lib/          dates (Malaysia time), work-day rules, types, errors, file helpers (no UI)
  offline/      IndexedDB, outbox + sync engine, hooks
  auth/         login, activation, password reset, current user/role
  components/   layout, bottom nav, sync bar, form widgets
  features/     one folder per area: clock, leave, trips, claims, approvals, reports, admin
supabase/
  migrations/   database schema, one file per build stage (source of truth)
  seed.sql      sample data for testing
  tests/        pgTAP database tests (permissions and calculations)
  deploy/       generated copy-and-paste SQL for manual setup (scripts/build-deploy-sql.sh)
e2e/            Playwright end-to-end tests on a phone-sized browser
```
Data access (`features/*/api.ts`) is separate from screens, so a desktop layout can reuse it. The CSS already widens at 900px.

## Key rules (enforced in the database)
- **Server time.** Clock-in and clock-out use `now()`. Offline entries keep the phone time, set `*_offline = true`, and store the sync time in `*_server_at`. A phone time in the future is not trusted.
- **Idempotent sync.** Entries and drafts carry phone-generated UUIDs, so retries never duplicate. Anything the server refuses goes to `sync_conflicts` for HR, and a copy stays on the phone. Nothing is dropped.
- **Schedules** have effective dates (`work_schedules`). `app_private.day_type_for(staff, date)` classifies every date as working day, off day or public holiday using the schedule in force on that date.
- **Leave days** use the person's own schedule, excluding off days and public holidays. Half days are 0.5 and single-day only. Each record stores type, dates, portion, `working_days`, status and `decided_at`. **Leave balances** can be added later as a separate `leave_entitlements` table (staff, type, year, days) with a balance view: entitlement minus approved `working_days`. Existing records don't change.
- **Hours** = time between clock-in and clock-out, minus the unpaid break when more than 5 h is recorded. **Overtime** counts on working days only: hours above the threshold, if at least the minimum. Off-day and public-holiday work is reported separately.
- **Exception flags** are computed live in `attendance_view`: `off_day, public_holiday, outstation_no_trip, offline, missed_clockout, over_limit, overtime, sync_conflict`. A review stores the flags it covered, so a new flag re-opens the review.
- **Approver snapshot.** `approver_id` is set when an item is submitted (NULL means the HR/Admin pool), so changing a supervisor only affects new requests. HR can `reassign`. Nobody can decide their own item.
- **Routing** is set per kind in `app_settings` (`route_leave/trip/claim/clock`). The current setup: leave and trips go to the supervisor; claims and clock exceptions go to HR.

## Run it locally (developers)
Requires Node 22 and Docker.
```bash
npm install
npm run db:start          # local Supabase in Docker (first run downloads images)
npm run db:reset          # apply migrations + sample data
cp .env.example .env.local  # set URL http://127.0.0.1:54321 and the anon key printed by db:start
npm run dev               # http://localhost:5173
```
Local emails (activation, password reset) appear in Mailpit at http://127.0.0.1:54324.

## Tests
```bash
npm run test:all   # fresh database, then 145 database tests + unit tests + 30 end-to-end tests
```
- `supabase/tests/*.sql`: who can see and do what for each role, schedule/holiday/leave calculations, time rules, approvals, reports
- `src/**/*.test.ts`: date and work-day calculations
- `e2e/*.spec.ts`: every stage in a Pixel-7-sized browser, including offline mode, the installed service worker, and Excel/PDF downloads

## Changing the database
Add a new file in `supabase/migrations/` (never edit one that is already live), run `npm run db:reset && npm run test:db`, then `npm run deploy-sql`. Give the new migration file to whoever runs the SQL Editor on the live project.
