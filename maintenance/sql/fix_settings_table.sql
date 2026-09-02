-- =============================================================================
-- إصلاح جدول الإعدادات - إضافة الأعمدة المفقودة
-- =============================================================================
-- شغّل هذا السكربت في Supabase SQL Editor لإصلاح خطأ 400

-- إضافة عمود theme إذا لم يكن موجوداً
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS theme VARCHAR(50) DEFAULT 'dark-neon';

-- إضافة عمود attendance_settings إذا لم يكن موجوداً
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS attendance_settings JSONB DEFAULT '{
    "auto_mark_enabled": false,
    "auto_mark_time": "07:30",
    "unmarked_default": "present"
}'::JSONB;

-- إضافة عمود whatsapp_templates إذا لم يكن موجوداً
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS whatsapp_templates JSONB DEFAULT '{
    "late": "السلام عليكم ورحمة الله وبركاته\nنفيدكم بتأخر الطالب/ة {student_name} عن الحضور اليوم.\nوقت الوصول: {time}",
    "absent": "السلام عليكم ورحمة الله وبركاته\nنفيدكم بغياب الطالب/ة {student_name} اليوم.\nنرجو التواصل مع الإدارة.",
    "violation": "السلام عليكم ورحمة الله وبركاته\nنود إعلامكم بتسجيل ملاحظة سلوكية على الطالب/ة {student_name}.\nالتفاصيل: {description}"
}'::JSONB;

-- إضافة عمود telemetry_retention_days إذا لم يكن موجوداً
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS telemetry_retention_days INTEGER DEFAULT 90;

-- التحقق من وجود الأعمدة الأخرى وإضافتها إذا لزم الأمر
ALTER TABLE settings
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE settings
ADD COLUMN IF NOT EXISTS security_settings JSONB DEFAULT '{
    "maxLoginAttempts": 5,
    "lockoutDurationMinutes": 30,
    "sessionTimeoutMinutes": 480,
    "requireStrongPassword": true
}'::JSONB;

-- تحديث updated_at تلقائياً عند التعديل
CREATE OR REPLACE FUNCTION update_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إنشاء الـ trigger إذا لم يكن موجوداً
DROP TRIGGER IF EXISTS trigger_settings_updated_at ON settings;
CREATE TRIGGER trigger_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_settings_timestamp();

-- إدخال صف افتراضي إذا لم يكن موجوداً
INSERT INTO settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- عرض الأعمدة الحالية للتأكد
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'settings'
ORDER BY ordinal_position;
