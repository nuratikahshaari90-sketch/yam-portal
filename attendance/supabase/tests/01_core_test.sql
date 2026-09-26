begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

-- Helper: act as a sample user (as the API would after login)
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

select plan(27);

-- ---------- Work schedules & day types ----------
select is(app_private.day_type_for('11111111-0000-0000-0000-000000000005', '2026-06-08'), 'working_day',
  'Kavitha: Monday 8 Jun 2026 was a working day under her OLD Mon-Fri schedule');
select is(app_private.day_type_for('11111111-0000-0000-0000-000000000005', '2026-07-06'), 'off_day',
  'Kavitha: Monday 6 Jul 2026 is an off day under her NEW Wed-Sun schedule');
select is(app_private.day_type_for('11111111-0000-0000-0000-000000000005', '2026-07-04'), 'working_day',
  'Kavitha: Saturday is a working day on the weekend schedule');
select is(app_private.day_type_for('11111111-0000-0000-0000-000000000004', '2026-07-04'), 'off_day',
  'Farid: Saturday is an off day on the default schedule');
select is(app_private.day_type_for('11111111-0000-0000-0000-000000000004', '2026-09-16'), 'public_holiday',
  'Malaysia Day is tagged as a public holiday');
select is(app_private.count_working_days('11111111-0000-0000-0000-000000000005', '2026-07-01', '2026-07-07'), 5,
  'Kavitha: Wed 1 Jul to Tue 7 Jul = 5 working days (Mon/Tue off)');
select is(app_private.count_working_days('11111111-0000-0000-0000-000000000004', '2026-09-14', '2026-09-18'), 4,
  'Farid: Mon 14 to Fri 18 Sep = 4 working days (Malaysia Day excluded)');
select is(app_private.count_working_days('11111111-0000-0000-0000-000000000004', '2026-09-19', '2026-09-20'), 0,
  'Farid: a weekend has 0 working days');
select is((select count(*)::int from work_schedules where staff_id = '11111111-0000-0000-0000-000000000004'), 1,
  'New staff automatically get a default Mon-Fri schedule');

-- ---------- Approval routing ----------
select is(app_private.approver_for('11111111-0000-0000-0000-000000000004', 'leave'),
  '11111111-0000-0000-0000-000000000003'::uuid, 'Farid''s leave goes to his supervisor Siti');
select is(app_private.approver_for('11111111-0000-0000-0000-000000000004', 'claim'), null,
  'Claims go to HR (route_claim = hr)');
select is(app_private.approver_for('11111111-0000-0000-0000-000000000004', 'clock'), null,
  'Clock exceptions and overtime go to HR (route_clock = hr)');
select is(app_private.approver_for('11111111-0000-0000-0000-000000000006', 'leave'), null,
  'Mei Ling has no supervisor, so her leave goes to HR');

-- ---------- Account activation guard ----------
select throws_ok($$ insert into auth.users (id, email, aud, role, instance_id)
                    values (gen_random_uuid(), 'stranger@gmail.com', 'authenticated', 'authenticated',
                            '00000000-0000-0000-0000-000000000000') $$,
  'P0001', 'EMAIL_NOT_REGISTERED', 'An email not registered by HR cannot create a login');
select lives_ok($$ insert into auth.users (id, email, aud, role, instance_id)
                   values (gen_random_uuid(), 'NewStaff@yam.test', 'authenticated', 'authenticated',
                           '00000000-0000-0000-0000-000000000000') $$,
  'A registered email can activate a login (case-insensitive)');
select isnt((select user_id from staff where email = 'newstaff@yam.test'), null,
  'Activation links the login to the staff record');

-- ---------- Row Level Security: who sees what ----------
select pg_temp.login('farid@yam.test');
select is((select count(*)::int from staff), 1, 'Staff see only their own staff record');
select is((select count(*)::int from work_schedules), 1, 'Staff see only their own schedule');
select ok((select count(*) from public_holidays) > 10, 'Everyone can read the public holiday list');
select throws_ok($$ insert into public_holidays (holiday_date, name) values ('2026-12-31', 'Fake') $$,
  '42501', null, 'Staff cannot add public holidays');
update app_settings set mileage_rate_per_km = 9.99;
select is((select mileage_rate_per_km from app_settings), 0.60::numeric, 'Staff cannot change settings');
update staff set role = 'admin' where id = '11111111-0000-0000-0000-000000000004';
select is((select role::text from staff), 'staff', 'Staff cannot promote themselves');
select pg_temp.logout();

select pg_temp.login('supervisor@yam.test');
select is((select count(*)::int from staff), 3, 'Supervisor sees self and their 2 team members');
select pg_temp.logout();

select pg_temp.login('hr@yam.test');
select is((select count(*)::int from staff), 7, 'HR/Admin sees everyone');
select throws_ok($$ update staff set role = 'staff' where email = 'hr@yam.test' $$,
  'P0001', 'You cannot remove your own HR/Admin access or deactivate yourself.',
  'HR cannot accidentally lock themselves out');
select lives_ok($$ insert into work_schedules (staff_id, effective_from, working_days)
                   values ('11111111-0000-0000-0000-000000000006', '2026-10-01', '{7,6,1,2,3}') $$,
  'HR can add a schedule change');
select pg_temp.logout();

set local role anon;
select throws_ok($$ select count(*) from public.staff $$, '42501', null,
  'People who are not logged in cannot read any data');
select * from finish();
rollback;
