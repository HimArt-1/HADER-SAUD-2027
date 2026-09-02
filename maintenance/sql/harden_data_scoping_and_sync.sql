-- ═══════════════════════════════════════════════════════════════
-- HARDEN DATA SCOPING AND SYNC (v3.1 - Syntax Fix)
-- Goal: Absolute consistency and timing accuracy
-- ═══════════════════════════════════════════════════════════════

-- 1. Add absence_time to settings if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='absence_time') THEN
        ALTER TABLE settings ADD COLUMN absence_time TIME DEFAULT '09:00:00';
    END IF;
END $$;

-- 2. Cleanup Duplicates in attendance_logs
DELETE FROM attendance_logs a
WHERE a.id NOT IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY student_id, date 
            ORDER BY created_at DESC, timestamp DESC
        ) as rn
        FROM attendance_logs
    ) t WHERE rn = 1
);

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_student_attendance_per_day') THEN
        ALTER TABLE attendance_logs ADD CONSTRAINT unique_student_attendance_per_day UNIQUE (student_id, date);
    END IF;
END $$;

-- 3. Hardening EXITS Table
-- Add dedicated 'date' column to avoid non-immutable index expressions
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='exits' AND column_name='date') THEN
        ALTER TABLE exits ADD COLUMN date DATE;
    END IF;
END $$;

-- Backfill 'date' from 'exit_time'
UPDATE exits SET date = exit_time::date WHERE date IS NULL;

-- Cleanup Duplicates in exits
DELETE FROM exits a
WHERE a.id NOT IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY student_id, date 
            ORDER BY created_at DESC, exit_time DESC
        ) as rn
        FROM exits
    ) t WHERE rn = 1
);

-- Add UNIQUE constraint on the dedicated date column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_student_exit_per_day') THEN
        ALTER TABLE exits ADD CONSTRAINT unique_student_exit_per_day UNIQUE (student_id, date);
    END IF;
END $$;

-- 4. Hardening VIOLATIONS Table
-- Add dedicated 'date' column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='violations' AND column_name='date') THEN
        ALTER TABLE violations ADD COLUMN date DATE;
    END IF;
END $$;

-- Backfill 'date' from 'created_at'
UPDATE violations SET date = created_at::date WHERE date IS NULL;

-- Cleanup Duplicates in violations
DELETE FROM violations a
WHERE a.id NOT IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY student_id, date, type 
            ORDER BY created_at DESC
        ) as rn
        FROM violations
    ) t WHERE rn = 1
);

-- Add UNIQUE constraint on the dedicated date column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_student_violation_per_day') THEN
        ALTER TABLE violations ADD CONSTRAINT unique_student_violation_per_day UNIQUE (student_id, date, type);
    END IF;
END $$;

-- 5. Final verification of settings for Realtime
-- Ensure settings table has a primary key for efficient Realtime updates
-- ALTER TABLE settings ADD PRIMARY KEY (id); -- Usually already exists
