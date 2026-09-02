-- ═══════════════════════════════════════════════════════════════
-- ترقية قاعدة البيانات من v2.0 إلى v2.3
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor
-- جميع الأوامر آمنة ولن تحذف أي بيانات موجودة (IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. ATTENDANCE_LOGS — إضافة الأعمدة المفقودة
-- ═══════════════════════════════════════════════════════════════

-- عمود recorded_by_label (مهم جداً - يسبب خطأ 400 حالياً)
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS recorded_by_label VARCHAR(50);

-- تغيير status للسماح بقيمة 'absent' (البحث عن القيد الحالي وحذفه ثم إعادة إنشائه)
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- البحث عن أي قيد CHECK على عمود status
    SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'attendance_logs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%';

    -- حذف القيد القديم إن وُجد
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE attendance_logs DROP CONSTRAINT %I', constraint_name);
    END IF;

    -- إضافة القيد الجديد مع السماح بـ absent
    ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_status_check
        CHECK (status IN ('present', 'late', 'absent'));
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. NOTIFICATIONS — إضافة الأعمدة المفقودة وإصلاح القيود
-- ═══════════════════════════════════════════════════════════════

-- إزالة قيد NOT NULL من title (بعض الإشعارات تُرسل بدون عنوان)
ALTER TABLE notifications ALTER COLUMN title DROP NOT NULL;

-- إضافة الأعمدة الناقصة (قد تكون موجودة بالفعل)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_popup BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- فهارس إضافية
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);

-- ═══════════════════════════════════════════════════════════════
-- 3. STUDENTS — إضافة عمود whatsapp_phone المفقود
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE students ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(20);

-- ═══════════════════════════════════════════════════════════════
-- 4. SETTINGS — إضافة أعمدة مفقودة
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE settings ADD COLUMN IF NOT EXISTS security_settings JSONB DEFAULT '{}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS attendance_settings JSONB DEFAULT '{}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS whatsapp_templates JSONB DEFAULT '[]';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS telemetry_retention_days INTEGER DEFAULT 90;

-- ═══════════════════════════════════════════════════════════════
-- 5. TELEMETRY TABLES — إنشاء جداول التشخيص إذا لم تكن موجودة
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    action TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS client_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    severity TEXT NOT NULL,
    source TEXT NOT NULL,
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

-- RLS for telemetry tables
ALTER TABLE auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_audit_logs_all" ON auth_audit_logs;
CREATE POLICY "auth_audit_logs_all" ON auth_audit_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "client_error_logs_all" ON client_error_logs;
CREATE POLICY "client_error_logs_all" ON client_error_logs FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- 6. DISMISSAL SYSTEM — إنشاء الجداول إذا لم تكن موجودة
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS dismissal_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    dismissal_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    method VARCHAR(50),
    picked_up_by VARCHAR(255),
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_by_label VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dismissal_records_date ON dismissal_records(date);

CREATE TABLE IF NOT EXISTS dismissal_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(50) REFERENCES students(id) ON DELETE CASCADE,
    student_name VARCHAR(255) NOT NULL,
    class_name VARCHAR(100) NOT NULL,
    section VARCHAR(20) NOT NULL,
    requested_by VARCHAR(100),
    requested_by_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    called_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dismissal_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_name VARCHAR(100) NOT NULL,
    dismissal_time TIME NOT NULL,
    days INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4}',
    label VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for dismissal tables
ALTER TABLE dismissal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dismissal_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dismissal_records_all" ON dismissal_records;
CREATE POLICY "dismissal_records_all" ON dismissal_records FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dismissal_calls_all" ON dismissal_calls;
CREATE POLICY "dismissal_calls_all" ON dismissal_calls FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dismissal_schedules_all" ON dismissal_schedules;
CREATE POLICY "dismissal_schedules_all" ON dismissal_schedules FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- 7. STORAGE BUCKETS
-- ═══════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('guardian-excuses', 'guardian-excuses', true)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- ✅ تم! أعد تحميل الصفحة بعد تشغيل هذا الملف
-- ═══════════════════════════════════════════════════════════════
