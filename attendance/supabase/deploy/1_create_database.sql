-- YAM Staff Attendance: complete database setup.
-- Paste this whole file into Supabase > SQL Editor and press Run. Run it ONCE on a new project.
-- Generated from supabase/migrations by scripts/build-deploy-sql.sh

-- ===================== 20260926000100_core.sql =====================
-- =====================================================================
-- Stage 1: staff, roles, work schedules, public holidays, settings
-- =====================================================================
-- Conventions
--   * All business dates are Malaysian dates (Asia/Kuala_Lumpur).
--   * `staff.id` is the key used everywhere. `staff.user_id` links to the
--     Supabase login (auth.users) once the person activates their account.
--   * Internal helper functions live in the `app_private` schema, which is
--     NOT exposed through the API.

create schema if not exists app_private;
grant usage on schema app_private to authenticated;

-- ---------------------------------------------------------------------
-- Staff and roles
-- ---------------------------------------------------------------------
create type public.app_role as enum ('staff', 'supervisor', 'admin');

create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete set null,
  email         text not null unique check (email = lower(trim(email)) and email like '%@%'),
  full_name     text not null check (length(trim(full_name)) > 0),
  staff_no      text unique,
  job_title     text,
  role          public.app_role not null default 'staff',
  supervisor_id uuid references public.staff (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (supervisor_id is null or supervisor_id <> id)
);
comment on table public.staff is 'One row per person. HR/Admin registers staff here before they can activate a login.';

-- Malaysia "today"
create function app_private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

-- Who is calling? (null when not logged in or deactivated)
create function public.current_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s where s.user_id = auth.uid() and s.active
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.role = 'admin' from public.staff s
                   where s.user_id = auth.uid() and s.active), false)
$$;

create function app_private.is_supervisor_of(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s
                 where s.id = p_staff and s.supervisor_id = public.current_staff_id())
$$;

-- Extended in later stages: anyone who is the approver of an item
-- belonging to p_staff may also see that person's basic details.
create function app_private.is_approver_for_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select false
$$;

-- Central visibility rule: self, HR/Admin, the person's supervisor,
-- or an approver of one of their items.
create function app_private.can_view_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_staff = public.current_staff_id()
      or public.is_admin()
      or app_private.is_supervisor_of(p_staff)
      or app_private.is_approver_for_staff(p_staff)
$$;

grant execute on function app_private.today() to authenticated;
grant execute on function app_private.is_supervisor_of(uuid) to authenticated;
grant execute on function app_private.is_approver_for_staff(uuid) to authenticated;
grant execute on function app_private.can_view_staff(uuid) to authenticated;

-- Data-integrity rules for staff changes
create function app_private.staff_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_sup_role public.app_role;
begin
  new.email := lower(trim(new.email));
  new.updated_at := now();

  if new.supervisor_id is not null then
    select role into v_sup_role from public.staff where id = new.supervisor_id;
    if v_sup_role is null or v_sup_role = 'staff' then
      raise exception 'The chosen supervisor must have the Supervisor or HR/Admin role.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- An admin cannot lock themselves out.
    if old.id = public.current_staff_id() and old.role = 'admin'
       and (new.role <> 'admin' or not new.active) then
      raise exception 'You cannot remove your own HR/Admin access or deactivate yourself.';
    end if;
    -- The login link is managed by the system only.
    if new.user_id is distinct from old.user_id and auth.uid() is not null then
      new.user_id := old.user_id;
    end if;
    -- Demoting someone to plain staff is blocked while they still lead a team.
    if new.role = 'staff' and old.role <> 'staff'
       and exists (select 1 from public.staff t where t.supervisor_id = old.id) then
      raise exception 'Reassign this person''s team to another supervisor before changing their role to Staff.';
    end if;
  end if;
  return new;
end $$;

create trigger staff_guard before insert or update on public.staff
for each row execute function app_private.staff_guard();

-- ---------------------------------------------------------------------
-- Login activation: only emails registered by HR can create a login.
-- ---------------------------------------------------------------------
create function app_private.auth_user_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff s
                 where s.email = lower(new.email) and s.active and s.user_id is null) then
    raise exception 'EMAIL_NOT_REGISTERED';
  end if;
  return new;
end $$;

create function app_private.auth_user_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.staff set user_id = new.id
   where email = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger yam_auth_user_guard before insert on auth.users
for each row execute function app_private.auth_user_guard();
create trigger yam_auth_user_link after insert on auth.users
for each row execute function app_private.auth_user_link();

-- ---------------------------------------------------------------------
-- Work schedules (with history via effective dates)
-- ---------------------------------------------------------------------
-- working_days uses ISO weekday numbers: 1 = Monday ... 7 = Sunday.
create table public.work_schedules (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.staff (id) on delete cascade,
  effective_from date not null,
  working_days   smallint[] not null
                 check (working_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  note           text,
  created_by     uuid references public.staff (id),
  created_at     timestamptz not null default now(),
  unique (staff_id, effective_from)
);
comment on table public.work_schedules is
  'Schedule history. The row with the latest effective_from on or before a date applies to that date.';

create function app_private.schedule_normalise() returns trigger
language plpgsql set search_path = '' as $$
begin
  select coalesce(array_agg(distinct d order by d), '{}') into new.working_days
    from unnest(new.working_days) d;
  new.created_by := coalesce(new.created_by, public.current_staff_id());
  return new;
end $$;
create trigger schedule_normalise before insert or update on public.work_schedules
for each row execute function app_private.schedule_normalise();

-- Every new staff member starts on Monday to Friday.
create function app_private.staff_default_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.work_schedules (staff_id, effective_from, working_days, note)
  values (new.id, date '2000-01-01', array[1,2,3,4,5]::smallint[], 'Default: Monday to Friday');
  return new;
end $$;
create trigger staff_default_schedule after insert on public.staff
for each row execute function app_private.staff_default_schedule();

create function app_private.working_days_for(p_staff uuid, p_date date) returns smallint[]
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select w.working_days from public.work_schedules w
      where w.staff_id = p_staff and w.effective_from <= p_date
      order by w.effective_from desc limit 1),
    array[1,2,3,4,5]::smallint[])
$$;

-- ---------------------------------------------------------------------
-- Public holidays
-- ---------------------------------------------------------------------
create table public.public_holidays (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null check (length(trim(name)) > 0),
  created_at   timestamptz not null default now()
);

create type public.day_type as enum ('working_day', 'off_day', 'public_holiday');

-- Classify a date for one person, using the schedule that applied then.
-- A public holiday takes precedence over an off day.
create function app_private.day_type_for(p_staff uuid, p_date date) returns public.day_type
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.public_holidays h where h.holiday_date = p_date)
      then 'public_holiday'::public.day_type
    when extract(isodow from p_date)::smallint = any (app_private.working_days_for(p_staff, p_date))
      then 'working_day'::public.day_type
    else 'off_day'::public.day_type
  end
$$;

-- Number of working days between two dates (inclusive) for one person.
create function app_private.count_working_days(p_staff uuid, p_from date, p_to date) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int
    from generate_series(p_from, p_to, interval '1 day') g(d)
   where app_private.day_type_for(p_staff, g.d::date) = 'working_day'
$$;

grant execute on function app_private.working_days_for(uuid, date) to authenticated;
grant execute on function app_private.day_type_for(uuid, date) to authenticated;
grant execute on function app_private.count_working_days(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Settings (single row, edited by HR/Admin)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id                       smallint primary key default 1 check (id = 1),
  missed_clockout_time     time not null default '23:59',
  max_daily_hours          numeric(4,2) not null default 10 check (max_daily_hours > 0),
  overtime_threshold_hours numeric(4,2) not null default 8 check (overtime_threshold_hours > 0),
  -- Unpaid break deducted from a day's hours when more than 5 hours were worked.
  break_minutes            integer not null default 60 check (break_minutes between 0 and 240),
  -- Overtime below this many minutes in a day is ignored.
  overtime_min_minutes     integer not null default 30 check (overtime_min_minutes between 0 and 240),
  mileage_rate_per_km      numeric(6,2) not null default 0.60 check (mileage_rate_per_km >= 0),
  -- Who approves each kind of request: the staff member's supervisor
  -- (falling back to HR when none is assigned) or always HR/Admin.
  route_leave text not null default 'supervisor' check (route_leave in ('supervisor', 'hr')),
  route_trip  text not null default 'supervisor' check (route_trip  in ('supervisor', 'hr')),
  route_claim text not null default 'hr'         check (route_claim in ('supervisor', 'hr')),
  route_clock text not null default 'hr'         check (route_clock in ('supervisor', 'hr')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id)
);
insert into public.app_settings (id) values (1);

create function app_private.settings_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := public.current_staff_id();
  return new;
end $$;
create trigger settings_touch before update on public.app_settings
for each row execute function app_private.settings_touch();

