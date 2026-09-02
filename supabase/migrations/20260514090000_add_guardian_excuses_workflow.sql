CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.guardian_excuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(50) NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  student_name TEXT,
  class_name TEXT,
  section TEXT,
  guardian_id TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  absence_date DATE NOT NULL,
  reason TEXT NOT NULL,
  attachment_url TEXT NOT NULL,
  attachment_path TEXT NOT NULL,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_by_label TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_excuses_student
  ON public.guardian_excuses(student_id);

CREATE INDEX IF NOT EXISTS idx_guardian_excuses_status_created
  ON public.guardian_excuses(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guardian_excuses_absence_date
  ON public.guardian_excuses(absence_date DESC);

ALTER TABLE public.guardian_excuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guardian_excuses_select_all" ON public.guardian_excuses;
CREATE POLICY "guardian_excuses_select_all"
  ON public.guardian_excuses FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "guardian_excuses_insert_public" ON public.guardian_excuses;
CREATE POLICY "guardian_excuses_insert_public"
  ON public.guardian_excuses FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "guardian_excuses_update_public" ON public.guardian_excuses;
CREATE POLICY "guardian_excuses_update_public"
  ON public.guardian_excuses FOR UPDATE
  USING (true)
  WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'guardian-excuses',
  'guardian-excuses',
  true,
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "guardian_excuses_storage_select" ON storage.objects;
CREATE POLICY "guardian_excuses_storage_select"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'guardian-excuses');

DROP POLICY IF EXISTS "guardian_excuses_storage_insert" ON storage.objects;
CREATE POLICY "guardian_excuses_storage_insert"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (bucket_id = 'guardian-excuses');

COMMENT ON TABLE public.guardian_excuses IS
  'Guardian-submitted absence excuses with review workflow and attachment metadata.';

NOTIFY pgrst, 'reload schema';
