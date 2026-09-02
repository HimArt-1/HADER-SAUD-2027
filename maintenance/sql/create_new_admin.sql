-- =============================================================================
-- 🔐 نظام حاضر - سكربت إنشاء حساب مدير جديد
-- =============================================================================
-- 
-- 📌 الاستخدام:
-- 1. افتح Supabase Dashboard > SQL Editor
-- 2. عدّل البيانات أدناه حسب احتياجك
-- 3. اضغط Run أو Ctrl+Enter
--
-- ⚠️ تنبيه أمني:
-- - غيّر اسم المستخدم وكلمة المرور قبل الاستخدام في الإنتاج
-- - كلمة المرور مشفرة بخوارزمية PBKDF2 (100,000 iteration)
-- - لا تشارك هذا الملف مع أي شخص بعد تعديله
--
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 🎯 الخيار 1: إنشاء حساب site_admin (صلاحيات كاملة)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ كلمة المرور الافتراضية: Admin@2024 (غيّرها فوراً بعد أول تسجيل دخول!)

INSERT INTO users (
    username,
    password,
    password_hash_version,
    name,
    role,
    email,
    phone,
    is_active
)
VALUES (
    'new_admin',                    -- 👤 اسم المستخدم (غيّره)
    '100000:5daebe7cf7a1209558c91c7ceb22a0ac:642b9003bc9e168b3e9ef3eef5c48645cb770850e5962c4f6f8c58fbb9dff248',  -- 🔑 كلمة المرور: Admin@2024
    1,                              -- إصدار التشفير
    'مدير النظام الجديد',           -- 📛 الاسم الظاهر (غيّره)
    'site_admin',                   -- 🔐 الدور (site_admin = صلاحيات كاملة)
    'admin@school.edu.sa',          -- 📧 البريد الإلكتروني (اختياري)
    '0501234567',                   -- 📱 رقم الجوال (اختياري)
    true                            -- ✅ الحساب مفعّل
)
ON CONFLICT (username) DO UPDATE SET
    password = EXCLUDED.password,
    password_hash_version = EXCLUDED.password_hash_version,
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    is_active = EXCLUDED.is_active,
    updated_at = NOW()
-- ═══════════════════════════════════════════════════════════════════════════
-- 🎯 الخيار 2: إنشاء حساب school_admin (مدير مدرسة)
-- ═══════════════════════════════════════════════════════════════════════════

/*
-- ⚠️ كلمة المرور: Manager@123
INSERT INTO users (
    username,
    password,
    password_hash_version,
    name,
    role,
    email,
    phone,
    is_active
)
VALUES (
    'school_manager',               -- 👤 اسم المستخدم
    '100000:63215f61466a277d8aa1d14dc4fc2e37:1e8bcdfb789a78908147eb7d451e639032a5c35d9e016be672d73124d91b1335',
    1,
    'مدير المدرسة',                 -- 📛 الاسم الظاهر
    'school_admin',                 -- 🔐 الدور
    'manager@school.edu.sa',
    '0509876543',
    true
)
ON CONFLICT (username) DO UPDATE SET
    password = EXCLUDED.password,
    name = EXCLUDED.name,
    updated_at = NOW();
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 🎯 الخيار 3: إنشاء حساب مشرف (supervisor)
-- ═══════════════════════════════════════════════════════════════════════════

/*
-- ⚠️ كلمة المرور: Supervisor@1
INSERT INTO users (
    username,
    password,
    password_hash_version,
    name,
    role,
    assigned_classes,
    assigned_sections,
    is_active
)
VALUES (
    'supervisor1',                  -- 👤 اسم المستخدم
    '100000:ccf483596da3dc98cb202d06eb9756f7:5a73ecfcf4381931c3003166c094389004122afa7ba53ab6375fe9f9f82b87bf',
    1,
    'المشرف أحمد',                  -- 📛 الاسم الظاهر
    'supervisor_global',            -- 🔐 الدور (supervisor_global أو supervisor_class)
    ARRAY['الأول', 'الثاني'],       -- 📚 الفصول المسندة
    ARRAY['أ', 'ب', 'ج'],           -- 📝 الشُعب المسندة
    true
)
ON CONFLICT (username) DO NOTHING;
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 📊 التحقق من إنشاء الحساب
-- ═══════════════════════════════════════════════════════════════════════════

SELECT 
    id,
    username,
    name,
    role,
    email,
    phone,
    is_active,
    created_at,
    updated_at
FROM users 
WHERE username IN ('new_admin', 'school_manager', 'supervisor1')
ORDER BY created_at DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 🔄 تحديث كلمة مرور حساب موجود
-- ═══════════════════════════════════════════════════════════════════════════

/*
UPDATE users 
SET 
    password = '100000:NEW_SALT_HEX:NEW_HASH_HEX',
    password_hash_version = 1,
    updated_at = NOW()
WHERE username = 'existing_username';
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- ❌ حذف حساب (استخدم بحذر!)
-- ═══════════════════════════════════════════════════════════════════════════

/*
DELETE FROM users WHERE username = 'username_to_delete';
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 📋 عرض جميع المستخدمين
-- ═══════════════════════════════════════════════════════════════════════════

/*
SELECT 
    id,
    username,
    name,
    role,
    is_active,
    last_login,
    created_at
FROM users 
ORDER BY 
    CASE role
        WHEN 'site_admin' THEN 1
        WHEN 'school_admin' THEN 2
        WHEN 'supervisor_global' THEN 3
        WHEN 'supervisor_class' THEN 4
        WHEN 'watcher' THEN 5
        WHEN 'kiosk' THEN 6
        WHEN 'guardian' THEN 7
    END,
    created_at DESC;
*/

-- =============================================================================
-- 📝 ملاحظات:
-- =============================================================================
-- الأدوار المتاحة:
--   • site_admin       - مدير النظام (صلاحيات كاملة)
--   • school_admin     - مدير المدرسة
--   • supervisor_global - مشرف عام
--   • supervisor_class  - مشرف فصل
--   • watcher          - مراقب/حارس
--   • kiosk            - جهاز كيوسك
--   • guardian         - ولي أمر
--
-- لتوليد كلمة مرور مشفرة جديدة:
--   استخدم السكربت Python: generate_admin_hash.py
-- =============================================================================
