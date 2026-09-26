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
