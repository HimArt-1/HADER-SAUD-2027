-- ═══════════════════════════════════════════════════════════════
-- إضافة عمود recorded_by_label إلى جدول attendance_logs
-- شغّل هذا في Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- إضافة العمود (لو مو موجود)
ALTER TABLE public.attendance_logs 
ADD COLUMN IF NOT EXISTS recorded_by_label TEXT;

-- إضافة فهرس
CREATE INDEX IF NOT EXISTS idx_attendance_logs_recorded_by_label
ON public.attendance_logs(recorded_by_label)
WHERE recorded_by_label IS NOT NULL;

-- تعليق
COMMENT ON COLUMN public.attendance_logs.recorded_by_label IS 
  'Label for kiosk/system recorder when recorded_by UUID is null';

-- ═══════════════════════════════════════════════════════════════
-- التحقق: هل العمود موجود؟
-- ═══════════════════════════════════════════════════════════════
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'attendance_logs' 
  AND column_name = 'recorded_by_label';
