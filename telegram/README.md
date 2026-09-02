# بوت حاضر — دليل الإعداد

## 1. إنشاء البوت

1. افتح **@BotFather** في تيلجرام
2. أرسل `/newbot`
3. اختر اسم: `حاضر بوت`
4. اختر username: `hader_school_bot` (أو أي اسم متاح)
5. انسخ الـ **Token**

## 2. إنشاء القنوات

أنشئ 6 قنوات في تيلجرام:

| القناة | الاسم المقترح |
|--------|-------------|
| 📷 حضور الجوال | `حاضر - ماسح الجوال` |
| 👤 حضور المشرف | `حاضر - المشرفين` |
| 🖥️ حضور الكشك | `حاضر - الكشك` |
| 🚪 الاستئذانات | `حاضر - الاستئذانات` |
| ❌ الغيابات | `حاضر - الغيابات` |
| ⏰ التأخيرات | `حاضر - التأخيرات` |

**مهم:** أضف البوت كـ **Admin** في كل قناة عشان يقدر يرسل فيها.

## 3. معرفة Chat ID

بعد إضافة البوت للقنوات، أرسل رسالة في كل قناة ثم شغّل:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

ابحث عن `chat.id` لكل قناة (يكون رقم سالب مثل `-1001234567890`).

## 4. إعداد `.env`

أضف هالسطور في ملف `.env`:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
TELEGRAM_CHANNEL_MOBILE="-1001111111111"
TELEGRAM_CHANNEL_SUPERVISOR="-1002222222222"
TELEGRAM_CHANNEL_KIOSK="-1003333333333"
TELEGRAM_CHANNEL_EXITS="-1004444444444"
TELEGRAM_CHANNEL_ABSENCES="-1005555555555"
TELEGRAM_CHANNEL_LATE="-1006666666666"
TELEGRAM_ADMIN_IDS="123456789"
```

**TELEGRAM_ADMIN_IDS**: رقمك في تيلجرام. للحصول عليه أرسل `/start` لبوت `@userinfobot`.

## 5. تثبيت وتشغيل

```bash
cd telegram
python -m venv venv
source venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
python bot.py
```

## 6. الأوامر

| الأمر | الوظيفة |
|-------|---------|
| `/start` | رسالة ترحيب |
| `/stats` | إحصائيات اليوم |
| `/absent` | قائمة الغائبين |
| `/late` | قائمة المتأخرين |
| `/exits` | الاستئذانات |
| `/report` | تقرير شامل |
| `/search أحمد` | بحث عن طالب |
