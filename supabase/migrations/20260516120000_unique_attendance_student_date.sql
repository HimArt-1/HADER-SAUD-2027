-- Prevent duplicated attendance states for the same student on the same day.
-- Keep the newest row by update/timestamp metadata, then enforce the app's
-- existing upsert contract: ON CONFLICT (student_id, date).

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_id, date
      ORDER BY
        "timestamp" DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM public.attendance_logs
  WHERE student_id IS NOT NULL
    AND date IS NOT NULL
)
DELETE FROM public.attendance_logs a
USING ranked r
WHERE a.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_student_id_date_unique_idx
  ON public.attendance_logs (student_id, date);
