-- =============================================================================
-- نظام حاضر (Hader) - Supabase Functions & Triggers
-- =============================================================================
-- هذا الملف يحتوي على الوظائف والمُشغّلات المتقدمة للنظام.
-- ترتيب التشغيل الكامل: maintenance/sql/00_EXECUTION_ORDER.sql
-- في SQL Editor عادةً:
--   1) maintenance/sql/supabase_schema.sql  (أو SQL_EDITOR_FULL.sql لتطوير فقط — يحذف بيانات)
--   2) هذا الملف — supabase_functions.sql
-- بدون الخطوة 1 سيظهر خطأ مثل: relation "attendance_logs" does not exist
-- =============================================================================

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t)
  INTO missing
  FROM unnest(array[
    'students',
    'settings',
    'notifications',
    'attendance_logs',
    'violations',
    'exits',
    'daily_summaries',
    'audit_logs',
    'rate_limits'
  ]) AS u(t)
  WHERE to_regclass('public.' || u.t) IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'supabase_functions.sql: missing table(s): %. Create schema first: run maintenance/sql/supabase_schema.sql (or SQL_EDITOR_FULL.sql), then re-run this file.',
      missing;
  END IF;
END $$;

-- =============================================================================
-- 1. وظائف مساعدة (Helper Functions)
-- =============================================================================

-- دالة للحصول على التاريخ المحلي
CREATE OR REPLACE FUNCTION get_local_date()
RETURNS DATE AS $$
BEGIN
    RETURN (NOW() AT TIME ZONE 'Asia/Riyadh')::DATE;
END;
$$ LANGUAGE plpgsql;

-- دالة للحصول على الوقت المحلي
CREATE OR REPLACE FUNCTION get_local_time()
RETURNS TIME AS $$
BEGIN
    RETURN (NOW() AT TIME ZONE 'Asia/Riyadh')::TIME;
END;
$$ LANGUAGE plpgsql;

-- دالة لتوليد UUID
CREATE OR REPLACE FUNCTION generate_uuid()
RETURNS TEXT AS $$
BEGIN
    RETURN gen_random_uuid()::TEXT;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. إشعارات تلقائية عند التأخر (Auto Late Notification)
-- =============================================================================

-- دالة إنشاء إشعار التأخر
CREATE OR REPLACE FUNCTION create_late_notification()
RETURNS TRIGGER AS $$
DECLARE
    student_record RECORD;
    assembly_time TIME;
    grace_period INTEGER;
    notification_id UUID;
