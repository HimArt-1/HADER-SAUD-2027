BEGIN;

-- A transaction lock disappears on commit/rollback or connection termination.
-- No persistent activity_logs marker is needed for automatic absence anymore.
-- Keep caller permissions and RLS: this function grants no new table access.
CREATE OR REPLACE FUNCTION public.mark_hader_automatic_absence()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $$
DECLARE
  school_now timestamp := statement_timestamp() AT TIME ZONE 'Asia/Riyadh';
  school_date date := school_now::date;
  settings_row jsonb;
  kiosk jsonb;
  attendance_settings jsonb;
  work_days jsonb;
  holidays jsonb;
  cutoff text;
  inserted_count integer;
  inserted_records jsonb;
  result_base jsonb := jsonb_build_object('date', school_date, 'count', 0, 'success', false, 'completed', false);
BEGIN
  IF NOT pg_try_advisory_xact_lock(184721, school_date - DATE '2000-01-01') THEN
    RETURN result_base || jsonb_build_object('reason', 'busy');
  END IF;

  SELECT to_jsonb(s) INTO settings_row FROM public.settings s LIMIT 1;
  IF settings_row IS NULL THEN
    RETURN result_base || jsonb_build_object('reason', 'settings_missing');
  END IF;
  IF (settings_row->>'school_active')::boolean IS FALSE
     OR (settings_row->>'system_ready')::boolean IS FALSE THEN
    RETURN result_base || jsonb_build_object('reason', 'school_disabled');
  END IF;

  kiosk := COALESCE(NULLIF(settings_row->'kiosk_settings', 'null'::jsonb), '{}'::jsonb);
  attendance_settings := COALESCE(NULLIF(settings_row->'attendance_settings', 'null'::jsonb), kiosk->'attendance_settings', '{}'::jsonb);
  work_days := COALESCE(NULLIF(attendance_settings->'work_days', 'null'::jsonb),
    NULLIF(kiosk#>'{attendance_settings,work_days}', 'null'::jsonb),
    NULLIF(settings_row->'work_days', 'null'::jsonb), '[0,1,2,3,4]'::jsonb);
  holidays := COALESCE(NULLIF(attendance_settings->'academic_holidays', 'null'::jsonb), '[]'::jsonb);
  IF jsonb_typeof(work_days) <> 'array' OR jsonb_typeof(holidays) <> 'array' THEN
    RETURN result_base || jsonb_build_object('reason', 'invalid_calendar');
  END IF;
  IF NOT (work_days @> jsonb_build_array(EXTRACT(DOW FROM school_date)::integer))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(holidays) h WHERE h->>'date' = school_date::text) THEN
    RETURN result_base || jsonb_build_object('success', true, 'completed', true, 'reason', 'holiday');
  END IF;

  cutoff := COALESCE(NULLIF(settings_row->>'absence_time', ''), NULLIF(kiosk->>'absence_time', ''),
    NULLIF(attendance_settings->>'auto_mark_time', ''), '09:00');
  IF cutoff !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN
    RETURN result_base || jsonb_build_object('reason', 'invalid_cutoff');
  END IF;
  IF school_now::time < cutoff::time THEN
    RETURN result_base || jsonb_build_object('reason', 'before_cutoff');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE is_active IS DISTINCT FROM FALSE) THEN
    RETURN result_base || jsonb_build_object('reason', 'empty_roster');
  END IF;

  WITH inserted AS (INSERT INTO public.attendance_logs
    (student_id, date, "timestamp", status, minutes_late, recorded_by_label, device_id)
  SELECT s.id, school_date, statement_timestamp(), 'absent', 0, 'auto-absence', 'auto-absence'
  FROM public.students s
  WHERE s.is_active IS DISTINCT FROM FALSE
    AND NOT EXISTS (SELECT 1 FROM public.attendance_logs a WHERE a.student_id = s.id AND a.date = school_date)
  -- A concurrent scanner can win after the SELECT snapshot: preserve its row.
  ON CONFLICT (student_id, date) DO NOTHING
  RETURNING *)
  SELECT count(*)::integer, COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
    INTO inserted_count, inserted_records FROM inserted;

  RETURN result_base || jsonb_build_object('success', true, 'completed', true, 'count', inserted_count, 'records', inserted_records);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_hader_automatic_absence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_hader_automatic_absence() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.mark_hader_automatic_absence() IS
  'Atomic automatic absence using Riyadh server time; respects caller RLS and never overwrites existing attendance.';

COMMIT;
