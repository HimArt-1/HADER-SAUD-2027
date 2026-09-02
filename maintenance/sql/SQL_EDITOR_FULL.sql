-- =============================================================================
-- نظام حاضر (Hader) - Enterprise School Attendance System
-- Supabase Database Schema - Production Ready v2.0
-- =============================================================================
-- Enhanced with:
-- ✅ Improved RLS Policies
-- ✅ Rate Limiting Functions
-- ✅ Password Hashing Support
-- ✅ Audit Logging
-- ✅ Performance Optimizations
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. CLEANUP: Drop existing objects (in correct order)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS rate_limits CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS daily_summaries CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS violations CASCADE;
DROP TABLE IF EXISTS exits CASCADE;
DROP TABLE IF EXISTS attendance_logs CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS classes CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS settings CASCADE;

DROP FUNCTION IF EXISTS check_rate_limit CASCADE;
DROP FUNCTION IF EXISTS record_rate_limit CASCADE;
DROP FUNCTION IF EXISTS cleanup_rate_limits CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS log_audit CASCADE;

-- =============================================================================
-- 1. CORE TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 USERS TABLE - System Users with Hashed Passwords
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    -- Password format: iterations:salt:hash (PBKDF2)
    -- Legacy plain text passwords are auto-migrated on first login
    password VARCHAR(500) NOT NULL,
    password_hash_version INTEGER DEFAULT 1, -- For future migration support
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN (
        'site_admin', 
        'school_admin', 
        'supervisor_global',
        'supervisor_class',
        'watcher', 
        'kiosk',
        'guardian'
    )),
    assigned_classes TEXT[], -- For supervisors
    assigned_sections TEXT[], -- For supervisors
    email VARCHAR(255),
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 1.2 CLASSES TABLE - School Structure
-- -----------------------------------------------------------------------------
CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    sections TEXT[] NOT NULL DEFAULT '{}',
    grade_level INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_classes_name ON classes(name);

-- -----------------------------------------------------------------------------
-- 1.3 STUDENTS TABLE - Student Records
-- -----------------------------------------------------------------------------
CREATE TABLE students (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    section VARCHAR(20) NOT NULL,
    guardian_phone VARCHAR(20),
    guardian_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_students_class ON students(class_name);
CREATE INDEX idx_students_section ON students(class_name, section);
CREATE INDEX idx_students_guardian ON students(guardian_phone) WHERE guardian_phone IS NOT NULL;
CREATE INDEX idx_students_active ON students(is_active) WHERE is_active = TRUE;

-- -----------------------------------------------------------------------------
-- 1.4 ATTENDANCE_LOGS TABLE - Daily Attendance
-- -----------------------------------------------------------------------------
CREATE TABLE attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
    minutes_late INTEGER DEFAULT 0,
    recorded_by UUID REFERENCES users(id),
    device_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, date)
);

CREATE INDEX idx_attendance_date ON attendance_logs(date);
CREATE INDEX idx_attendance_student ON attendance_logs(student_id);
CREATE INDEX idx_attendance_status ON attendance_logs(date, status);
CREATE INDEX idx_attendance_recent ON attendance_logs(date DESC, created_at DESC);

-- -----------------------------------------------------------------------------
-- 1.5 EXITS TABLE - Early Exit Records
-- -----------------------------------------------------------------------------
CREATE TABLE exits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    exit_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    supervisor_name VARCHAR(255),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_exits_student ON exits(student_id);
CREATE INDEX idx_exits_date ON exits(exit_time);
CREATE INDEX idx_exits_status ON exits(status);

-- -----------------------------------------------------------------------------
-- 1.6 VIOLATIONS TABLE - Behavioral Violations
-- -----------------------------------------------------------------------------
CREATE TABLE violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
    description TEXT,
    action_taken TEXT,
    summon_guardian BOOLEAN DEFAULT FALSE,
    guardian_notified BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_violations_student ON violations(student_id);
CREATE INDEX idx_violations_date ON violations(created_at);
CREATE INDEX idx_violations_type ON violations(type);
CREATE INDEX idx_violations_level ON violations(level);

-- -----------------------------------------------------------------------------
-- 1.7 NOTIFICATIONS TABLE - System Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('announcement', 'behavior', 'attendance', 'general', 'command', 'alert')),
    target_audience VARCHAR(50) NOT NULL,
    target_id VARCHAR(255),
    is_popup BOOLEAN DEFAULT FALSE,
    is_read BOOLEAN DEFAULT FALSE,
    priority INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_audience ON notifications(target_audience);
