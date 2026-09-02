-- Align public.users with app: call_station role + can_use_whatsapp flag.
-- Drop any existing CHECK constraint on role (name varies by Postgres version / dump).
DO $$
DECLARE
  r RECORD;
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

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_use_whatsapp BOOLEAN NOT NULL DEFAULT false;
