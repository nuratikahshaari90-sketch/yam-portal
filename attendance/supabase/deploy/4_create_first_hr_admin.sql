-- Registers the first HR/Admin person so they can activate their login.
-- 1. Replace the name and email below with the real HR person's details.
-- 2. Paste into Supabase > SQL Editor and press Run.
-- 3. The HR person opens the app, taps "Activate your account" and uses this email.
insert into public.staff (email, full_name, staff_no, job_title, role)
values (lower('hr.person@yam.org.my'), 'HR Person Full Name', 'YAM001', 'HR & Admin', 'admin');
