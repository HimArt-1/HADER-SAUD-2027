-- =============================================================================
-- نظام حاضر (Hader) - حماية سجلات الحضور من الحذف
-- =============================================================================
-- هذا السكربت يضيف:
-- 1. Trigger لتسجيل أي حذف لسجلات الحضور في audit_logs (للاسترجاع لاحقاً)
-- 2. وظيفة لاسترجاع السجلات المحذوفة لتاريخ معين
-- =============================================================================

-- 1. إنشاء Trigger لتسجيل عمليات الحذف تلقائياً
CREATE OR REPLACE FUNCTION audit_attendance_delete()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_logs (action, table_name, record_id, old_data)
    VALUES (
        'DELETE',
        'attendance_logs',
        OLD.id::text,
        to_jsonb(OLD)
    );
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- إنشاء الـ Trigger (يحذف القديم أولاً إن وجد)
DROP TRIGGER IF EXISTS trg_audit_attendance_delete ON attendance_logs;
CREATE TRIGGER trg_audit_attendance_delete
    BEFORE DELETE ON attendance_logs
    FOR EACH ROW
    EXECUTE FUNCTION audit_attendance_delete();

-- =============================================================================
-- 2. وظيفة استرجاع السجلات المحذوفة لتاريخ معين
-- =============================================================================
CREATE OR REPLACE FUNCTION recover_deleted_attendance(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    recovered_count INTEGER
) AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    INSERT INTO attendance_logs (id, student_id, date, timestamp, status, minutes_late, recorded_by, device_id, created_at)
    SELECT 
        COALESCE((al.old_data->>'id')::uuid, gen_random_uuid()),
        al.old_data->>'student_id',
        (al.old_data->>'date')::date,
        COALESCE((al.old_data->>'timestamp')::timestamptz, NOW()),
        al.old_data->>'status',
        COALESCE((al.old_data->>'minutes_late')::integer, 0),
        (al.old_data->>'recorded_by')::uuid,
        al.old_data->>'device_id',
        COALESCE((al.old_data->>'created_at')::timestamptz, NOW())
    FROM audit_logs al
    WHERE al.table_name = 'attendance_logs'
      AND al.action = 'DELETE'
      AND (al.old_data->>'date')::date = target_date
      AND NOT EXISTS (
          SELECT 1 FROM attendance_logs att 
          WHERE att.student_id = al.old_data->>'student_id' 
          AND att.date = (al.old_data->>'date')::date
      )
    ON CONFLICT (student_id, date) DO NOTHING;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 3. للاستخدام الفوري: استرجاع سجلات اليوم
-- =============================================================================
-- SELECT * FROM recover_deleted_attendance(CURRENT_DATE);

-- أو لتاريخ محدد:
-- SELECT * FROM recover_deleted_attendance('2026-05-11');
