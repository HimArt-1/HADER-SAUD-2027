-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Promote Attendance Timing to Top-Level Columns
-- ═══════════════════════════════════════════════════════════════

-- 1. Ensure the columns exist
ALTER TABLE settings 
ADD COLUMN IF NOT EXISTS assembly_time TEXT,
ADD COLUMN IF NOT EXISTS grace_period INTEGER;

-- 2. If 'assembly_time' exists as TIME, convert it to TEXT safely
DO $$ 
BEGIN 
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'settings' 
        AND column_name = 'assembly_time' 
        AND data_type = 'time without time zone'
    ) THEN
        ALTER TABLE settings ALTER COLUMN assembly_time TYPE TEXT USING assembly_time::text;
    END IF;
END $$;

-- 3. Apply default values for columns that are still null
UPDATE settings SET assembly_time = '07:00' WHERE assembly_time IS NULL;
UPDATE settings SET grace_period = 15 WHERE grace_period IS NULL;

-- 4. Migrate existing data from JSONB to columns (overwriting defaults if JSON data exists)
UPDATE settings
SET 
    assembly_time = COALESCE(kiosk_settings->>'assembly_time', assembly_time),
    grace_period = COALESCE((kiosk_settings->>'grace_period')::integer, grace_period)
WHERE kiosk_settings ? 'assembly_time' OR kiosk_settings ? 'grace_period';

-- 5. Final cleanup of updated_at
UPDATE settings SET updated_at = now();

-- 3. (Optional) Cleanup JSONB to avoid confusion
-- Note: Commented out to prevent data loss if something fails. 
-- You can run this later once verified.
-- UPDATE settings SET kiosk_settings = kiosk_settings - 'assembly_time' - 'grace_period';

COMMENT ON COLUMN settings.assembly_time IS 'Official school assembly start time (HH:MM)';
COMMENT ON COLUMN settings.grace_period IS 'Minutes allowed after assembly_time before marked as Late';
