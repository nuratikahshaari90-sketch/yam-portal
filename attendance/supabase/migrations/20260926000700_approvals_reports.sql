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
