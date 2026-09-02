# إعداد Supabase لنظام حاضر

## الخطوات بالترتيب

### الخطوة 1: إنشاء الجداول (Schema)
1. افتح Supabase Dashboard
2. اذهب إلى **SQL Editor**
3. انسخ والصق محتوى ملف `supabase_schema.sql`
4. اضغط **Run**

### الخطوة 2: إضافة سياسات RLS
1. في SQL Editor
2. انسخ والصق محتوى ملف `fix_rls_policies.sql`
3. اضغط **Run**

### الخطوة 3: إضافة الوظائف المتقدمة
1. في SQL Editor
2. انسخ والصق محتوى ملف `supabase_functions.sql`
3. اضغط **Run**

---

## ما الذي ستحصل عليه؟

### الإشعارات التلقائية
| الحدث | الإشعار |
|-------|---------|
| حضور متأخر | إشعار للمشرفين + ولي الأمر |
| مخالفة سلوكية | إشعار للمشرفين + استدعاء ولي الأمر (اختياري) |
| استئذان/خروج | إشعار للمشرفين + ولي الأمر |
| غياب | إشعار جماعي للغائبين |

### الوظائف المتاحة
```sql
-- توليد الملخص اليومي
SELECT generate_daily_summary();

-- إشعار الطلاب الغائبين
SELECT notify_absent_students();

-- تنظيف السجلات القديمة (90 يوم)
SELECT cleanup_old_records(90);

-- إحصائيات فصل معين
SELECT * FROM get_class_statistics('الأول', 'أ');

-- البحث عن طلاب
SELECT * FROM search_students('محمد');
```

ملاحظة أمنية:
- `search_students()` لم يعد متاحًا لدور `anon`، ويعيد `guardian_phone` كقيمة مخفية `NULL`.
- بعد تطبيق hardening الجديد، استخدم:
  - `supabase/migrations/20260506133000_harden_public_access_defaults.sql`
  - `maintenance/sql/verify_public_access_hardening.sql`

---

## إعداد Cron Jobs (اختياري)

### تفعيل pg_cron
1. اذهب إلى **Database** > **Extensions**
2. ابحث عن `pg_cron`
3. فعّله

### جدولة المهام
```sql
-- الملخص اليومي (5 عصراً بتوقيت السعودية)
SELECT cron.schedule('daily-summary', '0 14 * * *', 'SELECT generate_daily_summary()');

-- إشعار الغائبين (11 صباحاً أيام الدراسة)
SELECT cron.schedule('notify-absent', '0 8 * * 0-4', 'SELECT notify_absent_students()');

-- تنظيف أسبوعي
SELECT cron.schedule('cleanup', '0 0 * * 0', 'SELECT cleanup_old_records(90)');
```

---

## التحقق من النجاح

### اختبار الإشعارات
```sql
-- إدخال سجل حضور متأخر للاختبار
INSERT INTO attendance_logs (id, student_id, date, status, timestamp)
VALUES (
    gen_random_uuid()::text,
    (SELECT id FROM students LIMIT 1),
    CURRENT_DATE,
    'late',
    NOW()
);

-- التحقق من إنشاء الإشعار
SELECT * FROM notifications ORDER BY created_at DESC LIMIT 5;
```

### اختبار الوظائف
```sql
-- اختبار الملخص
SELECT generate_daily_summary();
SELECT * FROM daily_summaries WHERE date = CURRENT_DATE;

-- اختبار الإحصائيات
SELECT * FROM get_class_statistics('الأول');
```

---

## استكشاف الأخطاء

### خطأ: permission denied
تأكد من تشغيل `fix_rls_policies.sql`

### خطأ: function does not exist
تأكد من تشغيل `supabase_functions.sql`

### الإشعارات لا تظهر
1. تحقق من وجود المُشغّلات:
```sql
SELECT * FROM pg_trigger WHERE tgname LIKE 'trigger_%';
```

2. تحقق من الجداول:
```sql
SELECT COUNT(*) FROM notifications;
```

---

## الملفات

| الملف | الوظيفة |
|-------|---------|
| `supabase_schema.sql` | إنشاء الجداول |
| `fix_rls_policies.sql` | سياسات الأمان (RLS) |
| `supabase_functions.sql` | الوظائف والمُشغّلات |
