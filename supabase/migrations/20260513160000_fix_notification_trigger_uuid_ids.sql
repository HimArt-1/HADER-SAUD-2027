-- Fix trigger-generated notifications when notifications.id is UUID.
--
-- Older helper functions built notification IDs as TEXT and inserted them into
-- notifications.id. PostgreSQL does not implicitly cast that value in trigger
-- INSERT statements, so a late attendance insert can fail with:
--   column "id" is of type uuid but expression is of type text

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

ALTER TABLE public.daily_summaries
  ADD COLUMN IF NOT EXISTS exit_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS violation_count INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION public.create_late_notification()
RETURNS TRIGGER AS $$
DECLARE
    student_record RECORD;
BEGIN
    IF NEW.status = 'late' THEN
        SELECT * INTO student_record FROM public.students WHERE id = NEW.student_id;

        INSERT INTO public.notifications (title, message, type, target_audience, is_popup, priority, created_at)
        VALUES (
            '⏰ تأخر طالب',
            'تأخر الطالب ' || student_record.name || ' (' || student_record.class_name || ' - ' || student_record.section || ') عن الحضور.',
            'attendance',
            'supervisor',
            true,
            2,
            NOW()
        );

        IF student_record.guardian_phone IS NOT NULL THEN
            INSERT INTO public.notifications (title, message, type, target_audience, target_id, is_popup, priority, created_at)
            VALUES (
                'تنبيه تأخر',
                'نفيدكم بتأخر الطالب ' || student_record.name || ' عن الحضور اليوم.',
                'attendance',
                'guardian',
                NEW.student_id,
                false,
                1,
                NOW()
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.create_violation_notification()
RETURNS TRIGGER AS $$
DECLARE
    student_record RECORD;
    violation_emoji TEXT;
BEGIN
    SELECT * INTO student_record FROM public.students WHERE id = NEW.student_id;

    violation_emoji := CASE NEW.level
        WHEN 1 THEN '⚠️'
        WHEN 2 THEN '🚨'
        WHEN 3 THEN '🔴'
        ELSE '📋'
    END;

    INSERT INTO public.notifications (title, message, type, target_audience, is_popup, priority, created_at)
    VALUES (
        violation_emoji || ' مخالفة سلوكية',
        'تم تسجيل مخالفة على الطالب ' || student_record.name || ': ' || COALESCE(NEW.description, NEW.type),
        'behavior',
        'supervisor',
        NEW.level >= 2,
        NEW.level + 1,
        NOW()
    );

    IF NEW.summon_guardian = true AND student_record.guardian_phone IS NOT NULL THEN
        INSERT INTO public.notifications (title, message, type, target_audience, target_id, is_popup, priority, created_at)
        VALUES (
            'استدعاء ولي أمر',
            'نرجو حضوركم للمدرسة بخصوص الطالب ' || student_record.name || '. السبب: ' || COALESCE(NEW.description, NEW.type),
            'behavior',
            'guardian',
            NEW.student_id,
            true,
            3,
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.create_exit_notification()
RETURNS TRIGGER AS $$
DECLARE
    student_record RECORD;
BEGIN
    SELECT * INTO student_record FROM public.students WHERE id = NEW.student_id;

    INSERT INTO public.notifications (title, message, type, target_audience, is_popup, priority, created_at)
    VALUES (
        '🚪 استئذان طالب',
        'خرج الطالب ' || student_record.name || ' (' || student_record.class_name || ') من المدرسة. السبب: ' || COALESCE(NEW.reason, 'غير محدد'),
        'general',
        'supervisor',
        false,
        1,
        NOW()
    );

    IF student_record.guardian_phone IS NOT NULL THEN
        INSERT INTO public.notifications (title, message, type, target_audience, target_id, is_popup, priority, created_at)
        VALUES (
            'خروج من المدرسة',
            'نفيدكم بأن الطالب ' || student_record.name || ' غادر المدرسة. السبب: ' || COALESCE(NEW.reason, 'غير محدد'),
            'general',
            'guardian',
            NEW.student_id,
            false,
            1,
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
        COUNT(*) FILTER (WHERE status = 'late'),
        COUNT(*) FILTER (WHERE status = 'absent')
    INTO present_count, late_count, absent_count
    FROM public.attendance_logs
    WHERE date = today;

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
        GREATEST(total_students - present_count - late_count, 0),
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

CREATE OR REPLACE FUNCTION public.notify_absent_students()
RETURNS INTEGER AS $$
DECLARE
    today DATE := public.get_local_date();
    student_record RECORD;
    notification_count INTEGER := 0;
BEGIN
    FOR student_record IN
        SELECT s.* FROM public.students s
        WHERE s.is_active = true
        AND NOT EXISTS (
            SELECT 1 FROM public.attendance_logs a
            WHERE a.student_id = s.id
            AND a.date = today
        )
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.notifications n
            WHERE n.target_id = student_record.id
            AND n.type = 'attendance'
            AND DATE(n.created_at) = today
            AND n.title LIKE '%غياب%'
        ) THEN
            INSERT INTO public.notifications (title, message, type, target_audience, target_id, is_popup, priority, created_at)
            VALUES (
                '🚫 غياب طالب',
                'الطالب ' || student_record.name || ' (' || student_record.class_name || ' - ' || student_record.section || ') غائب اليوم.',
                'attendance',
                'supervisor',
                student_record.id,
                false,
                2,
                NOW()
            );

            notification_count := notification_count + 1;
        END IF;
    END LOOP;

    RETURN notification_count;
END;
$$ LANGUAGE plpgsql;
