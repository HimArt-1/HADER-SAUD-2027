-- Migration: Add recorded_by_label column to attendance_logs
-- Purpose: Allow storing non-UUID recorder identifiers (e.g., "adminHim")
--          while keeping recorded_by for actual user UUIDs
-- Date: 2026-01-28

-- Add the new column (idempotent)
ALTER TABLE public.attendance_logs
ADD COLUMN IF NOT EXISTS recorded_by_label TEXT;

-- Add index for querying by label (idempotent)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_recorded_by_label
ON public.attendance_logs(recorded_by_label)
WHERE recorded_by_label IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.attendance_logs.recorded_by_label IS
'Text label for recorder when no valid user UUID exists (e.g., admin panel actions)';
