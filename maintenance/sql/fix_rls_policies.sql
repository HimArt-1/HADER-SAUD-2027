-- =============================================================================
-- إصلاح سياسات RLS - تشغيل هذا الملف في Supabase SQL Editor
-- =============================================================================
-- هذا الملف يضيف سياسات INSERT/UPDATE/DELETE المفقودة لجميع الجداول
-- =============================================================================

-- سياسات جدول الطلاب (students)
DROP POLICY IF EXISTS "Enable insert for all" ON students;
CREATE POLICY "Enable insert for all" ON students FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON students;
CREATE POLICY "Enable update for all" ON students FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON students;
CREATE POLICY "Enable delete for all" ON students FOR DELETE USING (true);

-- سياسات جدول الفصول (classes)
DROP POLICY IF EXISTS "Enable insert for all" ON classes;
CREATE POLICY "Enable insert for all" ON classes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON classes;
CREATE POLICY "Enable update for all" ON classes FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON classes;
CREATE POLICY "Enable delete for all" ON classes FOR DELETE USING (true);

-- سياسات جدول المستخدمين (users)
DROP POLICY IF EXISTS "Enable insert for all" ON users;
CREATE POLICY "Enable insert for all" ON users FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON users;
CREATE POLICY "Enable update for all" ON users FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON users;
CREATE POLICY "Enable delete for all" ON users FOR DELETE USING (true);

-- سياسات جدول سجلات الحضور (attendance_logs)
DROP POLICY IF EXISTS "Enable insert for auth" ON attendance_logs;
CREATE POLICY "Enable insert for auth" ON attendance_logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for auth" ON attendance_logs;
CREATE POLICY "Enable update for auth" ON attendance_logs FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON attendance_logs;
CREATE POLICY "Enable delete for all" ON attendance_logs FOR DELETE USING (true);

-- سياسات جدول الإعدادات (settings)
DROP POLICY IF EXISTS "Enable insert for all" ON settings;
CREATE POLICY "Enable insert for all" ON settings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON settings;
CREATE POLICY "Enable update for all" ON settings FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON settings;
CREATE POLICY "Enable delete for all" ON settings FOR DELETE USING (true);

-- سياسات جدول الاستئذان (exits)
DROP POLICY IF EXISTS "Enable insert for all" ON exits;
CREATE POLICY "Enable insert for all" ON exits FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON exits;
CREATE POLICY "Enable update for all" ON exits FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON exits;
CREATE POLICY "Enable delete for all" ON exits FOR DELETE USING (true);

-- سياسات جدول المخالفات (violations)
DROP POLICY IF EXISTS "Enable insert for all" ON violations;
CREATE POLICY "Enable insert for all" ON violations FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON violations;
CREATE POLICY "Enable update for all" ON violations FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON violations;
CREATE POLICY "Enable delete for all" ON violations FOR DELETE USING (true);

-- سياسات جدول الإشعارات (notifications)
DROP POLICY IF EXISTS "Enable insert for all" ON notifications;
CREATE POLICY "Enable insert for all" ON notifications FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON notifications;
CREATE POLICY "Enable update for all" ON notifications FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON notifications;
CREATE POLICY "Enable delete for all" ON notifications FOR DELETE USING (true);

-- سياسات جدول الملخصات اليومية (daily_summaries)
DROP POLICY IF EXISTS "Enable insert for all" ON daily_summaries;
CREATE POLICY "Enable insert for all" ON daily_summaries FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON daily_summaries;
CREATE POLICY "Enable update for all" ON daily_summaries FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON daily_summaries;
CREATE POLICY "Enable delete for all" ON daily_summaries FOR DELETE USING (true);

-- سياسات جدول Rate Limits
DROP POLICY IF EXISTS "Enable insert for all" ON rate_limits;
CREATE POLICY "Enable insert for all" ON rate_limits FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON rate_limits;
CREATE POLICY "Enable update for all" ON rate_limits FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON rate_limits;
CREATE POLICY "Enable delete for all" ON rate_limits FOR DELETE USING (true);

-- سياسات جدول سجلات التدقيق (audit_logs)
DROP POLICY IF EXISTS "Enable insert for all" ON audit_logs;
CREATE POLICY "Enable insert for all" ON audit_logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all" ON audit_logs;
CREATE POLICY "Enable update for all" ON audit_logs FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all" ON audit_logs;
CREATE POLICY "Enable delete for all" ON audit_logs FOR DELETE USING (true);

-- =============================================================================
-- تم الانتهاء - جميع السياسات تم إضافتها بنجاح
-- =============================================================================