-- Snapshot of the approver at the moment a request is submitted.
-- NULL means "HR/Admin pool".
create function app_private.approver_for(p_staff uuid, p_kind text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_route text;
  v_sup   uuid;
begin
  select case p_kind when 'leave' then route_leave when 'trip' then route_trip
                     when 'claim' then route_claim when 'clock' then route_clock end
    into v_route from public.app_settings where id = 1;
  if v_route = 'hr' then return null; end if;
  select s.supervisor_id into v_sup
    from public.staff s join public.staff sup on sup.id = s.supervisor_id and sup.active
   where s.id = p_staff;
  return v_sup;
end $$;

-- ---------------------------------------------------------------------
-- Audit trail of decisions and important actions
-- ---------------------------------------------------------------------
create table public.approval_log (
  id         bigint generated always as identity primary key,
  entity     text not null,         -- leave | trip | claim | clock | staff
  entity_id  uuid not null,
  staff_id   uuid references public.staff (id),  -- whose item it is
  action     text not null,
  actor_id   uuid references public.staff (id),
  comment    text,
  created_at timestamptz not null default now()
);
create index on public.approval_log (entity, entity_id);

create function app_private.log_action(p_entity text, p_id uuid, p_staff uuid, p_action text, p_comment text)
returns void language sql security definer set search_path = '' as $$
  insert into public.approval_log (entity, entity_id, staff_id, action, actor_id, comment)
  values (p_entity, p_id, p_staff, p_action, public.current_staff_id(), nullif(trim(p_comment), ''))
$$;

-- ---------------------------------------------------------------------
-- Offline sync safety net: anything the server could not accept is kept
-- here for HR, so no entry is ever lost.
-- ---------------------------------------------------------------------
create table public.sync_conflicts (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references public.staff (id),
  kind            text not null,
  payload         jsonb not null,
  error           text not null,
  device_recorded_at timestamptz,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.staff (id),
  resolution_note text
);

create function public.record_sync_conflict(p_op_id uuid, p_kind text, p_payload jsonb, p_error text, p_device_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_staff_id();
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  insert into public.sync_conflicts (id, staff_id, kind, payload, error, device_recorded_at)
  values (p_op_id, v_me, p_kind, p_payload, left(p_error, 2000), p_device_at)
  on conflict (id) do nothing;
  return p_op_id;
end $$;

create function public.resolve_sync_conflict(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only HR/Admin can resolve sync issues.'; end if;
  update public.sync_conflicts
     set resolved_at = now(), resolved_by = public.current_staff_id(), resolution_note = p_note
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.staff           enable row level security;
alter table public.work_schedules  enable row level security;
alter table public.public_holidays enable row level security;
alter table public.app_settings    enable row level security;
alter table public.approval_log    enable row level security;
alter table public.sync_conflicts  enable row level security;

-- Nothing is visible to people who are not logged in.
revoke all on all tables in schema public from anon;

create policy staff_select on public.staff for select to authenticated
  using (app_private.can_view_staff(id));
create policy staff_admin_insert on public.staff for insert to authenticated
  with check (public.is_admin());
create policy staff_admin_update on public.staff for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy schedules_select on public.work_schedules for select to authenticated
  using (app_private.can_view_staff(staff_id));
create policy schedules_admin_all on public.work_schedules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy holidays_select on public.public_holidays for select to authenticated using (true);
create policy holidays_admin_all on public.public_holidays for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy settings_select on public.app_settings for select to authenticated using (true);
create policy settings_admin_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy log_select on public.approval_log for select to authenticated
  using (staff_id is not null and app_private.can_view_staff(staff_id));

create policy conflicts_select on public.sync_conflicts for select to authenticated
  using (staff_id = public.current_staff_id() or public.is_admin());

-- Tables that are written only through the functions above.
revoke insert, update, delete on public.approval_log, public.sync_conflicts from authenticated;
revoke delete on public.staff, public.app_settings from authenticated;

-- ===================== 20260926000200_attendance.sql =====================
-- =====================================================================
-- Stage 2: clock-in and clock-out
-- =====================================================================
-- Time rules
--   * Online entries use the SERVER time (now()), never the phone clock.
--   * Offline entries use the phone time, are flagged "recorded offline",
--     and also store the server time at which they synced.

create type public.work_mode as enum ('office', 'wfh', 'client_site', 'outstation', 'training');

create table public.attendance_entries (
  id                  uuid primary key,  -- generated on the phone so retries never duplicate
  staff_id            uuid not null references public.staff (id),
  work_date           date not null,
  work_mode           public.work_mode not null,
  location            text not null check (length(trim(location)) > 0),
  purpose             text not null check (length(trim(purpose)) > 0),
  day_type            public.day_type not null,
  holiday_name        text,

  clock_in_at         timestamptz not null,           -- official time used for calculations
  clock_in_server_at  timestamptz not null default now(),
  clock_in_device_at  timestamptz,
  clock_in_offline    boolean not null default false,

  clock_out_at        timestamptz,
  clock_out_server_at timestamptz,
  clock_out_device_at timestamptz,
  clock_out_offline   boolean not null default false,
  clock_out_note      text,
  clock_out_location  text,

  conflict_note       text,   -- set when a sync needed special handling

  adjusted_by         uuid references public.staff (id),
  adjusted_at         timestamptz,
  adjust_note         text,

  approver_id         uuid references public.staff (id), -- NULL = HR/Admin
  review_status       text check (review_status in ('approved', 'rejected')),
  reviewed_flags      text[] not null default '{}',
  reviewed_by         uuid references public.staff (id),
  reviewed_at         timestamptz,
  review_comment      text,

  created_at          timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create index on public.attendance_entries (staff_id, work_date);
create index on public.attendance_entries (staff_id) where clock_out_at is null;

alter table public.attendance_entries enable row level security;
create policy attendance_select on public.attendance_entries for select to authenticated
  using (app_private.can_view_staff(staff_id));
-- No insert/update/delete policies: all writes go through the functions below.
revoke insert, update, delete on public.attendance_entries from authenticated;

-- Pick the official time for an event.
create function app_private.event_time(p_device_at timestamptz, p_offline boolean, out v_at timestamptz, out v_note text)
language plpgsql stable set search_path = '' as $$
begin
  v_at := now();
  v_note := null;
  if p_offline and p_device_at is not null then
    if p_device_at > now() + interval '10 minutes' then
      v_note := 'Phone clock was ahead of the server; server time used.';
    else
      v_at := p_device_at;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Clock in
-- ---------------------------------------------------------------------
create function public.clock_in(
  p_id uuid,
  p_work_mode public.work_mode,
  p_location text,
  p_purpose text,
  p_trip_id uuid default null,
  p_device_at timestamptz default null,
  p_offline boolean default false
) returns public.attendance_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_staff_id();
  v_row   public.attendance_entries;
  v_at    timestamptz;
  v_note  text;
  v_date  date;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  -- Idempotent: the same entry sent twice is only stored once.
  select * into v_row from public.attendance_entries where id = p_id;
  if found then
    if v_row.staff_id is distinct from v_me then raise exception 'Entry belongs to someone else.'; end if;
    return v_row;
  end if;

  if coalesce(trim(p_location), '') = '' then raise exception 'Please enter your location.'; end if;
  if coalesce(trim(p_purpose), '') = '' then raise exception 'Please enter the purpose or task.'; end if;

  select * into v_at, v_note from app_private.event_time(p_device_at, p_offline);

  if exists (select 1 from public.attendance_entries
              where staff_id = v_me and clock_out_at is null) then
    if not p_offline then
      raise exception 'You are already clocked in. Please clock out first.';
    end if;
    -- An offline clock-in arriving while another entry is open (e.g. two
    -- phones): keep it, and flag it for HR instead of losing it.
    v_note := concat_ws(' ', v_note, 'Synced while another entry was still open.');
  end if;

  v_date := (v_at at time zone 'Asia/Kuala_Lumpur')::date;

  insert into public.attendance_entries (
    id, staff_id, work_date, work_mode, location, purpose, day_type, holiday_name,
    clock_in_at, clock_in_device_at, clock_in_offline, conflict_note, approver_id)
  values (
    p_id, v_me, v_date, p_work_mode, trim(p_location), trim(p_purpose),
    app_private.day_type_for(v_me, v_date),
    (select h.name from public.public_holidays h where h.holiday_date = v_date),
    v_at, p_device_at, coalesce(p_offline, false), v_note,
    app_private.approver_for(v_me, 'clock'))
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- Clock out
-- ---------------------------------------------------------------------
create function public.clock_out(
  p_entry_id uuid,
  p_note text default null,
  p_location text default null,
  p_device_at timestamptz default null,
  p_offline boolean default false
) returns public.attendance_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.current_staff_id();
  v_row  public.attendance_entries;
  v_at   timestamptz;
  v_note text;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  select * into v_row from public.attendance_entries where id = p_entry_id for update;
  if not found or v_row.staff_id is distinct from v_me then
    raise exception 'Clock-in record not found.';
  end if;

  if v_row.clock_out_at is not null then
    -- Already clocked out. A retry of the same clock-out is fine; a
    -- different one is kept in the sync issues list for HR.
    if p_device_at is not null and v_row.clock_out_device_at is not null
       and abs(extract(epoch from (p_device_at - v_row.clock_out_device_at))) < 1 then
      return v_row;
    end if;
    if v_row.clock_out_device_at is null and not p_offline then
      return v_row;
    end if;
    raise exception 'This entry was already clocked out at %.',
      to_char(v_row.clock_out_at at time zone 'Asia/Kuala_Lumpur', 'HH12:MI am, DD Mon');
  end if;

  select * into v_at, v_note from app_private.event_time(p_device_at, p_offline);
  if v_at < v_row.clock_in_at then
    v_at := v_row.clock_in_at;
    v_note := concat_ws(' ', v_note, 'Phone clock-out time was before clock-in; clock-in time used.');
  end if;

  update public.attendance_entries set
    clock_out_at        = v_at,
    clock_out_server_at = now(),
    clock_out_device_at = p_device_at,
    clock_out_offline   = coalesce(p_offline, false),
    clock_out_note      = nullif(trim(p_note), ''),
    clock_out_location  = nullif(trim(p_location), ''),
    conflict_note       = concat_ws(' ', conflict_note, v_note)
  where id = p_entry_id
  returning * into v_row;
  if v_row.conflict_note = '' then
    update public.attendance_entries set conflict_note = null where id = p_entry_id returning * into v_row;
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- HR correction (e.g. someone forgot to clock out)
-- ---------------------------------------------------------------------
create function public.admin_adjust_entry(p_id uuid, p_clock_in_at timestamptz, p_clock_out_at timestamptz, p_note text)
returns public.attendance_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.attendance_entries;
  v_old public.attendance_entries;
begin
  if not public.is_admin() then raise exception 'Only HR/Admin can correct entries.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Please give a reason for the correction.'; end if;
  select * into v_old from public.attendance_entries where id = p_id for update;
  if not found then raise exception 'Entry not found.'; end if;
  if p_clock_out_at is not null and p_clock_out_at < coalesce(p_clock_in_at, v_old.clock_in_at) then
    raise exception 'Clock-out must be after clock-in.';
  end if;
  update public.attendance_entries set
    clock_in_at  = coalesce(p_clock_in_at, clock_in_at),
    clock_out_at = p_clock_out_at,
    clock_out_server_at = case when v_old.clock_out_at is null and p_clock_out_at is not null then now() else clock_out_server_at end,
    adjusted_by  = public.current_staff_id(),
    adjusted_at  = now(),
    adjust_note  = trim(p_note)
  where id = p_id returning * into v_row;
  perform app_private.log_action('clock', p_id, v_row.staff_id, 'adjusted',
    format('%s (was %s – %s)', trim(p_note),
      to_char(v_old.clock_in_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon HH24:MI'),
      coalesce(to_char(v_old.clock_out_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon HH24:MI'), 'no clock-out')));
  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- Attendance with calculated hours and exception flags
-- (outstation check is added in the outstation stage)
-- ---------------------------------------------------------------------
-- Worked hours for a day = time between clock-in and clock-out, minus the
-- unpaid break when more than 5 hours were recorded that day.
create function app_private.net_hours(p_gross numeric, p_break_minutes integer) returns numeric
language sql immutable set search_path = '' as $$
  select round(greatest(0, p_gross - case when p_gross > 5 then p_break_minutes / 60.0 else 0 end), 2)
$$;

-- Overtime for a working day, respecting the minimum-overtime setting.
create function app_private.overtime_hours(p_net numeric, p_threshold numeric, p_min_minutes integer) returns numeric
language sql immutable set search_path = '' as $$
  select case when p_net - p_threshold > 0 and (p_net - p_threshold) * 60 >= p_min_minutes
              then round(p_net - p_threshold, 2) else 0 end
$$;
grant execute on function app_private.net_hours(numeric, integer) to authenticated;
grant execute on function app_private.overtime_hours(numeric, numeric, integer) to authenticated;

create view public.attendance_view with (security_invoker = true) as
with s as (select * from public.app_settings where id = 1),
e as (
  select a.*,
    round((extract(epoch from (a.clock_out_at - a.clock_in_at)) / 3600.0)::numeric, 2) as hours,
    round((sum(extract(epoch from (coalesce(a.clock_out_at, a.clock_in_at) - a.clock_in_at)))
           over (partition by a.staff_id, a.work_date) / 3600.0)::numeric, 2) as gross_day_hours,
    ((a.work_date + s.missed_clockout_time) at time zone 'Asia/Kuala_Lumpur') as cutoff_at
  from public.attendance_entries a cross join s
),
f as (
  select e.*,
    app_private.net_hours(e.gross_day_hours, s.break_minutes) as day_hours,
    case when e.day_type = 'working_day'
         then app_private.overtime_hours(app_private.net_hours(e.gross_day_hours, s.break_minutes),
                                         s.overtime_threshold_hours, s.overtime_min_minutes)
         else 0 end as day_overtime_hours,
    array_remove(array[
      case when e.day_type = 'off_day' then 'off_day' end,
      case when e.day_type = 'public_holiday' then 'public_holiday' end,
      case when e.clock_in_offline or e.clock_out_offline then 'offline' end,
      case when (e.clock_out_at is null and now() > e.cutoff_at)
             or (e.clock_out_at > e.cutoff_at and e.adjusted_by is null) then 'missed_clockout' end,
      case when app_private.net_hours(e.gross_day_hours, s.break_minutes) > s.max_daily_hours then 'over_limit' end,
      case when e.day_type = 'working_day'
            and app_private.overtime_hours(app_private.net_hours(e.gross_day_hours, s.break_minutes),
                                           s.overtime_threshold_hours, s.overtime_min_minutes) > 0 then 'overtime' end,
      case when e.conflict_note is not null then 'sync_conflict' end
    ], null) as flags
  from e cross join s
)
select f.id, f.staff_id, st.full_name, f.work_date, f.work_mode, f.location, f.purpose,
       f.day_type, f.holiday_name,
       f.clock_in_at, f.clock_in_server_at, f.clock_in_device_at, f.clock_in_offline,
       f.clock_out_at, f.clock_out_server_at, f.clock_out_device_at, f.clock_out_offline,
       f.clock_out_note, f.clock_out_location, f.conflict_note,
       f.adjusted_by, f.adjusted_at, f.adjust_note,
       f.approver_id, f.review_status, f.reviewed_flags, f.reviewed_by, f.reviewed_at, f.review_comment,
       f.created_at, f.hours, f.day_hours, f.day_overtime_hours, f.flags,
       case when cardinality(f.flags) = 0 then 'ok'
            when f.flags <@ f.reviewed_flags then f.review_status
            else 'pending' end as review_state,
       null::uuid as trip_id
  from f join public.staff st on st.id = f.staff_id;

-- ===================== 20260926000300_leave.sql =====================
-- =====================================================================
-- Stage 3: leave
-- =====================================================================
-- Designed so that leave ENTITLEMENTS and BALANCES can be added later
-- (e.g. a leave_entitlements table per staff / leave type / year) without
-- changing or losing any existing leave records: every leave record
-- already stores its leave type, dates, portion and the number of working
-- days taken, calculated against that person's schedule at the time.

create table public.leave_types (
  code          text primary key,
  name          text not null unique,
  document_hint text,
  active        boolean not null default true,
  sort_order    integer not null default 0
);
insert into public.leave_types (code, name, document_hint, sort_order) values
  ('annual',          'Annual Leave',          null, 1),
  ('hospitalization', 'Hospitalization Leave', 'Please attach your medical certificate or hospital letter.', 2),
  ('compassionate',   'Compassionate Leave',   null, 3),
  ('maternity',       'Maternity Leave',       'Attach supporting documents if available.', 4),
  ('paternity',       'Paternity Leave',       'Attach supporting documents if available.', 5),
  ('unpaid',          'Unpaid Leave',          null, 6);

create type public.request_status as enum ('draft', 'pending', 'changes_requested', 'approved', 'rejected', 'cancelled');
create type public.day_portion as enum ('full', 'half_am', 'half_pm');

create table public.leave_requests (
  id               uuid primary key,  -- may be generated on the phone (offline drafts)
  staff_id         uuid not null references public.staff (id),
  leave_type       text not null references public.leave_types (code),
  start_date       date not null,
  end_date         date not null,
  day_portion      public.day_portion not null default 'full',
  reason           text,
  document_path    text,
  working_days     numeric(5,1) not null default 0,
  status           public.request_status not null default 'draft',
  approver_id      uuid references public.staff (id),  -- NULL = HR/Admin
  submitted_at     timestamptz,
  decided_by       uuid references public.staff (id),
  decided_at       timestamptz,                        -- approval / rejection date
  decision_comment text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_date >= start_date),
  check (day_portion = 'full' or start_date = end_date)
);
create index on public.leave_requests (staff_id, start_date);
comment on column public.leave_requests.working_days is
  'Working days taken, using the staff member''s own schedule and excluding off days and public holidays. 0.5 for a half day.';

alter table public.leave_requests enable row level security;
create policy leave_select on public.leave_requests for select to authenticated
  using (app_private.can_view_staff(staff_id));
revoke insert, update, delete on public.leave_requests from authenticated;

create function app_private.leave_days(p_staff uuid, p_from date, p_to date, p_portion public.day_portion)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when p_portion = 'full' then app_private.count_working_days(p_staff, p_from, p_to)::numeric
              when app_private.count_working_days(p_staff, p_from, p_to) > 0 then 0.5
              else 0 end
$$;
grant execute on function app_private.leave_days(uuid, date, date, public.day_portion) to authenticated;

-- Now that requests exist, approvers may see the requester's details.
create or replace function app_private.is_approver_for_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_requests r
                  where r.staff_id = p_staff and r.approver_id = public.current_staff_id())
$$;

create function app_private.check_file_path(p_path text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_path is not null and split_part(p_path, '/', 1) <> public.current_staff_id()::text then
    raise exception 'Invalid attachment.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Save a draft (works for new or existing drafts; used by offline sync)
-- ---------------------------------------------------------------------
create function public.save_leave(p jsonb) returns public.leave_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.current_staff_id();
  v_id  uuid := (p->>'id')::uuid;
  v_row public.leave_requests;
  v_from date := (p->>'start_date')::date;
  v_to   date := (p->>'end_date')::date;
  v_portion public.day_portion := coalesce(nullif(p->>'day_portion', ''), 'full')::public.day_portion;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if v_id is null then raise exception 'Missing id.'; end if;
  if not exists (select 1 from public.leave_types where code = p->>'leave_type' and active) then
    raise exception 'Please choose a leave type.';
  end if;
  if v_from is null or v_to is null then raise exception 'Please choose the start and end dates.'; end if;
  if v_to < v_from then raise exception 'The end date cannot be before the start date.'; end if;
  if v_portion <> 'full' and v_from <> v_to then raise exception 'Half-day leave must start and end on the same day.'; end if;
  perform app_private.check_file_path(nullif(p->>'document_path', ''));

  select * into v_row from public.leave_requests where id = v_id for update;
  if found then
    if v_row.staff_id is distinct from v_me then raise exception 'Not your leave request.'; end if;
    if v_row.status <> 'draft' then raise exception 'This leave request has already been submitted and can no longer be edited.'; end if;
    update public.leave_requests set
      leave_type = p->>'leave_type', start_date = v_from, end_date = v_to, day_portion = v_portion,
      reason = nullif(trim(p->>'reason'), ''),
      document_path = nullif(p->>'document_path', ''),
      working_days = app_private.leave_days(v_me, v_from, v_to, v_portion),
      updated_at = now()
    where id = v_id returning * into v_row;
  else
    insert into public.leave_requests (id, staff_id, leave_type, start_date, end_date, day_portion, reason, document_path, working_days)
    values (v_id, v_me, p->>'leave_type', v_from, v_to, v_portion, nullif(trim(p->>'reason'), ''),
            nullif(p->>'document_path', ''), app_private.leave_days(v_me, v_from, v_to, v_portion))
    returning * into v_row;
  end if;
  return v_row;
end $$;

create function public.submit_leave(p_id uuid) returns public.leave_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.current_staff_id();
  v_row public.leave_requests;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  select * into v_row from public.leave_requests where id = p_id for update;
  if not found or v_row.staff_id is distinct from v_me then raise exception 'Leave request not found.'; end if;
  if v_row.status <> 'draft' then raise exception 'This leave request was already submitted.'; end if;

  v_row.working_days := app_private.leave_days(v_me, v_row.start_date, v_row.end_date, v_row.day_portion);
  if v_row.working_days = 0 then
    raise exception 'The dates you chose are all off days or public holidays on your schedule, so no leave is needed.';
  end if;
  if exists (select 1 from public.leave_requests o
              where o.staff_id = v_me and o.id <> p_id and o.status in ('pending', 'approved')
                and o.start_date <= v_row.end_date and o.end_date >= v_row.start_date
                and not (o.day_portion <> 'full' and v_row.day_portion <> 'full' and o.day_portion <> v_row.day_portion)) then
    raise exception 'You already have leave pending or approved on some of these dates.';
  end if;

  update public.leave_requests set
    status = 'pending', working_days = v_row.working_days, submitted_at = now(), updated_at = now(),
    approver_id = app_private.approver_for(v_me, 'leave')
  where id = p_id returning * into v_row;
  perform app_private.log_action('leave', p_id, v_me, 'submitted', null);
  return v_row;
end $$;

-- Staff can delete a draft or withdraw a pending request.
create function public.cancel_leave(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.current_staff_id();
  v_row public.leave_requests;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  select * into v_row from public.leave_requests where id = p_id for update;
  if not found then raise exception 'Leave request not found.'; end if;
  if v_row.staff_id = v_me and v_row.status = 'draft' then
    delete from public.leave_requests where id = p_id;
    return;
  end if;
  if v_row.staff_id = v_me and v_row.status = 'pending' then
    update public.leave_requests set status = 'cancelled', updated_at = now() where id = p_id;
  elsif public.is_admin() and v_row.status in ('pending', 'approved') then
    -- HR can cancel approved leave (e.g. staff came back to work).
    update public.leave_requests set status = 'cancelled', updated_at = now() where id = p_id;
  else
    raise exception 'This leave request cannot be cancelled. Please contact HR.';
  end if;
  perform app_private.log_action('leave', p_id, v_row.staff_id, 'cancelled', p_reason);
end $$;

create view public.leave_view with (security_invoker = true) as
select r.*, t.name as leave_type_name, s.full_name, a.full_name as approver_name, d.full_name as decided_by_name
  from public.leave_requests r
  join public.leave_types t on t.code = r.leave_type
  join public.staff s on s.id = r.staff_id
  left join public.staff a on a.id = r.approver_id
  left join public.staff d on d.id = r.decided_by;

alter table public.leave_types enable row level security;
create policy leave_types_select on public.leave_types for select to authenticated using (true);
create policy leave_types_admin on public.leave_types for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- File storage for medical certificates and receipts.
-- Files live under <staff id>/..., visible to the owner and to anyone who
-- may view that staff member (supervisor, approver, HR/Admin).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create function app_private.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
grant execute on function app_private.try_uuid(text) to authenticated;

create policy yam_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = public.current_staff_id()::text);
create policy yam_files_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and app_private.can_view_staff(app_private.try_uuid((storage.foldername(name))[1])));
create policy yam_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = public.current_staff_id()::text);

-- Staff may see the NAME of their own supervisor and of anyone who approves
-- their items (not that person's attendance or requests).
create function app_private.is_my_approver(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.id = public.current_staff_id() and s.supervisor_id = p_staff)
      or exists (select 1 from public.leave_requests r
                  where r.staff_id = public.current_staff_id() and (r.approver_id = p_staff or r.decided_by = p_staff))
$$;
grant execute on function app_private.is_my_approver(uuid) to authenticated;

drop policy staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated
  using (app_private.can_view_staff(id) or app_private.is_my_approver(id));

-- ===================== 20260926000400_trips.sql =====================
-- =====================================================================
-- Stage 4: outstation trips
-- =====================================================================
create table public.trips (
  id                   uuid primary key default gen_random_uuid(),
  staff_id             uuid not null references public.staff (id),
  destination          text not null check (length(trim(destination)) > 0),
  start_date           date not null,
  end_date             date not null,
  purpose              text not null check (length(trim(purpose)) > 0),
  estimated_cost       numeric(10,2) check (estimated_cost >= 0),
  estimated_cost_notes text,
  status               public.request_status not null default 'draft',
  approver_id          uuid references public.staff (id),  -- NULL = HR/Admin
  submitted_at         timestamptz,
  decided_by           uuid references public.staff (id),
  decided_at           timestamptz,
  decision_comment     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (end_date >= start_date)
);
create index on public.trips (staff_id, start_date);

alter table public.trips enable row level security;
create policy trips_select on public.trips for select to authenticated
  using (app_private.can_view_staff(staff_id));
revoke insert, update, delete on public.trips from authenticated;

alter table public.attendance_entries add column trip_id uuid references public.trips (id);

create or replace function app_private.is_approver_for_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_requests r
                  where r.staff_id = p_staff and r.approver_id = public.current_staff_id())
      or exists (select 1 from public.trips t
                  where t.staff_id = p_staff and t.approver_id = public.current_staff_id())
$$;

create or replace function app_private.is_my_approver(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.id = public.current_staff_id() and s.supervisor_id = p_staff)
      or exists (select 1 from public.leave_requests r
                  where r.staff_id = public.current_staff_id() and (r.approver_id = p_staff or r.decided_by = p_staff))
      or exists (select 1 from public.trips t
                  where t.staff_id = public.current_staff_id() and (t.approver_id = p_staff or t.decided_by = p_staff))
$$;

-- The approved trip covering a date, if any.
create function app_private.trip_for(p_staff uuid, p_date date) returns uuid
language sql stable security definer set search_path = '' as $$
  select t.id from public.trips t
   where t.staff_id = p_staff and t.status = 'approved' and p_date between t.start_date and t.end_date
   order by t.start_date desc limit 1
$$;
grant execute on function app_private.trip_for(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- Staff actions
-- ---------------------------------------------------------------------
create function public.save_trip(p jsonb) returns public.trips
language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.current_staff_id();
  v_id  uuid := coalesce((p->>'id')::uuid, gen_random_uuid());
  v_row public.trips;
  v_from date := (p->>'start_date')::date;
  v_to   date := (p->>'end_date')::date;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if coalesce(trim(p->>'destination'), '') = '' then raise exception 'Please enter the destination.'; end if;
  if coalesce(trim(p->>'purpose'), '') = '' then raise exception 'Please enter the purpose of the trip.'; end if;
  if v_from is null or v_to is null then raise exception 'Please choose the start and end dates.'; end if;
  if v_to < v_from then raise exception 'The end date cannot be before the start date.'; end if;
  if (p->>'estimated_cost')::numeric < 0 then raise exception 'Estimated cost cannot be negative.'; end if;

  select * into v_row from public.trips where id = v_id for update;
  if found then
    if v_row.staff_id is distinct from v_me then raise exception 'Not your trip.'; end if;
    if v_row.status not in ('draft', 'changes_requested') then
      raise exception 'This trip request can no longer be edited.';
    end if;
    update public.trips set destination = trim(p->>'destination'), start_date = v_from, end_date = v_to,
      purpose = trim(p->>'purpose'), estimated_cost = nullif(p->>'estimated_cost', '')::numeric,
      estimated_cost_notes = nullif(trim(p->>'estimated_cost_notes'), ''), updated_at = now()
    where id = v_id returning * into v_row;
  else
    insert into public.trips (id, staff_id, destination, start_date, end_date, purpose, estimated_cost, estimated_cost_notes)
    values (v_id, v_me, trim(p->>'destination'), v_from, v_to, trim(p->>'purpose'),
            nullif(p->>'estimated_cost', '')::numeric, nullif(trim(p->>'estimated_cost_notes'), ''))
    returning * into v_row;
  end if;
  return v_row;
end $$;

create function public.submit_trip(p_id uuid) returns public.trips
language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.current_staff_id();
  v_row public.trips;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  select * into v_row from public.trips where id = p_id for update;
  if not found or v_row.staff_id is distinct from v_me then raise exception 'Trip not found.'; end if;
  if v_row.status not in ('draft', 'changes_requested') then raise exception 'This trip was already submitted.'; end if;
  update public.trips set status = 'pending', submitted_at = now(), updated_at = now(),
    -- A resubmission after "changes requested" goes back to the same approver.
    approver_id = case when v_row.status = 'changes_requested' then v_row.approver_id
                       else app_private.approver_for(v_me, 'trip') end
  where id = p_id returning * into v_row;
  perform app_private.log_action('trip', p_id, v_me,
    case when v_row.decided_at is not null then 'resubmitted' else 'submitted' end, null);
  return v_row;
end $$;

create function public.cancel_trip(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := public.current_staff_id();
  v_row public.trips;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  select * into v_row from public.trips where id = p_id for update;
  if not found then raise exception 'Trip not found.'; end if;
  if v_row.staff_id = v_me and v_row.status = 'draft' then
    delete from public.trips where id = p_id;
    return;
  end if;
  if (v_row.staff_id = v_me and v_row.status in ('pending', 'changes_requested'))
     or (public.is_admin() and v_row.status in ('pending', 'changes_requested', 'approved')) then
    update public.trips set status = 'cancelled', updated_at = now() where id = p_id;
    perform app_private.log_action('trip', p_id, v_row.staff_id, 'cancelled', p_reason);
  else
    raise exception 'This trip cannot be cancelled. Please contact HR.';
  end if;
end $$;

create view public.trip_view with (security_invoker = true) as
select t.*, s.full_name, a.full_name as approver_name, d.full_name as decided_by_name
  from public.trips t
  join public.staff s on s.id = t.staff_id
  left join public.staff a on a.id = t.approver_id
  left join public.staff d on d.id = t.decided_by;

-- ---------------------------------------------------------------------
-- Clock-in now links Outstation entries to an approved trip
-- ---------------------------------------------------------------------
create or replace function public.clock_in(
  p_id uuid,
  p_work_mode public.work_mode,
  p_location text,
  p_purpose text,
  p_trip_id uuid default null,
  p_device_at timestamptz default null,
  p_offline boolean default false
) returns public.attendance_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_staff_id();
  v_row   public.attendance_entries;
  v_at    timestamptz;
  v_note  text;
  v_date  date;
  v_trip  uuid;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;

  select * into v_row from public.attendance_entries where id = p_id;
  if found then
    if v_row.staff_id is distinct from v_me then raise exception 'Entry belongs to someone else.'; end if;
    return v_row;
  end if;

  if coalesce(trim(p_location), '') = '' then raise exception 'Please enter your location.'; end if;
  if coalesce(trim(p_purpose), '') = '' then raise exception 'Please enter the purpose or task.'; end if;

  select * into v_at, v_note from app_private.event_time(p_device_at, p_offline);

  if exists (select 1 from public.attendance_entries
              where staff_id = v_me and clock_out_at is null) then
    if not p_offline then
      raise exception 'You are already clocked in. Please clock out first.';
    end if;
    v_note := concat_ws(' ', v_note, 'Synced while another entry was still open.');
  end if;

  v_date := (v_at at time zone 'Asia/Kuala_Lumpur')::date;

  if p_work_mode = 'outstation' then
    select t.id into v_trip from public.trips t
     where t.id = p_trip_id and t.staff_id = v_me and t.status = 'approved'
       and v_date between t.start_date and t.end_date;
    v_trip := coalesce(v_trip, app_private.trip_for(v_me, v_date));
  end if;

  insert into public.attendance_entries (
    id, staff_id, work_date, work_mode, location, purpose, day_type, holiday_name,
    clock_in_at, clock_in_device_at, clock_in_offline, conflict_note, approver_id, trip_id)
  values (
    p_id, v_me, v_date, p_work_mode, trim(p_location), trim(p_purpose),
    app_private.day_type_for(v_me, v_date),
    (select h.name from public.public_holidays h where h.holiday_date = v_date),
    v_at, p_device_at, coalesce(p_offline, false), v_note,
    app_private.approver_for(v_me, 'clock'), v_trip)
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------
-- Attendance view: add the trip link and the "no approved trip" alert.
-- An outstation entry is linked to its explicit trip, or else to any
-- approved trip that covers the date (so approving a trip afterwards
-- clears the alert).
-- ---------------------------------------------------------------------
create or replace view public.attendance_view with (security_invoker = true) as
with s as (select * from public.app_settings where id = 1),
e as (
  select a.*,
    round((extract(epoch from (a.clock_out_at - a.clock_in_at)) / 3600.0)::numeric, 2) as hours,
    round((sum(extract(epoch from (coalesce(a.clock_out_at, a.clock_in_at) - a.clock_in_at)))
           over (partition by a.staff_id, a.work_date) / 3600.0)::numeric, 2) as gross_day_hours,
    ((a.work_date + s.missed_clockout_time) at time zone 'Asia/Kuala_Lumpur') as cutoff_at,
    coalesce(
      (select t.id from public.trips t where t.id = a.trip_id and t.status = 'approved'),
      app_private.trip_for(a.staff_id, a.work_date)) as effective_trip_id
  from public.attendance_entries a cross join s
),
f as (
  select e.*,
    app_private.net_hours(e.gross_day_hours, s.break_minutes) as day_hours,
    case when e.day_type = 'working_day'
         then app_private.overtime_hours(app_private.net_hours(e.gross_day_hours, s.break_minutes),
                                         s.overtime_threshold_hours, s.overtime_min_minutes)
         else 0 end as day_overtime_hours,
    array_remove(array[
      case when e.day_type = 'off_day' then 'off_day' end,
      case when e.day_type = 'public_holiday' then 'public_holiday' end,
      case when e.work_mode = 'outstation' and e.effective_trip_id is null then 'outstation_no_trip' end,
      case when e.clock_in_offline or e.clock_out_offline then 'offline' end,
      case when (e.clock_out_at is null and now() > e.cutoff_at)
             or (e.clock_out_at > e.cutoff_at and e.adjusted_by is null) then 'missed_clockout' end,
      case when app_private.net_hours(e.gross_day_hours, s.break_minutes) > s.max_daily_hours then 'over_limit' end,
      case when e.day_type = 'working_day'
            and app_private.overtime_hours(app_private.net_hours(e.gross_day_hours, s.break_minutes),
                                           s.overtime_threshold_hours, s.overtime_min_minutes) > 0 then 'overtime' end,
      case when e.conflict_note is not null then 'sync_conflict' end
    ], null) as flags
  from e cross join s
)
select f.id, f.staff_id, st.full_name, f.work_date, f.work_mode, f.location, f.purpose,
       f.day_type, f.holiday_name,
       f.clock_in_at, f.clock_in_server_at, f.clock_in_device_at, f.clock_in_offline,
       f.clock_out_at, f.clock_out_server_at, f.clock_out_device_at, f.clock_out_offline,
       f.clock_out_note, f.clock_out_location, f.conflict_note,
       f.adjusted_by, f.adjusted_at, f.adjust_note,
       f.approver_id, f.review_status, f.reviewed_flags, f.reviewed_by, f.reviewed_at, f.review_comment,
       f.created_at, f.hours, f.day_hours, f.day_overtime_hours, f.flags,
       case when cardinality(f.flags) = 0 then 'ok'
            when f.flags <@ f.reviewed_flags then f.review_status
            else 'pending' end as review_state,
       f.effective_trip_id as trip_id
  from f join public.staff st on st.id = f.staff_id;

-- ===================== 20260926000500_claims.sql =====================
-- =====================================================================
-- Stage 5: claims (linked to approved outstation trips)
-- =====================================================================
create type public.claim_status as enum ('draft', 'submitted', 'approved', 'rejected', 'paid');
create type public.claim_category as enum ('mileage', 'meals', 'toll', 'parking', 'accommodation', 'other');

create table public.claims (
  id               uuid primary key,  -- may be generated on the phone (offline drafts)
  staff_id         uuid not null references public.staff (id),
  trip_id          uuid not null references public.trips (id),
  notes            text,
  status           public.claim_status not null default 'draft',
  approver_id      uuid references public.staff (id),  -- NULL = HR/Admin
  submitted_at     timestamptz,
  decided_by       uuid references public.staff (id),
  decided_at       timestamptz,
  decision_comment text,
  paid_by          uuid references public.staff (id),
  paid_at          timestamptz,
  payment_ref      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.claims (staff_id);
create index on public.claims (trip_id);

create table public.claim_items (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims (id) on delete cascade,
  item_date    date not null,
  category     public.claim_category not null,
  description  text not null check (length(trim(description)) > 0),
  distance_km  numeric(8,1) check (distance_km > 0),
  rate_per_km  numeric(6,2),
  amount       numeric(10,2) not null check (amount >= 0),
  receipt_path text,
  sort_order   integer not null default 0,
  check (category <> 'mileage' or (distance_km is not null and rate_per_km is not null))
);
create index on public.claim_items (claim_id);

alter table public.claims enable row level security;
alter table public.claim_items enable row level security;
create policy claims_select on public.claims for select to authenticated
  using (app_private.can_view_staff(staff_id));
create policy claim_items_select on public.claim_items for select to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id and app_private.can_view_staff(c.staff_id)));
revoke insert, update, delete on public.claims, public.claim_items from authenticated;

create or replace function app_private.is_approver_for_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_requests r
                  where r.staff_id = p_staff and r.approver_id = public.current_staff_id())
      or exists (select 1 from public.trips t
                  where t.staff_id = p_staff and t.approver_id = public.current_staff_id())
      or exists (select 1 from public.claims c
                  where c.staff_id = p_staff and c.approver_id = public.current_staff_id())
$$;

create or replace function app_private.is_my_approver(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.id = public.current_staff_id() and s.supervisor_id = p_staff)
      or exists (select 1 from public.leave_requests r
                  where r.staff_id = public.current_staff_id() and (r.approver_id = p_staff or r.decided_by = p_staff))
      or exists (select 1 from public.trips t
                  where t.staff_id = public.current_staff_id() and (t.approver_id = p_staff or t.decided_by = p_staff))
      or exists (select 1 from public.claims c
                  where c.staff_id = public.current_staff_id()
                    and (c.approver_id = p_staff or c.decided_by = p_staff or c.paid_by = p_staff))
$$;

-- ---------------------------------------------------------------------
-- Save a draft claim with all its items (replaces the items).
-- p = { id, trip_id, notes, items: [{ id, item_date, category, description,
--       distance_km, amount, receipt_path }] }
-- ---------------------------------------------------------------------
create function public.save_claim(p jsonb) returns public.claims
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_staff_id();
  v_id    uuid := (p->>'id')::uuid;
  v_trip  uuid := (p->>'trip_id')::uuid;
  v_rate  numeric := (select mileage_rate_per_km from public.app_settings where id = 1);
  v_row   public.claims;
  v_item  jsonb;
  v_n     integer := 0;
  v_cat   public.claim_category;
  v_km    numeric;
  v_amt   numeric;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if v_id is null then raise exception 'Missing id.'; end if;
  if not exists (select 1 from public.trips t where t.id = v_trip and t.staff_id = v_me and t.status = 'approved') then
    raise exception 'Claims must be linked to one of your approved outstation trips.';
  end if;

  select * into v_row from public.claims where id = v_id for update;
  if found then
    if v_row.staff_id is distinct from v_me then raise exception 'Not your claim.'; end if;
    if v_row.status <> 'draft' then raise exception 'This claim has already been submitted and can no longer be edited.'; end if;
    update public.claims set trip_id = v_trip, notes = nullif(trim(p->>'notes'), ''), updated_at = now()
     where id = v_id returning * into v_row;
    delete from public.claim_items where claim_id = v_id;
  else
    insert into public.claims (id, staff_id, trip_id, notes)
    values (v_id, v_me, v_trip, nullif(trim(p->>'notes'), '')) returning * into v_row;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_cat := (v_item->>'category')::public.claim_category;
    if (v_item->>'item_date') is null then raise exception 'Item %: please enter the date.', v_n; end if;
    if coalesce(trim(v_item->>'description'), '') = '' then raise exception 'Item %: please enter a description.', v_n; end if;
    perform app_private.check_file_path(nullif(v_item->>'receipt_path', ''));
    if v_cat = 'mileage' then
      v_km := nullif(v_item->>'distance_km', '')::numeric;
      if v_km is null or v_km <= 0 then raise exception 'Item %: please enter the kilometres travelled.', v_n; end if;
      v_amt := round(v_km * v_rate, 2);
    else
      v_km := null;
      v_amt := nullif(v_item->>'amount', '')::numeric;
      if v_amt is null or v_amt <= 0 then raise exception 'Item %: please enter the amount in RM.', v_n; end if;
    end if;
    insert into public.claim_items (id, claim_id, item_date, category, description, distance_km, rate_per_km, amount, receipt_path, sort_order)
    values (coalesce((v_item->>'id')::uuid, gen_random_uuid()), v_id, (v_item->>'item_date')::date, v_cat,
            trim(v_item->>'description'), v_km, case when v_cat = 'mileage' then v_rate end, v_amt,
            nullif(v_item->>'receipt_path', ''), v_n);
  end loop;
  return v_row;
end $$;

create function public.submit_claim(p_id uuid) returns public.claims
language plpgsql security definer set search_path = '' as $$
declare
  v_me   uuid := public.current_staff_id();
  v_row  public.claims;
  v_rate numeric := (select mileage_rate_per_km from public.app_settings where id = 1);
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  select * into v_row from public.claims where id = p_id for update;
  if not found or v_row.staff_id is distinct from v_me then raise exception 'Claim not found.'; end if;
  if v_row.status <> 'draft' then raise exception 'This claim was already submitted.'; end if;
  if not exists (select 1 from public.claim_items where claim_id = p_id) then
    raise exception 'Please add at least one item before submitting.';
  end if;
  if not exists (select 1 from public.trips t where t.id = v_row.trip_id and t.status = 'approved') then
    raise exception 'The trip for this claim is no longer approved.';
  end if;
  -- Mileage uses the rate in force when the claim is submitted.
  update public.claim_items set rate_per_km = v_rate, amount = round(distance_km * v_rate, 2)
   where claim_id = p_id and category = 'mileage';
  update public.claims set status = 'submitted', submitted_at = now(), updated_at = now(),
    approver_id = app_private.approver_for(v_me, 'claim')
  where id = p_id returning * into v_row;
  perform app_private.log_action('claim', p_id, v_me, 'submitted', null);
  return v_row;
end $$;

create function public.delete_claim_draft(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.claims where id = p_id and staff_id = public.current_staff_id() and status = 'draft';
  if not found then raise exception 'Only your own draft claims can be deleted.'; end if;
end $$;

create view public.claims_view with (security_invoker = true) as
select c.*, s.full_name, t.destination, t.start_date as trip_start, t.end_date as trip_end,
       a.full_name as approver_name, d.full_name as decided_by_name,
       coalesce(i.total, 0)::numeric(12,2) as total_amount,
       coalesce(i.n, 0)::int as item_count,
       coalesce(i.no_receipt, 0)::int as items_without_receipt
  from public.claims c
  join public.staff s on s.id = c.staff_id
  join public.trips t on t.id = c.trip_id
  left join public.staff a on a.id = c.approver_id
  left join public.staff d on d.id = c.decided_by
  left join lateral (
    select sum(amount) as total, count(*) as n,
           count(*) filter (where receipt_path is null and category <> 'mileage') as no_receipt
      from public.claim_items ci where ci.claim_id = c.id) i on true;

-- ===================== 20260926000700_approvals_reports.sql =====================
-- =====================================================================
-- Stage 7: approvals, exception alerts and reports
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pending approvals: everything the current user can act on.
-- HR/Admin can act on everything (including items routed to supervisors);
-- supervisors on items routed to them. Nobody approves their own items.
-- ---------------------------------------------------------------------
create view public.pending_approvals with (security_invoker = true) as
with me as (select public.current_staff_id() as id, public.is_admin() as admin)
select 'leave'::text as kind, r.id, r.staff_id, s.full_name, r.approver_id, a.full_name as approver_name,
       t.name as title,
       case when r.start_date = r.end_date then to_char(r.start_date, 'Dy DD Mon YYYY')
            else to_char(r.start_date, 'DD Mon') || ' – ' || to_char(r.end_date, 'DD Mon YYYY') end
         || ' · ' || r.working_days || ' working day(s)'
         || case when r.day_portion = 'half_am' then ' (morning)' when r.day_portion = 'half_pm' then ' (afternoon)' else '' end as detail,
       r.reason as note, r.submitted_at, null::text[] as flags, null::numeric as amount, r.start_date as item_date
  from public.leave_requests r
  join public.leave_types t on t.code = r.leave_type
  join public.staff s on s.id = r.staff_id
  left join public.staff a on a.id = r.approver_id, me
 where r.status = 'pending' and r.staff_id <> me.id and (me.admin or r.approver_id = me.id)
union all
select 'trip', tr.id, tr.staff_id, s.full_name, tr.approver_id, a.full_name,
       'Outstation: ' || tr.destination,
       to_char(tr.start_date, 'DD Mon') || ' – ' || to_char(tr.end_date, 'DD Mon YYYY')
         || coalesce(' · est. RM ' || to_char(tr.estimated_cost, 'FM999,990.00'), ''),
       tr.purpose, tr.submitted_at, null, tr.estimated_cost, tr.start_date
  from public.trips tr
  join public.staff s on s.id = tr.staff_id
  left join public.staff a on a.id = tr.approver_id, me
 where tr.status = 'pending' and tr.staff_id <> me.id and (me.admin or tr.approver_id = me.id)
union all
select 'claim', c.id, c.staff_id, c.full_name, c.approver_id, c.approver_name,
       'Claim: ' || c.destination,
       c.item_count || ' item(s)' || case when c.items_without_receipt > 0 then ' · ' || c.items_without_receipt || ' without receipt' else '' end,
       c.notes, c.submitted_at, null, c.total_amount, c.trip_start
  from public.claims_view c, me
 where c.status = 'submitted' and c.staff_id <> me.id and (me.admin or c.approver_id = me.id)
union all
select 'clock', v.id, v.staff_id, v.full_name, v.approver_id, a.full_name,
       'Attendance: ' || to_char(v.work_date, 'Dy DD Mon YYYY'),
       to_char(v.clock_in_at at time zone 'Asia/Kuala_Lumpur', 'HH12:MI am') || ' – '
         || coalesce(to_char(v.clock_out_at at time zone 'Asia/Kuala_Lumpur', 'HH12:MI am'), 'no clock-out')
         || ' · ' || v.location,
       v.purpose, v.clock_in_server_at, v.flags, v.day_hours, v.work_date
  from public.attendance_view v
  left join public.staff a on a.id = v.approver_id, me
 where v.review_state = 'pending' and v.staff_id <> me.id and (me.admin or v.approver_id = me.id);

-- ---------------------------------------------------------------------
-- Approve / reject / ask for changes / mark paid
-- ---------------------------------------------------------------------
create function public.decide(p_kind text, p_id uuid, p_action text, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := public.current_staff_id();
  v_admin    boolean := public.is_admin();
  v_owner    uuid;
  v_approver uuid;
  v_status   text;
  v_flags    text[];
  v_comment  text := nullif(trim(p_comment), '');
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  if p_action not in ('approve', 'reject', 'request_changes', 'paid') then raise exception 'Unknown action.'; end if;
  if p_action in ('reject', 'request_changes') and v_comment is null then
    raise exception 'Please add a comment explaining why.';
  end if;

  if p_kind = 'leave' then
    select staff_id, approver_id, status::text into v_owner, v_approver, v_status from public.leave_requests where id = p_id for update;
  elsif p_kind = 'trip' then
    select staff_id, approver_id, status::text into v_owner, v_approver, v_status from public.trips where id = p_id for update;
  elsif p_kind = 'claim' then
    select staff_id, approver_id, status::text into v_owner, v_approver, v_status from public.claims where id = p_id for update;
  elsif p_kind = 'clock' then
    select staff_id, approver_id, review_state, flags into v_owner, v_approver, v_status, v_flags
      from public.attendance_view where id = p_id;
    perform 1 from public.attendance_entries where id = p_id for update;
  else
    raise exception 'Unknown item type.';
  end if;
  if v_owner is null then raise exception 'Item not found.'; end if;
  if v_owner = v_me then raise exception 'You cannot approve your own requests.'; end if;

  -- Marking a claim as paid is an HR/Admin task.
  if p_action = 'paid' then
    if p_kind <> 'claim' then raise exception 'Only claims can be marked as paid.'; end if;
    if not v_admin then raise exception 'Only HR/Admin can mark claims as paid.'; end if;
    if v_status <> 'approved' then raise exception 'Only approved claims can be marked as paid.'; end if;
    update public.claims set status = 'paid', paid_by = v_me, paid_at = now(), payment_ref = v_comment, updated_at = now()
     where id = p_id;
    perform app_private.log_action('claim', p_id, v_owner, 'paid', v_comment);
    return;
  end if;

  -- NULL approver means "HR/Admin pool": only admins may act (coalesce so a
  -- NULL comparison can never let a request through).
  if not (v_admin or coalesce(v_approver = v_me, false)) then
    raise exception 'You are not the approver for this item.';
  end if;
  if p_action = 'request_changes' and p_kind <> 'trip' then
    raise exception 'Asking for changes is only available for trip requests.';
  end if;
  if (p_kind in ('leave', 'trip') and v_status <> 'pending')
     or (p_kind = 'claim' and v_status <> 'submitted')
     or (p_kind = 'clock' and v_status <> 'pending') then
    raise exception 'This item has already been decided.';
  end if;

  if p_kind = 'leave' then
    update public.leave_requests set status = case when p_action = 'approve' then 'approved' else 'rejected' end::public.request_status,
      decided_by = v_me, decided_at = now(), decision_comment = v_comment, updated_at = now() where id = p_id;
  elsif p_kind = 'trip' then
    update public.trips set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected'
                                                    else 'changes_requested' end::public.request_status,
      decided_by = v_me, decided_at = now(), decision_comment = v_comment, updated_at = now() where id = p_id;
  elsif p_kind = 'claim' then
    update public.claims set status = case when p_action = 'approve' then 'approved' else 'rejected' end::public.claim_status,
      decided_by = v_me, decided_at = now(), decision_comment = v_comment, updated_at = now() where id = p_id;
  else
    update public.attendance_entries set review_status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      reviewed_flags = v_flags, reviewed_by = v_me, reviewed_at = now(), review_comment = v_comment where id = p_id;
  end if;
  perform app_private.log_action(p_kind, p_id, v_owner, p_action, v_comment);
end $$;

-- ---------------------------------------------------------------------
-- HR/Admin: move a pending item to another approver (NULL = HR/Admin).
-- ---------------------------------------------------------------------
create function public.reassign(p_kind text, p_id uuid, p_new_approver uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_name  text;
begin
  if not public.is_admin() then raise exception 'Only HR/Admin can reassign approvals.'; end if;
  if p_new_approver is not null then
    select full_name into v_name from public.staff where id = p_new_approver and active and role in ('supervisor', 'admin');
    if v_name is null then raise exception 'The new approver must be an active supervisor or HR/Admin.'; end if;
  end if;
  if p_kind = 'leave' then
    update public.leave_requests set approver_id = p_new_approver where id = p_id and status = 'pending' returning staff_id into v_owner;
  elsif p_kind = 'trip' then
    update public.trips set approver_id = p_new_approver where id = p_id and status = 'pending' returning staff_id into v_owner;
  elsif p_kind = 'claim' then
    update public.claims set approver_id = p_new_approver where id = p_id and status = 'submitted' returning staff_id into v_owner;
  elsif p_kind = 'clock' then
    update public.attendance_entries set approver_id = p_new_approver where id = p_id returning staff_id into v_owner;
  end if;
  if v_owner is null then raise exception 'Only pending items can be reassigned.'; end if;
  if v_owner = p_new_approver then raise exception 'People cannot approve their own requests.'; end if;
  perform app_private.log_action(p_kind, p_id, v_owner, 'reassigned', 'To ' || coalesce(v_name, 'HR/Admin'));
end $$;

-- Approvers of clock exceptions may see that person too.
create or replace function app_private.is_approver_for_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.leave_requests r
                  where r.staff_id = p_staff and r.approver_id = public.current_staff_id())
      or exists (select 1 from public.trips t
                  where t.staff_id = p_staff and t.approver_id = public.current_staff_id())
      or exists (select 1 from public.claims c
                  where c.staff_id = p_staff and c.approver_id = public.current_staff_id())
      or exists (select 1 from public.attendance_entries a
                  where a.staff_id = p_staff and a.approver_id = public.current_staff_id())
$$;

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------
-- Which staff the current user may report on.
create function app_private.reportable_staff(p_staff uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s
   where (p_staff is null or s.id = p_staff)
     and (public.is_admin() or s.id = public.current_staff_id() or s.supervisor_id = public.current_staff_id())
$$;

-- One row per staff member per day in the month.
create function public.attendance_daily_report(p_month date, p_staff uuid default null)
returns table (
  staff_id uuid, full_name text, staff_no text, work_date date, day_type public.day_type, holiday_name text,
  leave_type text, leave_portion public.day_portion, leave_days numeric,
  entries integer, modes text[], first_in timestamptz, last_out timestamptz,
  hours numeric, overtime_hours numeric, overtime_status text, flags text[], review text, no_record boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  s      public.app_settings;
begin
  if public.current_staff_id() is null then raise exception 'Not signed in.'; end if;
  select * into s from public.app_settings where id = 1;
  return query
  with people as (
    select st.id, st.full_name, st.staff_no, st.created_at from public.staff st
     where st.id in (select app_private.reportable_staff(p_staff))
       and (st.active or exists (select 1 from public.attendance_entries a
                                  where a.staff_id = st.id and a.work_date between v_from and v_to))
  ),
  days as (
    select p.id as sid, p.full_name, p.staff_no, p.created_at, g.d::date as d,
           app_private.day_type_for(p.id, g.d::date) as dtype
      from people p cross join generate_series(v_from, v_to, interval '1 day') g(d)
  ),
  ent as (
    select v.staff_id, v.work_date,
           count(*)::int as n,
           array_agg(distinct v.work_mode::text) as modes,
           min(v.clock_in_at) as first_in, max(v.clock_out_at) as last_out,
           sum(coalesce(extract(epoch from (v.clock_out_at - v.clock_in_at)), 0)) / 3600.0 as gross,
           bool_or(v.review_state = 'pending') as any_pending
      from public.attendance_view v
     where v.work_date between v_from and v_to and v.review_state is distinct from 'rejected'
       and v.staff_id in (select id from people)
     group by v.staff_id, v.work_date
  ),
  fl as (
    select v.staff_id, v.work_date, array_agg(distinct f) as flags
      from public.attendance_view v cross join lateral unnest(v.flags) f
     where v.work_date between v_from and v_to and v.review_state is distinct from 'rejected'
       and v.staff_id in (select id from people)
     group by v.staff_id, v.work_date
  ),
  lv as (
    select r.staff_id, d.d, t.name, r.day_portion
      from public.leave_requests r
      join public.leave_types t on t.code = r.leave_type
      cross join lateral generate_series(greatest(r.start_date, v_from), least(r.end_date, v_to), interval '1 day') d(d)
     where r.status = 'approved' and r.start_date <= v_to and r.end_date >= v_from
       and r.staff_id in (select id from people)
  )
  select dy.sid, dy.full_name, dy.staff_no, dy.d, dy.dtype,
         (select h.name from public.public_holidays h where h.holiday_date = dy.d),
         case when dy.dtype = 'working_day' then lv.name end,
         case when dy.dtype = 'working_day' then lv.day_portion end,
         case when dy.dtype = 'working_day' and lv.name is not null
              then case when lv.day_portion = 'full' then 1.0 else 0.5 end else 0 end::numeric,
         coalesce(e.n, 0),
         coalesce(e.modes, '{}'),
         e.first_in, e.last_out,
         coalesce(app_private.net_hours(round(e.gross::numeric, 2), s.break_minutes), 0),
         case when dy.dtype = 'working_day' and e.n is not null
              then app_private.overtime_hours(app_private.net_hours(round(e.gross::numeric, 2), s.break_minutes),
                                              s.overtime_threshold_hours, s.overtime_min_minutes)
              else 0 end,
         case when dy.dtype = 'working_day' and e.n is not null
                   and app_private.overtime_hours(app_private.net_hours(round(e.gross::numeric, 2), s.break_minutes),
                                                  s.overtime_threshold_hours, s.overtime_min_minutes) > 0
              then case when e.any_pending then 'pending' else 'approved' end end,
         coalesce(fl.flags, '{}'),
         case when e.any_pending then 'pending' end,
         (dy.dtype = 'working_day' and e.n is null and lv.name is null
            and dy.d < app_private.today() and dy.d >= (dy.created_at at time zone 'Asia/Kuala_Lumpur')::date)
    from days dy
    left join ent e on e.staff_id = dy.sid and e.work_date = dy.d
    left join lv on lv.staff_id = dy.sid and lv.d = dy.d
    left join fl on fl.staff_id = dy.sid and fl.work_date = dy.d
   order by dy.full_name, dy.d;
end $$;

-- Monthly summary per staff member.
create function public.attendance_monthly_report(p_month date, p_staff uuid default null)
returns table (
  staff_id uuid, full_name text, staff_no text,
  days_worked integer, office_days integer, wfh_days integer, client_site_days integer, outstation_days integer, training_days integer,
  total_hours numeric, overtime_hours_approved numeric, overtime_hours_pending numeric,
  off_day_days integer, off_day_hours numeric, public_holiday_days integer, public_holiday_hours numeric,
  leave_days_total numeric, leave_by_type jsonb, missed_clockouts integer, no_record_days integer, pending_reviews integer
)
language sql stable security definer set search_path = '' as $$
  select d.staff_id, d.full_name, d.staff_no,
    count(*) filter (where d.entries > 0)::int,
    count(*) filter (where 'office' = any(d.modes))::int,
    count(*) filter (where 'wfh' = any(d.modes))::int,
    count(*) filter (where 'client_site' = any(d.modes))::int,
    count(*) filter (where 'outstation' = any(d.modes))::int,
    count(*) filter (where 'training' = any(d.modes))::int,
    coalesce(sum(d.hours), 0),
    coalesce(sum(d.overtime_hours) filter (where d.overtime_status = 'approved'), 0),
    coalesce(sum(d.overtime_hours) filter (where d.overtime_status = 'pending'), 0),
    count(*) filter (where d.entries > 0 and d.day_type = 'off_day')::int,
    coalesce(sum(d.hours) filter (where d.day_type = 'off_day'), 0),
    count(*) filter (where d.entries > 0 and d.day_type = 'public_holiday')::int,
    coalesce(sum(d.hours) filter (where d.day_type = 'public_holiday'), 0),
    coalesce(sum(d.leave_days), 0),
    coalesce((select jsonb_object_agg(x.leave_type, x.days) from (
        select d2.leave_type, sum(d2.leave_days) as days
          from public.attendance_daily_report(p_month, d.staff_id) d2
         where d2.leave_type is not null group by d2.leave_type) x), '{}'::jsonb),
    count(*) filter (where 'missed_clockout' = any(d.flags))::int,
    count(*) filter (where d.no_record)::int,
    count(*) filter (where d.review = 'pending')::int
  from public.attendance_daily_report(p_month, p_staff) d
  group by d.staff_id, d.full_name, d.staff_no
  order by d.full_name
$$;

-- Monthly claims report: claims submitted in the month (not drafts).
create function public.claims_monthly_report(p_month date)
returns table (
  claim_id uuid, staff_id uuid, full_name text, staff_no text, destination text, trip_start date, trip_end date,
  status public.claim_status, submitted_at timestamptz, decided_at timestamptz, paid_at timestamptz, payment_ref text,
  mileage_km numeric, mileage numeric, meals numeric, toll numeric, parking numeric, accommodation numeric, other numeric, total numeric
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.staff_id, s.full_name, s.staff_no, t.destination, t.start_date, t.end_date,
         c.status, c.submitted_at, c.decided_at, c.paid_at, c.payment_ref,
         coalesce(sum(i.distance_km) filter (where i.category = 'mileage'), 0),
         coalesce(sum(i.amount) filter (where i.category = 'mileage'), 0),
         coalesce(sum(i.amount) filter (where i.category = 'meals'), 0),
         coalesce(sum(i.amount) filter (where i.category = 'toll'), 0),
         coalesce(sum(i.amount) filter (where i.category = 'parking'), 0),
         coalesce(sum(i.amount) filter (where i.category = 'accommodation'), 0),
         coalesce(sum(i.amount) filter (where i.category = 'other'), 0),
         coalesce(sum(i.amount), 0)
    from public.claims c
    join public.staff s on s.id = c.staff_id
    join public.trips t on t.id = c.trip_id
    left join public.claim_items i on i.claim_id = c.id
   where c.status <> 'draft'
     and (c.submitted_at at time zone 'Asia/Kuala_Lumpur')::date
         between date_trunc('month', p_month)::date and (date_trunc('month', p_month) + interval '1 month - 1 day')::date
     and c.staff_id in (select app_private.reportable_staff(null))
     and public.current_staff_id() is not null
   group by c.id, s.full_name, s.staff_no, t.destination, t.start_date, t.end_date
   order by s.full_name, c.submitted_at
$$;

-- ===================== 20260926000800_hardening.sql =====================
-- =====================================================================
-- Security hardening: only signed-in users can call the app's functions.
-- (Supabase allows anonymous callers by default.)
-- =====================================================================
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema app_private from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Views are read through Row Level Security of their underlying tables;
-- anonymous users get nothing.
revoke all on all tables in schema public from anon;
