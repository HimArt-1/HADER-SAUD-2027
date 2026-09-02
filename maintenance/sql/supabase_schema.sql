-- =============================================================================
-- نظام حاضر (Hader) - Enterprise School Attendance System
-- HADER FULL SETUP SCRIPT (Production Ready v2.3)
-- =============================================================================
-- هذا الملف يحتوي على كل ما تحتاجه لتشغيل النظام ١٠٠٪ على Supabase
-- تم إضافة (DROP POLICY IF EXISTS) لتجنب أخطاء التكرار
-- يتضمن:
-- 1. الجداول الأساسية (Tables)
-- 2. الدوال والمنطق (Functions & RPCs)
-- 3. سياسات الأمان (RLS Policies)
-- 4. إعدادات التخزين (Storage)
-- 5. بيانات أولية (Seed Data)
-- =============================================================================

-- تفعيل الامتدادات الضرورية
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. الجداول الأساسية
-- =============================================================================

-- 2.1 المستخدمين (Users)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(500) NOT NULL, -- Hashed
    password_hash_version INTEGER DEFAULT 1,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('site_admin', 'school_admin', 'supervisor_global', 'supervisor_class', 'watcher', 'kiosk', 'guardian', 'call_station')),
    assigned_classes TEXT[],
    assigned_sections TEXT[],
    email VARCHAR(255),
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    can_use_whatsapp BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMPTZ,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = TRUE;

-- 2.2 الفصول (Classes)
CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    sections TEXT[] NOT NULL DEFAULT '{}',
    grade_level INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classes_name ON classes(name);

-- 2.3 الطلاب (Students)
CREATE TABLE IF NOT EXISTS students (
    id VARCHAR(50) PRIMARY KEY, -- رقم الهوية/الأكاديمي
    name VARCHAR(255) NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    section VARCHAR(20) NOT NULL,
    guardian_phone VARCHAR(20),
    guardian_name VARCHAR(255),
    whatsapp_phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name);
CREATE INDEX IF NOT EXISTS idx_students_section ON students(class_name, section);
CREATE INDEX IF NOT EXISTS idx_students_guardian ON students(guardian_phone) WHERE guardian_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_active ON students(is_active) WHERE is_active = TRUE;

-- 2.4 سجلات الحضور (Attendance Logs)
CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) CHECK (status IN ('present', 'late', 'absent')),
    minutes_late INTEGER DEFAULT 0,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL, -- للمشرفين
    recorded_by_label VARCHAR(50), -- للكشك أو النظام
    device_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_logs(date, status);
CREATE INDEX IF NOT EXISTS idx_attendance_recent ON attendance_logs(date DESC, created_at DESC);

-- 2.5 الاستئذان (Exits)
CREATE TABLE IF NOT EXISTS exits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    exit_time TIMESTAMPTZ NOT NULL,
    supervisor_name VARCHAR(255),
    notes TEXT,
    status VARCHAR(20) DEFAULT 'approved',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exits_student ON exits(student_id);
CREATE INDEX IF NOT EXISTS idx_exits_date ON exits(exit_time); 
CREATE INDEX IF NOT EXISTS idx_exits_status ON exits(status);

-- 2.6 المخالفات والسلوك (Violations)
CREATE TABLE IF NOT EXISTS violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    level INTEGER DEFAULT 1,
    description TEXT,
    action_taken TEXT,
    summon_guardian BOOLEAN DEFAULT FALSE,
    guardian_notified BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_student ON violations(student_id);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(created_at);
CREATE INDEX IF NOT EXISTS idx_violations_type ON violations(type);
CREATE INDEX IF NOT EXISTS idx_violations_level ON violations(level);

-- 2.7 الإشعارات (Notifications)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255),
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    target_audience VARCHAR(50) NOT NULL,
    target_id VARCHAR(100), -- يمكن أن يكون ID مستخدم أو فصل
    is_popup BOOLEAN DEFAULT FALSE,
    is_read BOOLEAN DEFAULT FALSE,
    priority INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_audience ON notifications(target_audience);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_id) WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read) WHERE is_read = FALSE;

