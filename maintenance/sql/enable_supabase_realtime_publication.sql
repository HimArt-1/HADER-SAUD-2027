-- =============================================================================
-- تفعيل Realtime لجداول حاضر (Hader) — Supabase → SQL Editor
-- Idempotent: آمن لإعادة التشغيل، يتخطى الجداول المضافة مسبقاً (لا خطأ 42710)
-- =============================================================================

DO $pub$
DECLARE
  t text;
  tables text[] := ARRAY[
    'attendance_logs',
    'dismissal_calls',
    'notifications',
    'settings',
    'students',
    'classes',
    'exits',
    'violations',
    'dismissal_records',
    'dismissal_schedules'
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
      RAISE NOTICE 'Added table: %', t;
    ELSE
      RAISE NOTICE 'Skipped (already in publication): %', t;
    END IF;
  END LOOP;
END
$pub$;

-- اختياري: فك التعليق إذا أردت Realtime على سجلات الإنصراف نفسها
-- (نفّذ مرة منفصلة أو أضف اسم الجدول داخل المصفوفة أعلاه)
-- 'dismissal_records'

-- =============================================================================
-- RLS: Realtime يتبع SELECT — فعّل فقط الجداول المطلوبة تشغيلياً، وتجنب بث جداول
-- المستخدمين أو الجداول الحساسة ما لم تكن السياسات مقيدة ومراجَعة.
-- =============================================================================
