-- =============================================================================
-- نظام حاضر (Hader) - Supabase Complete Schema
-- =============================================================================
-- This script initializes the database structure for the Hader system on Supabase.
-- It covers core entities, dismissal tracking, system logging, and security.
-- All operations are idempotent (using IF NOT EXISTS and DROP POLICY IF EXISTS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensions & Core Setup
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 2. Core Tables
-- -----------------------------------------------------------------------------

-- Roles type (optional, but good for reference)
-- Role names matches the Role enum in TypeScript
-- ['site_admin', 'school_admin', 'sub_admin', 'teacher', 'supervisor', 'guard_dispatcher']

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    is_active BOOLEAN DEFAULT true,
    email TEXT,
    phone TEXT,
    assigned_classes JSONB DEFAULT '[]'::jsonb, -- Store [{class_name: string, sections: string[]}]
    assigned_sections TEXT[] DEFAULT '{}',
    can_use_whatsapp BOOLEAN DEFAULT false,
    password_hash_version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Classes Table
CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    sections TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Students Table
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY, -- Using school-specific student ID as primary key
    name TEXT NOT NULL,
    class_name TEXT NOT NULL, -- Logical link to classes.name
    section TEXT NOT NULL,
    guardian_name TEXT,
    guardian_phone TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Attendance Logs Table
CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'present', 'late', 'absent'
    date DATE NOT NULL,
    time TIME NOT NULL,
    status TEXT NOT NULL, -- redundant but used for consistency (e.g., 'recorded')
    method TEXT DEFAULT 'manual', -- 'scan', 'manual', 'bulk'
    recorded_by UUID REFERENCES users(id),
    recorded_by_label TEXT, -- Name of the librarian/guard who took the attendance
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Early Exits Table
CREATE TABLE IF NOT EXISTS exits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    authorized_by TEXT, -- Name or ID of authorizer
    date DATE NOT NULL,
    time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Behavioral Violations Table
CREATE TABLE IF NOT EXISTS violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    description TEXT,
    severity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high'
    date DATE NOT NULL,
    time TIME NOT NULL,
    recorded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Dismissal System (Guard Dispatcher Station)
-- -----------------------------------------------------------------------------

-- Dismissal Records (Actual departures)
CREATE TABLE IF NOT EXISTS dismissal_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    guardian_id TEXT, -- Optional unique ID for the person picking up
    guardian_name TEXT,
    guardian_phone TEXT,
    method TEXT DEFAULT 'id_card', -- 'id_card', 'qr', 'manual', 'phone_call'
    status TEXT DEFAULT 'pending', -- 'pending', 'called', 'dismissed', 'cancelled'
    call_time TIMESTAMPTZ,
    dismissal_time TIMESTAMPTZ,
    exit_time TIMESTAMPTZ DEFAULT now(),
    date TEXT DEFAULT to_char(now(), 'YYYY-MM-DD'),
    picked_up_by TEXT,
    recorded_by TEXT,
    recorded_by_label TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dismissal_records_exit_time ON dismissal_records(exit_time);

-- Dismissal Calls (Real-time requests for student pickup)
CREATE TABLE IF NOT EXISTS dismissal_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
    student_name TEXT,
    class_name TEXT,
    section TEXT,
    request_time TIMESTAMPTZ DEFAULT now(),
    called_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending', -- 'pending', 'calling', 'completed', 'failed'
    priority INTEGER DEFAULT 1,
    lane TEXT, -- Optional pickup lane for organization
    requested_by TEXT,
    requested_by_name TEXT,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dismissal_calls_request_time ON dismissal_calls(request_time);

-- Dismissal Schedules (Recurring or planned departure times)
CREATE TABLE IF NOT EXISTS dismissal_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL, -- e.g., 'Standard Sunday'
    class_names TEXT[] DEFAULT '{}', -- Affected classes
    dismissal_time TIME NOT NULL,
    day_of_week INTEGER[], -- 0-6 (Sunday-Saturday)
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 4. Communication & Notifications
-- -----------------------------------------------------------------------------

-- Notifications Table (Global broadcasts)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'announcement', -- 'announcement', 'emergency', 'task'
    target_audience TEXT DEFAULT 'all', -- 'all', 'teacher', 'guardian', 'admin'
    is_read BOOLEAN DEFAULT false,
    is_popup BOOLEAN DEFAULT false,
    priority TEXT DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 5. System Configuration & Logging
-- -----------------------------------------------------------------------------

-- System Settings Table (Single-row robust configuration)
CREATE TABLE IF NOT EXISTS settings (
    id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    system_ready BOOLEAN DEFAULT true,
    school_active BOOLEAN DEFAULT true,
    school_name TEXT,
    principal_name TEXT,
    logo_url TEXT,
    dark_mode BOOLEAN DEFAULT true,
    theme TEXT DEFAULT 'default',
    kiosk_settings JSONB DEFAULT '{}'::jsonb,
    security_settings JSONB DEFAULT '{}'::jsonb,
    attendance_settings JSONB DEFAULT '{}'::jsonb,
    social_links JSONB DEFAULT '{}'::jsonb,
    notification_templates JSONB DEFAULT '{}'::jsonb,
    whatsapp_templates JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Audit Logs (Database-level change monitoring)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Activity Logs (High-level operational UI actions)
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    user_name TEXT,
    action TEXT NOT NULL, -- e.g., 'EXPORT_REPORT', 'LOGIN', 'IMPORT_STUDENTS'
    description TEXT,
    target_id TEXT,
    target_name TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Authentication Audit Logs (Security focused)
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID, -- Might be null if login fails
    username TEXT,
    action TEXT NOT NULL, -- 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT'
    status TEXT NOT NULL, -- 'success', 'failure'
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Client-Side Error Logs (Persistence of front-end crashes)
CREATE TABLE IF NOT EXISTS client_error_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message TEXT NOT NULL,
    stack TEXT,
    component TEXT,
    url TEXT,
    user_id UUID,
    device_info JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Emergency Logs (Crisis management events)
CREATE TABLE IF NOT EXISTS emergency_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- 'lockdown', 'evacuation', 'fire'
    message TEXT,
    status TEXT DEFAULT 'active', -- 'active', 'resolved'
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id)
);

