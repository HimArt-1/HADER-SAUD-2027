-- =============================================================================
-- Hader — Complete Supabase bootstrap and compatibility migration
-- Date: 2026-08-23
--
-- Usage (new project or a project based on the known Hader v2.x schema):
--   1. Open Supabase Dashboard > SQL Editor > New query.
--   2. Paste this whole file and press Run once.
--   3. Review the verification result sets at the bottom.
--
-- Properties:
--   * Creates the complete schema required by the current Hader application.
--   * Safe to run again: tables, columns, indexes, functions and policies are
--     created/replaced idempotently.
--   * Does not drop tables, truncate tables, delete rows, or create default
--     administrator credentials.
--   * Stops with a clear error if duplicate attendance rows would prevent the
--     required (student_id, date) unique index; it never deletes those rows.
--   * Stops with a remediation hint when corrupted legacy rows cannot satisfy
--     a required current-app constraint; it does not invent student ownership.
--
-- Security note:
--   The current Hader client uses its own users table with the Supabase anon
--   key rather than Supabase Auth. The compatibility RLS policies below allow
--   anon/authenticated access to operational tables so the current application
--   works. Move authentication to Supabase Auth before tightening these rules.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- =============================================================================
-- 1. Core tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(500) NOT NULL,
  password_hash_version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  assigned_classes JSONB DEFAULT '[]'::JSONB,
  assigned_sections TEXT[] DEFAULT '{}'::TEXT[],
  email VARCHAR(255),
  phone VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  can_use_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  last_login TIMESTAMPTZ,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_hash_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_classes JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS assigned_sections TEXT[] DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS can_use_whatsapp BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Older Hader schemas stored assigned_classes as TEXT[]. The current client
-- sends structured class/section assignments, so preserve and convert any
-- legacy array to JSONB instead of discarding it.
DO $assigned_classes_type$
DECLARE
  assigned_classes_type TEXT;
BEGIN
  SELECT c.udt_name
  INTO assigned_classes_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'users'
    AND c.column_name = 'assigned_classes';

  IF assigned_classes_type = '_text' THEN
    ALTER TABLE public.users
      ALTER COLUMN assigned_classes TYPE JSONB
      USING COALESCE(to_jsonb(assigned_classes), '[]'::JSONB);
    ALTER TABLE public.users
      ALTER COLUMN assigned_classes SET DEFAULT '[]'::JSONB;
  ELSIF assigned_classes_type <> 'jsonb' THEN
    RAISE EXCEPTION 'Unsupported public.users.assigned_classes type: %', assigned_classes_type;
  END IF;
END
$assigned_classes_type$;

DO $users_role$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE public.users
    ADD CONSTRAINT users_role_check CHECK (role IN (
      'site_admin',
      'school_admin',
      'supervisor_global',
      'supervisor_class',
      'watcher',
      'kiosk',
      'guardian',
      'call_station'
    ));
END
$users_role$;

CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  sections TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  grade_level INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.students (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  section VARCHAR(20) NOT NULL,
  guardian_phone VARCHAR(20),
  guardian_name VARCHAR(255),
  whatsapp_phone VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL,
  minutes_late INTEGER NOT NULL DEFAULT 0,
  recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_by_label VARCHAR(100),
  device_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS recorded_by_label VARCHAR(100),
  ADD COLUMN IF NOT EXISTS device_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.attendance_logs
  ALTER COLUMN recorded_by_label TYPE VARCHAR(100)
    USING recorded_by_label::VARCHAR(100);

DO $attendance_required_values$
DECLARE
  missing_student_count BIGINT;
  missing_status_count BIGINT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE student_id IS NULL),
    COUNT(*) FILTER (WHERE status IS NULL)
  INTO missing_student_count, missing_status_count
  FROM public.attendance_logs;

  IF missing_student_count > 0 OR missing_status_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Hader migration stopped: attendance_logs has %s row(s) without student_id and %s row(s) without status.',
        missing_student_count,
        missing_status_count
      ),
      HINT = 'Repair or archive those legacy attendance rows, then run this migration again. No row was deleted.';
  END IF;
END
$attendance_required_values$;

UPDATE public.attendance_logs
SET
  "timestamp" = COALESCE("timestamp", created_at, NOW()),
  date = COALESCE(
    date,
    (COALESCE("timestamp", created_at, NOW()) AT TIME ZONE 'Asia/Riyadh')::DATE
  ),
  minutes_late = COALESCE(minutes_late, 0),
  created_at = COALESCE(created_at, "timestamp", NOW()),
  updated_at = COALESCE(updated_at, created_at, "timestamp", NOW());

ALTER TABLE public.attendance_logs
  ALTER COLUMN student_id SET NOT NULL,
  ALTER COLUMN date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN date SET NOT NULL,
  ALTER COLUMN "timestamp" SET DEFAULT NOW(),
  ALTER COLUMN "timestamp" SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN minutes_late SET DEFAULT 0,
  ALTER COLUMN minutes_late SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_status_check;
ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_status_check
  CHECK (status IN ('present', 'late', 'absent', 'excused'));

