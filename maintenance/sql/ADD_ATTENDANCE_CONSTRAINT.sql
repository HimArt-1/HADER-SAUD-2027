-- =============================================================================
-- 🔒 HADER System - Enforce Unique Attendance
-- =============================================================================
-- هذا التحديث يمنع تكرار تسجيل الحضور لنفس الطالب في نفس اليوم نهائياً
-- على مستوى قاعدة البيانات
-- =============================================================================

BEGIN;

-- 1. تنظيف أي تكرارات موجودة حالياً (الاحتفاظ بأحدث سجل لكل طالب لكل يوم)
DELETE FROM attendance_logs a USING (
    SELECT MIN(ctid) as ctid, student_id, date
    FROM attendance_logs 
    GROUP BY student_id, date HAVING COUNT(*) > 1
) b
WHERE a.student_id = b.student_id 
AND a.date = b.date 
AND a.ctid <> b.ctid;

-- 2. إضافة قيد عدم التكرار (Unique Constraint)
ALTER TABLE attendance_logs 
DROP CONSTRAINT IF EXISTS unique_student_attendance_daily;

ALTER TABLE attendance_logs
ADD CONSTRAINT unique_student_attendance_daily UNIQUE (student_id, date);

COMMIT;

-- =============================================================================
-- ✨ تم تفعيل الحماية من التكرار بنجاح
-- =============================================================================
