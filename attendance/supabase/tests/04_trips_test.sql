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

select plan(16);

select pg_temp.login('farid@yam.test');
select is((select status::text from save_trip('{"id":"cccccccc-0000-0000-0000-000000000001","destination":"Johor Bahru","start_date":"2026-10-20","end_date":"2026-10-22","purpose":"Partner audit","estimated_cost":"450"}')),
  'draft', 'Farid saves a trip request');
select throws_ok($$ select save_trip('{"destination":"","start_date":"2026-10-20","end_date":"2026-10-22","purpose":"x"}') $$,
  'P0001', 'Please enter the destination.', 'Destination is required');
select is((select approver_id from submit_trip('cccccccc-0000-0000-0000-000000000001')),
  '11111111-0000-0000-0000-000000000003'::uuid, 'Submitted trip goes to his supervisor Siti');
select throws_ok($$ select save_trip('{"id":"cccccccc-0000-0000-0000-000000000001","destination":"JB","start_date":"2026-10-20","end_date":"2026-10-22","purpose":"x"}') $$,
  'P0001', 'This trip request can no longer be edited.', 'A pending trip cannot be edited');

-- Outstation clock-ins are linked to the approved trip covering the date
select clock_in('cccccccc-0000-0000-0000-0000000000a1', 'outstation', 'Kuantan', 'Relief', null, '2026-09-16 10:00+08', true);
select is((select trip_id from attendance_entries where id = 'cccccccc-0000-0000-0000-0000000000a1'),
  '44444444-0000-0000-0000-000000000001'::uuid, 'Outstation clock-in during an approved trip is linked to it');
select clock_out('cccccccc-0000-0000-0000-0000000000a1', null, null, '2026-09-16 12:00+08', true);
select clock_in('cccccccc-0000-0000-0000-0000000000a2', 'outstation', 'Melaka', 'Visit', '44444444-0000-0000-0000-000000000002', '2026-09-24 20:00+08', true);
select is((select trip_id from attendance_entries where id = 'cccccccc-0000-0000-0000-0000000000a2'), null,
  'Someone else''s trip cannot be linked');
select ok((select 'outstation_no_trip' = any(flags) from attendance_view where id = 'cccccccc-0000-0000-0000-0000000000a2'),
  'Outstation with no approved trip raises an alert');
select is((select count(distinct staff_id)::int from trip_view), 1, 'Staff see only their own trips');
select pg_temp.logout();

-- Approving a trip afterwards clears the alert
insert into trips (staff_id, destination, start_date, end_date, purpose, status)
values ('11111111-0000-0000-0000-000000000004', 'Melaka', '2026-09-24', '2026-09-24', 'Visit', 'approved');
select ok((select not ('outstation_no_trip' = any(flags)) from attendance_view where id = 'cccccccc-0000-0000-0000-0000000000a2'),
  'Once a covering trip is approved, the alert clears');
select isnt((select trip_id from attendance_view where id = 'cccccccc-0000-0000-0000-0000000000a2'), null,
  '... and the entry shows under that trip');

-- Changes requested -> edit -> resubmit goes back to the same approver
select pg_temp.login('kavitha@yam.test');
select lives_ok($$ select save_trip('{"id":"44444444-0000-0000-0000-000000000004","destination":"Kota Bharu, Kelantan","start_date":"2026-10-24","end_date":"2026-10-25","purpose":"Orphanage support programme","estimated_cost":"520","estimated_cost_notes":"Bus RM120, hotel RM300, meals RM100"}') $$,
  'Kavitha can edit a trip when changes were requested');
select is((select status::text || '/' || approver_id from submit_trip('44444444-0000-0000-0000-000000000004')),
  'pending/11111111-0000-0000-0000-000000000003', 'Resubmitted trip returns to the same approver');
select pg_temp.logout();

select pg_temp.login('supervisor@yam.test');
select is((select count(distinct staff_id)::int from trip_view), 2, 'Supervisor sees her team''s trips');
select pg_temp.logout();
select pg_temp.login('hr@yam.test');
select is((select count(*)::int from trip_view), 7, 'HR sees all trips');
select pg_temp.logout();
select pg_temp.login('meiling@yam.test');
select is((select count(*)::int from trip_view), 2, 'Mei Ling sees only her own 2 trips');
select throws_ok($$ select cancel_trip('44444444-0000-0000-0000-000000000002') $$, 'P0001',
  'This trip cannot be cancelled. Please contact HR.', 'Staff cannot cancel an approved trip');
select pg_temp.logout();

select * from finish();
rollback;
