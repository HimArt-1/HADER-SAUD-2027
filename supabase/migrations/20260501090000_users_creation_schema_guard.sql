-- Keep public.users aligned with the admin user form and cloud-first sync.
-- This migration is intentionally idempotent so it can be pasted into the
-- Supabase SQL editor for existing production projects.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS assigned_classes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_sections text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS can_use_whatsapp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_hash_version integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'site_admin',
    'school_admin',
    'supervisor_global',
    'supervisor_class',
    'watcher',
    'kiosk',
    'guardian',
    'call_station'
  ));

NOTIFY pgrst, 'reload schema';