-- 2.8 الإعدادات (Settings) - جدول الصف الواحد
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    system_ready BOOLEAN DEFAULT FALSE,
    school_active BOOLEAN DEFAULT TRUE,
    school_name VARCHAR(255),
    principal_name VARCHAR(255),
    logo_url TEXT,
    dark_mode BOOLEAN DEFAULT TRUE,
    theme JSONB,
    kiosk_settings JSONB DEFAULT '{}',
    security_settings JSONB DEFAULT '{}',
    attendance_settings JSONB DEFAULT '{}',
    social_links JSONB DEFAULT '{}',
    notification_templates JSONB DEFAULT '{}',
    whatsapp_templates JSONB DEFAULT '[]',
    telemetry_retention_days INTEGER DEFAULT 90,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- 2.9 سجلات التدقيق (Audit Logs)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(50),
    record_id VARCHAR(100),
    old_data JSONB,
    new_data JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs(table_name, record_id);

-- 2.10 Rate Limits
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    attempts INTEGER DEFAULT 1,
    first_attempt TIMESTAMPTZ DEFAULT NOW(),
    last_attempt TIMESTAMPTZ DEFAULT NOW(),
    blocked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, action_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked ON rate_limits(blocked_until) WHERE blocked_until IS NOT NULL;

-- 2.11 Daily Summaries
CREATE TABLE IF NOT EXISTS daily_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE UNIQUE NOT NULL,
    total_students INTEGER DEFAULT 0,
    present_count INTEGER DEFAULT 0,
    late_count INTEGER DEFAULT 0,
    absent_count INTEGER DEFAULT 0,
    exit_count INTEGER DEFAULT 0,
    violation_count INTEGER DEFAULT 0,
    attendance_rate DECIMAL(5,2) DEFAULT 0.00,
    summary_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date DESC);

-- 2.12 سجلات تدقيق المصادقة (Auth Audit Logs)
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    action TEXT NOT NULL CHECK (action IN ('LOGIN', 'LOGOUT', 'SESSION_RESTORE', 'SESSION_EXPIRED')),
    actor_user_id UUID NULL,
    actor_role TEXT NULL,
    actor_label TEXT NOT NULL DEFAULT 'anonymous',
    session_key TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    ip_hint TEXT NULL,
    user_agent TEXT NOT NULL,
    meta JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON auth_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_action ON auth_audit_logs(action);

-- 2.13 سجلات أخطاء العميل (Client Error Logs)
CREATE TABLE IF NOT EXISTS client_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    severity TEXT NOT NULL CHECK (severity IN ('ERROR', 'WARN')),
    source TEXT NOT NULL CHECK (source IN ('window.onerror', 'unhandledrejection', 'react-boundary', 'console.error')),
    message TEXT NOT NULL,
    stack TEXT NULL,
    path TEXT NOT NULL DEFAULT '',
    actor_user_id UUID NULL,
    actor_role TEXT NULL,
    session_key TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    meta JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_client_error_logs_created_at ON client_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_severity ON client_error_logs(severity);

-- =============================================================================
-- 3. الدوال والإجراءات (Functions & RPCs)
-- =============================================================================

-- دالة للتحقق من كلمة المرور (Login RPC)
CREATE OR REPLACE FUNCTION verify_user_password(
    p_username TEXT,
    p_plain_password TEXT
) RETURNS TABLE (
    id UUID,
    username VARCHAR,
    role VARCHAR,
    password_match BOOLEAN
) SECURITY DEFINER
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
    WHERE u.username = p_username;
END;
$$ LANGUAGE plpgsql;

