# 🎓 نظام حاضر (HADER System)

<div align="center">

![HADER Logo](public/images/hader-logo.png)

**نظام إدارة مدرسية متكامل لإدارة الحضور والانصراف والمتابعة السلوكية**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.1-646CFF?logo=vite)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com/)

[العربية](#arabic) | [English](#english)

</div>

---

<a name="arabic"></a>

## 📋 المحتويات

- [نظرة عامة](#نظرة-عامة)
- [المميزات](#المميزات)
- [التقنيات المستخدمة](#التقنيات-المستخدمة)
- [متطلبات التشغيل](#متطلبات-التشغيل)
- [التثبيت](#التثبيت)
- [الإعداد](#الإعداد)
- [الاستخدام](#الاستخدام)
- [البنية](#البنية)
- [المساهمة](#المساهمة)
- [الترخيص](#الترخيص)

---

## 🎯 نظرة عامة

**نظام حاضر (HADER)** هو منصة إدارة مدرسية متكاملة ومتقدمة تهدف إلى تسهيل وأتمتة عمليات إدارة الحضور والانصراف والمتابعة السلوكية للطلاب في المؤسسات التعليمية.

### ✨ لماذا نظام حاضر؟

- ⚡ **سريع وسهل الاستخدام** - واجهة مستخدم بديهية وسلسة
- 🔒 **آمن ومشفر** - حماية عالية للبيانات الحساسة
- 📱 **متجاوب** - يعمل على جميع الأجهزة (حاسوب، لوحي، جوال)
- 🌐 **دعم كامل للعربية** - واجهة RTL احترافية
- 📊 **تقارير شاملة** - إحصائيات وتحليلات تفصيلية
- 🎨 **تصميم عصري** - Glass Morphism وتأثيرات Neon

---

## 🚀 المميزات

### 📝 إدارة الحضور والانصراف
- ✅ تسجيل حضور تلقائي عبر الباركود/QR Code
- ✅ تسجيل حضور وغياب يدوي من لوحة الإدارة
- ✅ احتساب التأخير تلقائياً حسب الإعدادات
- ✅ تتبع أوقات الدخول والخروج
- ✅ تقارير الغياب والتأخير اليومية/الشهرية

### 👨‍👩‍👦 المتابعة السلوكية
- 📌 تسجيل الانتهاكات السلوكية
- 📌 تصنيف وتتبع السلوك لكل طالب
- 📌 إشعارات فورية لأولياء الأمور
- 📌 نظام عقوبات ومكافآت

### 👥 إدارة المستخدمين (9 أدوار)
- 🔐 **Site Admin** - مدير النظام العام
- 🏫 **School Admin** - مدير المدرسة
- 👔 **Supervisor Global** - مشرف عام
- 👔 **Supervisor Class** - مشرف فصل
- 👮 **Watcher** - حارس/مراقب
- 🖥️ **Kiosk** - جهاز كيوسك آلي
- 👨‍👩‍👧 **Guardian** - ولي أمر

### 📊 التقارير والتحليلات
- 📈 لوحات تحكم تحليلية تفاعلية
- 📄 تقارير PDF و Excel قابلة للتحميل
- 📊 رسوم بيانية وإحصائيات شاملة
- 🎯 تحليل الأداء حسب الفصل/الطالب

### 🔔 نظام الإشعارات
- 📩 إشعارات فورية داخل التطبيق
- 📱 رسائل لأولياء الأمور
- ⚠️ تنبيهات التأخير والغياب
- 📢 استعلامات وأعذار

### 🎨 واجهة المستخدم
- 🌙 وضع ليلي (Dark Mode)
- ✨ تأثيرات Glass Morphism وNeon
- 🎭 خطوط عربية احترافية (Cairo, Tajawal, Amiri)
- 📐 تصميم RTL كامل

### 🔐 الأمان والحماية
- 🔒 تشفير كلمات المرور (PBKDF2 - 100,000 iteration)
- 🛡️ Rate Limiting لحماية من Brute Force
- ✅ Input Validation شامل
- 🚫 حماية من XSS و SQL Injection
- 🔑 جلسات آمنة مع انتهاء صلاحية

---

## 🛠️ التقنيات المستخدمة

### Frontend
- ⚛️ **React 18.2** - مكتبة UI الحديثة
- 📘 **TypeScript 5.2** - Type Safety كامل
- ⚡ **Vite 5.1** - Build Tool سريع
- 🎨 **TailwindCSS 3.4** - Utility-first CSS
- 📊 **Recharts 2.12** - رسوم بيانية تفاعلية
- 🔀 **React Router 6.22** - Routing

### Backend & Database
- 🗄️ **Supabase** - PostgreSQL Database
- ☁️ **Cloud/Local Mode** - يدعم الوضعين
- 💾 **LocalStorage** - تخزين محلي للبيانات

### Security & Performance
- 🔐 **crypto-js 4.2** - تشفير البيانات
- 🚀 **Lazy Loading** - تحميل تلقائي
- 💨 **Code Splitting** - تقسيم الكود
- 📦 **Bundle Optimization** - تحسين الحجم

### Additional Tools
- 📷 **JSBarcode 3.11** - توليد باركود
- 🔲 **QRCode 1.5** - توليد QR Code
- 📊 **xlsx 0.18** - معالجة Excel
- 📄 **jsPDF** - توليد PDF
- 🧪 **Vitest** - Testing Framework

---

## 📦 متطلبات التشغيل

### الحد الأدنى
- **Node.js**: 20.0 أو أعلى
- **npm**: 9.0 أو أعلى (أو yarn/pnpm)
- **متصفح حديث**: Chrome 90+, Firefox 88+, Safari 14+

### للتشغيل السحابي (اختياري)
- حساب **Supabase** مجاني أو مدفوع
- PostgreSQL 14+

---

## 🔧 التثبيت

### 1️⃣ استنساخ المستودع

```bash
git clone https://github.com/HimArt-1/Hader.git
cd Hader
```

### 2️⃣ تثبيت الحزم

```bash
npm install
# أو
yarn install
# أو
pnpm install
```

### 3️⃣ تشغيل المشروع

```bash
npm run dev
# سيعمل على http://localhost:5173
```

---

## ⚙️ الإعداد

### 1. إعداد قاعدة البيانات (اختياري - للوضع السحابي)

#### أ. إنشاء مشروع Supabase
1. اذهب إلى [supabase.com](https://supabase.com)
2. أنشئ حساباً جديداً أو سجل الدخول
3. أنشئ مشروعاً جديداً

#### ب. تشغيل Schema SQL
1. افتح **SQL Editor** في Supabase
2. انسخ محتوى ملف `schema.sql`
3. نفّذ الـ SQL

#### ج. تكوين المتغيرات

أنشئ ملف `.env` في المجلد الرئيسي:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_ENABLE_PWA=false
```

ملاحظات مهمة:
- `Bootstrap Admin` أصبح معطّلًا افتراضيًا لأسباب أمنية، ولا يجب تفعيله في build الإنتاج أو مع تهيئة Supabase السحابية.
- عند الحاجة لتحديثات Supabase الأمنية الجديدة، استخدم ملفات `supabase/migrations/` كمسار أساسي، مع سكربتات `maintenance/sql/` فقط عند الصيانة اليدوية المقصودة.
- ترتيب التشغيل الكامل للسكربتات: `maintenance/sql/00_EXECUTION_ORDER.sql` (مرجع داخل الملف).

### 2. إنشاء مستخدم مدير

قم بتشغيل أحد ملفات SQL التالية:

```sql
-- راجع ملف create_admin_user_hashed.sql
-- غيّر username, password, name حسب الحاجة
```

### 3. تخصيص الإعدادات

راجع ملف `services/db.ts` لتخصيص:
- ⏰ وقت الاصطفاف الافتراضي
- ⏱️ فترة السماحية للتأخير
- 🔐 إعدادات الأمان

---

## 📖 الاستخدام

### تسجيل الدخول

#### للموظفين (Staff)
```
Username: [اسم المستخدم]
Password: [كلمة المرور]
Type: Staff
```

#### لأولياء الأمور (Guardians)
```
Username: [رقم جوال ولي الأمر]
Password: [آخر 4 أرقام من معرّف الابن]
Type: Guardian
```

### الوظائف الرئيسية

#### 1. لوحة التحكم (Dashboard)
- عرض إحصائيات الحضور اليومي
- رسوم بيانية تفاعلية
- ملخص الحالات

---

## ✅ فحص الجودة قبل الإنتاج

للتأكد من عدم اختلاف البيانات بين الأجهزة قبل الإطلاق:

- راجع ونفّذ: `maintenance/docs/CROSS_DEVICE_VALIDATION_CHECKLIST.md`

## 💻 تطبيق سطح المكتب (Mac & Windows)

يوفّر زرّا **macOS / Windows** أسفل الشريط الجانبي مثبّت Electron الأصلي
من أحدث إصدار GitHub منشور. النسخة الأصلية هي المطلوبة لجلسة نور الآمنة؛
أما مشغّل Chrome/Edge الخفيف فهو بديل احتياطي فقط ولا يوفّر تكامل نور.

عند دفع وسم إصدار مثل `v1.0.0`، يبني GitHub Actions ملف DMG موحّداً
لأجهزة Intel وApple Silicon ومثبّت EXE لويندوز x64، ثم ينشرهما مع
`desktop-manifest.json`. يكتشف تطبيق حاضر هذا الملف تلقائياً عبر
`VITE_DESKTOP_RELEASE_URL`.

- الدليل الكامل: `maintenance/docs/DESKTOP_APP_GUIDE.md`
- دليل النشر: `maintenance/docs/NATIVE_DESKTOP_RELEASE.md`

#### 2. لوحة الإدارة (Admin)
- إدارة الطلاب والفصول
- إدارة المستخدمين
- تسجيل حضور/غياب يدوي
- تصدير التقارير

#### 3. جهاز الكيوسك (Kiosk)
- واجهة بسيطة لتسجيل الحضور
- مسح الباركود/QR Code
- عرض حالة الطالب

#### 4. الإشراف (Supervision)
- متابعة الحضور والانصراف
- تسجيل الانتهاكات السلوكية
- إشعارات أولياء الأمور

#### 5. ولي الأمر (Parents)
- عرض بيانات الأبناء
- تتبع الحضور والسلوك
- طلب أعذار

---

## 📁 البنية

```
HADER/
├── 📂 components/           # مكونات React القابلة لإعادة الاستخدام
│   ├── Layout.tsx          # التخطيط الرئيسي
│   ├── BarcodeStudio.tsx   # استوديو الباركود
│   └── import/             # مكونات الاستيراد
│
├── 📂 pages/               # صفحات التطبيق
│   ├── Login.tsx           # صفحة تسجيل الدخول
│   ├── Dashboard.tsx       # لوحة التحكم
│   ├── Admin.tsx           # لوحة الإدارة
│   ├── Kiosk.tsx           # جهاز الكيوسك
│   ├── Supervision.tsx     # الإشراف
│   ├── Parents.tsx         # أولياء الأمور
│   └── Watcher.tsx         # المراقب
│
├── 📂 services/            # خدمات Backend
│   ├── auth.ts             # المصادقة
│   ├── db.ts               # قاعدة البيانات
│   ├── security.ts         # الأمان
│   ├── cache.ts            # التخزين المؤقت
│   └── supabase.ts         # اتصال Supabase
│
├── 📂 hooks/               # React Hooks مخصصة
│   └── useResourceManagement.ts
│
├── 📂 utils/               # أدوات مساعدة
│   ├── async.ts            # Retry, Timeout
│   └── validation.ts       # التحقق
│
├── 📂 types/               # TypeScript Types
│   ├── errors.ts           # أنواع الأخطاء
│   └── import.ts           # أنواع الاستيراد
│
├── 📂 maintenance/         # 🧹 أدوات الصيانة والتوثيق
│   ├── sql/                # سكربتات قاعدة البيانات
│   ├── scripts/            # سكربتات بايثون
│   └── docs/               # التوثيق والأدلة التقنية
│
├── 📂 constants/           # ثوابت
│   └── schoolCatalog.ts    # فهرس المدارس
│
├── 📂 __tests__/           # الاختبارات
│
├── 📄 App.tsx              # التطبيق الرئيسي
├── 📄 index.tsx            # نقطة الدخول
├── 📄 types.ts             # تعريفات الأنواع (8,959 سطر)
├── 📄 schema.sql           # تخطيط قاعدة البيانات
└── 📄 package.json         # الحزم والبرامج
```

---

## 🧪 الاختبار

```bash
# فحص lint
npm run lint

# فحص TypeScript
npm run typecheck

# تشغيل الاختبارات مرة واحدة
npm run test:run
```

---

## 🏗️ البناء

```bash
# بناء الإنتاج الافتراضي (PWA معطلة افتراضياً لثبات البناء)
npm run build

# بناء مع تفعيل PWA صراحة
npm run build:pwa

# معاينة البناء
npm run preview
```

---

## 🐳 Docker

```bash
# بناء صورة Docker
docker build -t hader-system .

# تشغيل Container
docker run -p 8080:80 hader-system
```

---

## 🌐 النشر

### Vercel (موصى به)
```bash
npm install -g vercel
vercel deploy
```

### Netlify
```bash
npm run build
# رفع مجلد dist/ إلى Netlify
```

### Docker/VPS
```bash
# استخدم Dockerfile المرفق
docker-compose up -d
```

---

## 🔄 التحديثات الأخيرة

### v2.0.0 (2026-01-25)
- ✨ **إضافة تسجيل الغياب اليدوي**
  - واجهة Toggle للتبديل بين الحضور/الغياب
  - دعم كامل في قاعدة البيانات
  - تحديثات UI ديناميكية
- 🔒 تحسينات أمنية
- 🎨 تحسينات UI/UX

---

## 🤝 المساهمة

نرحب بمساهماتكم! يرجى اتباع الخطوات التالية:

1. Fork المشروع
2. أنشئ فرعاً للميزة (`git checkout -b feature/AmazingFeature`)
3. Commit التغييرات (`git commit -m 'Add some AmazingFeature'`)
4. Push إلى الفرع (`git push origin feature/AmazingFeature`)
5. افتح Pull Request

### إرشادات المساهمة
- 📝 اكتب كود نظيف وموثق
- ✅ أضف اختبارات للميزات الجديدة
- 📚 حدّث الوثائق
- 🎨 اتبع معايير الكود الموجودة

---

## 📄 الترخيص

هذا المشروع مرخص تحت **MIT License** - راجع ملف [LICENSE](LICENSE) للتفاصيل.

---

## 👨‍💻 المطور

**HimArt**
- GitHub: [@HimArt-1](https://github.com/HimArt-1)
- Repository: [Hader](https://github.com/HimArt-1/Hader)

---

## 🙏 شكر وتقدير

- شكراً لـ [Supabase](https://supabase.com) للبنية التحتية
- شكراً لـ [React](https://reactjs.org) و [Vite](https://vitejs.dev)
- شكراً لجميع المساهمين في المكتبات مفتوحة المصدر

---

## 📞 الدعم

للحصول على الدعم:
- 🐛 افتح [Issue](https://github.com/HimArt-1/Hader/issues)
- 💬 ناقش في [Discussions](https://github.com/HimArt-1/Hader/discussions)
- 📧 راسلنا عبر GitHub

---

<div align="center">

**صُنع بـ ❤️ في السعودية**

⭐ إذا أعجبك المشروع، ضع نجمة على GitHub!

</div>

---

<a name="english"></a>

# 🎓 HADER System

**Comprehensive School Management System for Attendance, Exit, and Behavioral Tracking**

## 🌟 Key Features

- ✅ Automated attendance tracking via Barcode/QR Code
- ✅ Manual attendance and absence recording
- ✅ Behavioral violation tracking
- ✅ Real-time parent notifications
- ✅ Comprehensive reports (PDF, Excel)
- ✅ Multi-role support (9 roles)
- ✅ Dark mode & RTL support
- ✅ Cloud & Local mode

## 🚀 Quick Start

```bash
# Clone repository
git clone https://github.com/HimArt-1/Hader.git
cd Hader

# Install dependencies
npm install

# Run development server
npm run dev
```

## 📦 Tech Stack

- **Frontend**: React 18.2, TypeScript 5.2, Vite 5.1
- **Styling**: TailwindCSS 3.4
- **Database**: Supabase (PostgreSQL)
- **Security**: PBKDF2 encryption, Rate limiting
- **Charts**: Recharts 2.12

## 📄 License

MIT License - see [LICENSE](LICENSE) file

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

<div align="center">

**Made with ❤️ in Saudi Arabia**

[⬆ Back to Top](#-نظام-حاضر-hader-system)

</div>
