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
