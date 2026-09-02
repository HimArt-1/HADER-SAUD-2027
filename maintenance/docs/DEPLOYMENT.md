# 🚀 دليل النشر - نظام حاضر (Hader System)

## ✅ قائمة التحقق قبل النشر

### 1. قاعدة البيانات (Supabase)
- [ ] تأكد من إنشاء مشروع على [Supabase](https://supabase.com)
- [ ] شغّل ملف `schema.sql` في SQL Editor
- [ ] شغّل ملف `FIX_SETTINGS_RLS.sql` لإصلاح الصلاحيات
- [ ] تحقق من إنشاء المستخدم الافتراضي:
  - Username: `admin`
  - Password: `admin123`

### 2. المتغيرات البيئية
أنشئ ملف `.env` يحتوي على:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_APP_MODE=cloud
VITE_ALLOW_LOCAL_FALLBACK=false
VITE_WHATSAPP_API_KEY=your-secure-key-here

# اختياري — يفعّل قناة Native (DMG/EXE) لزرّي تنزيل سطح المكتب
# انظر: maintenance/docs/DESKTOP_APP_GUIDE.md (القسم 4)
# VITE_DESKTOP_RELEASE_URL=https://cdn.example.com/desktop/manifest.json
```

### 3. النشر على Vercel

#### الخطوة 1: ربط المستودع
```bash
# تأكد من رفع الكود على GitHub أولاً
git add .
git commit -m "Prepare for deployment"
git push origin main
```

#### الخطوة 2: إعداد Vercel
1. اذهب إلى [Vercel](https://vercel.com)
2. اضغط "New Project"
3. اختر المستودع من GitHub
4. أضف المتغيرات البيئية:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_MODE` = `cloud`
   - `VITE_ALLOW_LOCAL_FALLBACK` = `false`
5. اضغط "Deploy"

### 4. إعدادات إضافية

#### تفعيل HTTPS (تلقائي على Vercel)
الـ HTTPS مفعّل تلقائياً على Vercel.

#### تخصيص الدومين (اختياري)
1. في Vercel Dashboard → Settings → Domains
2. أضف الدومين الخاص بك

---

## 🧪 تحقق متعدد الأجهزة (إلزامي قبل الإطلاق)

قبل اعتماد النشر للإنتاج، نفّذ دليل الفحص التالي بالكامل:

- `maintenance/docs/CROSS_DEVICE_VALIDATION_CHECKLIST.md`

هذا الفحص يغطي:

- ثبات المزامنة بين جهازين.
- منع تكرار الإشعارات.
- سلامة watermark والتشخيصات.
- سلوك النظام عند انقطاع الشبكة والعودة.

> 💻 **النسخة المكتبية**: لتفعيل وإدارة قناة Native (`.dmg` / `.exe`) أو فهم آلية المشغّل
> الذكي خفيف الوزن، راجع: `maintenance/docs/DESKTOP_APP_GUIDE.md`.

---

## 📋 أوامر مفيدة

```bash
# تشغيل محلي
npm run dev

# بناء للإنتاج
npm run build

# معاينة البناء
npm run preview

# تشغيل الاختبارات
npm run test
```

---

## 🔧 WhatsApp Automation (اختياري)

إذا كنت تريد تشغيل خادم WhatsApp:

### متطلبات
- Python 3.10+
- Google Chrome

### التثبيت
```bash
cd whatsapp
python3 -m venv venv
source venv/bin/activate  # على Mac/Linux
pip install flask flask-cors pillow pandas selenium webdriver-manager
```

### التشغيل
```bash
source venv/bin/activate
python3 server.py
```

### الأمان (Security)
يجب إضافة المتغير التالي إلى ملف `.env` لضمان أمان الخادم:
```env
WHATSAPP_API_KEY=your-secure-key-here
```
يمكنك توليد مفتاح عشوائي باستخدام:
```bash
openssl rand -hex 32
```

### ملاحظة مهمة
خادم WhatsApp يجب أن يعمل على نفس الجهاز الذي يفتح فيه المتصفح (لا يمكن نشره على Vercel).

### حزمة «تحميل المشغل» على الواجهة
قبل النشر، يجب أن يُبنى أرشيف ZIP حقيقي تحت `public/downloads/whatsapp/hader_whatsapp_pro.zip`. المشروع يولّده تلقائياً عند **`npm run build`** عبر `scripts/bundle-whatsapp-launcher.mjs` (يضم `server.py` و`whatsapp_pro_tool.py` و`requirements.txt` و`run_windows.bat` و`run_mac.sh` وغيرها من مجلد `/whatsapp/`). في `vercel.json` يجب ألا يُعاد توجيه مسار `/downloads/...` إلى `index.html` وإلا يحمّل المتصفح صفحة HTML بدلاً من الـ ZIP.

---

## 📊 هيكل المشروع

```
hader+whatsapp/
├── pages/           # صفحات التطبيق
├── components/      # المكونات
├── services/        # الخدمات (API, DB, Auth)
├── hooks/           # React Hooks
├── types/           # TypeScript Types
├── whatsapp/        # خادم WhatsApp (Python)
├── public/          # ملفات ثابتة
├── schema.sql       # هيكل قاعدة البيانات
└── dist/            # ملفات البناء (بعد npm run build)
```

---

## 🔐 الأمان

- ❌ لا ترفع ملف `.env` أبداً
- ❌ لا ترفع مجلدات `whatsapp_session/` أو `venv/`
- ✅ استخدم Variables في Vercel للأسرار
- ✅ تأكد من تفعيل RLS في Supabase

---

## 🆘 حل المشاكل

### خطأ 401 Unauthorized
شغّل ملف `FIX_SETTINGS_RLS.sql` في Supabase SQL Editor.

### الصفحة فارغة بعد النشر
تأكد من وجود `vercel.json` بهذا المحتوى:
```json
{
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### ChromeDriver لا يعمل
```bash
sudo xattr -cr ~/.wdm/drivers/chromedriver/
```

---

## 📞 الدعم

للمساعدة، راجع:
- `SUPABASE_SETUP_GUIDE.md` - إعداد Supabase
- `CONTRIBUTING.md` - المساهمة في المشروع
