-- =============================================================================
-- FULL SYSTEM RESET SCRIPT (FACTORY RESET)
-- =============================================================================
-- ⚠️ WARNING: THIS SCRIPT DELETES ALMOST ALL DATA ⚠️
-- 
-- This script will:
-- 1. Delete ALL students and classes.
-- 2. Delete ALL attendance records, violations, exits, and notifications.
-- 3. Delete ALL logs and summaries.
-- 4. Delete ALL users EXCEPT Admin users (site_admin).
--
-- Use this script only when you want to make the system completely clean
-- and ready for a fresh start (Production Ready).
-- =============================================================================

BEGIN;

-- 1. Operational Data (Truncate for speed and reset sequences)
TRUNCATE TABLE attendance_logs CASCADE;
TRUNCATE TABLE exits CASCADE;
TRUNCATE TABLE violations CASCADE;
TRUNCATE TABLE notifications CASCADE;
TRUNCATE TABLE daily_summaries CASCADE;
TRUNCATE TABLE audit_logs CASCADE;
TRUNCATE TABLE rate_limits CASCADE;

-- 2. Master Data (Students & Classes)
-- We use DELETE to ensure cascading constraints work if TRUNCATE has issues with FKs
-- although TRUNCATE CASCADE usually handles it.
DELETE FROM students;
DELETE FROM classes;

-- 3. Optional: Logs
-- Check if table exists to avoid errors (if using older schema)
DELETE FROM client_error_logs;
DELETE FROM auth_audit_logs;

-- 4. Users Cleanup
-- Keep ONLY Site Admins (e.g., admin, adminHim)
-- Delete all other roles (supervisors, watchers, guardians, etc.)
DELETE FROM users WHERE role NOT IN ('site_admin', 'school_admin');

-- 5. Reset Settings (Optional - set to defaults if needed)
-- UPDATE settings SET 
--    school_active = true, 
--    system_ready = false -- Set to false to force setup wizard if you have one
-- WHERE id = 1;

COMMIT;

-- =============================================================================
-- SYSTEM RESET COMPLETED SUCCESSFULLY
-- =============================================================================