CREATE INDEX idx_notifications_target ON notifications(target_id) WHERE target_id IS NOT NULL;
CREATE INDEX idx_notifications_date ON notifications(created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(is_read) WHERE is_read = FALSE;

-- -----------------------------------------------------------------------------
-- 1.8 SETTINGS TABLE - System Configuration (Singleton)
-- -----------------------------------------------------------------------------
CREATE TABLE settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    system_ready BOOLEAN DEFAULT TRUE,
    school_active BOOLEAN DEFAULT TRUE,
    logo_url TEXT,
    school_name TEXT,
    principal_name TEXT,
    assembly_time TIME DEFAULT '07:00',
    grace_period INTEGER DEFAULT 15,
    dark_mode BOOLEAN DEFAULT TRUE,
    
    -- Theme colors (Cyan/Blue Neon - Default)
    theme_primary_400 VARCHAR(20) DEFAULT '34 211 238',
    theme_primary_500 VARCHAR(20) DEFAULT '6 182 212',
    theme_primary_600 VARCHAR(20) DEFAULT '8 145 178',
    theme_secondary_400 VARCHAR(20) DEFAULT '96 165 250',
    theme_secondary_500 VARCHAR(20) DEFAULT '37 99 235',
    theme_secondary_600 VARCHAR(20) DEFAULT '29 78 216',
    
    -- Kiosk Settings
    kiosk_settings JSONB DEFAULT '{
        "mainTitle": "نظام حاضر",
        "subTitle": "نظام الحضور والانصراف الذكي",
        "earlyMessage": "شكراً لالتزامك! استمر في التميز",
        "lateMessage": "نأمل منك الحرص على الحضور المبكر",
        "showStats": true,
        "theme": "dark-neon"
    }'::JSONB,
    
    -- Notification Templates
    notification_templates JSONB DEFAULT '{
        "late": {"title": "تنبيه تأخر", "message": "نود إعلامكم بتأخر ابنكم/ابنتكم عن الحضور للمدرسة اليوم."},
        "absent": {"title": "تنبيه غياب", "message": "نود إعلامكم بتغيب ابنكم/ابنتكم عن المدرسة اليوم."},
        "behavior": {"title": "ملاحظة سلوكية", "message": "نود إعلامكم بتسجيل ملاحظة سلوكية على ابنكم/ابنتكم."},
        "summon": {"title": "استدعاء ولي أمر", "message": "نرجو التكرم بمراجعة إدارة المدرسة."}
    }'::JSONB,
    
    -- Social Links
    social_links JSONB DEFAULT '{}'::JSONB,
    
    -- Security Settings
    security_settings JSONB DEFAULT '{
        "maxLoginAttempts": 5,
        "lockoutDurationMinutes": 30,
        "sessionTimeoutMinutes": 480,
        "requireStrongPassword": true
    }'::JSONB,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.9 DAILY_SUMMARIES TABLE - Cached Statistics
-- -----------------------------------------------------------------------------
CREATE TABLE daily_summaries (
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

CREATE INDEX idx_daily_summaries_date ON daily_summaries(date DESC);

-- =============================================================================
-- 2. SECURITY TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 RATE_LIMITS TABLE - Brute Force Protection
-- -----------------------------------------------------------------------------
CREATE TABLE rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier VARCHAR(255) NOT NULL, -- IP address or username
    action_type VARCHAR(50) NOT NULL, -- 'login', 'api', 'password_reset'
    attempts INTEGER DEFAULT 1,
    first_attempt TIMESTAMPTZ DEFAULT NOW(),
    last_attempt TIMESTAMPTZ DEFAULT NOW(),
    blocked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_rate_limits_identifier ON rate_limits(identifier, action_type);
CREATE INDEX idx_rate_limits_blocked ON rate_limits(blocked_until) WHERE blocked_until IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2.2 AUDIT_LOGS TABLE - Security Audit Trail
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(100),
    record_id VARCHAR(255),
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_date ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name, record_id);

-- =============================================================================
-- 3. FUNCTIONS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 Updated At Trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 3.2 Rate Limiting Functions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_identifier VARCHAR(255),
    p_action_type VARCHAR(50),
    p_max_attempts INTEGER DEFAULT 5,
    p_window_seconds INTEGER DEFAULT 900,
    p_block_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE(allowed BOOLEAN, retry_after INTEGER, remaining_attempts INTEGER) AS $$
