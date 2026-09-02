-- =============================================================================
-- 🔧 إصلاح صلاحيات RLS لجميع الجداول
-- قم بتشغيل هذا في SQL Editor في Supabase Dashboard
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════
-- 📋 SETTINGS - الإعدادات
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for settings" ON settings;
CREATE POLICY "Enable insert for settings" ON settings 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for settings" ON settings;
CREATE POLICY "Enable update for settings" ON settings 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for settings" ON settings;
CREATE POLICY "Enable delete for settings" ON settings 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 👨‍🎓 STUDENTS - الطلاب
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for students" ON students;
CREATE POLICY "Enable insert for students" ON students 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for students" ON students;
CREATE POLICY "Enable update for students" ON students 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for students" ON students;
CREATE POLICY "Enable delete for students" ON students 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 🏫 CLASSES - الفصول
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for classes" ON classes;
CREATE POLICY "Enable insert for classes" ON classes 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for classes" ON classes;
CREATE POLICY "Enable update for classes" ON classes 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for classes" ON classes;
CREATE POLICY "Enable delete for classes" ON classes 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 👥 USERS - المستخدمين
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for users" ON users;
CREATE POLICY "Enable insert for users" ON users 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for users" ON users;
CREATE POLICY "Enable update for users" ON users 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for users" ON users;
CREATE POLICY "Enable delete for users" ON users 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 🚪 EXITS - الاستئذان
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for exits" ON exits;
CREATE POLICY "Enable insert for exits" ON exits 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for exits" ON exits;
CREATE POLICY "Enable update for exits" ON exits 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for exits" ON exits;
CREATE POLICY "Enable delete for exits" ON exits 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- ⚠️ VIOLATIONS - المخالفات
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for violations" ON violations;
CREATE POLICY "Enable insert for violations" ON violations 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for violations" ON violations;
CREATE POLICY "Enable update for violations" ON violations 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for violations" ON violations;
CREATE POLICY "Enable delete for violations" ON violations 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 🔔 NOTIFICATIONS - الإشعارات
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for notifications" ON notifications;
CREATE POLICY "Enable insert for notifications" ON notifications 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for notifications" ON notifications;
CREATE POLICY "Enable update for notifications" ON notifications 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for notifications" ON notifications;
CREATE POLICY "Enable delete for notifications" ON notifications 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 📊 DAILY_SUMMARIES - ملخصات يومية
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for daily_summaries" ON daily_summaries;
CREATE POLICY "Enable insert for daily_summaries" ON daily_summaries 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for daily_summaries" ON daily_summaries;
CREATE POLICY "Enable update for daily_summaries" ON daily_summaries 
FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for daily_summaries" ON daily_summaries;
CREATE POLICY "Enable delete for daily_summaries" ON daily_summaries 
FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 📝 AUDIT_LOGS - سجلات التدقيق
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Enable insert for audit_logs" ON audit_logs;
CREATE POLICY "Enable insert for audit_logs" ON audit_logs 
FOR INSERT WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- ✅ تأكيد وجود صف الإعدادات الأساسي
-- ═══════════════════════════════════════════════════════════════
INSERT INTO settings (id, system_ready, school_active) 
VALUES (1, true, true) 
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- ✅ تم! الآن يجب أن تختفي رسائل 401 Unauthorized
-- =============================================================================
