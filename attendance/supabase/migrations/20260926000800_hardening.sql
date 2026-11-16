-- =====================================================================
-- Security hardening: only signed-in users can call the app's functions.
-- (Supabase allows anonymous callers by default.)
-- =====================================================================
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema app_private from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;

-- Views are read through Row Level Security of their underlying tables;
-- anonymous users get nothing.
revoke all on all tables in schema public from anon;
