-- =======================================================
-- Revert Kiosk Hardening
-- Run this in your Supabase SQL Editor to restore Kiosk
-- functionality immediately without a database reset.
-- =======================================================

-- Restore public/anon access to search_students
grant execute on function public.search_students(text, text, text, integer) to public;
grant execute on function public.search_students(text, text, text, integer) to anon;
grant execute on function public.search_students(text, text, text, integer) to authenticated;

-- (Optional) If you also want to unlock the guardian_login_security table for anon, uncomment below:
-- grant select, insert, update on table public.guardian_login_security to anon;
