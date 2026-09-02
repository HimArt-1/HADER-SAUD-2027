-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Fix Dismissal System Schema for Cloud Sync
-- ═══════════════════════════════════════════════════════════════

-- 1. Fix dismissal_records table
-- Adding missing columns expected by the application code and sync service
ALTER TABLE dismissal_records 
ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS date TEXT DEFAULT to_char(now(), 'YYYY-MM-DD'),
ADD COLUMN IF NOT EXISTS picked_up_by TEXT,
ADD COLUMN IF NOT EXISTS recorded_by TEXT,
ADD COLUMN IF NOT EXISTS recorded_by_label TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create index for sync performance if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_dismissal_records_exit_time ON dismissal_records(exit_time);

-- 2. Fix dismissal_calls table
-- Adding missing columns for sender identification and state tracking
ALTER TABLE dismissal_calls 
ADD COLUMN IF NOT EXISTS request_time TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS requested_by TEXT,
ADD COLUMN IF NOT EXISTS requested_by_name TEXT,
ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- Ensure request_time is searchable
CREATE INDEX IF NOT EXISTS idx_dismissal_calls_request_time ON dismissal_calls(request_time);

-- 3. Update comments for documentation
COMMENT ON COLUMN dismissal_records.exit_time IS 'Timestamp used for cloud synchronization filtering';
COMMENT ON COLUMN dismissal_calls.request_time IS 'Timestamp used for cloud synchronization filtering';
