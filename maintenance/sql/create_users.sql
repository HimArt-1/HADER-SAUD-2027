-- =============================================================================
-- نظام حاضر (Hader) — إنشاء حسابات المستخدمين
-- =============================================================================
-- 
-- 📌 الاستخدام:
--   1. افتح Supabase Dashboard → SQL Editor
--   2. انسخ القسم المطلوب والصقه
--   3. عدّل القيم المحاطة بـ <> ببياناتك الفعلية
--   4. اضغط Run أو Ctrl+Enter
--
-- 📌 الأدوار المتاحة:
--   • site_admin     → مدير النظام (صلاحيات كاملة)
--   • school_admin   → مدير المدرسة
--   • supervisor_global → مشرف عام
--   • supervisor_class  → مشرف فصل (يحتاج assigned_classes)
--   • watcher        → مراقب
--   • kiosk          → حساب كشك الحضور
--   • guardian       → ولي أمر
--
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1️⃣  إنشاء حساب مدير المدرسة (school_admin)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO users (username, password, name, role, is_active)
VALUES (
  '<SCHOOL_ADMIN_USERNAME>',   -- اسم المستخدم (مثال: school_admin_1)
  '<SCHOOL_ADMIN_PASSWORD>',   -- كلمة المرور
  '<اسم مدير المدرسة>',         -- الاسم الكامل (مثال: أ. أحمد الشهري)
  'school_admin',
  true
)
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();


-- ═══════════════════════════════════════════════════════════════
-- 2️⃣  إنشاء حساب مشرف عام
-- ═══════════════════════════════════════════════════════════════

-- INSERT INTO users (username, password, name, role, is_active)
-- VALUES (
--   '<SUPERVISOR_USERNAME>',
--   '<SUPERVISOR_PASSWORD>',
--   '<اسم المشرف>',
--   'supervisor_global',
--   true
-- )
-- ON CONFLICT (username) DO UPDATE SET
--   password = EXCLUDED.password,
--   name = EXCLUDED.name,
--   role = EXCLUDED.role,
--   is_active = EXCLUDED.is_active,
--   updated_at = NOW();


-- ═══════════════════════════════════════════════════════════════
-- 3️⃣  إنشاء حساب مشرف فصل (مع تعيين الفصول)
-- ═══════════════════════════════════════════════════════════════

-- INSERT INTO users (username, password, name, role, assigned_classes, is_active)
-- VALUES (
--   '<CLASS_SUPERVISOR_USERNAME>',
--   '<CLASS_SUPERVISOR_PASSWORD>',
--   '<اسم مشرف الفصل>',
--   'supervisor_class',
--   '[{"class_name": "الأول", "sections": ["أ", "ب"]}]'::jsonb,
--   true
-- )
-- ON CONFLICT (username) DO UPDATE SET
--   password = EXCLUDED.password,
--   name = EXCLUDED.name,
--   role = EXCLUDED.role,
--   assigned_classes = EXCLUDED.assigned_classes,
--   is_active = EXCLUDED.is_active,
--   updated_at = NOW();


-- ═══════════════════════════════════════════════════════════════
-- 4️⃣  إنشاء حساب مراقب
-- ═══════════════════════════════════════════════════════════════

-- INSERT INTO users (username, password, name, role, is_active)
-- VALUES (
--   '<WATCHER_USERNAME>',
--   '<WATCHER_PASSWORD>',
--   '<اسم المراقب>',
--   'watcher',
--   true
-- )
-- ON CONFLICT (username) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
-- 5️⃣  إنشاء حساب كشك
-- ═══════════════════════════════════════════════════════════════

-- INSERT INTO users (username, password, name, role, is_active)
-- VALUES (
--   'kiosk1',
--   'kiosk_secure_pass',
--   'كشك الحضور الرئيسي',
--   'kiosk',
--   true
-- )
-- ON CONFLICT (username) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
-- 6️⃣  إنشاء عدة حسابات دفعة واحدة (Batch Insert)
-- ═══════════════════════════════════════════════════════════════

-- INSERT INTO users (username, password, name, role, is_active) VALUES
--   ('supervisor1', 'pass123', 'مشرف الدور الأول', 'supervisor_global', true),
--   ('supervisor2', 'pass456', 'مشرف الدور الثاني', 'supervisor_global', true),
--   ('watcher1', 'watch123', 'مراقب البوابة', 'watcher', true)
-- ON CONFLICT (username) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
-- 🔍  عرض جميع المستخدمين
-- ═══════════════════════════════════════════════════════════════

SELECT 
  id,
  username,
  name,
  role,
  is_active,
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

-- =============================================================================
