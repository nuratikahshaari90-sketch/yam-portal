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

select plan(30);

-- ---------- Sample data checks ----------
select is((select flags from attendance_view where id = '22222222-0000-0000-0000-000000000001'), '{off_day}',
  'Farid''s Saturday entry is tagged Work on Off Day');
select is((select flags from attendance_view where id = '22222222-0000-0000-0000-000000000003'), '{public_holiday}',
  'Kavitha''s Malaysia Day entry is tagged Work on Public Holiday');
select is((select flags from attendance_view where id = '22222222-0000-0000-0000-000000000002'), '{over_limit,overtime}',
  'An 11.5-hour day is flagged as overtime and over the daily limit');
select is((select day_overtime_hours from attendance_view where id = '22222222-0000-0000-0000-000000000002'), 2.50,
  'Overtime = 11.5h - 1h break - 8h threshold = 2.5h');
select is((select flags from attendance_view where id = '22222222-0000-0000-0000-000000000005'), '{missed_clockout}',
  'No clock-out by the cut-off time is flagged as missed clock-out');
select is((select count(*)::int from attendance_view where work_date between '2026-09-01' and '2026-09-13'
            and cardinality(flags) > 0), 0,
  'Normal 9-hour days (8h + 1h lunch) are NOT flagged as overtime');

-- ---------- Clock in / out as Farid ----------
select pg_temp.login('farid@yam.test');

select throws_ok($$ insert into attendance_entries (id, staff_id, work_date, work_mode, location, purpose, day_type, clock_in_at)
                    values (gen_random_uuid(), '11111111-0000-0000-0000-000000000004', current_date, 'office', 'x', 'y', 'working_day', now()) $$,
  '42501', null, 'Staff cannot write entries directly (only through Clock In)');

select throws_ok($$ select clock_in('aaaaaaaa-0000-0000-0000-000000000001', 'office', '  ', 'Work', null, null, false) $$,
  'P0001', 'Please enter your location.', 'Location is required');

select lives_ok($$ select clock_in('aaaaaaaa-0000-0000-0000-000000000001', 'client_site', 'Client office, Putrajaya',
                                   'Audit meeting', null, now() - interval '3 hours', false) $$,
  'Farid clocks in');
select is((select clock_in_at from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000001'), now(),
  'Online clock-in uses the SERVER time, not the phone time');
select is((select day_type::text from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  app_private.day_type_for('11111111-0000-0000-0000-000000000004', app_private.today())::text,
  'Day type is tagged from Farid''s schedule and the holiday list');
select lives_ok($$ select clock_in('aaaaaaaa-0000-0000-0000-000000000001', 'client_site', 'Client office, Putrajaya', 'Audit meeting') $$,
  'Sending the same clock-in twice (retry) is accepted');
select is((select count(*)::int from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  '... and is stored only once');
select throws_ok($$ select clock_in(gen_random_uuid(), 'office', 'HQ', 'Work') $$,
  'P0001', 'You are already clocked in. Please clock out first.', 'Cannot clock in twice while online');

select lives_ok($$ select clock_out('aaaaaaaa-0000-0000-0000-000000000001', 'Audit done', null, null, false) $$, 'Farid clocks out');
select is((select clock_out_note from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'Audit done',
  'Clock-out note saved');
select lives_ok($$ select clock_out('aaaaaaaa-0000-0000-0000-000000000001', 'Audit done', null, null, false) $$,
  'Retrying the same clock-out is harmless');

-- Offline entries: phone time is used and flagged, server time stored too
select lives_ok($$ select clock_in('aaaaaaaa-0000-0000-0000-000000000002', 'office', 'HQ', 'Backlog',
                                   null, '2026-09-16 09:00+08', true) $$, 'An offline clock-in syncs');
select is((select clock_in_at from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '2026-09-16 09:00+08'::timestamptz, 'Offline entry keeps the phone time');
select is((select clock_in_server_at from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000002'), now(),
  'Offline entry also stores the server time it synced');
select is((select day_type::text || '/' || holiday_name from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'public_holiday/Malaysia Day', 'Offline entry on 16 Sep is tagged Work on Public Holiday');
select lives_ok($$ select clock_out('aaaaaaaa-0000-0000-0000-000000000002', null, null, '2026-09-16 13:00+08', true) $$,
  'Offline clock-out syncs');
select ok((select flags @> '{offline,public_holiday}' from attendance_view where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'Flags show "recorded offline" and public holiday');

select lives_ok($$ select clock_in('aaaaaaaa-0000-0000-0000-000000000003', 'office', 'HQ', 'Work',
                                   null, now() + interval '2 hours', true) $$, 'Offline clock-in with a phone clock that is ahead');
select is((select clock_in_at from attendance_entries where id = 'aaaaaaaa-0000-0000-0000-000000000003'), now(),
  'A phone clock set in the future is not trusted: server time is used and noted');

-- Visibility
select is((select count(distinct staff_id)::int from attendance_view), 1, 'Staff see only their own attendance');
select throws_ok($$ select clock_out('22222222-0000-0000-0000-000000000005') $$, 'P0001', 'Clock-in record not found.',
  'Staff cannot clock out someone else''s entry');
select pg_temp.logout();

select pg_temp.login('supervisor@yam.test');
select is((select count(distinct staff_id)::int from attendance_view), 3, 'Supervisor sees self + team');
select pg_temp.logout();

-- HR correction of a missed clock-out
select pg_temp.login('farid@yam.test');
select throws_ok($$ select admin_adjust_entry('22222222-0000-0000-0000-000000000005', null, '2026-09-24 18:00+08', 'Forgot') $$,
  'P0001', 'Only HR/Admin can correct entries.', 'Staff cannot correct entries');
select pg_temp.logout();
select pg_temp.login('hr@yam.test');
select admin_adjust_entry('22222222-0000-0000-0000-000000000005', null, '2026-09-24 18:00+08', 'Confirmed with Mei Ling by phone');
select is((select flags from attendance_view where id = '22222222-0000-0000-0000-000000000005'), '{}',
  'After HR corrects the clock-out, the missed clock-out flag clears (correction is logged)');
select pg_temp.logout();

select * from finish();
rollback;
