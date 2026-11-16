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
