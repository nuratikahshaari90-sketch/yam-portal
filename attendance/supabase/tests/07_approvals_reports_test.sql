begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

create function pg_temp.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

select plan(33);

-- ---------- Who sees what in the approval queue ----------
select pg_temp.login('hr@yam.test');
select is((select count(*)::int from pending_approvals), 14, 'HR sees all 14 pending items');
select is((select count(*)::int from pending_approvals where kind = 'clock'), 8, '... including 8 attendance exceptions');
select pg_temp.logout();
select pg_temp.login('supervisor@yam.test');
select is((select array_agg(kind || ':' || full_name order by kind)::text from pending_approvals),
  '{"leave:Kavitha Rajan","trip:Kavitha Rajan"}', 'Siti sees only the leave and trip routed to her (claims/overtime go to HR)');
select pg_temp.logout();
select pg_temp.login('farid@yam.test');
select is((select count(*)::int from pending_approvals), 0, 'Staff have nothing to approve');
select pg_temp.logout();

-- ---------- Supervisor decisions ----------
select pg_temp.login('supervisor@yam.test');
select throws_ok($$ select decide('leave', '33333333-0000-0000-0000-000000000003', 'reject', '  ') $$, 'P0001',
  'Please add a comment explaining why.', 'Rejecting needs a comment');
select throws_ok($$ select decide('leave', '33333333-0000-0000-0000-000000000003', 'request_changes', 'x') $$, 'P0001',
  'Asking for changes is only available for trip requests.', 'Ask-for-changes is for trips only');
select lives_ok($$ select decide('leave', '33333333-0000-0000-0000-000000000003', 'approve', 'Enjoy Deepavali') $$, 'Siti approves Kavitha''s leave');
select is((select status::text from leave_requests where id = '33333333-0000-0000-0000-000000000003'), 'approved', 'Leave is approved');
select isnt((select decided_at from leave_requests where id = '33333333-0000-0000-0000-000000000003'), null, 'Approval date is stored');
select throws_ok($$ select decide('leave', '33333333-0000-0000-0000-000000000003', 'approve') $$, 'P0001',
  'This item has already been decided.', 'Cannot decide twice');
select lives_ok($$ select decide('trip', '44444444-0000-0000-0000-000000000005', 'request_changes', 'Please add mileage estimate') $$,
  'Siti asks for changes on a trip');
select is((select status::text from trips where id = '44444444-0000-0000-0000-000000000005'), 'changes_requested', 'Trip shows Changes requested');
select throws_ok($$ select decide('claim', '55555555-0000-0000-0000-000000000001', 'approve') $$, 'P0001',
  'You are not the approver for this item.', 'Supervisors cannot approve claims routed to HR');
select throws_ok($$ select decide('leave', '33333333-0000-0000-0000-000000000005', 'approve') $$, 'P0001',
  'You cannot approve your own requests.', 'Nobody approves their own leave');
select pg_temp.logout();

-- ---------- HR decisions ----------
select pg_temp.login('hr@yam.test');
select lives_ok($$ select decide('leave', '33333333-0000-0000-0000-000000000005', 'approve') $$, 'HR approves Siti''s leave');
select lives_ok($$ select decide('claim', '55555555-0000-0000-0000-000000000001', 'approve', 'OK') $$, 'HR approves Farid''s claim');
select lives_ok($$ select decide('claim', '55555555-0000-0000-0000-000000000001', 'paid', 'IBG-001') $$, 'HR marks it paid');
select is((select status::text || '/' || payment_ref from claims where id = '55555555-0000-0000-0000-000000000001'), 'paid/IBG-001',
  'Claim is Paid with a payment reference');
select lives_ok($$ select decide('clock', '22222222-0000-0000-0000-000000000002', 'approve', 'Annual report deadline') $$,
  'HR approves overtime on 23 Sep');
select lives_ok($$ select decide('clock', '22222222-0000-0000-0000-000000000001', 'reject', 'Not authorised weekend work') $$,
  'HR rejects the Saturday entry');
select is((select overtime_hours_approved || '/' || overtime_hours_pending || '/' || off_day_days
             from attendance_monthly_report('2026-09-01', '11111111-0000-0000-0000-000000000004')),
  '2.50/1.50/0', 'Report: 2.5h approved OT, 1.5h pending, rejected off-day work not counted');
select throws_ok($$ select reassign('trip', '44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004') $$,
  'P0001', 'The new approver must be an active supervisor or HR/Admin.', 'Cannot reassign to plain staff');
select lives_ok($$ select reassign('trip', '44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003') $$,
  'HR reassigns Mei Ling''s trip to Siti');
select pg_temp.logout();

select pg_temp.login('supervisor@yam.test');
select ok(exists (select 1 from pending_approvals where id = '44444444-0000-0000-0000-000000000003'), 'Siti now sees the reassigned trip');
select throws_ok($$ select decide('claim', '55555555-0000-0000-0000-000000000002', 'paid', 'x') $$, 'P0001',
  'Only HR/Admin can mark claims as paid.', 'Supervisors cannot mark claims paid');
select is((select count(*)::int from attendance_monthly_report('2026-09-01')), 3, 'Supervisor report covers self + team');
select pg_temp.logout();

select pg_temp.login('farid@yam.test');
select is((select array_agg(full_name)::text from attendance_monthly_report('2026-09-01')), '{"Muhammad Farid Hakim"}',
  'Staff report shows only themselves');
select is((select count(*)::int from attendance_monthly_report('2026-09-01', '11111111-0000-0000-0000-000000000006')), 0,
  'Staff cannot run a report on someone else');
select is((select count(*)::int from claims_monthly_report('2026-09-01')), 1, 'Staff claims report shows only their own claims');
select pg_temp.logout();
select pg_temp.login('hr@yam.test');
select is((select sum(total)::text from claims_monthly_report('2026-09-01')), '1291.10', 'HR claims report total for September');
select pg_temp.logout();

-- ---------- Deactivated staff can do nothing, even with a valid login ----------
update staff set active = false where email = 'farid@yam.test';
select pg_temp.login('farid@yam.test');
select throws_ok($$ select submit_leave('33333333-0000-0000-0000-000000000006') $$, 'P0001', 'Not signed in.',
  'A deactivated user cannot submit requests');
select is((select count(*)::int from attendance_view), 0, 'A deactivated user sees no attendance');
select is((select count(*)::int from staff), 0, 'A deactivated user sees no staff records');
select pg_temp.logout();

select * from finish();
rollback;
