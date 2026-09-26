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
    if v_row.staff_id <> v_me then raise exception 'Entry belongs to someone else.'; end if;
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
  if not found or v_row.staff_id <> v_me then
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