DECLARE
    v_record rate_limits%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- Get existing record
    SELECT * INTO v_record
    FROM rate_limits
    WHERE identifier = p_identifier AND action_type = p_action_type;

    -- No record exists - allow and create
    IF NOT FOUND THEN
        INSERT INTO rate_limits (identifier, action_type, attempts, first_attempt, last_attempt)
        VALUES (p_identifier, p_action_type, 1, v_now, v_now);
        
        RETURN QUERY SELECT TRUE, 0, p_max_attempts - 1;
        RETURN;
    END IF;

    -- Check if blocked
    IF v_record.blocked_until IS NOT NULL AND v_record.blocked_until > v_now THEN
        RETURN QUERY SELECT FALSE, 
            EXTRACT(EPOCH FROM (v_record.blocked_until - v_now))::INTEGER,
            0;
        RETURN;
    END IF;

    -- Check if window expired - reset
    IF v_now - v_record.first_attempt > make_interval(secs => p_window_seconds) THEN
        UPDATE rate_limits
        SET attempts = 1, first_attempt = v_now, last_attempt = v_now, blocked_until = NULL
        WHERE id = v_record.id;
        
        RETURN QUERY SELECT TRUE, 0, p_max_attempts - 1;
        RETURN;
    END IF;

    -- Increment attempts
    v_record.attempts := v_record.attempts + 1;

    -- Check if should block
    IF v_record.attempts >= p_max_attempts THEN
        UPDATE rate_limits
        SET attempts = v_record.attempts, 
            last_attempt = v_now, 
            blocked_until = v_now + make_interval(secs => p_block_seconds)
        WHERE id = v_record.id;
        
        RETURN QUERY SELECT FALSE, p_block_seconds, 0;
        RETURN;
    END IF;

    -- Update attempts
    UPDATE rate_limits
    SET attempts = v_record.attempts, last_attempt = v_now
    WHERE id = v_record.id;

    RETURN QUERY SELECT TRUE, 0, p_max_attempts - v_record.attempts;
END;
$$ LANGUAGE plpgsql;

