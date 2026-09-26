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
    if v_row.staff_id <> v_me then raise exception 'Not your leave request.'; end if;
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
  select * into v_row from public.leave_requests where id = p_id for update;
  if not found or v_row.staff_id <> v_me then raise exception 'Leave request not found.'; end if;
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