-- Rate Limiting Table
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT UNIQUE NOT NULL, -- e.g., 'login:ip_address'
    count INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Daily Summaries (Aggregated stats for performance)
CREATE TABLE IF NOT EXISTS daily_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE UNIQUE NOT NULL,
    present_count INTEGER DEFAULT 0,
    late_count INTEGER DEFAULT 0,
    absent_count INTEGER DEFAULT 0,
    total_students INTEGER DEFAULT 0,
    attendance_rate DECIMAL(5,2) DEFAULT 0.00,
    metadata JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 6. Row Level Security (RLS) Policies
-- -----------------------------------------------------------------------------

-- Enable RLS for all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;

-- General Policy: Enable Read Access for everyone (Required for kiosk and offline sync)
-- Use DO blocks to safely handle Policy creation (idempotent)
DO $$
BEGIN
    -- users
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read for all' AND tablename = 'users') THEN
        CREATE POLICY "Enable read for all" ON users FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all for authenticated users' AND tablename = 'users') THEN
        CREATE POLICY "Enable all for authenticated users" ON users FOR ALL TO authenticated USING (true);
    END IF;

    -- classes
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read for all' AND tablename = 'classes') THEN
        CREATE POLICY "Enable read for all" ON classes FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all for authenticated users' AND tablename = 'classes') THEN
        CREATE POLICY "Enable all for authenticated users" ON classes FOR ALL TO authenticated USING (true);
    END IF;

    -- students
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read for all' AND tablename = 'students') THEN
        CREATE POLICY "Enable read for all" ON students FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all for authenticated users' AND tablename = 'students') THEN
        CREATE POLICY "Enable all for authenticated users" ON students FOR ALL TO authenticated USING (true);
    END IF;

    -- attendance_logs
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read for all' AND tablename = 'attendance_logs') THEN
        CREATE POLICY "Enable read for all" ON attendance_logs FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable insert/update for all' AND tablename = 'attendance_logs') THEN
        -- Allow insert for all to support kiosks and guest markers
        CREATE POLICY "Enable insert/update for all" ON attendance_logs FOR ALL USING (true);
    END IF;

    -- notifications
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read for all' AND tablename = 'notifications') THEN
        CREATE POLICY "Enable read for all" ON notifications FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all for authenticated users' AND tablename = 'notifications') THEN
        CREATE POLICY "Enable all for authenticated users" ON notifications FOR ALL TO authenticated USING (true);
    END IF;

    -- settings
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read for all' AND tablename = 'settings') THEN
        CREATE POLICY "Enable read for all" ON settings FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all for authenticated users' AND tablename = 'settings') THEN
        CREATE POLICY "Enable all for authenticated users" ON settings FOR ALL TO authenticated USING (true);
    END IF;

    -- logs (strictly authenticated or internal)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated audit write' AND tablename = 'audit_logs') THEN
        CREATE POLICY "Authenticated audit write" ON audit_logs FOR ALL TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated activity write' AND tablename = 'activity_logs') THEN
        CREATE POLICY "Authenticated activity write" ON activity_logs FOR ALL TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public auth_audit insert' AND tablename = 'auth_audit_logs') THEN
        CREATE POLICY "Public auth_audit insert" ON auth_audit_logs FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public client_error insert' AND tablename = 'client_error_logs') THEN
        CREATE POLICY "Public client_error insert" ON client_error_logs FOR INSERT WITH CHECK (true);
    END IF;

    -- dismissal system (High interaction)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all for dismissal_records' AND tablename = 'dismissal_records') THEN
        CREATE POLICY "Enable all for dismissal_records" ON dismissal_records FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable all for dismissal_calls' AND tablename = 'dismissal_calls') THEN
        CREATE POLICY "Enable all for dismissal_calls" ON dismissal_calls FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Enable read for schedules' AND tablename = 'dismissal_schedules') THEN
        CREATE POLICY "Enable read for schedules" ON dismissal_schedules FOR SELECT USING (true);
    END IF;

