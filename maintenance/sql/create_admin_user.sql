-- =============================================================================
-- إنشاء حساب المدير في Supabase باستخدام بيانات مخصصة (لا تستخدم بيانات افتراضية)
-- =============================================================================
-- 
-- الاستخدام:
-- 1. افتح Supabase Dashboard
-- 2. اذهب إلى SQL Editor
-- 3. انسخ هذا الكود والصقه
-- 4. اضغط Run أو Ctrl+Enter
--
-- =============================================================================

-- استبدل القيم بين القوسين ببيانات قوية وفريدة قبل التنفيذ
INSERT INTO users (username, password, name, role, is_active)
VALUES ('<ADMIN_USERNAME>', '<ADMIN_PASSWORD>', '<ADMIN_NAME>', 'site_admin', true)
ON CONFLICT (username) DO NOTHING;

-- التحقق من إنشاء المستخدم
SELECT 
    id,
    username,
    name,
    role,
    is_active,
    created_at
FROM users 
WHERE username = '<ADMIN_USERNAME>';

-- =============================================================================
-- إذا ظهرت رسالة "ON CONFLICT" غير مدعومة، استخدم هذا بدلاً منه:
-- =============================================================================

-- DELETE FROM users WHERE username = '<ADMIN_USERNAME>';  -- احذف إذا كان موجوداً
-- INSERT INTO users (username, password, name, role, is_active)
-- VALUES ('<ADMIN_USERNAME>', '<ADMIN_PASSWORD>', '<ADMIN_NAME>', 'site_admin', true);

-- =============================================================================

