-- =============================================================================
-- 📋 HADER System - Required Supabase Database Updates
-- =============================================================================
--
-- هذا الملف يحتوي على جميع التحديثات المطلوبة لقاعدة البيانات
--
-- التعليمات:
-- 1. افتح Supabase Dashboard → SQL Editor
-- 2. انسخ والصق محتوى هذا الملف
-- 3. اضغط Run أو Ctrl+Enter
-- 4. تأكد من ظهور "Success" لكل قسم
--
-- =============================================================================

-- =============================================================================
-- PART 1: جداول Telemetry (حل أخطاء 401 و 404 في الكونسول)
-- =============================================================================

-- 1.1 إنشاء جدول auth_audit_logs لتتبع تسجيل الدخول والخروج
CREATE TABLE IF NOT EXISTS public.auth_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
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

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON public.auth_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_action ON public.auth_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_actor ON public.auth_audit_logs (actor_user_id);

-- 1.2 إنشاء جدول client_error_logs لتتبع الأخطاء في المتصفح
CREATE TABLE IF NOT EXISTS public.client_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
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

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_client_error_logs_created_at ON public.client_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_severity ON public.client_error_logs (severity);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_actor ON public.client_error_logs (actor_user_id);

-- =============================================================================
-- PART 2: Row Level Security (RLS) Policies
-- =============================================================================

-- تفعيل RLS على الجداول
ALTER TABLE public.auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;

-- 2.1 صلاحيات auth_audit_logs
-- السماح للجميع بالإضافة (لتسجيل محاولات الدخول)
DROP POLICY IF EXISTS "auth_audit_logs_insert_public" ON public.auth_audit_logs;
CREATE POLICY "auth_audit_logs_insert_public"
  ON public.auth_audit_logs
  FOR INSERT
  WITH CHECK (true);

-- السماح بالقراءة للـ site_admin فقط
DROP POLICY IF EXISTS "auth_audit_logs_select_site_admin" ON public.auth_audit_logs;
CREATE POLICY "auth_audit_logs_select_site_admin"
  ON public.auth_audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id::text = auth.jwt() ->> 'sub'
      AND role = 'site_admin'
    )
  );

-- 2.2 صلاحيات client_error_logs
-- السماح للجميع بالإضافة (لتسجيل الأخطاء من المتصفح)
DROP POLICY IF EXISTS "client_error_logs_insert_public" ON public.client_error_logs;
CREATE POLICY "client_error_logs_insert_public"
  ON public.client_error_logs
  FOR INSERT
  WITH CHECK (true);

-- السماح بالقراءة للـ site_admin فقط
DROP POLICY IF EXISTS "client_error_logs_select_site_admin" ON public.client_error_logs;
CREATE POLICY "client_error_logs_select_site_admin"
  ON public.client_error_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id::text = auth.jwt() ->> 'sub'
      AND role = 'site_admin'
    )
  );

-- =============================================================================
-- PART 3: Telemetry Retention & Cleanup
-- =============================================================================

-- 3.1 إضافة عمود telemetry_retention_days في جدول settings
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS telemetry_retention_days INTEGER DEFAULT 90;