END $$;

-- -----------------------------------------------------------------------------
-- 7. Functions & RPCs
-- -----------------------------------------------------------------------------

-- Secure Password Verification (RPC)
DROP FUNCTION IF EXISTS verify_user_password(TEXT, TEXT);
CREATE OR REPLACE FUNCTION verify_user_password(
  target_username TEXT,
  target_password TEXT
)
RETURNS TABLE (
  is_valid BOOLEAN,
  user_data JSON
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (u.password = crypt(target_password, u.password)) as is_valid,
    row_to_json(u.*) as user_data
  FROM users u
  WHERE u.username = target_username AND u.is_active = true;
END;
$$;

-- Telemetry Cleanup (Maintenance)
-- Removes logs older than 30 days
DROP FUNCTION IF EXISTS cleanup_telemetry_logs();
CREATE OR REPLACE FUNCTION cleanup_telemetry_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth_audit_logs WHERE created_at < NOW() - INTERVAL '30 days';
  DELETE FROM client_error_logs WHERE created_at < NOW() - INTERVAL '30 days';
  DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days'; -- Keep audit longer
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Storage Buckets configuration
-- -----------------------------------------------------------------------------

-- Use Supabase storage.buckets table
-- Note: This requires running within the database that has the storage schema.
-- In Supabase dashboard, it's safe to run these.
DO $$
BEGIN
    INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
    INSERT INTO storage.buckets (id, name, public) VALUES ('badges', 'badges', true) ON CONFLICT (id) DO NOTHING;
    INSERT INTO storage.buckets (id, name, public) VALUES ('whatsapp-media', 'whatsapp-media', true) ON CONFLICT (id) DO NOTHING;
    INSERT INTO storage.buckets (id, name, public) VALUES ('guardian-excuses', 'guardian-excuses', false) ON CONFLICT (id) DO NOTHING;
END $$;

-- Policies for public access to storage (Replace with restricted policies as needed)
-- NOTE: Policies on storage.objects usually require 'policy' extension or manual dashboard setup
-- but we include templates here.

-- -----------------------------------------------------------------------------
-- 9. Seed Data (Initial Configuration)
-- -----------------------------------------------------------------------------

-- Create initial admin users
-- Password for admin: admin123
-- Password for adminHim: himArt123
INSERT INTO users (username, password, name, role) 
VALUES (
    'admin', 
    crypt('admin123', gen_salt('bf')), 
    'مدير النظام', 
    'site_admin'
) ON CONFLICT (username) DO NOTHING;

INSERT INTO users (username, password, name, role) 
VALUES (
    'adminHim', 
    crypt('himArt123', gen_salt('bf')), 
    'أستاذ حاضر', 
    'site_admin'
) ON CONFLICT (username) DO NOTHING;

-- Initialize settings row
INSERT INTO settings (id, school_name) 
VALUES (
    '00000000-0000-0000-0000-000000000000', 
    'مدرسة حاضر الذكية'
) ON CONFLICT (id) DO NOTHING;