BEGIN
    -- فقط عند إدخال سجل جديد بحالة "متأخر"
    IF NEW.status = 'late' THEN
        -- جلب بيانات الطالب
        SELECT * INTO student_record FROM students WHERE id = NEW.student_id;

        -- جلب إعدادات وقت الطابور
        SELECT
            COALESCE((s.kiosk_settings->>'assembly_time')::TIME, '07:00'::TIME),
            COALESCE((s.kiosk_settings->>'grace_period')::INTEGER, 15)
        INTO assembly_time, grace_period
        FROM settings s WHERE id = 1;

        -- إنشاء إشعار للمشرفين
        notification_id := gen_random_uuid();
        INSERT INTO notifications (id, title, message, type, target_audience, is_popup, priority, created_at)
        VALUES (
            notification_id,
            '⏰ تأخر طالب',
            'تأخر الطالب ' || student_record.name || ' (' || student_record.class_name || ' - ' || student_record.section || ') عن الحضور.',
            'attendance',
            'supervisor',
            true,
            2,
            NOW()
        );

        -- إنشاء إشعار لولي الأمر (إذا كان لديه رقم هاتف)
        IF student_record.guardian_phone IS NOT NULL THEN
            notification_id := gen_random_uuid();
            INSERT INTO notifications (id, title, message, type, target_audience, target_id, is_popup, priority, created_at)
            VALUES (
                notification_id,
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

-- إنشاء المُشغّل
DROP TRIGGER IF EXISTS trigger_late_notification ON attendance_logs;
CREATE TRIGGER trigger_late_notification
    AFTER INSERT ON attendance_logs
    FOR EACH ROW
    EXECUTE FUNCTION create_late_notification();

-- =============================================================================
-- 3. إشعارات المخالفات السلوكية (Violation Notifications)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_violation_notification()
RETURNS TRIGGER AS $$
DECLARE
    student_record RECORD;
    notification_id UUID;
    violation_emoji TEXT;
BEGIN
    -- جلب بيانات الطالب
    SELECT * INTO student_record FROM students WHERE id = NEW.student_id;

    -- تحديد الإيموجي حسب مستوى المخالفة
    violation_emoji := CASE NEW.level
        WHEN 1 THEN '⚠️'
        WHEN 2 THEN '🚨'
        WHEN 3 THEN '🔴'
        ELSE '📋'
    END;

    -- إشعار للمشرفين
    notification_id := gen_random_uuid();
    INSERT INTO notifications (id, title, message, type, target_audience, is_popup, priority, created_at)
    VALUES (
        notification_id,
        violation_emoji || ' مخالفة سلوكية',
        'تم تسجيل مخالفة على الطالب ' || student_record.name || ': ' || COALESCE(NEW.description, NEW.type),
        'behavior',
        'supervisor',
        NEW.level >= 2,  -- منبثق للمخالفات الخطيرة
        NEW.level + 1,
        NOW()
    );

    -- إشعار لولي الأمر إذا كان مستدعى
    IF NEW.summon_guardian = true AND student_record.guardian_phone IS NOT NULL THEN
        notification_id := gen_random_uuid();
        INSERT INTO notifications (id, title, message, type, target_audience, target_id, is_popup, priority, created_at)
        VALUES (
            notification_id,
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

DROP TRIGGER IF EXISTS trigger_violation_notification ON violations;
CREATE TRIGGER trigger_violation_notification
    AFTER INSERT ON violations
    FOR EACH ROW
    EXECUTE FUNCTION create_violation_notification();

-- =============================================================================
-- 4. إشعارات الاستئذان (Exit Notifications)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_exit_notification()
RETURNS TRIGGER AS $$
DECLARE
    student_record RECORD;
    notification_id UUID;
BEGIN
    SELECT * INTO student_record FROM students WHERE id = NEW.student_id;

    -- إشعار للمشرفين
    notification_id := gen_random_uuid();
    INSERT INTO notifications (id, title, message, type, target_audience, is_popup, priority, created_at)
    VALUES (
        notification_id,
        '🚪 استئذان طالب',
        'خرج الطالب ' || student_record.name || ' (' || student_record.class_name || ') من المدرسة. السبب: ' || COALESCE(NEW.reason, 'غير محدد'),
        'general',
        'supervisor',
        false,
        1,
        NOW()
    );

    -- إشعار لولي الأمر
    IF student_record.guardian_phone IS NOT NULL THEN
        notification_id := gen_random_uuid();
        INSERT INTO notifications (id, title, message, type, target_audience, target_id, is_popup, priority, created_at)
        VALUES (
            notification_id,
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

DROP TRIGGER IF EXISTS trigger_exit_notification ON exits;
CREATE TRIGGER trigger_exit_notification
    AFTER INSERT ON exits
    FOR EACH ROW
    EXECUTE FUNCTION create_exit_notification();

-- =============================================================================
-- 5. الملخص اليومي التلقائي (Daily Summary)
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_daily_summary()
RETURNS void AS $$
DECLARE
    today DATE := get_local_date();
    total_students INTEGER;
    present_count INTEGER;
    late_count INTEGER;
    absent_count INTEGER;
    exit_count INTEGER;
    violation_count INTEGER;
BEGIN
    -- حساب الإحصائيات
    SELECT COUNT(*) INTO total_students FROM students WHERE is_active = true;

    SELECT
        COUNT(*) FILTER (WHERE status = 'present'),
        COUNT(*) FILTER (WHERE status = 'late')
    INTO present_count, late_count
    FROM attendance_logs
    WHERE date = today;

    absent_count := GREATEST(total_students - present_count - late_count, 0);

    SELECT COUNT(*) INTO exit_count FROM exits WHERE DATE(exit_time) = today;
    SELECT COUNT(*) INTO violation_count FROM violations WHERE DATE(created_at) = today;

    -- إدخال أو تحديث الملخص
    INSERT INTO daily_summaries (
        id, date, total_students, present_count, late_count, absent_count,
        exit_count, violation_count, attendance_rate, created_at, updated_at
    ) VALUES (
        gen_random_uuid(),
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

-- =============================================================================
-- 6. تنظيف السجلات القديمة (Cleanup Old Records)
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_records(days_to_keep INTEGER DEFAULT 90)
RETURNS TABLE(
    deleted_notifications INTEGER,
    deleted_audit_logs INTEGER,
    deleted_rate_limits INTEGER
) AS $$
DECLARE
    cutoff_date TIMESTAMP := NOW() - (days_to_keep || ' days')::INTERVAL;
    notif_count INTEGER;
    audit_count INTEGER;
    rate_count INTEGER;
BEGIN
    -- حذف الإشعارات القديمة
    DELETE FROM notifications WHERE created_at < cutoff_date;
    GET DIAGNOSTICS notif_count = ROW_COUNT;

    -- حذف سجلات التدقيق القديمة
    DELETE FROM audit_logs WHERE created_at < cutoff_date;
    GET DIAGNOSTICS audit_count = ROW_COUNT;

    -- حذف سجلات Rate Limits القديمة
    DELETE FROM rate_limits WHERE created_at < cutoff_date;
    GET DIAGNOSTICS rate_count = ROW_COUNT;

    RETURN QUERY SELECT notif_count, audit_count, rate_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 7. إحصائيات الفصل (Class Statistics)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_class_statistics(
    p_class_name TEXT,
    p_section TEXT DEFAULT NULL,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL
)
RETURNS TABLE(
    total_students BIGINT,
    present_count BIGINT,
    late_count BIGINT,
    absent_count BIGINT,
    attendance_rate NUMERIC,
    total_exits BIGINT,
    total_violations BIGINT
) AS $$
DECLARE
    from_date DATE := COALESCE(p_from_date, get_local_date() - INTERVAL '30 days');
    to_date DATE := COALESCE(p_to_date, get_local_date());
BEGIN
    RETURN QUERY
    WITH student_ids AS (
        SELECT id FROM students
        WHERE class_name = p_class_name
        AND (p_section IS NULL OR section = p_section)
        AND is_active = true
    ),
    attendance_stats AS (
        SELECT
            COUNT(*) FILTER (WHERE status = 'present') as present,
            COUNT(*) FILTER (WHERE status = 'late') as late,
            COUNT(*) FILTER (WHERE status = 'absent') as absent
        FROM attendance_logs
        WHERE student_id IN (SELECT id FROM student_ids)
        AND date BETWEEN from_date AND to_date
    )
    SELECT
        (SELECT COUNT(*) FROM student_ids),
        COALESCE(a.present, 0),
        COALESCE(a.late, 0),
        COALESCE(a.absent, 0),
        CASE WHEN (a.present + a.late + a.absent) > 0
            THEN ROUND(((a.present + a.late)::NUMERIC / (a.present + a.late + a.absent)) * 100, 2)
            ELSE 0
        END,
        (SELECT COUNT(*) FROM exits WHERE student_id IN (SELECT id FROM student_ids) AND DATE(exit_time) BETWEEN from_date AND to_date),
        (SELECT COUNT(*) FROM violations WHERE student_id IN (SELECT id FROM student_ids) AND DATE(created_at) BETWEEN from_date AND to_date)
    FROM attendance_stats a;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 8. البحث المتقدم عن الطلاب (Advanced Student Search)
-- =============================================================================

CREATE OR REPLACE FUNCTION search_students(
    p_query TEXT DEFAULT NULL,
    p_class_name TEXT DEFAULT NULL,
    p_section TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
    id TEXT,
    name TEXT,
    class_name TEXT,
    section TEXT,
    guardian_phone TEXT,
    is_active BOOLEAN,
    attendance_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id::TEXT,
        s.name::TEXT,
        s.class_name::TEXT,
        s.section::TEXT,
        NULL::TEXT AS guardian_phone,
        s.is_active,
        COALESCE(
            (SELECT ROUND(
                (COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::NUMERIC /
                NULLIF(COUNT(*), 0)) * 100, 2
            )
            FROM attendance_logs a
            WHERE a.student_id = s.id
            AND a.date >= get_local_date() - INTERVAL '30 days'),
            0
        ) as attendance_rate
    FROM students s
    WHERE
        (p_query IS NULL OR s.name ILIKE '%' || p_query || '%' OR s.id ILIKE '%' || p_query || '%')
        AND (p_class_name IS NULL OR s.class_name = p_class_name)
        AND (p_section IS NULL OR s.section = p_section)
    ORDER BY s.name
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 9. إشعار الغياب الجماعي (Bulk Absence Notification)
-- =============================================================================

CREATE OR REPLACE FUNCTION notify_absent_students()
RETURNS INTEGER AS $$
DECLARE
    today DATE := get_local_date();
    student_record RECORD;
    notification_count INTEGER := 0;
    notification_id UUID;
BEGIN
    -- جلب الطلاب الذين ليس لديهم سجل حضور اليوم
    FOR student_record IN
        SELECT s.* FROM students s
        WHERE s.is_active = true
        AND NOT EXISTS (
            SELECT 1 FROM attendance_logs a
            WHERE a.student_id = s.id
            AND a.date = today
        )
    LOOP
        -- إشعار للمشرفين (مرة واحدة في اليوم لكل طالب)
        IF NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.target_id = student_record.id
            AND n.type = 'attendance'
            AND DATE(n.created_at) = today
            AND n.title LIKE '%غياب%'
        ) THEN
            notification_id := gen_random_uuid();
            INSERT INTO notifications (id, title, message, type, target_audience, target_id, is_popup, priority, created_at)
            VALUES (
                notification_id,
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

-- =============================================================================
-- 10. تحديث حقل updated_at تلقائياً
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- إضافة المُشغّل لجميع الجداول الرئيسية
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['students', 'users', 'classes', 'settings', 'daily_summaries'])
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trigger_update_timestamp ON %I;
            CREATE TRIGGER trigger_update_timestamp
                BEFORE UPDATE ON %I
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        ', tbl, tbl);
    END LOOP;
END;
$$;

-- =============================================================================
-- 11. Cron Job للملخص اليومي (يتطلب pg_cron extension)
-- =============================================================================

-- ملاحظة: هذا يتطلب تفعيل pg_cron في Supabase
-- يمكنك تفعيله من Dashboard > Database > Extensions

-- SELECT cron.schedule(
--     'daily-summary',
--     '0 14 * * *',  -- كل يوم الساعة 2 ظهراً (بتوقيت UTC = 5 عصراً بتوقيت السعودية)
--     'SELECT generate_daily_summary()'
-- );

-- SELECT cron.schedule(
--     'notify-absent',
--     '0 8 * * 0-4',  -- أيام الدراسة الساعة 8 صباحاً UTC = 11 صباحاً بتوقيت السعودية
--     'SELECT notify_absent_students()'
-- );

-- SELECT cron.schedule(
--     'cleanup-old-records',
--     '0 0 * * 0',  -- كل يوم أحد منتصف الليل
--     'SELECT cleanup_old_records(90)'
-- );

-- =============================================================================
-- 12. فهارس لتحسين الأداء (Performance Indexes)
-- =============================================================================

-- فهرس للبحث في الإشعارات
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_audience, target_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- فهرس للحضور
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_logs(student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_logs(status);

-- فهرس للطلاب
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name, section);
CREATE INDEX IF NOT EXISTS idx_students_active ON students(is_active);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);

-- فهرس للمخالفات
CREATE INDEX IF NOT EXISTS idx_violations_student ON violations(student_id);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(created_at);

-- فهرس للاستئذان
CREATE INDEX IF NOT EXISTS idx_exits_student ON exits(student_id);
CREATE INDEX IF NOT EXISTS idx_exits_date ON exits(exit_time);

-- =============================================================================
-- 13. صلاحيات الوظائف (Function Permissions)
-- =============================================================================

-- السماح للمستخدمين المجهولين بتنفيذ الوظائف
GRANT EXECUTE ON FUNCTION get_local_date() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_local_time() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_daily_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_statistics(TEXT, TEXT, DATE, DATE) TO anon, authenticated;
REVOKE ALL ON FUNCTION search_students(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_students(TEXT, TEXT, TEXT, INTEGER) TO authenticated;

-- =============================================================================
-- تم الانتهاء - جميع الوظائف والمُشغّلات تم إنشاؤها بنجاح
-- =============================================================================

-- ملخص ما تم إنشاؤه:
-- ✅ وظائف مساعدة (get_local_date, get_local_time, generate_uuid)
-- ✅ إشعارات تلقائية للتأخر
-- ✅ إشعارات تلقائية للمخالفات
-- ✅ إشعارات تلقائية للاستئذان
-- ✅ توليد الملخص اليومي
-- ✅ تنظيف السجلات القديمة
-- ✅ إحصائيات الفصل
-- ✅ البحث المتقدم
-- ✅ إشعار الغياب الجماعي
-- ✅ تحديث updated_at تلقائياً
-- ✅ فهارس الأداء
