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

select plan(24);

select pg_temp.login('farid@yam.test');
select is((select working_days from save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000001","leave_type":"annual","start_date":"2026-10-12","end_date":"2026-10-16","reason":"Holiday"}')),
  5.0, 'Farid: Mon 12 - Fri 16 Oct = 5 working days');
select is((select status::text from submit_leave('bbbbbbbb-0000-0000-0000-000000000001')), 'pending', 'Farid submits his leave');
select is((select approver_id from leave_requests where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000003'::uuid, 'It goes to his supervisor Siti');
select throws_ok($$ select save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000001","leave_type":"annual","start_date":"2026-10-12","end_date":"2026-10-13"}') $$,
  'P0001', 'This leave request has already been submitted and can no longer be edited.', 'A submitted request cannot be edited');
select is((select working_days from save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000002","leave_type":"annual","start_date":"2026-09-14","end_date":"2026-09-18"}')),
  4.0, 'Mon 14 - Fri 18 Sep = 4 working days (Malaysia Day excluded)');
select is((select working_days from save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000003","leave_type":"annual","start_date":"2026-10-17","end_date":"2026-10-18"}')),
  0.0, 'A weekend has 0 working days for Farid');
select throws_ok($$ select submit_leave('bbbbbbbb-0000-0000-0000-000000000003') $$, 'P0001',
  'The dates you chose are all off days or public holidays on your schedule, so no leave is needed.', 'Cannot submit leave with no working days');
select throws_ok($$ select save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000004","leave_type":"annual","start_date":"2026-10-19","end_date":"2026-10-20","day_portion":"half_am"}') $$,
  'P0001', 'Half-day leave must start and end on the same day.', 'Half day must be a single day');
select is((select working_days from save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000005","leave_type":"annual","start_date":"2026-10-14","end_date":"2026-10-14","day_portion":"half_pm"}')),
  0.5, 'A half day counts as 0.5');
select throws_ok($$ select submit_leave('bbbbbbbb-0000-0000-0000-000000000005') $$, 'P0001',
  'You already have leave pending or approved on some of these dates.', 'Overlapping leave is refused');
select throws_ok($$ select save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000006","leave_type":"hospitalization","start_date":"2026-10-21","end_date":"2026-10-21","document_path":"11111111-0000-0000-0000-000000000006/leave/x.jpg"}') $$,
  'P0001', 'Invalid attachment.', 'Cannot attach someone else''s file');
select throws_ok($$ update leave_requests set status = 'approved' $$, '42501', null, 'Staff cannot approve their own leave by editing the table');
select lives_ok($$ select cancel_leave('bbbbbbbb-0000-0000-0000-000000000003') $$, 'Deleting a draft');
select is((select count(*)::int from leave_requests where id = 'bbbbbbbb-0000-0000-0000-000000000003'), 0, '... removes it');
select is((select count(distinct staff_id)::int from leave_view), 1, 'Staff see only their own leave');
select is((select approver_name from leave_view where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'Siti Aminah Yusof',
  'Staff can see the name of their approver');
select is((select count(*)::int from attendance_view where staff_id = '11111111-0000-0000-0000-000000000003'), 0,
  '... but not their supervisor''s attendance');
select pg_temp.logout();

select pg_temp.login('kavitha@yam.test');
select is((select working_days from save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000010","leave_type":"annual","start_date":"2026-10-12","end_date":"2026-10-16"}')),
  3.0, 'Kavitha (Wed-Sun roster): Mon 12 - Fri 16 Oct = 3 working days');
select is((select working_days from save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000011","leave_type":"annual","start_date":"2026-06-06","end_date":"2026-06-07"}')),
  0.0, 'Kavitha: a June weekend (before her roster change) = 0 working days');
select pg_temp.logout();

select pg_temp.login('supervisor@yam.test');
select is((select count(distinct staff_id)::int from leave_view), 3, 'Supervisor sees self + team leave');
select pg_temp.logout();

-- Supervisor change: existing pending stays, new requests go to the new approver
select pg_temp.login('hr@yam.test');
update staff set supervisor_id = null where id = '11111111-0000-0000-0000-000000000004';
select pg_temp.logout();
select pg_temp.login('farid@yam.test');
select save_leave('{"id":"bbbbbbbb-0000-0000-0000-000000000007","leave_type":"compassionate","start_date":"2026-10-26","end_date":"2026-10-26"}');
select is((select approver_id from submit_leave('bbbbbbbb-0000-0000-0000-000000000007')), null, 'After the supervisor is removed, NEW leave goes to HR');
select is((select approver_id from leave_requests where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  '11111111-0000-0000-0000-000000000003'::uuid, 'Existing pending leave stays with Siti');
select lives_ok($$ select cancel_leave('bbbbbbbb-0000-0000-0000-000000000007', 'Plans changed') $$, 'Staff can withdraw a pending request');
select is((select status::text from leave_requests where id = 'bbbbbbbb-0000-0000-0000-000000000007'), 'cancelled', '... it becomes Cancelled');
select pg_temp.logout();

select * from finish();
rollback;