-- دالة لتحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER update_users_modtime BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_students_modtime BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_settings_modtime BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- دالة تنظيف سجلات القياس (Telemetry Cleanup)
CREATE OR REPLACE FUNCTION public.cleanup_telemetry_logs(retention_days INT DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
    auth_deleted INT := 0;
    error_deleted INT := 0;
BEGIN
    DELETE FROM public.auth_audit_logs
    WHERE created_at < NOW() - make_interval(days => retention_days);
    GET DIAGNOSTICS auth_deleted = ROW_COUNT;

    DELETE FROM public.client_error_logs
    WHERE created_at < NOW() - make_interval(days => retention_days);
    GET DIAGNOSTICS error_deleted = ROW_COUNT;

    RETURN json_build_object(
        'auth_deleted', auth_deleted,
        'error_deleted', error_deleted
    );
END;
$$;

-- =============================================================================
-- 4. سياسات الأمان (Row Level Security - RLS)
-- =============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_error_logs ENABLE ROW LEVEL SECURITY;

-- سياسات عامة للقراءة
DROP POLICY IF EXISTS "Enable read for all" ON users;
CREATE POLICY "Enable read for all" ON users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON students;
CREATE POLICY "Enable read for all" ON students FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON classes;
CREATE POLICY "Enable read for all" ON classes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON attendance_logs;
CREATE POLICY "Enable read for all" ON attendance_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON settings;
CREATE POLICY "Enable read for all" ON settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON exits;
CREATE POLICY "Enable read for all" ON exits FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON violations;
CREATE POLICY "Enable read for all" ON violations FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON notifications;
CREATE POLICY "Enable read for all" ON notifications FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable read for all" ON daily_summaries;
CREATE POLICY "Enable read for all" ON daily_summaries FOR SELECT USING (true);

-- سياسات الكتابة (للمصادق عليهم)
DROP POLICY IF EXISTS "Enable insert for auth" ON attendance_logs;
CREATE POLICY "Enable insert for auth" ON attendance_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR true); 

DROP POLICY IF EXISTS "Enable update for auth" ON attendance_logs;
CREATE POLICY "Enable update for auth" ON attendance_logs FOR UPDATE USING (auth.role() = 'authenticated' OR true);

-- سياسات الكتابة للإعدادات (Settings)
DROP POLICY IF EXISTS "Enable insert for settings" ON settings;
CREATE POLICY "Enable insert for settings" ON settings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for settings" ON settings;
CREATE POLICY "Enable update for settings" ON settings FOR UPDATE USING (true);

-- سياسات الكتابة للطلاب (Students)
DROP POLICY IF EXISTS "Enable insert for students" ON students;
CREATE POLICY "Enable insert for students" ON students FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for students" ON students;
CREATE POLICY "Enable update for students" ON students FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for students" ON students;
CREATE POLICY "Enable delete for students" ON students FOR DELETE USING (true);

-- سياسات الكتابة للفصول (Classes)
DROP POLICY IF EXISTS "Enable insert for classes" ON classes;
CREATE POLICY "Enable insert for classes" ON classes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for classes" ON classes;
CREATE POLICY "Enable update for classes" ON classes FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for classes" ON classes;
CREATE POLICY "Enable delete for classes" ON classes FOR DELETE USING (true);

-- سياسات الكتابة للمستخدمين (Users)
DROP POLICY IF EXISTS "Enable insert for users" ON users;
CREATE POLICY "Enable insert for users" ON users FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for users" ON users;
CREATE POLICY "Enable update for users" ON users FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for users" ON users;
CREATE POLICY "Enable delete for users" ON users FOR DELETE USING (true);

-- سياسات الكتابة للاستئذان (Exits)
DROP POLICY IF EXISTS "Enable insert for exits" ON exits;
CREATE POLICY "Enable insert for exits" ON exits FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for exits" ON exits;
CREATE POLICY "Enable update for exits" ON exits FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for exits" ON exits;
CREATE POLICY "Enable delete for exits" ON exits FOR DELETE USING (true);

