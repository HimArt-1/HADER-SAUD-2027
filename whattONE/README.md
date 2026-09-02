# 🟢 whattONE v2 — نظام إشعارات الحضور والغياب

أداة واتساب مستقلة مع نظام قوالب متقدم واستيراد ذكي لبيانات الحضور.

---

## 🚀 التثبيت والتشغيل

### 🍎 macOS
```bash
chmod +x install_mac.sh
./install_mac.sh
```
أو انقر مرتين على **whattONE.app**

### 🪟 Windows
انقر مرتين على **`install_windows.bat`** — سيقوم بـ:
- فحص Python و Chrome
- تثبيت المتطلبات تلقائياً
- إنشاء اختصار على سطح المكتب وقائمة ابدأ
- تشغيل الأداة

> 📖 لمزيد من التفاصيل: [`WINDOWS_GUIDE.md`](WINDOWS_GUIDE.md)

### ⚡ التشغيل المباشر
```bash
# macOS / Linux
chmod +x start.sh && ./start.sh

# Windows
start.bat
```
ثم افتح **http://localhost:5005**

---

## 📝 قوالب الحضور

| القالب | الوصف |
|--------|-------|
| 🔴 لم يحضر | إشعار غياب مع اسم الطالب والصف والتاريخ |
| 🟡 متأخر | إشعار تأخر مع وقت الوصول |
| 🟠 مستأذن | إشعار استئذان مع وقت المغادرة |
| ⚠️ تنبيه غياب متكرر | تنبيه لولي الأمر |
| 📢 رسالة عامة | إشعار مخصص |
| ➕ قالب مخصص | إنشاء قوالب جديدة |

## 📥 الاستيراد الذكي

التعرف التلقائي على أعمدة CSV/Excel:
- **👤 اسم الطالب** — بالعربية أو الإنجليزية
- **📱 رقم الهاتف** — يتعرف على أرقام الهاتف تلقائياً
- **📌 الحالة** — غائب/متأخر/مستأذن/حاضر
- **🏫 الصف** — الصف الدراسي
- **📋 الفصل** — الشعبة/القسم
- **🕐 الوقت** — وقت الحضور/المغادرة
- **📅 التاريخ** — تاريخ اليوم

## 📡 API

| Method | Endpoint | الوصف |
|--------|----------|-------|
| `GET` | `/api/status` | حالة البوت |
| `POST` | `/api/start` | تشغيل |
| `POST` | `/api/stop` | إيقاف |
| `POST` | `/api/import/upload` | رفع ملف للاستيراد |
| `POST` | `/api/import/process` | معالجة الملف المستورد |
| `GET` | `/api/templates` | القوالب |
| `POST` | `/api/templates` | إضافة قالب |
| `GET` | `/api/settings` | الإعدادات |
| `POST` | `/api/settings` | حفظ الإعدادات |
| `POST` | `/api/send` | إرسال رسائل |
| `GET` | `/api/queue` | الطابور |

## 📁 هيكل الملفات

```
whattONE/
├── whattONE.app/          ← 🍎 تطبيق macOS
├── install_mac.sh         ← 🍎 مُثبّت macOS
├── install_windows.bat    ← 🪟 مُثبّت Windows
├── start.bat              ← 🪟 تشغيل Windows
├── start.sh               ← 🍎 تشغيل macOS/Linux
├── setup_shortcut.bat     ← 🪟 إنشاء اختصار
├── server.py              ← الخادم الرئيسي
├── whatsapp_engine.py     ← محرك الواتساب
├── smart_import.py        ← الاستيراد الذكي
├── templates_engine.py    ← محرك القوالب
├── dashboard/             ← واجهة لوحة التحكم
└── WINDOWS_GUIDE.md       ← 📖 دليل ويندوز
```
