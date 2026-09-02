# نظام حاضر - دليل التشغيل المحلي
# Hader System - Local Setup Guide

---

## المتطلبات الأساسية | Prerequisites

### Windows:
1. **Node.js v18+** - [تحميل من هنا](https://nodejs.org/)
2. **Python 3.10+** - [تحميل من هنا](https://www.python.org/downloads/)
3. **Google Chrome** - [تحميل من هنا](https://www.google.com/chrome/)
4. **Git** (اختياري) - [تحميل من هنا](https://git-scm.com/)

### Mac:
1. **Node.js v18+** - `brew install node` أو [تحميل](https://nodejs.org/)
2. **Python 3.10+** - `brew install python@3.11` أو [تحميل](https://www.python.org/downloads/)
3. **Google Chrome** - [تحميل من هنا](https://www.google.com/chrome/)

---

## التشغيل السريع | Quick Start

### Windows:
```batch
:: انقر مزدوج على الملف أو شغّل من Command Prompt:
start-windows.bat
```

### Mac/Linux:
```bash
# أولاً: أعطِ صلاحية التنفيذ
chmod +x start-mac.sh

# ثانياً: شغّل السكربت
./start-mac.sh
```

---

## التثبيت اليدوي | Manual Installation

### الخطوة 1: إعداد ملف البيئة (.env)

```bash
# انسخ ملف المثال
cp .env.example .env

# ثم عدّل الملف وأضف بيانات Supabase:
```

**محتوى .env المطلوب:**
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_APP_MODE=cloud
```

> **ملاحظة:** احصل على بيانات Supabase من:
> https://supabase.com/dashboard/project/_/settings/api

---

### الخطوة 2: تثبيت مكتبات الواجهة الأمامية

```bash
# تثبيت مكتبات Node.js
npm install
```

---

### الخطوة 3: إعداد خادم الواتساب

#### Windows:
```batch
cd whatsapp
python -m venv venv
venv\Scripts\activate.bat
pip install -r requirements.txt
```

#### Mac/Linux:
```bash
cd whatsapp
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## تشغيل النظام | Running the System

### الواجهة الأمامية فقط (Frontend Only):
```bash
npm run dev
# افتح: http://localhost:5173
```

### خادم الواتساب فقط (WhatsApp Server Only):

#### Windows:
```batch
cd whatsapp
venv\Scripts\activate.bat
python server.py
```

#### Mac/Linux:
```bash
cd whatsapp
source venv/bin/activate
python3 server.py
```
> الخادم يعمل على: http://localhost:5050

### تشغيل النظام الكامل (Full System):

**الطريقة 1: استخدام السكربت**
```bash
# Windows:
start-windows.bat
# اختر الخيار 3

# Mac/Linux:
./start-mac.sh
# اختر الخيار 3
```

**الطريقة 2: تشغيل يدوي (فتح نافذتين)**

النافذة 1 (الواجهة):
```bash
npm run dev
```

النافذة 2 (الواتساب):
```bash
cd whatsapp
source venv/bin/activate  # Mac
# أو: venv\Scripts\activate.bat  # Windows
python server.py
```

---

## بناء للإنتاج | Build for Production

```bash
npm run build
```

ملفات الإنتاج ستكون في مجلد `dist/`

### تشغيل نسخة الإنتاج محلياً:
```bash
npm run preview
# افتح: http://localhost:4173
```

---

## إعداد قاعدة البيانات | Database Setup

### استخدام Supabase (مُوصى به):

1. أنشئ مشروع جديد على [Supabase](https://supabase.com)
2. اذهب إلى SQL Editor
3. نفّذ محتوى الملف: `schema.sql`
4. نفّذ محتوى الملف: `SQL_EDITOR_SEED.sql` (بيانات تجريبية)

### إعداد مستخدم أدمن:
نفّذ في SQL Editor:
```sql
INSERT INTO users (id, name, username, password_hash, role)
VALUES (
    gen_random_uuid(),
    'مدير النظام',
    'admin',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: password
    'admin'
);
```

> **تنبيه أمني:** غيّر كلمة المرور فوراً بعد أول تسجيل دخول!

---

## استخدام واجهة الواتساب | WhatsApp Integration

### الخطوة 1: تشغيل الخادم
```bash
cd whatsapp
source venv/bin/activate
python server.py
```

### الخطوة 2: مسح رمز QR
1. افتح المتصفح على: http://localhost:5050
2. سيفتح نافذة Chrome جديدة
3. امسح رمز QR بتطبيق واتساب على هاتفك

### الخطوة 3: استخدام الواجهة
1. من لوحة الإدارة، اذهب إلى "واتساب"
2. أو افتح: http://localhost:5173/whatsapp-control

---

## حل المشاكل الشائعة | Troubleshooting

### مشكلة: npm install يفشل
```bash
# امسح الكاش وأعد المحاولة
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### مشكلة: Python لا يعمل (Mac)
```bash
# تأكد من استخدام python3
python3 --version
# إذا لم يكن مثبتاً:
brew install python@3.11
```

### مشكلة: ChromeDriver لا يعمل
```bash
# أعد تثبيت webdriver-manager
pip uninstall webdriver-manager
pip install webdriver-manager
```

### مشكلة: CORS Error
تأكد أن خادم الواتساب يعمل على المنفذ الصحيح (5050)

### مشكلة: WhatsApp session منتهية
1. أوقف الخادم
2. احذف مجلد `whatsapp/whatsapp_session`
3. أعد تشغيل الخادم
4. امسح رمز QR مجدداً

---

## المنافذ المستخدمة | Ports Used

| الخدمة | المنفذ | الرابط |
|--------|--------|--------|
| الواجهة (Dev) | 5173 | http://localhost:5173 |
| الواجهة (Preview) | 4173 | http://localhost:4173 |
| خادم الواتساب | 5050 | http://localhost:5050 |

---

## هيكل المشروع | Project Structure

```
Hader-Local-Deployment/
├── components/         # React components
│   ├── admin/         # Admin components
│   ├── import/        # Import wizard
│   └── whatsapp/      # WhatsApp UI
├── pages/             # App pages
├── services/          # API & business logic
├── hooks/             # Custom React hooks
├── types/             # TypeScript types
├── whatsapp/          # Python WhatsApp server
│   ├── server.py      # Flask server
│   ├── whatsapp_pro_tool.py
│   └── requirements.txt
├── public/            # Static assets
├── start-mac.sh       # Mac startup script
├── start-windows.bat  # Windows startup script
├── .env.example       # Environment template
└── package.json       # Node.js dependencies
```

---

## الدعم والمساعدة | Support

للمشاكل والاستفسارات:
- راجع ملف `README.md` للتوثيق الكامل
- افحص ملفات SQL لإعداد قاعدة البيانات

---

**تم إعداد هذا الدليل بواسطة نظام حاضر | Hader System**
