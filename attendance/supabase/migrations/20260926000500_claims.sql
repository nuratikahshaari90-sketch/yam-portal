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
    if v_row.staff_id <> v_me then raise exception 'Not your claim.'; end if;
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
  select * into v_row from public.claims where id = p_id for update;
  if not found or v_row.staff_id <> v_me then raise exception 'Claim not found.'; end if;
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
