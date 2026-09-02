-- =============================================================================
-- إصلاح قيد حالة الحضور للسماح بتسجيل الغياب (absent)
-- =============================================================================

DO $$
BEGIN
  -- أولاً، نحاول إزالة القيد القديم إذا كان موجوداً
  BEGIN
    ALTER TABLE public.attendance_logs DROP CONSTRAINT attendance_logs_status_check;
  EXCEPTION
    WHEN undefined_object THEN
      -- القيد غير موجود، لا بأس
  END;
  
  -- ثانياً، نضيف القيد الجديد الذي يسمح بحالة الغياب والأعذار
  ALTER TABLE public.attendance_logs 
  ADD CONSTRAINT attendance_logs_status_check 
  CHECK (status IN ('present', 'late', 'absent', 'excused'));
  
  RAISE NOTICE 'تم تحديث قيد حالات الحضور بنجاح.';
END
$$;