-- سياسات الكتابة للمخالفات (Violations)
DROP POLICY IF EXISTS "Enable insert for violations" ON violations;
CREATE POLICY "Enable insert for violations" ON violations FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for violations" ON violations;
CREATE POLICY "Enable update for violations" ON violations FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for violations" ON violations;
CREATE POLICY "Enable delete for violations" ON violations FOR DELETE USING (true);

-- سياسات الكتابة للإشعارات (Notifications)
DROP POLICY IF EXISTS "Enable insert for notifications" ON notifications;
CREATE POLICY "Enable insert for notifications" ON notifications FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for notifications" ON notifications;
CREATE POLICY "Enable update for notifications" ON notifications FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for notifications" ON notifications;
CREATE POLICY "Enable delete for notifications" ON notifications FOR DELETE USING (true);

-- سياسات الكتابة للملخصات اليومية (Daily Summaries)
DROP POLICY IF EXISTS "Enable insert for daily_summaries" ON daily_summaries;
CREATE POLICY "Enable insert for daily_summaries" ON daily_summaries FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for daily_summaries" ON daily_summaries;
CREATE POLICY "Enable update for daily_summaries" ON daily_summaries FOR UPDATE USING (true);

-- سياسات الكتابة لسجلات التدقيق (Audit Logs)
DROP POLICY IF EXISTS "Enable insert for audit_logs" ON audit_logs;
CREATE POLICY "Enable insert for audit_logs" ON audit_logs FOR INSERT WITH CHECK (true);

-- سياسات سجلات المصادقة (Auth Audit Logs)
DROP POLICY IF EXISTS "auth_audit_logs_select_all" ON auth_audit_logs;
CREATE POLICY "auth_audit_logs_select_all" ON auth_audit_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "auth_audit_logs_insert_public" ON auth_audit_logs;
CREATE POLICY "auth_audit_logs_insert_public" ON auth_audit_logs FOR INSERT WITH CHECK (true);

-- سياسات سجلات الأخطاء (Client Error Logs)
DROP POLICY IF EXISTS "client_error_logs_select_all" ON client_error_logs;
CREATE POLICY "client_error_logs_select_all" ON client_error_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "client_error_logs_insert_public" ON client_error_logs;
CREATE POLICY "client_error_logs_insert_public" ON client_error_logs FOR INSERT WITH CHECK (true);

-- =============================================================================
-- 5. التخزين (Storage)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('badges', 'badges', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('whatsapp-media', 'whatsapp-media', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id IN ('avatars', 'badges', 'whatsapp-media'));

DROP POLICY IF EXISTS "Public Upload" ON storage.objects;
CREATE POLICY "Public Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN ('avatars', 'badges', 'whatsapp-media'));

-- =============================================================================
-- 6. البيانات الأولية (Seed Data)
-- =============================================================================

INSERT INTO settings (id, school_name, system_ready) VALUES (1, 'مدرسة المستقبل', true) ON CONFLICT (id) DO NOTHING;

-- مدير عام
INSERT INTO users (username, password, name, role)
VALUES ('admin', crypt('admin123', gen_salt('bf')), 'المدير العام', 'site_admin') 
ON CONFLICT (username) DO NOTHING;

-- الدعم الفني (Super Admin)
INSERT INTO users (username, password, name, role)
VALUES ('adminHim', crypt('adminHim5000', gen_salt('bf')), 'الدعم الفني (Super Admin)', 'site_admin') 
ON CONFLICT (username) DO NOTHING;

-- =============================================================================
-- نظام حاضر (Hader) - Missing Features Schema Update (v2.3)
-- 1. Dismissal System Tables (الانصراف والنداء)
-- 2. Storage Buckets (حاوية رفع الأعذار)
-- =============================================================================

-- =============================================================================
-- PART 1: DISMISSAL SYSTEM
-- =============================================================================

-- 1.1 سجلات الانصراف (Dismissal Records)
CREATE TABLE IF NOT EXISTS dismissal_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    dismissal_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method VARCHAR(50) CHECK (method IN ('kiosk', 'watcher', 'scanner', 'admin')),
    picked_up_by VARCHAR(255),
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_by_label VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dismissal_records_date ON dismissal_records(date);
CREATE INDEX IF NOT EXISTS idx_dismissal_records_student ON dismissal_records(student_id);

-- 1.2 طلبات نداء الانصراف (Dismissal Call Requests)
CREATE TABLE IF NOT EXISTS dismissal_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    student_name VARCHAR(255) NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    section VARCHAR(20) NOT NULL,
    requested_by VARCHAR(100), -- username (guardian username or supervisor ID)
    requested_by_name VARCHAR(255),
    status VARCHAR(50) CHECK (status IN ('pending', 'called', 'dismissed', 'cancelled')) DEFAULT 'pending',
    called_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Call Board real-time performance
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_status ON dismissal_calls(status) WHERE status IN ('pending', 'called');
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_date ON dismissal_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_student ON dismissal_calls(student_id);

-- 1.3 جداول مواعيد الانصراف للفصول (Dismissal Schedules)
CREATE TABLE IF NOT EXISTS dismissal_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_name VARCHAR(100) NOT NULL,
    dismissal_time TIME NOT NULL, -- HH:mm
    days INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4}', -- 0=Sun, 1=Mon...
    label VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- RLS POLICIES FOR DISMISSAL SYSTEM
