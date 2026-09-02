-- Remove the remaining lint warning from generate_daily_summary by using the
-- computed absent_count variable directly.
CREATE OR REPLACE FUNCTION public.generate_daily_summary()
RETURNS void AS $$
DECLARE
    today DATE := public.get_local_date();
    total_students INTEGER;
    present_count INTEGER;
    late_count INTEGER;
    absent_count INTEGER;
    exit_count INTEGER;
    violation_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_students FROM public.students WHERE is_active = true;

    SELECT
        COUNT(*) FILTER (WHERE status = 'present'),
        COUNT(*) FILTER (WHERE status = 'late')
    INTO present_count, late_count
    FROM public.attendance_logs
    WHERE date = today;

    absent_count := GREATEST(total_students - present_count - late_count, 0);

    SELECT COUNT(*) INTO exit_count FROM public.exits WHERE DATE(exit_time) = today;
    SELECT COUNT(*) INTO violation_count FROM public.violations WHERE DATE(created_at) = today;

    INSERT INTO public.daily_summaries (
        date, total_students, present_count, late_count, absent_count,
        exit_count, violation_count, attendance_rate, created_at, updated_at
    ) VALUES (
        today,
        total_students,
        present_count,
        late_count,
        absent_count,
        exit_count,
        violation_count,
        CASE WHEN total_students > 0
            THEN ROUND(((present_count + late_count)::NUMERIC / total_students) * 100, 2)
            ELSE 0
        END,
        NOW(),
        NOW()
    )
    ON CONFLICT (date) DO UPDATE SET
        total_students = EXCLUDED.total_students,
        present_count = EXCLUDED.present_count,
        late_count = EXCLUDED.late_count,
        absent_count = EXCLUDED.absent_count,
        exit_count = EXCLUDED.exit_count,
        violation_count = EXCLUDED.violation_count,
        attendance_rate = EXCLUDED.attendance_rate,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