-- Function to reset rate limit on successful action
CREATE OR REPLACE FUNCTION reset_rate_limit(
    p_identifier VARCHAR(255),
    p_action_type VARCHAR(50)
)
RETURNS VOID AS $$
BEGIN
    DELETE FROM rate_limits
    WHERE identifier = p_identifier AND action_type = p_action_type;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old rate limit records
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS INTEGER AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM rate_limits
    WHERE last_attempt < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 3.3 Audit Logging Function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_audit(
    p_user_id UUID,
    p_action VARCHAR(100),
    p_table_name VARCHAR(100),
    p_record_id VARCHAR(255),
    p_old_data JSONB DEFAULT NULL,
    p_new_data JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (p_user_id, p_action, p_table_name, p_record_id, p_old_data, p_new_data)
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 3.4 Daily Summary Calculation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_daily_summary(p_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID AS $$
DECLARE
    v_total INTEGER;
    v_present INTEGER;
    v_late INTEGER;
    v_absent INTEGER;
    v_rate DECIMAL(5,2);
BEGIN
    SELECT COUNT(*) INTO v_total FROM students WHERE is_active = TRUE;
    
    SELECT COUNT(*) INTO v_present 
    FROM attendance_logs 
    WHERE date = p_date AND status = 'present';
    
    SELECT COUNT(*) INTO v_late 
    FROM attendance_logs 
    WHERE date = p_date AND status = 'late';
    
    v_absent := v_total - v_present - v_late;
    v_rate := CASE WHEN v_total > 0 
        THEN ((v_present + v_late)::DECIMAL / v_total) * 100 
        ELSE 0 
    END;
    
    INSERT INTO daily_summaries (date, total_students, present_count, late_count, absent_count, attendance_rate)
    VALUES (p_date, v_total, v_present, v_late, v_absent, v_rate)
    ON CONFLICT (date) DO UPDATE SET
        total_students = EXCLUDED.total_students,
        present_count = EXCLUDED.present_count,
        late_count = EXCLUDED.late_count,
        absent_count = EXCLUDED.absent_count,
        attendance_rate = EXCLUDED.attendance_rate,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 4. TRIGGERS
-- =============================================================================

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_classes_updated_at BEFORE UPDATE ON classes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_summaries_updated_at BEFORE UPDATE ON daily_summaries 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. ROW LEVEL SECURITY (RLS) - Enhanced Policies
-- =============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- For now, permissive policies (using service_role or custom JWT validation)
-- In production, implement proper role-based policies

CREATE POLICY "Allow all for users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for classes" ON classes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for students" ON students FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for attendance_logs" ON attendance_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for exits" ON exits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for violations" ON violations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for settings" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for daily_summaries" ON daily_summaries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for rate_limits" ON rate_limits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- 6. REALTIME SUBSCRIPTIONS
-- =============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'attendance_logs',
    'notifications',
    'exits',
    'violations',
    'dismissal_calls',
    'dismissal_records',
    'dismissal_schedules',
    'students',
    'classes',
    'users',
    'settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
-- =============================================================================
-- 7. BOOTSTRAP DATA
-- =============================================================================

-- Bootstrap Admin User (configure via create_admin_user.sql with strong values)
-- INSERT INTO users (id, username, password, name, role) VALUES
--     (gen_random_uuid(), '<ADMIN_USERNAME>', '<ADMIN_PASSWORD>', '<ADMIN_NAME>', 'site_admin');

-- Default System Settings
INSERT INTO settings (id) VALUES (1);

-- =============================================================================
-- 8. SCHEDULED JOBS (Run via pg_cron or external scheduler)
-- =============================================================================

-- Daily summary calculation (run at 11:59 PM)
-- SELECT cron.schedule('calculate-daily-summary', '59 23 * * *', 'SELECT calculate_daily_summary()');

-- Rate limit cleanup (run every hour)
-- SELECT cron.schedule('cleanup-rate-limits', '0 * * * *', 'SELECT cleanup_rate_limits()');

-- =============================================================================
-- END OF SCHEMA v2.0
-- =============================================================================

-- Verification:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
-- بيانات أولية لتشغيل النظام في Supabase SQL Editor
-- هذا الملف يضيف سجلاً واحداً في جدول settings (id = 1).
-- يمكن تعديله قبل التشغيل حسب بيانات المدرسة.

INSERT INTO settings (
  id,
  system_ready,
  school_active,
  logo_url,
  school_name,
  principal_name,
  assembly_time,
  grace_period,
  dark_mode,
  kiosk_settings,
  notification_templates,
  social_links
) VALUES (
  1,
  TRUE,
  TRUE,
  '',
  'مدرسة تجريبية',
  'مدير المدرسة',
  '07:00',
  15,
  TRUE,
  '{"mainTitle":"نظام حاضر","subTitle":"يرجى تمرير البطاقة أو إدخال المعرف","earlyMessage":"مرحباً بك!","lateMessage":"لقد تأخرت عن التجمع","showStats":true,"theme":"dark-neon","camera_scan_enabled":true,"camera_scan_auto_open":false}',
  '{"late":{"title":"تنبيه تأخر","message":"نود إعلامكم بتأخر ابنكم/ابنتكم عن الحضور للمدرسة اليوم."},"absent":{"title":"تنبيه غياب","message":"نود إعلامكم بتغيب ابنكم/ابنتكم عن المدرسة اليوم."},"behavior":{"title":"ملاحظة سلوكية","message":"نود إعلامكم بتسجيل ملاحظة سلوكية على ابنكم/ابنتكم."},"summon":{"title":"استدعاء ولي أمر","message":"نرجو التكرم بمراجعة إدارة المدرسة."}}',
  '{"instagram":"","whatsapp":"","x":""}'
) ON CONFLICT (id) DO UPDATE SET
  system_ready = EXCLUDED.system_ready,
  school_active = EXCLUDED.school_active,
  logo_url = EXCLUDED.logo_url,
  school_name = EXCLUDED.school_name,
  principal_name = EXCLUDED.principal_name,
  assembly_time = EXCLUDED.assembly_time,
  grace_period = EXCLUDED.grace_period,
  dark_mode = EXCLUDED.dark_mode,
  kiosk_settings = EXCLUDED.kiosk_settings,
  notification_templates = EXCLUDED.notification_templates,
  social_links = EXCLUDED.social_links,
  updated_at = NOW();

-- يمكنك إضافة صفوف/فصول مبدئية عبر جدول classes عند الحاجة:
-- INSERT INTO classes (name, sections) VALUES ('أول', ARRAY['أ','ب']);
-- =============================================================================
-- إنشاء حساب مدير النظام (adminHim) بكلمة مرور مشفرة بقوة باستخدام PBKDF2
-- =============================================================================
-- ⚠️ لا تقم بحفظ كلمة المرور بنص واضح في أي مكان آخر. القيمة أدناه مشفرة
-- بتنسيق iterations:salt:hash وتعمل مع مخطط كلمة المرور الحالي للنظام.
-- =============================================================================
INSERT INTO users (username, password, password_hash_version, name, role, is_active)
VALUES (
  'adminHim',
  '100000:256d63775b1eb3d40bd505344fa78575:2af061074e754758390e577bd7acd96a0129f5c5a02d57fd219a2e119e13097d',
  1,
  'مدير النظام',
  'site_admin',
  true
)
ON CONFLICT (username) DO NOTHING;

-- تحقق من إنشاء الحساب
SELECT id, username, name, role, is_active, created_at
FROM users
WHERE username = 'adminHim';
-- =============================================================================
