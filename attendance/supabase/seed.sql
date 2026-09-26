-- =====================================================================
-- SAMPLE DATA for testing. Do NOT load this into the live system.
-- All sample logins use the password:  YamTest#2026
-- =====================================================================

-- ---------------------------------------------------------------------
-- Staff (registered by HR before activation)
-- ---------------------------------------------------------------------
insert into public.staff (id, email, full_name, staff_no, job_title, role) values
  ('11111111-0000-0000-0000-000000000001', 'hr@yam.test',         'Nurul Huda Ismail',    'YAM001', 'HR & Admin Executive', 'admin'),
  ('11111111-0000-0000-0000-000000000002', 'director@yam.test',   'Ahmad Faizal Rahman',  'YAM002', 'Director',             'admin'),
  ('11111111-0000-0000-0000-000000000003', 'supervisor@yam.test', 'Siti Aminah Yusof',    'YAM003', 'Programme Manager',    'supervisor'),
  ('11111111-0000-0000-0000-000000000004', 'farid@yam.test',      'Muhammad Farid Hakim', 'YAM004', 'Programme Officer',    'staff'),
  ('11111111-0000-0000-0000-000000000005', 'kavitha@yam.test',    'Kavitha Rajan',        'YAM005', 'Field Coordinator',    'staff'),
  ('11111111-0000-0000-0000-000000000006', 'meiling@yam.test',    'Lim Mei Ling',         'YAM006', 'Finance Officer',      'staff'),
  -- Registered by HR but has not activated a login yet (to test activation).
  ('11111111-0000-0000-0000-000000000007', 'newstaff@yam.test',   'Hafiz Abdullah',       'YAM007', 'Programme Assistant',  'staff');

-- Supervisor assignments (Mei Ling and Hafiz have none -> their approvals go to HR)
update public.staff set supervisor_id = '11111111-0000-0000-0000-000000000003'
 where id in ('11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000005');

