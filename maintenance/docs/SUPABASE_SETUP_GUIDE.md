# 🚀 دليل تحديث قاعدة البيانات - نظام حاضر

## 📋 نظرة عامة

هذا الدليل يشرح كيفية تطبيق التحديثات المطلوبة على قاعدة بيانات Supabase لحل الأخطاء وتحسين الأداء.

---

## ❌ المشاكل الحالية

عند فحص Console في المتصفح، تظهر الأخطاء التالية:

### 1. خطأ 401 - Unauthorized
```
POST https://.../rest/v1/auth_audit_logs 401 (Unauthorized)
```
**السبب:** جدول `auth_audit_logs` غير موجود أو صلاحيات RLS غير صحيحة

### 2. خطأ 404 - Not Found
```
POST https://.../rest/v1/client_error_logs 404 (Not Found)
```
**السبب:** جدول `client_error_logs` غير موجود في قاعدة البيانات

### 3. خطأ assigned_classes (تم حله)
```
TypeError: Cannot read properties of undefined (reading 'length')
```
**الحالة:** ✅ تم الحل في الكود

---

## ✅ الحل: تنفيذ ملف SQL

### الخطوة 1: الدخول إلى Supabase Dashboard

1. افتح [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. اختر مشروعك
3. من القائمة الجانبية، اختر **SQL Editor**

### الخطوة 2: تنفيذ ملف التحديثات

1. افتح ملف `SUPABASE_REQUIRED_UPDATES.sql`
2. انسخ **كامل** محتوى الملف
3. الصقه في SQL Editor
4. اضغط **Run** أو `Ctrl + Enter`

### الخطوة 3: التحقق من النجاح

يجب أن ترى رسائل نجاح مثل:
```
Success. No rows returned
```

في الأسفل، ستظهر جداول الإحصائيات:
```
table_name          | total_records | unique_users | latest_record
--------------------|---------------|--------------|---------------
auth_audit_logs     | 0             | 0            | NULL
client_error_logs   | 0             | 0            | NULL
```

---

## 📦 ما الذي يتم إنشاؤه؟

### 1. جدول `auth_audit_logs`
يسجل كل محاولات تسجيل الدخول والخروج:
- **معلومات المستخدم:** ID، الصلاحية، الاسم
- **معلومات الجلسة:** Session key، IP، User agent
- **الإجراء:** LOGIN, LOGOUT, SESSION_RESTORE, SESSION_EXPIRED

### 2. جدول `client_error_logs`
يسجل كل الأخطاء التي تحدث في المتصفح:
- **نوع الخطأ:** ERROR أو WARN
- **المصدر:** window.onerror, unhandledrejection, react-boundary
- **التفاصيل:** الرسالة، Stack trace، المسار

### 3. دالة `cleanup_telemetry_logs()`
دالة لحذف السجلات القديمة (أكثر من 90 يوم) تلقائياً.

### 4. Row Level Security (RLS) Policies
صلاحيات الأمان:
- **الإضافة:** مسموح للجميع (لتسجيل الأحداث)
- **القراءة:** مسموح لـ `site_admin` فقط

### 5. تحسينات على جدول `users`
- إصلاح قيم `assigned_classes` الخاطئة
- تحويل `'null'` (string) إلى `NULL` (database null)
- التأكد من أن `sections` دائماً array صحيح

---

## 🔧 ما بعد التنفيذ

### 1. إعادة تحميل التطبيق
```bash
# في المتصفح
F5 أو Ctrl+R
```

### 2. فحص Console
يجب أن تختفي أخطاء 401 و 404. يجب أن ترى فقط:
```
✅ Using CloudProvider (Supabase)
✅ Hader System Ready
✅ Loaded X students from Supabase
```

### 3. تجربة إضافة مشرف
1. اذهب إلى **واجهة الإدارة** → **المستخدمون**
2. أضف مشرف صف جديد
3. اختر صفوف وأقسام
4. يجب أن يعمل بدون أخطاء

### 4. عرض Telemetry Logs
1. اذهب إلى **واجهة الدعم** → **Telemetry**
2. ستجد سجلات تسجيل الدخول والأخطاء

---

## 🛡️ صلاحيات الأمان (RLS)

### جدول `auth_audit_logs`

| عملية | من يستطيع؟ | الشرط |
|-------|------------|-------|
| INSERT | الجميع | لتسجيل محاولات الدخول |
| SELECT | site_admin فقط | لحماية البيانات الحساسة |
| UPDATE | ممنوع | السجلات للقراءة فقط |
| DELETE | ممنوع | للحفاظ على Audit trail |

### جدول `client_error_logs`

| عملية | من يستطيع؟ | الشرض |
|-------|------------|-------|
| INSERT | الجميع | لتسجيل الأخطاء من المتصفح |
| SELECT | site_admin فقط | لحماية معلومات الأخطاء |
| UPDATE | ممنوع | السجلات للقراءة فقط |
| DELETE | ممنوع | للحفاظ على سجل الأخطاء |

---

## 📝 إنشاء مستخدم Site Admin جديد

إذا كنت تريد إنشاء حساب مدير جديد:

### الطريقة 1: عبر SQL Editor

```sql
INSERT INTO public.users (username, password, name, role, is_active, assigned_classes)
VALUES (
  'admin2024',              -- اسم المستخدم
  'YourSecurePassword123',  -- كلمة المرور
  'المدير العام',          -- الاسم
  'site_admin',             -- الصلاحية
  true,                     -- نشط
  NULL                      -- لا يحتاج أقسام
)
ON CONFLICT (username) DO NOTHING;
```

### الطريقة 2: عبر واجهة الإدارة

1. سجل دخول كـ مدير موجود
2. اذهب إلى **المستخدمون**
3. أضف مستخدم جديد
4. اختر صلاحية **Site Admin**

---

## 🔍 الاستعلامات المفيدة

### عرض آخر 10 محاولات تسجيل دخول
```sql
SELECT
  created_at,
  action,
  actor_label,
  actor_role,
  ip_hint,
  LEFT(user_agent, 50) AS browser
FROM public.auth_audit_logs
ORDER BY created_at DESC
LIMIT 10;
```

### عرض الأخطاء الحديثة
```sql
SELECT
  created_at,
  severity,
  source,
  message,
  path,
  actor_role
FROM public.client_error_logs
WHERE severity = 'ERROR'
ORDER BY created_at DESC
LIMIT 10;
```

### عرض المستخدمين المشرفين على أقسام
```sql
SELECT
  username,
  name,
  role,
  jsonb_pretty(assigned_classes) AS assigned_classes
FROM public.users
WHERE role = 'supervisor_class'
  AND assigned_classes IS NOT NULL;
```

### إحصائيات الحضور اليوم
```sql
SELECT
  date,
  COUNT(*) AS total_records,
  COUNT(*) FILTER (WHERE status = 'present') AS present,
  COUNT(*) FILTER (WHERE status = 'late') AS late,
  COUNT(*) FILTER (WHERE status = 'absent') AS absent
FROM public.attendance_logs
WHERE date = CURRENT_DATE
GROUP BY date;
```

---

## 🧹 صيانة دورية

### حذف سجلات telemetry القديمة (90+ يوم)

```sql
-- تشغيل يدوي
SELECT public.cleanup_telemetry_logs(90);

-- النتيجة المتوقعة:
{
  "auth_deleted": 150,
  "error_deleted": 50,
  "retention_days": 90,
  "executed_at": "2024-01-15T10:30:00Z"
}
```

### تعديل مدة الحفظ (من 90 يوم إلى 30 يوم)

```sql
UPDATE public.settings
SET telemetry_retention_days = 30
WHERE id = 1;

-- ثم تشغيل التنظيف
SELECT public.cleanup_telemetry_logs(30);
```

---

## ⚠️ ملاحظات مهمة

### 1. النسخ الاحتياطي
قبل تنفيذ أي تحديثات، يُنصح بعمل نسخة احتياطية:
```bash
# في Supabase Dashboard
Database → Backups → Create Backup
```

### 2. كلمات المرور
- ❌ **لا تستخدم** كلمات مرور بسيطة مثل `admin`, `123456`
- ✅ **استخدم** كلمات مرور قوية: حروف كبيرة + صغيرة + أرقام + رموز
- ⚡ **الأفضل:** استخدام bcrypt hash

### 3. صلاحيات RLS
- الجداول الجديدة لديها RLS مفعّل تلقائياً
- فقط `site_admin` يستطيع قراءة السجلات
- الجميع يستطيع إضافة سجلات (للتتبع)

### 4. الأداء
- الفهارس (indexes) تم إنشاؤها تلقائياً
- السجلات القديمة تُحذف تلقائياً كل ليلة (00:30)
- لا تأثير على أداء التطبيق

---

## 🆘 استكشاف الأخطاء

### خطأ: "relation already exists"
**الحل:** الجداول موجودة بالفعل. هذا طبيعي إذا نفذت الـ migration سابقاً.

### خطأ: "permission denied"
**الحل:** تأكد أنك مسجل دخول بصلاحيات `site_admin` في Supabase Dashboard.

### الأخطاء لا تزال موجودة بعد التحديث
**الحل:**
1. امسح Cache المتصفح (`Ctrl+Shift+Delete`)
2. أعد تحميل الصفحة بالقوة (`Ctrl+Shift+R`)
3. تحقق من Console لرسائل جديدة

### لا أستطيع رؤية Telemetry Logs في Support
**الحل:**
1. تأكد من تنفيذ SQL بنجاح
2. تأكد من أنك مسجل دخول كـ `site_admin`
3. جرّب إعادة تسجيل الدخول لتوليد سجلات جديدة

---

## 📊 الفوائد المكتسبة

بعد تطبيق هذه التحديثات:

✅ **حل الأخطاء في Console** - اختفاء 401 و 404
✅ **تتبع النشاط** - سجل كامل لمحاولات الدخول
✅ **مراقبة الأخطاء** - تسجيل تلقائي لجميع الأخطاء
✅ **إدارة أفضل** - واجهة Support تعرض كل التفاصيل
✅ **أداء محسّن** - فهارس تسرّع الاستعلامات
✅ **أمان أقوى** - RLS يحمي البيانات الحساسة
✅ **صيانة تلقائية** - حذف السجلات القديمة كل ليلة

---

## 🎓 المزيد من المعلومات

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL JSON Functions](https://www.postgresql.org/docs/current/functions-json.html)
- [pg_cron Extension](https://github.com/citusdata/pg_cron)

---

## 📞 الدعم

إذا واجهت أي مشاكل:
1. تحقق من الـ Console logs
2. راجع هذا الدليل
3. تحقق من Supabase Dashboard → Logs
4. تحقق من Table Editor لرؤية البيانات مباشرة

---

**آخر تحديث:** 2024-01-26
**الإصدار:** 1.0
**نظام حاضر - HADER** 🎓
