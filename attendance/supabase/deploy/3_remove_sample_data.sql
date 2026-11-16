-- Removes ALL sample data (staff with @yam.test emails and everything they
-- recorded, except uploaded photos: empty those in Supabase > Storage > files
-- if you uploaded test photos). Settings, leave types and the public holiday list stay
-- (HR should check the holiday list against the official gazette).
-- Run this before real staff start using the app.
begin;
create temporary table sample_staff on commit drop as
  select id, user_id from public.staff where email like '%@yam.test';

delete from public.approval_log    where staff_id in (select id from sample_staff) or actor_id in (select id from sample_staff);
delete from public.sync_conflicts  where staff_id in (select id from sample_staff);
delete from public.claim_items     where claim_id in (select id from public.claims where staff_id in (select id from sample_staff));
delete from public.claims          where staff_id in (select id from sample_staff);
delete from public.attendance_entries where staff_id in (select id from sample_staff);
delete from public.trips           where staff_id in (select id from sample_staff);
delete from public.leave_requests  where staff_id in (select id from sample_staff);
update public.app_settings set updated_by = null where updated_by in (select id from sample_staff);
update public.work_schedules set created_by = null where created_by in (select id from sample_staff);
update public.staff set supervisor_id = null where supervisor_id in (select id from sample_staff);
delete from public.staff           where id in (select id from sample_staff);
delete from auth.users             where id in (select user_id from sample_staff where user_id is not null);
commit;
select 'Sample data removed. Staff left: ' || count(*) from public.staff;