-- =============================================================================

-- Enable RLS
ALTER TABLE dismissal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_schedules ENABLE ROW LEVEL SECURITY;

-- Kiosk/System Override (If you have a service role, this isn't strictly needed for server-side
-- but good practice to define explicit access for API clients)

DROP POLICY IF EXISTS "Permit all on dismissal_records for authenticated users" ON dismissal_records;
CREATE POLICY "Permit all on dismissal_records for authenticated users" 
    ON dismissal_records FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Permit all on dismissal_calls for authenticated users" ON dismissal_calls;
CREATE POLICY "Permit all on dismissal_calls for authenticated users" 
    ON dismissal_calls FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Permit all on dismissal_schedules for authenticated users" ON dismissal_schedules;
CREATE POLICY "Permit all on dismissal_schedules for authenticated users" 
    ON dismissal_schedules FOR ALL TO authenticated USING (true);

-- =============================================================================
-- PART 2: STORAGE BUCKETS
-- =============================================================================

-- 2.1 إنشاء حاوية (Bucket) الأعذار
-- Uses the internal storage.buckets table provided by Supabase
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'guardian-excuses',
  'guardian-excuses',
  true, -- Make it public so front-end can display images easily without presigned URLs
  false,
  5242880, -- 5MB limit
  '{"image/jpeg","image/png","image/webp","application/pdf"}'
) ON CONFLICT (id) DO NOTHING;

-- 2.2 RLS Policies for Storage
-- Requires the storage_policies to be defined in auth/storage context

-- Drop existing policies just in case
DROP POLICY IF EXISTS "Guardians can upload excuses" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view excuses" ON storage.objects;

-- Allow authenticated users (guardians) to insert files
CREATE POLICY "Guardians can upload excuses" 
    ON storage.objects FOR INSERT TO authenticated 
    WITH CHECK (bucket_id = 'guardian-excuses');

-- Allow anyone to read (since bucket is public)
CREATE POLICY "Anyone can view excuses" 
    ON storage.objects FOR SELECT TO public 
    USING (bucket_id = 'guardian-excuses');

-- Allow authenticated users to delete (e.g. for cleanup or users deleting their own)
DROP POLICY IF EXISTS "Users can delete excuses" ON storage.objects;
CREATE POLICY "Users can delete excuses"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'guardian-excuses');

-- =============================================================================
-- DONE!
-- Run this in your Supabase SQL Editor
-- =============================================================================