-- Kavitha changed to a weekend schedule on 1 July 2026:
-- works Wednesday to Sunday, off on Monday and Tuesday.
insert into public.work_schedules (staff_id, effective_from, working_days, note, created_by) values
  ('11111111-0000-0000-0000-000000000005', date '2026-07-01', array[3,4,5,6,7]::smallint[],
   'Field weekend roster: Wed to Sun, off Mon and Tue', '11111111-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Logins for the sample staff (password: YamTest#2026)
-- ---------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated', s.email,
       extensions.crypt('YamTest#2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from public.staff s
 where s.email <> 'newstaff@yam.test';

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.email like '%@yam.test';

-- ---------------------------------------------------------------------
-- Public holidays 2026 (SAMPLE: HR must check against the official
-- gazette for YAM's state before go-live)
-- ---------------------------------------------------------------------
insert into public.public_holidays (holiday_date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-01', 'Thaipusam / Federal Territory Day'),
  ('2026-02-17', 'Chinese New Year'),
  ('2026-02-18', 'Chinese New Year (2nd day)'),
  ('2026-03-21', 'Hari Raya Aidilfitri'),
  ('2026-03-22', 'Hari Raya Aidilfitri (2nd day)'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-27', 'Hari Raya Haji'),
  ('2026-05-31', 'Wesak Day'),
  ('2026-06-01', 'Agong''s Birthday'),
  ('2026-06-17', 'Awal Muharram'),
  ('2026-08-25', 'Maulidur Rasul'),
  ('2026-08-31', 'National Day'),
  ('2026-09-16', 'Malaysia Day'),
  ('2026-11-08', 'Deepavali'),
  ('2026-12-25', 'Christmas Day');

-- ---------------------------------------------------------------------
-- Sample attendance, 1 to 25 September 2026
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_in timestamptz;
  v_out timestamptz;
  v_mode public.work_mode;
  v_loc text;
  v_purpose text;
  n int := 0;
begin
  for r in
    select s.id as staff_id, s.email, g.d::date as d, row_number() over () as k
      from public.staff s
      cross join generate_series(date '2026-09-01', date '2026-09-25', interval '1 day') g(d)
     where s.email in ('farid@yam.test', 'kavitha@yam.test', 'meiling@yam.test', 'supervisor@yam.test', 'hr@yam.test')
       and app_private.day_type_for(s.id, g.d::date) = 'working_day'
       -- days covered by sample leave / trips / special cases below
       and not (s.email = 'farid@yam.test'   and g.d::date in ('2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-17', '2026-09-23'))
       and not (s.email = 'kavitha@yam.test' and g.d::date in ('2026-09-05', '2026-09-06', '2026-09-16', '2026-09-20'))
       and not (s.email = 'meiling@yam.test' and g.d::date in ('2026-09-21', '2026-09-22', '2026-09-24'))
     order by s.email, g.d
  loop
    n := n + 1;
    v_in  := ((r.d + time '08:30' + ((r.k * 7) % 35) * interval '1 minute') at time zone 'Asia/Kuala_Lumpur');
    v_out := v_in + interval '8 hours 55 minutes' + ((r.k * 11) % 25) * interval '1 minute';
    select m, l, p into v_mode, v_loc, v_purpose from (values
      (0, 'office'::public.work_mode,      'YAM HQ, Bangi',                      'Programme admin and reporting'),
      (1, 'wfh'::public.work_mode,         'Home, Kajang',                       'Proposal writing'),
      (2, 'client_site'::public.work_mode, 'Partner NGO office, Putrajaya',      'Beneficiary data verification'),
      (3, 'office'::public.work_mode,      'YAM HQ, Bangi',                      'Team meeting and planning'),
      (4, 'training'::public.work_mode,    'Training centre, Shah Alam',         'Volunteer safety training')
    ) t(i, m, l, p) where t.i = (r.k % 5);

    insert into public.attendance_entries (id, staff_id, work_date, work_mode, location, purpose, day_type,
      clock_in_at, clock_in_server_at, clock_out_at, clock_out_server_at, clock_out_note)
    values (gen_random_uuid(), r.staff_id, r.d, v_mode, v_loc, v_purpose, 'working_day',
      v_in, v_in, v_out, v_out, 'Completed planned tasks');
  end loop;
end $$;

-- Farid: outstation in Kuantan (14, 15, 17 Sep; 16 Sep is Malaysia Day)
insert into public.attendance_entries (id, staff_id, work_date, work_mode, location, purpose, day_type,
  clock_in_at, clock_in_server_at, clock_out_at, clock_out_server_at, clock_out_note)
select gen_random_uuid(), '11111111-0000-0000-0000-000000000004', d, 'outstation',
       'Flood relief centre, Kuantan', 'Flood relief aid distribution', 'working_day',
       (d + time '08:00') at time zone 'Asia/Kuala_Lumpur', (d + time '08:00') at time zone 'Asia/Kuala_Lumpur',
       (d + time '17:30') at time zone 'Asia/Kuala_Lumpur', (d + time '17:30') at time zone 'Asia/Kuala_Lumpur',
       'Distributed food packs'
  from unnest(array[date '2026-09-14', date '2026-09-15', date '2026-09-17']) d;

insert into public.attendance_entries (id, staff_id, work_date, work_mode, location, purpose, day_type, holiday_name,
  clock_in_at, clock_in_server_at, clock_out_at, clock_out_server_at, clock_out_note,
  clock_in_device_at, clock_in_offline, clock_out_device_at, clock_out_offline) values
  -- Farid works on his off day (Saturday 19 Sep)
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000004', '2026-09-19', 'client_site',
   'Masjid Al-Hidayah, Kajang', 'Community iftar logistics', 'off_day', null,
   '2026-09-19 09:00+08', '2026-09-19 09:00+08', '2026-09-19 14:00+08', '2026-09-19 14:00+08', 'Event completed',
   null, false, null, false),
  -- Farid: long day, 11 hours (overtime and over the 10-hour limit)
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000004', '2026-09-23', 'office',
   'YAM HQ, Bangi', 'Annual report deadline', 'working_day', null,
   '2026-09-23 07:30+08', '2026-09-23 07:30+08', '2026-09-23 19:00+08', '2026-09-23 19:00+08', 'Report submitted',
   null, false, null, false),
  -- Kavitha works on Malaysia Day (a public holiday, and a working day on her roster)
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000005', '2026-09-16', 'client_site',
   'Rumah Kebajikan Seri Kenangan, Cheras', 'Malaysia Day programme', 'public_holiday', 'Malaysia Day',
   '2026-09-16 08:00+08', '2026-09-16 08:00+08', '2026-09-16 16:00+08', '2026-09-16 16:00+08', 'Programme done',
   null, false, null, false),
  -- Kavitha: recorded offline in a rural area, synced later
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000005', '2026-09-20', 'client_site',
   'Kampung Orang Asli Sungai Ruil, Cameron Highlands', 'Water filter installation', 'working_day', null,
   '2026-09-20 08:10+08', '2026-09-20 19:45+08', '2026-09-20 16:40+08', '2026-09-20 19:45+08', 'Installed 12 filters',
   '2026-09-20 08:10+08', true, '2026-09-20 16:40+08', true);

-- Mei Ling forgot to clock out on 24 Sep
insert into public.attendance_entries (id, staff_id, work_date, work_mode, location, purpose, day_type,
  clock_in_at, clock_in_server_at) values
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000006', '2026-09-24', 'office',
   'YAM HQ, Bangi', 'Month-end payment processing', 'working_day',
   '2026-09-24 08:50+08', '2026-09-24 08:50+08');

