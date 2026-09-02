-- =============================================================================
-- ⚡ HADER System - Quick Fix (بدون تعديل نوع العمود)
-- =============================================================================
--
-- هذا الكود يطبق فقط التحديثات الأساسية بدون تعديل assigned_classes
--
-- التعليمات:
-- 1. افتح Supabase Dashboard → SQL Editor
-- 2. انسخ والصق هذا الكود
-- 3. اضغط Run
--
-- =============================================================================

-- PART 1: جداول Telemetry
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

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON public.auth_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_action ON public.auth_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_actor ON public.auth_audit_logs (actor_user_id);

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

CREATE INDEX IF NOT EXISTS idx_client_error_logs_created_at ON public.client_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_severity ON public.client_error_logs (severity);
CREATE INDEX IF NOT EXISTS idx_client_error_logs_actor ON public.client_error_logs (actor_user_id);

-- PART 2: Row Level Security
ALTER TABLE public.auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_audit_logs_insert_public" ON public.auth_audit_logs;
CREATE POLICY "auth_audit_logs_insert_public"
  ON public.auth_audit_logs
  FOR INSERT
  WITH CHECK (true);

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

DROP POLICY IF EXISTS "client_error_logs_insert_public" ON public.client_error_logs;
CREATE POLICY "client_error_logs_insert_public"
  ON public.client_error_logs
  FOR INSERT
  WITH CHECK (true);

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

-- PART 3: Telemetry Retention
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS telemetry_retention_days INTEGER DEFAULT 90;

CREATE OR REPLACE FUNCTION public.cleanup_telemetry_logs(retention_days INT DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auth_deleted INT := 0;
  error_deleted INT := 0;
BEGIN
  DELETE FROM public.auth_audit_logs
  WHERE created_at < now() - make_interval(days => retention_days);
  GET DIAGNOSTICS auth_deleted = ROW_COUNT;

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

GRANT EXECUTE ON FUNCTION public.cleanup_telemetry_logs(INT) TO authenticated;

-- PART 4: التحقق من النتائج
SELECT
  'auth_audit_logs' AS table_name,
  COUNT(*) AS total_records,
  MAX(created_at) AS latest_record
FROM public.auth_audit_logs
UNION ALL
SELECT
  'client_error_logs' AS table_name,
  COUNT(*) AS total_records,
  MAX(created_at) AS latest_record
FROM public.client_error_logs;

-- =============================================================================
-- ✅ تم! الآن يمكنك إغلاق SQL Editor وإعادة تحميل التطبيق
-- =============================================================================