DO $attendance_duplicates$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.attendance_logs
    WHERE student_id IS NOT NULL AND date IS NOT NULL
    GROUP BY student_id, date
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Hader migration stopped: duplicate attendance rows exist for the same student and date.',
      HINT = 'Review duplicates with: SELECT student_id, date, count(*) FROM public.attendance_logs GROUP BY student_id, date HAVING count(*) > 1; Resolve them manually, then run this migration again.';
  END IF;
END
$attendance_duplicates$;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_student_id_date_unique_idx
  ON public.attendance_logs(student_id, date);

CREATE TABLE IF NOT EXISTS public.exits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  requester_relation TEXT,
  requester_relation_other TEXT,
  supervisor_name VARCHAR(255),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'approved',
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.exits
  ADD COLUMN IF NOT EXISTS date DATE,
  ADD COLUMN IF NOT EXISTS requester_relation TEXT,
  ADD COLUMN IF NOT EXISTS requester_relation_other TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $exit_required_values$
DECLARE
  missing_student_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO missing_student_count
  FROM public.exits
  WHERE student_id IS NULL;

  IF missing_student_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Hader migration stopped: exits has %s row(s) without student_id.',
        missing_student_count
      ),
      HINT = 'Repair or archive those legacy exit rows, then run this migration again. No row was deleted.';
  END IF;
END
$exit_required_values$;

UPDATE public.exits
SET
  exit_time = COALESCE(exit_time, created_at, NOW()),
  date = COALESCE(
    date,
    (COALESCE(exit_time, created_at, NOW()) AT TIME ZONE 'Asia/Riyadh')::DATE
  ),
  status = COALESCE(status, 'approved'),
  created_at = COALESCE(created_at, exit_time, NOW()),
  updated_at = COALESCE(updated_at, created_at, exit_time, NOW());

ALTER TABLE public.exits
  ALTER COLUMN student_id SET NOT NULL,
  ALTER COLUMN exit_time SET DEFAULT NOW(),
  ALTER COLUMN exit_time SET NOT NULL,
  ALTER COLUMN date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN date SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'approved',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.exits
  DROP CONSTRAINT IF EXISTS exits_status_check,
  DROP CONSTRAINT IF EXISTS exits_requester_relation_check;
ALTER TABLE public.exits
  ADD CONSTRAINT exits_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT exits_requester_relation_check
    CHECK (requester_relation IS NULL OR requester_relation IN (
      'father', 'mother', 'brother', 'sister', 'driver', 'other'
    ));

CREATE TABLE IF NOT EXISTS public.violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  action_taken TEXT,
  summon_guardian BOOLEAN NOT NULL DEFAULT FALSE,
  guardian_notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_label VARCHAR(100),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS created_by_label VARCHAR(100),
  ADD COLUMN IF NOT EXISTS date DATE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $violation_required_values$
DECLARE
  missing_student_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO missing_student_count
  FROM public.violations
  WHERE student_id IS NULL;

  IF missing_student_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Hader migration stopped: violations has %s row(s) without student_id.',
        missing_student_count
      ),
      HINT = 'Repair or archive those legacy violation rows, then run this migration again. No row was deleted.';
  END IF;
END
$violation_required_values$;

UPDATE public.violations
SET
  level = COALESCE(level, 1),
  summon_guardian = COALESCE(summon_guardian, FALSE),
  guardian_notified = COALESCE(guardian_notified, FALSE),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW()),
  date = COALESCE(
    date,
    (COALESCE(created_at, NOW()) AT TIME ZONE 'Asia/Riyadh')::DATE
  );

ALTER TABLE public.violations
  ALTER COLUMN student_id SET NOT NULL,
  ALTER COLUMN level SET DEFAULT 1,
  ALTER COLUMN level SET NOT NULL,
  ALTER COLUMN summon_guardian SET DEFAULT FALSE,
  ALTER COLUMN summon_guardian SET NOT NULL,
  ALTER COLUMN guardian_notified SET DEFAULT FALSE,
  ALTER COLUMN guardian_notified SET NOT NULL,
  ALTER COLUMN date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN date SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.violations
  DROP CONSTRAINT IF EXISTS violations_level_check;
ALTER TABLE public.violations
  ADD CONSTRAINT violations_level_check CHECK (level BETWEEN 1 AND 5);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255),
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  target_audience VARCHAR(50) NOT NULL,
  target_id VARCHAR(255),
  is_popup BOOLEAN NOT NULL DEFAULT FALSE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check,
  DROP CONSTRAINT IF EXISTS notifications_target_audience_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'announcement', 'behavior', 'general', 'command', 'alert',
    'attendance', 'dismissal_call'
  )),
  ADD CONSTRAINT notifications_target_audience_check CHECK (target_audience IN (
    'all', 'admin', 'supervisor', 'guardian', 'kiosk', 'class', 'student', 'user'
  ));