-- ---------------------------------------------------------------------
-- Sample leave
-- ---------------------------------------------------------------------
insert into public.leave_requests (id, staff_id, leave_type, start_date, end_date, day_portion, reason,
  working_days, status, approver_id, submitted_at, decided_by, decided_at, decision_comment)
select v.id::uuid, v.staff_id::uuid, v.leave_type, v.s::date, v.e::date, v.portion::public.day_portion, v.reason,
       app_private.leave_days(v.staff_id::uuid, v.s::date, v.e::date, v.portion::public.day_portion),
       v.status::public.request_status, v.approver::uuid, v.submitted::timestamptz, v.decided_by::uuid,
       v.decided::timestamptz, v.comment
from (values
  -- Farid: approved annual leave (supervisor Siti approved)
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000004', 'annual', '2026-09-10', '2026-09-11', 'full',
   'Family wedding in Melaka', 'approved', '11111111-0000-0000-0000-000000000003', '2026-09-01 10:00+08',
   '11111111-0000-0000-0000-000000000003', '2026-09-02 09:15+08', 'Enjoy!'),
  -- Kavitha: hospitalization on her weekend working days (Sat-Sun)
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000005', 'hospitalization', '2026-09-05', '2026-09-06', 'full',
   'Admitted for dengue observation', 'approved', '11111111-0000-0000-0000-000000000003', '2026-09-07 08:00+08',
   '11111111-0000-0000-0000-000000000003', '2026-09-07 11:00+08', 'Get well soon'),
  -- Kavitha: pending annual leave, Wed 7 to Sun 11 Oct (5 working days on her roster)
  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000005', 'annual', '2026-10-07', '2026-10-11', 'full',
   'Deepavali preparations at home in Ipoh', 'pending', '11111111-0000-0000-0000-000000000003', '2026-09-24 09:00+08',
   null, null, null),
  -- Mei Ling: pending half day (no supervisor, so HR approves)
  ('33333333-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000006', 'annual', '2026-10-05', '2026-10-05', 'half_pm',
   'Bank appointment', 'pending', null, '2026-09-25 16:00+08', null, null, null),
  -- Siti (supervisor, no supervisor of her own): pending, goes to HR
  ('33333333-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000003', 'compassionate', '2026-09-29', '2026-09-30', 'full',
   'Grandmother passed away', 'pending', null, '2026-09-26 07:30+08', null, null, null),
  -- Farid: a draft he has not submitted yet
  ('33333333-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000004', 'paternity', '2026-11-02', '2026-11-06', 'full',
   'Expected due date early November', 'draft', null, null, null, null, null)
) v(id, staff_id, leave_type, s, e, portion, reason, status, approver, submitted, decided_by, decided, comment);
