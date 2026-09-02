# تطبيق Hardening على Supabase

هذا الدليل يشرح الطريقة الآمنة لتطبيق الترحيل:

- `supabase/migrations/20260506133000_harden_public_access_defaults.sql`

الهدف من هذا الترحيل:

- منع الاعتماد على جدول `guardian_login_security` كجدول عام مفتوح
- تقييد تنفيذ `search_students()` ومنع تسريب `guardian_phone`
- إزالة جدول `users` من `supabase_realtime`

## قبل التنفيذ

نفّذ هذه الخطوات أولًا:

1. خذ نسخة احتياطية أو snapshot من قاعدة البيانات.
2. طبّق الترحيل على بيئة staging إن توفرت.
3. تأكد أن إصدار التطبيق الحالي يتضمن التعديلات البرمجية المقابلة في:
   - `services/auth.ts`
   - `services/bootstrapAdmin.ts`
   - `services/db.ts`
   - `services/hybridProvider.ts`

## ترتيب التنفيذ

1. افتح Supabase Dashboard.
2. اذهب إلى `SQL Editor`.
3. نفّذ ملف الترحيل:
   - `supabase/migrations/20260506133000_harden_public_access_defaults.sql`
4. بعد نجاحه، نفّذ ملف التحقق:
   - `maintenance/sql/verify_public_access_hardening.sql`

## ما الذي يجب أن تراه بعد التنفيذ

- لا توجد سياسات عامة نشطة على `public.guardian_login_security`
- المستخدم `anon` لا يملك `SELECT/INSERT/UPDATE` على `guardian_login_security`
- المستخدم `anon` لا يملك `EXECUTE` على `public.search_students(...)`
- المستخدم `authenticated` يملك `EXECUTE` على `public.search_students(...)`
- الجدول `public.users` غير موجود داخل publication `supabase_realtime`

## تحقق تشغيلي داخل التطبيق

بعد تطبيق SQL، اختبر داخل التطبيق نفسه:

1. تسجيل دخول موظف `staff`
2. تسجيل دخول ولي أمر `guardian`
3. فتح شاشتين مختلفتين والتأكد أن تسجيل حضور جديد يصل بينهما
4. التأكد أن شاشة/ميزة البحث عن الطلاب ما زالت تعمل
5. التأكد أن صفحة الدعم أو السجلات لا تعتمد على `guardian_phone` من `search_students()`

## ملاحظات مهمة

- قفل محاولة دخول ولي الأمر أصبح محليًا في التطبيق، وليس في جدول Supabase العام.
- إذا كان لديك تكامل خارجي يعتمد على `search_students()` من دور `anon` فسيحتاج تعديلًا.
- إذا لاحظت توقف تحديثات Realtime مرتبطة بالمستخدمين، فهذا متوقع لأن `users` أُزيل من publication.

## عند ظهور مشكلة بعد التنفيذ

افحص أولًا:

1. هل التطبيق المرفوع يتضمن تحديث `services/auth.ts`؟
2. هل الترحيل طُبق على نفس المشروع الذي يستخدمه `VITE_SUPABASE_URL`؟
3. هل توجد سكربتات SQL يدوية قديمة أُعيد تشغيلها ووسّعت الصلاحيات مرة أخرى؟

إذا احتجت، يمكنني تجهيز لك أيضًا checklist rollback أو ملف SQL خاص بالمراجعة اليدوية قبل الإنتاج.