CREATE TABLE IF NOT EXISTS public.settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  system_ready BOOLEAN NOT NULL DEFAULT FALSE,
  school_active BOOLEAN NOT NULL DEFAULT TRUE,
  school_name VARCHAR(255),
  principal_name VARCHAR(255),
  logo_url TEXT,
  dark_mode BOOLEAN NOT NULL DEFAULT TRUE,
  admin_theme TEXT,
  theme JSONB DEFAULT '{}'::JSONB,
  assembly_time TEXT DEFAULT '07:00',
  grace_period INTEGER DEFAULT 15,
  absence_time TEXT DEFAULT '09:00',
  work_days INTEGER[] DEFAULT ARRAY[0,1,2,3,4],
  kiosk_settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  security_settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  attendance_settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  social_links JSONB NOT NULL DEFAULT '{}'::JSONB,
  notification_templates JSONB NOT NULL DEFAULT '{}'::JSONB,
  whatsapp_templates JSONB NOT NULL DEFAULT '[]'::JSONB,
  whatsapp_triggers JSONB NOT NULL DEFAULT '{}'::JSONB,
  whatsapp_autopilot BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_autopilot_time TEXT,
  telemetry_retention_days INTEGER NOT NULL DEFAULT 90,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_single_row_check CHECK (id = 1)
);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS system_ready BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS school_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS school_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS principal_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS admin_theme TEXT,
  ADD COLUMN IF NOT EXISTS theme JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS assembly_time TEXT DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS grace_period INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS absence_time TEXT DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS work_days INTEGER[] DEFAULT ARRAY[0,1,2,3,4],
  ADD COLUMN IF NOT EXISTS kiosk_settings JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS security_settings JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS attendance_settings JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS notification_templates JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS whatsapp_templates JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS whatsapp_triggers JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS whatsapp_autopilot BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_autopilot_time TEXT,
  ADD COLUMN IF NOT EXISTS telemetry_retention_days INTEGER DEFAULT 90,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

INSERT INTO public.settings (id, system_ready)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_students INTEGER NOT NULL DEFAULT 0,
  present_count INTEGER NOT NULL DEFAULT 0,
  late_count INTEGER NOT NULL DEFAULT 0,
  absent_count INTEGER NOT NULL DEFAULT 0,
  exit_count INTEGER NOT NULL DEFAULT 0,
  violation_count INTEGER NOT NULL DEFAULT 0,
  attendance_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  summary_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.daily_summaries
  ADD COLUMN IF NOT EXISTS exit_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS violation_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- =============================================================================
-- 2. Operational, security and support tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  table_name VARCHAR(100),
  record_id VARCHAR(255),
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  first_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rate_limits_identifier_action_unique UNIQUE(identifier, action_type)
);

CREATE TABLE IF NOT EXISTS public.auth_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action TEXT NOT NULL CHECK (action IN ('LOGIN', 'LOGOUT', 'SESSION_RESTORE', 'SESSION_EXPIRED')),
  actor_user_id UUID,
  actor_role TEXT,
  actor_label TEXT NOT NULL DEFAULT 'anonymous',
  session_key TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  ip_hint TEXT,
  user_agent TEXT NOT NULL,
  meta JSONB
);

CREATE TABLE IF NOT EXISTS public.client_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity TEXT NOT NULL CHECK (severity IN ('ERROR', 'WARN')),
  source TEXT NOT NULL CHECK (source IN (
    'window.onerror', 'unhandledrejection', 'react-boundary', 'console.error'
  )),
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT NOT NULL DEFAULT '',
  actor_user_id UUID,
  actor_role TEXT,
  session_key TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  meta JSONB
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  description TEXT,
  target_id TEXT,
  target_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.emergency_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.guardian_login_security (
  phone VARCHAR(20) PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_tombstones_unique_record UNIQUE(table_name, record_id)
);

-- =============================================================================
-- 3. Dismissal and guardian excuse workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.dismissal_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  dismissal_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method VARCHAR(50) CHECK (method IN ('kiosk', 'watcher', 'scanner', 'admin')),
  picked_up_by VARCHAR(255),
  recorded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_by_label VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dismissal_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_name VARCHAR(255) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  section VARCHAR(20) NOT NULL,
  requested_by VARCHAR(100),
  requested_by_name VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'called', 'dismissed', 'cancelled')),
  request_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  called_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dismissal_calls
  ADD COLUMN IF NOT EXISTS request_time TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.dismissal_calls
SET
  request_time = COALESCE(request_time, created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, request_time, NOW());

ALTER TABLE public.dismissal_calls
  ALTER COLUMN request_time SET DEFAULT NOW(),
  ALTER COLUMN request_time SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.dismissal_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name VARCHAR(100) NOT NULL,
  dismissal_time TIME NOT NULL,
  days INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4],
  label VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.guardian_excuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_name TEXT,
  class_name TEXT,
  section TEXT,
  guardian_id TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  absence_date DATE NOT NULL,
  reason TEXT NOT NULL,
  attachment_url TEXT NOT NULL,
  attachment_path TEXT NOT NULL,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_by_label TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Read-only compatibility alias used by the current cloud backup exporter.
-- The canonical table is public.exits; no duplicate exit data is stored.
DO $exit_permissions_view$
DECLARE
  relation_kind "char";
