# إعداد الاستبيانات الآمنة

قسم الاستبيانات يعتمد في النشر العام على Supabase، وتسجيل دخول الموظفين السحابي يمر عبر Edge Function محمية بـ Cloudflare Turnstile. الوضع المحلي يسمح بحفظ المسودات فقط حتى لا يُنشئ روابط لا تعمل خارج الجهاز.

## 1. قاعدة البيانات

طبّق الترحيل:

```bash
supabase db push
```

الترحيل `20260902090000_add_surveys.sql` ينشئ جداول الاستبيانات، ويجعل جدول المستخدمين للقراءة فقط عبر Data API، ثم يمرر إدارة المستخدمين عبر دوال محمية بجلسة المدير.

## 2. Turnstile

أنشئ Managed Widget في Cloudflare Turnstile وأضف نطاق الإنتاج، و`localhost` و`127.0.0.1` للتطوير. لا تضع المفتاح السري في ملفات Vite أو في المستودع.

أضف المفتاح العام إلى بيئة بناء الواجهة:

```env
VITE_TURNSTILE_SITE_KEY=your_public_site_key
```

وأضف القيم التالية من لوحة Supabase ضمن Edge Function Secrets:

- `TURNSTILE_SECRET`: المفتاح السري للـWidget.
- `TURNSTILE_HOSTNAMES`: أسماء المضيفين المسموح بها مفصولة بفاصلة، من دون بروتوكول أو مسار.
- `HADER_ALLOWED_ORIGINS`: أصول الواجهة الكاملة المسموح بها مفصولة بفاصلة، مثل `https://example.com`.

في الإنتاج لا تضف `localhost` أو `127.0.0.1` إلى `TURNSTILE_HOSTNAMES` أو `HADER_ALLOWED_ORIGINS` الخاصة ببيئة الإنتاج.

## 3. Edge Function

انشر نقطة الدخول العامة مع إيقاف فحص JWT؛ فهي تتحقق من Turnstile بنفسها ولا تكشف دوال كلمة المرور للمفتاح العام:

```bash
supabase functions deploy hader-auth --no-verify-jwt
```

تتحقق الدالة من `success` و`action=hader_login` واسم المضيف، ثم تطبق حداً لكل مصدر وحداً عالمياً قبل تنفيذ bcrypt. رمز Turnstile أحادي الاستخدام، لذلك يجب إعادة إنشاء التحقق بعد كل محاولة فاشلة.

## 4. رابط الاستبيان

اضبط رابط التطبيق العام المستخدم في رسائل الدعوة:

```env
VITE_APP_URL=https://your-production-domain.example
```

بعد تطبيق الترحيل ونشر الدالة، سجّل خروج المدير ثم ادخل مجدداً لإنشاء جلسة إدارة الاستبيانات الآمنة.