-- 3.2 إنشاء دالة لتنظيف السجلات القديمة
CREATE OR REPLACE FUNCTION public.cleanup_telemetry_logs(retention_days INT DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_deleted INT := 0;
  error_deleted INT := 0;
BEGIN
  -- حذف سجلات auth_audit_logs القديمة
  DELETE FROM public.auth_audit_logs
  WHERE created_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS auth_deleted = ROW_COUNT;

  -- حذف سجلات client_error_logs القديمة
  DELETE FROM public.client_error_logs
  WHERE created_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS error_deleted = ROW_COUNT;

  RETURN json_build_object(
    'auth_deleted', auth_deleted,
    'error_deleted', error_deleted,
    'retention_days', retention_days,
    'executed_at', now()
  );
END;
$$;

-- 3.3 إعطاء صلاحيات تنفيذ الدالة للـ site_admin
GRANT EXECUTE ON FUNCTION public.cleanup_telemetry_logs(INT) TO authenticated;

-- =============================================================================
-- PART 4: تحسينات على جدول users (لحل مشاكل assigned_classes)
-- =============================================================================

-- ملاحظة: عمود assigned_classes من نوع TEXT[] وليس JSONB
-- لذلك لن نحتاج تحديثات معقدة، فقط تنظيف القيم الفارغة

-- التأكد من أن عمود assigned_classes يقبل NULL بشكل صحيح
ALTER TABLE public.users
  ALTER COLUMN assigned_classes SET DEFAULT NULL;

-- إصلاح أي سجلات بها قيم فارغة
UPDATE public.users
SET assigned_classes = NULL
WHERE assigned_classes = ARRAY[]::TEXT[]
   OR assigned_classes IS NOT NULL AND array_length(assigned_classes, 1) IS NULL;

-- =============================================================================
-- PART 5: فحص البيانات والتحقق من النتائج
-- =============================================================================

-- 5.1 عرض إحصائيات الجداول الجديدة
SELECT
  'auth_audit_logs' AS table_name,
  COUNT(*) AS total_records,
  COUNT(DISTINCT actor_user_id) AS unique_users,
  MAX(created_at) AS latest_record
FROM public.auth_audit_logs
UNION ALL
SELECT
  'client_error_logs' AS table_name,
  COUNT(*) AS total_records,
  COUNT(DISTINCT actor_user_id) AS unique_users,
  MAX(created_at) AS latest_record
FROM public.client_error_logs;

-- 5.2 التحقق من المستخدمين الذين لديهم assigned_classes
SELECT
  id,
  username,
  name,
  role,
  assigned_classes,
  CASE
    WHEN assigned_classes IS NULL THEN '✅ NULL (صحيح)'
    WHEN array_length(assigned_classes, 1) > 0 THEN '✅ Array مع بيانات (صحيح)'
    WHEN array_length(assigned_classes, 1) IS NULL THEN '⚠️ Array فارغ'
    ELSE '❌ نوع خاطئ'
  END AS validation_status
FROM public.users
WHERE role = 'supervisor_class'
ORDER BY created_at DESC;

-- =============================================================================
-- PART 6 (اختياري): إنشاء مستخدم Site Admin جديد
-- =============================================================================
--
-- ⚠️ تحذير: غيّر القيم التالية قبل التنفيذ!
--
-- UNCOMMENT THE LINES BELOW AND REPLACE VALUES:
--
-- INSERT INTO public.users (username, password, name, role, is_active, assigned_classes)
-- VALUES (
--   'YOUR_ADMIN_USERNAME',           -- اسم المستخدم
--   'YOUR_SECURE_PASSWORD',          -- كلمة المرور (يفضل استخدام bcrypt hash)
--   'اسم المدير',                    -- الاسم الكامل
--   'site_admin',                    -- الصلاحية
--   true,                            -- نشط
--   NULL                             -- لا يحتاج assigned_classes
-- )
-- ON CONFLICT (username) DO NOTHING;
--
-- للتحقق من إنشاء المستخدم:
-- SELECT id, username, name, role, is_active, created_at
-- FROM public.users
-- WHERE username = 'YOUR_ADMIN_USERNAME';

-- =============================================================================
-- 🎉 انتهى! تم تطبيق جميع التحديثات بنجاح
-- =============================================================================
--
-- الخطوات التالية:
-- 1. أعد تحميل صفحة التطبيق
-- 2. تحقق من Console - يجب اختفاء أخطاء 401 و 404
-- 3. جرّب إضافة مشرف جديد - يجب أن يعمل بدون أخطاء
-- 4. تحقق من قسم Support → Telemetry لرؤية السجلات
--
-- =============================================================================