BEGIN
  SELECT c.relkind
  INTO relation_kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'exit_permissions';

  IF relation_kind IS NULL THEN
    EXECUTE $view$
      CREATE VIEW public.exit_permissions
      WITH (security_invoker = TRUE)
      AS
      SELECT
        id,
        student_id,
        reason,
        exit_time,
        date,
        requester_relation,
        requester_relation_other,
        supervisor_name,
        notes,
        status,
        created_by,
        created_at,
        updated_at
      FROM public.exits
    $view$;
  ELSIF relation_kind = 'v' THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.exit_permissions
      WITH (security_invoker = TRUE)
      AS
      SELECT
        id,
        student_id,
        reason,
        exit_time,
        date,
        requester_relation,
        requester_relation_other,
        supervisor_name,
        notes,
        status,
        created_by,
        created_at,
        updated_at
      FROM public.exits
    $view$;
  ELSE
    RAISE NOTICE 'public.exit_permissions already exists as a non-view relation; preserving it.';
  END IF;
END
$exit_permissions_view$;

-- =============================================================================
-- 4. Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON public.users(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_classes_name ON public.classes(name);
CREATE INDEX IF NOT EXISTS idx_students_name ON public.students(name);
CREATE INDEX IF NOT EXISTS idx_students_class_section ON public.students(class_name, section);
CREATE INDEX IF NOT EXISTS idx_students_guardian ON public.students(guardian_phone) WHERE guardian_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_active ON public.students(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_attendance_date_status ON public.attendance_logs(date, status);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON public.attendance_logs(student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_recent ON public.attendance_logs(date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_recorded_by_label ON public.attendance_logs(recorded_by_label)
  WHERE recorded_by_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exits_student_date ON public.exits(student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_exits_status ON public.exits(status);
CREATE INDEX IF NOT EXISTS idx_violations_student_date ON public.violations(student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_violations_type ON public.violations(type);
CREATE INDEX IF NOT EXISTS idx_notifications_audience_created ON public.notifications(target_audience, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON public.notifications(target_id) WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON public.daily_summaries(date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked ON public.rate_limits(blocked_until) WHERE blocked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON public.auth_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_action ON public.auth_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_created_at ON public.client_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_severity ON public.client_error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_logs_created_at ON public.emergency_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_login_security_locked_until ON public.guardian_login_security(locked_until)
  WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at ON public.sync_tombstones(deleted_at);
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_table_record ON public.sync_tombstones(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_dismissal_records_date ON public.dismissal_records(date DESC);
CREATE INDEX IF NOT EXISTS idx_dismissal_records_student ON public.dismissal_records(student_id);
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_status ON public.dismissal_calls(status)
  WHERE status IN ('pending', 'called');
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_created ON public.dismissal_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_excuses_student ON public.guardian_excuses(student_id);
CREATE INDEX IF NOT EXISTS idx_guardian_excuses_status_created ON public.guardian_excuses(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_excuses_absence_date ON public.guardian_excuses(absence_date DESC);

-- =============================================================================
-- 5. Helper functions and RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_local_date()
RETURNS DATE
LANGUAGE SQL
STABLE
SET search_path = public, extensions
AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Riyadh')::DATE;
$$;

CREATE OR REPLACE FUNCTION public.get_local_time()
RETURNS TIME
LANGUAGE SQL
STABLE
SET search_path = public, extensions
AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Riyadh')::TIME;
$$;

CREATE OR REPLACE FUNCTION public.generate_uuid()
RETURNS TEXT
LANGUAGE SQL
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT gen_random_uuid()::TEXT;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_user_password(
  p_username TEXT,
  p_plain_password TEXT
)
RETURNS TABLE (
  id UUID,
  username VARCHAR,
  role VARCHAR,
  password_match BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.username,
    u.role,
    (u.password = crypt(p_plain_password, u.password::TEXT)) AS password_match
  FROM public.users u
  WHERE u.username = p_username
    AND u.is_active = TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_students(
  p_query TEXT DEFAULT NULL,
  p_class_name TEXT DEFAULT NULL,
  p_section TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  class_name TEXT,
  section TEXT,
  guardian_phone TEXT,
  is_active BOOLEAN,
  attendance_rate NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id::TEXT,
    s.name::TEXT,
    s.class_name::TEXT,
    s.section::TEXT,
    NULL::TEXT AS guardian_phone,
    s.is_active,
    COALESCE((
      SELECT ROUND(
        COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::NUMERIC
        / NULLIF(COUNT(*), 0) * 100,
        2
      )
      FROM public.attendance_logs a
      WHERE a.student_id = s.id
        AND a.date >= public.get_local_date() - 30
    ), 0) AS attendance_rate
  FROM public.students s
  WHERE (p_query IS NULL OR s.name ILIKE '%' || p_query || '%' OR s.id ILIKE '%' || p_query || '%')
    AND (p_class_name IS NULL OR s.class_name = p_class_name)
    AND (p_section IS NULL OR s.section = p_section)
    AND s.is_active = TRUE
  ORDER BY s.name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_daily_summary()
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  today DATE := public.get_local_date();
  total_students INTEGER := 0;
  present_count INTEGER := 0;
  late_count INTEGER := 0;
  absent_count INTEGER := 0;
  exit_count INTEGER := 0;
  violation_count INTEGER := 0;
BEGIN
  SELECT COUNT(*) INTO total_students
  FROM public.students
  WHERE is_active = TRUE;

  SELECT
    COUNT(*) FILTER (WHERE status = 'present'),
    COUNT(*) FILTER (WHERE status = 'late')
  INTO present_count, late_count
  FROM public.attendance_logs
  WHERE date = today;

  absent_count := GREATEST(total_students - present_count - late_count, 0);

  SELECT COUNT(*) INTO exit_count FROM public.exits WHERE date = today;
  SELECT COUNT(*) INTO violation_count FROM public.violations WHERE date = today;

  INSERT INTO public.daily_summaries (
    date, total_students, present_count, late_count, absent_count,
    exit_count, violation_count, attendance_rate
  ) VALUES (
    today, total_students, present_count, late_count, absent_count,
    exit_count, violation_count,
    CASE WHEN total_students > 0
      THEN ROUND(((present_count + late_count)::NUMERIC / total_students) * 100, 2)
      ELSE 0
    END
  )
  ON CONFLICT (date) DO UPDATE SET
    total_students = EXCLUDED.total_students,
    present_count = EXCLUDED.present_count,
    late_count = EXCLUDED.late_count,
    absent_count = EXCLUDED.absent_count,
    exit_count = EXCLUDED.exit_count,
    violation_count = EXCLUDED.violation_count,
    attendance_rate = EXCLUDED.attendance_rate,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_class_statistics(
  p_class_name TEXT,
  p_section TEXT DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
  total_students BIGINT,
  present_count BIGINT,
  late_count BIGINT,
  absent_count BIGINT,
  attendance_rate NUMERIC,
  total_exits BIGINT,
  total_violations BIGINT
)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  from_date DATE := COALESCE(p_from_date, public.get_local_date() - 30);
  to_date DATE := COALESCE(p_to_date, public.get_local_date());
BEGIN
  RETURN QUERY
  WITH student_ids AS (
    SELECT s.id
    FROM public.students s
    WHERE s.class_name = p_class_name
      AND (p_section IS NULL OR s.section = p_section)
      AND s.is_active = TRUE
  ), attendance_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE a.status = 'present') AS present,
      COUNT(*) FILTER (WHERE a.status = 'late') AS late,
      COUNT(*) FILTER (WHERE a.status = 'absent') AS absent
    FROM public.attendance_logs a
    WHERE a.student_id IN (SELECT student_ids.id FROM student_ids)
      AND a.date BETWEEN from_date AND to_date
  )
  SELECT
    (SELECT COUNT(*) FROM student_ids),
    COALESCE(stats.present, 0),
    COALESCE(stats.late, 0),
    COALESCE(stats.absent, 0),
    CASE WHEN (stats.present + stats.late + stats.absent) > 0
      THEN ROUND(((stats.present + stats.late)::NUMERIC
        / (stats.present + stats.late + stats.absent)) * 100, 2)
      ELSE 0
    END,
    (SELECT COUNT(*) FROM public.exits e
      WHERE e.student_id IN (SELECT student_ids.id FROM student_ids)
        AND e.date BETWEEN from_date AND to_date),
    (SELECT COUNT(*) FROM public.violations v
      WHERE v.student_id IN (SELECT student_ids.id FROM student_ids)
        AND v.date BETWEEN from_date AND to_date)
  FROM attendance_stats stats;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_absent_students()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  today DATE := public.get_local_date();
  student_record RECORD;
  notification_count INTEGER := 0;
BEGIN
  FOR student_record IN
    SELECT s.*
    FROM public.students s
    WHERE s.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance_logs a
        WHERE a.student_id = s.id AND a.date = today
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.target_id = student_record.id
        AND n.type = 'attendance'
        AND (n.created_at AT TIME ZONE 'Asia/Riyadh')::DATE = today
        AND n.title LIKE '%غياب%'
    ) THEN
      INSERT INTO public.notifications (
        title, message, type, target_audience, target_id, is_popup, priority
      ) VALUES (
        '🚫 غياب طالب',
        'الطالب ' || student_record.name || ' (' || student_record.class_name ||
          ' - ' || student_record.section || ') غائب اليوم.',
        'attendance', 'supervisor', student_record.id, FALSE, 2
      );
      notification_count := notification_count + 1;
    END IF;
  END LOOP;

  RETURN notification_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_telemetry_logs(retention_days INTEGER DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  auth_deleted INTEGER := 0;
  error_deleted INTEGER := 0;
BEGIN
  IF retention_days < 1 THEN
    RAISE EXCEPTION 'retention_days must be at least 1';
  END IF;

  DELETE FROM public.auth_audit_logs
  WHERE created_at < NOW() - make_interval(days => retention_days);
  GET DIAGNOSTICS auth_deleted = ROW_COUNT;

  DELETE FROM public.client_error_logs
  WHERE created_at < NOW() - make_interval(days => retention_days);
  GET DIAGNOSTICS error_deleted = ROW_COUNT;

  RETURN json_build_object('auth_deleted', auth_deleted, 'error_deleted', error_deleted);
END;
$$;

-- =============================================================================
-- 6. Notification functions and triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_late_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  student_record RECORD;
BEGIN
  IF NEW.status = 'late' THEN
    SELECT * INTO student_record FROM public.students WHERE id = NEW.student_id;

    INSERT INTO public.notifications (
      title, message, type, target_audience, is_popup, priority
    ) VALUES (
      '⏰ تأخر طالب',
      'تأخر الطالب ' || student_record.name || ' (' || student_record.class_name ||
        ' - ' || student_record.section || ') عن الحضور.',
      'attendance', 'supervisor', TRUE, 2
    );

    IF student_record.guardian_phone IS NOT NULL THEN
      INSERT INTO public.notifications (
        title, message, type, target_audience, target_id, is_popup, priority
      ) VALUES (
        'تنبيه تأخر',
        'نفيدكم بتأخر الطالب ' || student_record.name || ' عن الحضور اليوم.',
        'attendance', 'guardian', NEW.student_id, FALSE, 1
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_violation_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  student_record RECORD;
  violation_emoji TEXT;
BEGIN
  SELECT * INTO student_record FROM public.students WHERE id = NEW.student_id;
  violation_emoji := CASE NEW.level
    WHEN 1 THEN '⚠️'
    WHEN 2 THEN '🚨'
    WHEN 3 THEN '🔴'
    ELSE '📋'
  END;

  INSERT INTO public.notifications (
    title, message, type, target_audience, is_popup, priority
  ) VALUES (
    violation_emoji || ' مخالفة سلوكية',
    'تم تسجيل مخالفة على الطالب ' || student_record.name || ': ' ||
      COALESCE(NEW.description, NEW.type),
    'behavior', 'supervisor', NEW.level >= 2, NEW.level + 1
  );

  IF NEW.summon_guardian = TRUE AND student_record.guardian_phone IS NOT NULL THEN
    INSERT INTO public.notifications (
      title, message, type, target_audience, target_id, is_popup, priority
    ) VALUES (
      'استدعاء ولي أمر',
      'نرجو حضوركم للمدرسة بخصوص الطالب ' || student_record.name || '. السبب: ' ||
        COALESCE(NEW.description, NEW.type),
      'behavior', 'guardian', NEW.student_id, TRUE, 3
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_exit_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  student_record RECORD;
BEGIN
  SELECT * INTO student_record FROM public.students WHERE id = NEW.student_id;

  INSERT INTO public.notifications (
    title, message, type, target_audience, is_popup, priority
  ) VALUES (
    '🚪 استئذان طالب',
    'خرج الطالب ' || student_record.name || ' (' || student_record.class_name ||
      ') من المدرسة. السبب: ' || COALESCE(NEW.reason, 'غير محدد'),
    'general', 'supervisor', FALSE, 1
  );

  IF student_record.guardian_phone IS NOT NULL THEN
    INSERT INTO public.notifications (
      title, message, type, target_audience, target_id, is_popup, priority
    ) VALUES (
      'خروج من المدرسة',
      'نفيدكم بأن الطالب ' || student_record.name || ' غادر المدرسة. السبب: ' ||
        COALESCE(NEW.reason, 'غير محدد'),
      'general', 'guardian', NEW.student_id, FALSE, 1
    );
  END IF;

  RETURN NEW;
END;
$$;

DO $triggers$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'classes', 'students', 'attendance_logs', 'exits', 'violations',
    'settings', 'daily_summaries', 'dismissal_records', 'dismissal_calls',
    'dismissal_schedules', 'guardian_excuses'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trigger_update_timestamp ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER trigger_update_timestamp BEFORE UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      table_name
    );
  END LOOP;
END
$triggers$;

DROP TRIGGER IF EXISTS trigger_late_notification ON public.attendance_logs;
CREATE TRIGGER trigger_late_notification
  AFTER INSERT ON public.attendance_logs
  FOR EACH ROW EXECUTE FUNCTION public.create_late_notification();

DROP TRIGGER IF EXISTS trigger_violation_notification ON public.violations;
CREATE TRIGGER trigger_violation_notification
  AFTER INSERT ON public.violations
  FOR EACH ROW EXECUTE FUNCTION public.create_violation_notification();

DROP TRIGGER IF EXISTS trigger_exit_notification ON public.exits;
CREATE TRIGGER trigger_exit_notification
  AFTER INSERT ON public.exits
  FOR EACH ROW EXECUTE FUNCTION public.create_exit_notification();

-- =============================================================================
-- 7. Row-level security and API grants
-- =============================================================================

DO $rls$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'classes', 'students', 'attendance_logs', 'exits', 'violations',
    'notifications', 'settings', 'daily_summaries', 'audit_logs', 'rate_limits',
    'auth_audit_logs', 'client_error_logs', 'activity_logs', 'emergency_logs',
    'sync_tombstones', 'dismissal_records', 'dismissal_calls',
    'dismissal_schedules', 'guardian_excuses'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "hader_app_compat_access" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "hader_app_compat_access" ON public.%I '
      'FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE)',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO anon, authenticated',
      table_name
    );
  END LOOP;
END
$rls$;

ALTER TABLE public.guardian_login_security ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "guardian_login_security_select_all" ON public.guardian_login_security;
DROP POLICY IF EXISTS "guardian_login_security_upsert_all" ON public.guardian_login_security;
DROP POLICY IF EXISTS "guardian_login_security_update_all" ON public.guardian_login_security;
DROP POLICY IF EXISTS "hader_app_compat_access" ON public.guardian_login_security;
REVOKE ALL ON TABLE public.guardian_login_security FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.verify_user_password(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_students(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_user_password(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_students(TEXT, TEXT, TEXT, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_local_date() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_local_time() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_statistics(TEXT, TEXT, DATE, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_daily_summary() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_absent_students() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_telemetry_logs(INTEGER) TO anon, authenticated;
GRANT SELECT ON public.exit_permissions TO anon, authenticated;

-- =============================================================================
-- 8. Storage buckets and policies
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', TRUE),
  ('badges', 'badges', TRUE),
  ('whatsapp-media', 'whatsapp-media', TRUE)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

INSERT INTO storage.buckets (
  id, name, public, avif_autodetection, file_size_limit, allowed_mime_types
)
VALUES (
  'guardian-excuses',
  'guardian-excuses',
  TRUE,
  FALSE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "hader_public_media_read" ON storage.objects;
CREATE POLICY "hader_public_media_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id IN ('avatars', 'badges', 'whatsapp-media', 'guardian-excuses'));

DROP POLICY IF EXISTS "hader_public_media_insert" ON storage.objects;
CREATE POLICY "hader_public_media_insert"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (bucket_id IN ('avatars', 'badges', 'whatsapp-media', 'guardian-excuses'));

DROP POLICY IF EXISTS "hader_authenticated_media_update" ON storage.objects;
CREATE POLICY "hader_authenticated_media_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('avatars', 'badges', 'whatsapp-media', 'guardian-excuses'))
  WITH CHECK (bucket_id IN ('avatars', 'badges', 'whatsapp-media', 'guardian-excuses'));

DROP POLICY IF EXISTS "hader_authenticated_media_delete" ON storage.objects;
CREATE POLICY "hader_authenticated_media_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('avatars', 'badges', 'whatsapp-media', 'guardian-excuses'));

-- =============================================================================
-- 9. Supabase Realtime publication
-- =============================================================================

DO $realtime$
DECLARE
  table_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'attendance_logs', 'dismissal_calls', 'notifications', 'settings',
    'students', 'classes', 'exits', 'violations', 'dismissal_records',
    'dismissal_schedules', 'guardian_excuses', 'sync_tombstones'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.users;
  END IF;
END
$realtime$;

COMMENT ON TABLE public.sync_tombstones IS
  'Durable delete markers used by offline devices to remove remotely deleted records.';
COMMENT ON TABLE public.guardian_excuses IS
  'Guardian-submitted absence excuses with attachment metadata and review state.';
COMMENT ON COLUMN public.attendance_logs.recorded_by_label IS
  'Recorder label used when no public.users UUID is available.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- 10. Verification — review these result sets after Run succeeds
-- =============================================================================

WITH required_tables(table_name) AS (
  VALUES
    ('users'), ('classes'), ('students'), ('attendance_logs'), ('exits'),
    ('violations'), ('notifications'), ('settings'), ('daily_summaries'),
    ('audit_logs'), ('rate_limits'), ('auth_audit_logs'),
    ('client_error_logs'), ('activity_logs'), ('emergency_logs'),
    ('guardian_login_security'), ('sync_tombstones'), ('dismissal_records'),
    ('dismissal_calls'), ('dismissal_schedules'), ('guardian_excuses'),
    ('exit_permissions')
)
SELECT
  'required_tables' AS check_name,
  COUNT(*) FILTER (WHERE to_regclass('public.' || table_name) IS NOT NULL) AS found,
  COUNT(*) AS expected,
  COALESCE(
    STRING_AGG(table_name, ', ' ORDER BY table_name)
      FILTER (WHERE to_regclass('public.' || table_name) IS NULL),
    'none'
  ) AS missing
FROM required_tables;

SELECT
  'attendance_duplicates' AS check_name,
  COUNT(*) AS duplicate_groups
FROM (
  SELECT student_id, date
  FROM public.attendance_logs
  GROUP BY student_id, date
  HAVING COUNT(*) > 1
) duplicates;

SELECT
  'required_functions' AS check_name,
  COUNT(*) FILTER (WHERE function_oid IS NOT NULL) AS found,
  COUNT(*) AS expected,
  COALESCE(
    STRING_AGG(signature, ', ' ORDER BY signature) FILTER (WHERE function_oid IS NULL),
    'none'
  ) AS missing
FROM (
  SELECT signature, to_regprocedure(signature) AS function_oid
  FROM (VALUES
    ('public.get_local_date()'),
    ('public.get_local_time()'),
    ('public.verify_user_password(text,text)'),
    ('public.search_students(text,text,text,integer)'),
    ('public.generate_daily_summary()'),
    ('public.get_class_statistics(text,text,date,date)'),
    ('public.notify_absent_students()'),
    ('public.cleanup_telemetry_logs(integer)')
  ) required_functions(signature)
) function_status;

WITH required_indexes(index_name) AS (
  VALUES
    ('attendance_logs_student_id_date_unique_idx'),
    ('idx_students_class_section'),
    ('idx_attendance_date_status'),
    ('idx_exits_student_date'),
    ('idx_violations_student_date'),
    ('idx_notifications_audience_created'),
    ('idx_dismissal_calls_status'),
    ('idx_guardian_excuses_status_created'),
    ('idx_sync_tombstones_table_record')
)
SELECT
  'required_indexes' AS check_name,
  COUNT(*) FILTER (WHERE to_regclass('public.' || index_name) IS NOT NULL) AS found,
  COUNT(*) AS expected,
  COALESCE(
    STRING_AGG(index_name, ', ' ORDER BY index_name)
      FILTER (WHERE to_regclass('public.' || index_name) IS NULL),
    'none'
  ) AS missing
FROM required_indexes;

WITH required_rls(table_name) AS (
  VALUES
    ('users'), ('classes'), ('students'), ('attendance_logs'), ('exits'),
    ('violations'), ('notifications'), ('settings'), ('daily_summaries'),
    ('audit_logs'), ('rate_limits'), ('auth_audit_logs'),
    ('client_error_logs'), ('activity_logs'), ('emergency_logs'),
    ('guardian_login_security'), ('sync_tombstones'), ('dismissal_records'),
    ('dismissal_calls'), ('dismissal_schedules'), ('guardian_excuses')
)
SELECT
  'rls_enabled' AS check_name,
  COUNT(*) FILTER (WHERE c.relrowsecurity) AS enabled,
  COUNT(*) AS expected,
  COALESCE(
    STRING_AGG(r.table_name, ', ' ORDER BY r.table_name)
      FILTER (WHERE NOT COALESCE(c.relrowsecurity, FALSE)),
    'none'
  ) AS missing
FROM required_rls r
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || r.table_name);

SELECT
  'application_rls_policies' AS check_name,
  COUNT(*) FILTER (WHERE policyname = 'hader_app_compat_access') AS found,
  20 AS expected,
  COUNT(*) FILTER (WHERE tablename = 'guardian_login_security') AS guardian_security_policy_count
FROM pg_policies
WHERE schemaname = 'public';

WITH required_triggers(table_name, trigger_name) AS (
  VALUES
    ('users', 'trigger_update_timestamp'),
    ('classes', 'trigger_update_timestamp'),
    ('students', 'trigger_update_timestamp'),
    ('attendance_logs', 'trigger_update_timestamp'),
    ('attendance_logs', 'trigger_late_notification'),
    ('exits', 'trigger_update_timestamp'),
    ('exits', 'trigger_exit_notification'),
    ('violations', 'trigger_update_timestamp'),
    ('violations', 'trigger_violation_notification'),
    ('settings', 'trigger_update_timestamp'),
    ('daily_summaries', 'trigger_update_timestamp'),
    ('dismissal_records', 'trigger_update_timestamp'),
    ('dismissal_calls', 'trigger_update_timestamp'),
    ('dismissal_schedules', 'trigger_update_timestamp'),
    ('guardian_excuses', 'trigger_update_timestamp')
), trigger_status AS (
  SELECT
    r.*,
    EXISTS (
      SELECT 1
      FROM pg_trigger t
      WHERE t.tgrelid = to_regclass('public.' || r.table_name)
        AND t.tgname = r.trigger_name
        AND NOT t.tgisinternal
    ) AS found
  FROM required_triggers r
)
SELECT
  'required_triggers' AS check_name,
  COUNT(*) FILTER (WHERE found) AS found,
  COUNT(*) AS expected,
  COALESCE(
    STRING_AGG(table_name || '.' || trigger_name, ', ' ORDER BY table_name, trigger_name)
      FILTER (WHERE NOT found),
    'none'
  ) AS missing
FROM trigger_status;

SELECT
  'storage_buckets' AS check_name,
  COUNT(*) FILTER (WHERE id IN ('avatars', 'badges', 'whatsapp-media', 'guardian-excuses')) AS found,
  4 AS expected
FROM storage.buckets;

SELECT
  'storage_policies' AS check_name,
  COUNT(*) FILTER (WHERE policyname IN (
    'hader_public_media_read',
    'hader_public_media_insert',
    'hader_authenticated_media_update',
    'hader_authenticated_media_delete'
  )) AS found,
  4 AS expected
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects';

SELECT
  'key_api_privileges' AS check_name,
  has_table_privilege('anon', 'public.attendance_logs', 'INSERT') AS anon_attendance_insert,
  has_table_privilege('anon', 'public.exit_permissions', 'SELECT') AS anon_exit_export_select,
  NOT has_table_privilege('anon', 'public.guardian_login_security', 'SELECT')
    AS guardian_security_hidden_from_anon;

WITH required_realtime(table_name) AS (
  VALUES
    ('attendance_logs'), ('dismissal_calls'), ('notifications'), ('settings'),
    ('students'), ('classes'), ('exits'), ('violations'), ('dismissal_records'),
    ('dismissal_schedules'), ('guardian_excuses'), ('sync_tombstones')
), realtime_status AS (
  SELECT
    r.table_name,
    EXISTS (
      SELECT 1
      FROM pg_publication_tables p
      WHERE p.pubname = 'supabase_realtime'
        AND p.schemaname = 'public'
        AND p.tablename = r.table_name
    ) AS published
  FROM required_realtime r
)
SELECT
  'required_realtime_tables' AS check_name,
  COUNT(*) FILTER (WHERE published) AS found,
  COUNT(*) AS expected,
  COALESCE(
    STRING_AGG(table_name, ', ' ORDER BY table_name) FILTER (WHERE NOT published),
    'none'
  ) AS missing,
  NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'users'
  ) AS users_excluded
FROM realtime_status;

SELECT
  'hader_bootstrap_complete' AS status,
  public.get_local_date() AS riyadh_date,
  NOW() AS completed_at;
