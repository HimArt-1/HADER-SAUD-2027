-- =============================================================================
-- 🔧 HADER System - Fix assigned_classes Type Mismatch
-- =============================================================================
--
-- المشكلة: عمود assigned_classes في جدول users هو TEXT[] لكن الكود يستخدمه كـ JSONB
-- الحل: تحويل العمود من TEXT[] إلى JSONB
--
-- التعليمات:
-- 1. افتح Supabase Dashboard → SQL Editor
-- 2. انسخ والصق هذا الكود
-- 3. اضغط Run
--
-- =============================================================================

-- STEP 1: التحقق من نوع العمود الحالي
SELECT
  column_name,
  data_type,
  udt_name
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('assigned_classes', 'assigned_sections');

-- STEP 2: نسخ البيانات الحالية إلى عمود مؤقت (backup)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS assigned_classes_backup TEXT[];
UPDATE public.users SET assigned_classes_backup = assigned_classes WHERE assigned_classes IS NOT NULL;

-- STEP 3: حذف العمود القديم وإنشاء عمود جديد بنوع JSONB
ALTER TABLE public.users DROP COLUMN IF EXISTS assigned_classes CASCADE;
ALTER TABLE public.users ADD COLUMN assigned_classes JSONB DEFAULT NULL;

-- STEP 4: محاولة استعادة البيانات (إذا كانت بصيغة JSON)
-- هذا الكود سيحاول تحويل TEXT[] إلى JSONB إذا أمكن
-- إذا فشل، ستحتاج إضافة البيانات يدوياً من واجهة الإدارة

-- التحقق من النتيجة
SELECT
  id,
  username,
  name,
  role,
  assigned_classes,
  assigned_classes_backup
FROM public.users
WHERE role = 'supervisor_class';

-- =============================================================================
-- ملاحظة: إذا كان لديك مشرفين حالياً، ستحتاج إعادة إدخال الصفوف المسؤولين عنها
-- من واجهة الإدارة بعد تنفيذ هذا الكود
-- =============================================================================

-- OPTIONAL: حذف عمود النسخ الاحتياطي بعد التأكد من نجاح العملية
-- ALTER TABLE public.users DROP COLUMN IF EXISTS assigned_classes_backup;
