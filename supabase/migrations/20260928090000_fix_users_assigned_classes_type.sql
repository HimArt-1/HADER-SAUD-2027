-- save_hader_user accepts structured class/section assignments as JSONB.
-- Older databases still have TEXT[]; ADD COLUMN IF NOT EXISTS never changes
-- an existing column's type. Preserve those assignments during conversion.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $repair_assigned_classes$
DECLARE
  column_type REGTYPE;
BEGIN
  SELECT atttypid::REGTYPE INTO column_type
  FROM pg_attribute
  WHERE attrelid = 'public.users'::REGCLASS
    AND attname = 'assigned_classes'
    AND NOT attisdropped;

  IF column_type = 'text[]'::REGTYPE THEN
    -- USING converts row values, but PostgreSQL also needs the old array
    -- default removed before it can change the column type.
    ALTER TABLE public.users ALTER COLUMN assigned_classes DROP DEFAULT;
    ALTER TABLE public.users ALTER COLUMN assigned_classes TYPE JSONB
      USING COALESCE(to_jsonb(assigned_classes), '[]'::JSONB);
  ELSIF column_type IS DISTINCT FROM 'jsonb'::REGTYPE THEN
    RAISE EXCEPTION 'Unsupported public.users.assigned_classes type: %', column_type;
  END IF;

  ALTER TABLE public.users ALTER COLUMN assigned_classes SET DEFAULT '[]'::JSONB;
END
$repair_assigned_classes$;

NOTIFY pgrst, 'reload schema';
COMMIT;
