-- =============================================================================
-- Verify public-access hardening for Hader Supabase
-- Run after:
-- supabase/migrations/20260506133000_harden_public_access_defaults.sql
-- =============================================================================

-- 1) Ensure guardian_login_security has no remaining public policies
SELECT
  'guardian_login_security_policies' AS check_name,
  COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'guardian_login_security';

-- 2) Ensure anon/authenticated cannot access guardian_login_security directly
--    (If table_missing: run the migration first — has_table_privilege errors if the relation does not exist.)
SELECT
  'guardian_login_security_privileges' AS check_name,
  to_regclass('public.guardian_login_security') IS NOT NULL AS table_exists,
  CASE WHEN to_regclass('public.guardian_login_security') IS NOT NULL
    THEN has_table_privilege('anon', 'public.guardian_login_security', 'SELECT') END AS anon_select,
  CASE WHEN to_regclass('public.guardian_login_security') IS NOT NULL
    THEN has_table_privilege('anon', 'public.guardian_login_security', 'INSERT') END AS anon_insert,
  CASE WHEN to_regclass('public.guardian_login_security') IS NOT NULL
    THEN has_table_privilege('anon', 'public.guardian_login_security', 'UPDATE') END AS anon_update,
  CASE WHEN to_regclass('public.guardian_login_security') IS NOT NULL
    THEN has_table_privilege('authenticated', 'public.guardian_login_security', 'SELECT') END AS authenticated_select,
  CASE WHEN to_regclass('public.guardian_login_security') IS NOT NULL
    THEN has_table_privilege('authenticated', 'public.guardian_login_security', 'INSERT') END AS authenticated_insert,
  CASE WHEN to_regclass('public.guardian_login_security') IS NOT NULL
    THEN has_table_privilege('authenticated', 'public.guardian_login_security', 'UPDATE') END AS authenticated_update;

-- 3) Kiosk compatibility exception:
--    search_students is intentionally callable by anon for kiosk deployments.
--    authenticated must remain callable as well.
SELECT
  'search_students_execute_privileges_kiosk_exception' AS check_name,
  has_function_privilege('anon', 'public.search_students(text, text, text, integer)', 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', 'public.search_students(text, text, text, integer)', 'EXECUTE') AS authenticated_execute;

-- 4) Ensure guardian_phone is masked by the function
SELECT
  'search_students_masking_sample' AS check_name,
  guardian_phone
FROM public.search_students(NULL, NULL, NULL, 1);

-- 5) Ensure users table is not included in Supabase realtime publication
SELECT
  'users_realtime_publication' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'users'
  ) AS users_still_published;

-- 6) Optional quick reference for currently published tables
SELECT
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
ORDER BY tablename;
