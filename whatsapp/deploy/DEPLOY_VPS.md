# 🚀 دليل نشر خادم واتساب حادر على VPS

## المتطلبات

| المتطلب | الحد الأدنى |
|---------|------------|
| نظام التشغيل | Ubuntu 22.04+ |
| RAM | 2 GB |
| المعالج | 1 vCPU |
| التخزين | 20 GB SSD |
| الميزانية | ~40-50 ريال/شهر |

### مزودات VPS مقترحة (< 50 ريال/شهر)

| المزود | الخطة | السعر |
|--------|------|-------|
| [Hetzner](https://hetzner.com) | CX22 (2 vCPU, 4GB) | ~15 ريال |
| [DigitalOcean](https://digitalocean.com) | Basic Droplet (1 vCPU, 2GB) | ~45 ريال |
| [Contabo](https://contabo.com) | Cloud VPS S (4 vCPU, 8GB) | ~25 ريال |

---

## ⚡ التثبيت السريع

### 1. تجهيز الخادم

```bash
# الاتصال بالخادم
ssh root@YOUR_VPS_IP

# تشغيل سكريبت الإعداد التلقائي
bash <(curl -sSL https://raw.githubusercontent.com/YOUR_REPO/main/whatsapp/deploy/setup-vps.sh)
```

### 2. نسخ ملفات المشروع

من جهازك المحلي:

```bash
# نسخ الملفات المطلوبة — بلا .env
# سكربت الإعداد في الخطوة 1 أنشأ .env على الخادم ووضع فيه مفتاحاً مولّداً.
# نسخ ملف .env من جهازك فوقه يمحو ذلك المفتاح، وينقل أسراراً من جهازك إلى الخادم.
scp -r Dockerfile.whatsapp docker-compose.whatsapp.yml whatsapp/ root@YOUR_VPS_IP:/opt/hader-whatsapp/
```

### 3. تعديل الإعدادات

```bash
# على الخادم
cd /opt/hader-whatsapp

# تعديل ملف الإعدادات
nano .env
```

**أهم الإعدادات:**

```env
# ⚙️ وضع التشغيل — production يرفض إقلاع الخدمة بلا مفتاح API صالح
#    (الحد الأدنى 32 محرفاً). هذا يمنع نشر خادم مفتوح دون أن تنتبه.
WHATSAPP_ENV=production

# 🔐 مفتاح API — ولّده بـ: openssl rand -hex 32
#    يبقى في بيئة الخادم وفي متغيرات Vercel فقط. لا تضعه في أي متغير
#    يبدأ بـ VITE_، فتلك تُحزَم داخل جافاسكربت المتصفح ويقرأها أي زائر.
WHATSAPP_API_KEY=ولّد_مفتاح_بأمر_openssl_rand_hex_32

# 🔐 كلمة مرور VNC
VNC_PASSWORD=كلمة_مرور_قوية

# 🔗 Supabase
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=your_key
```

### 4. بناء وتشغيل الحاوية

```bash
# بناء الصورة وتشغيل الحاوية
docker compose -f docker-compose.whatsapp.yml up -d --build

# متابعة السجلات
docker compose -f docker-compose.whatsapp.yml logs -f
```

### 5. مسح رمز QR

**الطريقة المباشرة والآمنة (داخل تطبيق حاضر):**
1. افتح تطبيق حاضر > لوحة تحكم واتساب > بطاقة "التحكم بالنظام".
2. اضغط **"تشغيل المحرك"** ثم اضغط زر **"مسح رمز QR داخل التطبيق"**.
3. تظهر نافذة منبثقة تستخرج رمز QR مباشرة من واتساب ويب وتحدّثه تلقائياً. امسحه بهاتفك دون الحاجة لفتح منافذ VNC!

**طريقة الطوارئ (VNC عبر نفق مشفر SSH):**
شاشة VNC **معطّلة افتراضياً** (`autostart=false` في supervisord) وغير منشورة على
Nginx عمداً — هي تحكم كامل بالمتصفح الذي يحمل جلسة واتساب للمدرسة. لتشغيلها مؤقتاً
لغرض تشخيصي:

```bash
# 1) على الخادم: شغّل الخدمتين يدوياً
docker exec hader-whatsapp supervisorctl start x11vnc novnc

# 2) من جهازك المحلي: نفق SSH (المنفذ غير مفتوح للإنترنت)
ssh -L 6080:127.0.0.1:6080 root@YOUR_VPS_IP

# 3) افتح محلياً، وكلمة المرور هي VNC_PASSWORD من ملف .env
http://localhost:6080/vnc.html

# 4) أوقفهما فور الانتهاء
docker exec hader-whatsapp supervisorctl stop novnc x11vnc
```

### 6. إعداد Nginx وتأمين الاتصال (TLS/HTTPS)

```bash
# نسخ إعدادات Nginx
cp whatsapp/deploy/nginx-whatsapp.conf /etc/nginx/sites-available/whatsapp
ln -s /etc/nginx/sites-available/whatsapp /etc/nginx/sites-enabled/

# اختبار وإعادة تحميل
nginx -t && systemctl reload nginx
```

---

## 🔗 ربط الواجهة الأمامية بالخادم البعيد (آمن بنسبة 100%)

بدلاً من حفظ مفتاح API أو عنوان الخادم في متصفحات المستخدمين أو في كود الواجهة الأمامية، يعتمد "حاضر" على **مسار وسيط خادم محمي (Backend Proxy)** عبر Vercel Serverless Function (`/api/whatsapp`):

### في لوحة تحكم Vercel (أو ملف `.env.production`):

أضف المتغيرات السرية على مستوى الخادم فقط (Environment Variables):

```env
# رابط خادم VPS (المحمي بـ Nginx)
WHATSAPP_SERVER_URL=https://your-vps-domain.com

# مفتاح API السري للخادم
WHATSAPP_API_KEY=your_secret_api_key_from_vps
```

**كيف يعمل الأمان؟**
1. تتصل واجهة حاضر تلقائياً بالمسار الداخلي `/api/whatsapp/*`.
2. يتحقق خادم Vercel من رمز المستخدم المسجل (Supabase JWT) وصلاحياته.
3. يقوم الخادم بإضافة `X-API-Key` وتوجيه الطلب لخادمك البعيد بأمان تام.
4. العميل والمتصفح لا يعرفان مفتاح API إطلاقاً، ولا يمكن لأي طرف خارجي استغلال الخادم.

---

## 🗓️ جدولة إشعارات الحضور (على الخادم)

الطيار الآلي لم يعد يعمل داخل صفحة حاضر. الجدولة تعيش في الجسر نفسه، فتعمل
والمدرسة مغلقة ولا أحد يفتح لوحة التحكم، وتقرأ ساعة المدرسة لا ساعة متصفح الموظف.

```bash
# قراءة الإعدادات والتشغيل القادم وسجل آخر التشغيلات
curl -s -H "X-API-Key: $WHATSAPP_API_KEY" https://your-vps-domain.com/api/schedule

# تفعيل الجدولة 07:30 بتوقيت الرياض
curl -s -X POST -H "Content-Type: application/json" -H "X-API-Key: $WHATSAPP_API_KEY" \
  -d '{"enabled": true, "time": "07:30", "timezone": "Asia/Riyadh"}' \
  https://your-vps-domain.com/api/schedule

# تجربة بلا أثر: يبني الصفوف ويخبرك بعددها دون إضافة رسالة واحدة
curl -s -X POST -H "Content-Type: application/json" -H "X-API-Key: $WHATSAPP_API_KEY" \
  -d '{"simulate": true, "force": true}' \
  https://your-vps-domain.com/api/schedule/run
```

**ما يمنع التكرار:** لكل يوم مفتاح تشغيل واحد يُحجز في قاعدة البيانات
(`attendance:2026-09-16:07:30`)، ومعرّف كل صف محسوب من التاريخ والنوع ورقم الطالب.
إعادة تشغيل الخدمة في نفس الدقيقة، أو تشغيلها مرتين، لا تنتج إشعاراً مكرراً.

**الجدولة لا تُرسل.** تضيف إلى الطابور فقط، والإرسال يبقى أمراً منفصلاً
(`/api/sending/start`). خادم يعمل بلا إشراف لا يبدأ الإرسال من تلقاء نفسه.

> مصدر بيانات الحضور هو Supabase عبر REST. اضبط `VITE_SUPABASE_URL` و
> `VITE_SUPABASE_ANON_KEY` في `.env` على الخادم، وتأكد أن سياسات RLS تسمح
> بقراءة `attendance_logs` و`students` لهذا المفتاح. بدونها تعمل الجدولة
> وتُرجع صفراً بهدوء.

---

## 🔄 الاستعادة بعد إعادة التشغيل

عند إقلاع الخدمة يفتح الجسر المتصفح ويستعيد جلسة واتساب المحفوظة تلقائياً،
دون أن يضغط أحد "تشغيل". في خادم بلا شاشة هذا هو الفرق بين خدمة تعمل وخدمة
تبدو أنها تعمل.

```env
# الافتراضي داخل الحاوية: مفعّل. اجعله false إن أردت بدءاً يدوياً.
WHATSAPP_AUTO_START_ENGINE=true
```

الاستعادة تصل إلى `ready` فقط: الجلسة عائدة والطابور محفوظ، ولا تُرسل رسالة
حتى تطلب الإرسال صراحةً.

**مهلة الإيقاف:** `stop_grace_period: 90s` في ملف compose. كروم يكتب ملف
التعريف — وفيه جلسة واتساب — أثناء الإغلاق؛ إن قُتل قبل أن ينتهي ضاعت الجلسة
ولزم مسح رمز QR من جديد. السلسلة مرتبة بهامش: gunicorn 60 ثانية، ثم supervisord
75، ثم docker 90. لا تخفض هذه القيم اعتماداً على قياس واحد على جهاز فارغ.

---

## 📊 المراقبة والصيانة

### أوامر مفيدة

```bash
# حالة الحاوية
docker compose -f docker-compose.whatsapp.yml ps

# سجلات الخادم
docker compose -f docker-compose.whatsapp.yml logs -f whatsapp-server

# إعادة تشغيل
docker compose -f docker-compose.whatsapp.yml restart

# إيقاف
docker compose -f docker-compose.whatsapp.yml down

# تحديث (بعد تعديل الكود)
docker compose -f docker-compose.whatsapp.yml up -d --build
```

### فحص الحالة

```bash
# فحص API
curl http://localhost:5001/api/status

# فحص صحة الحاوية
docker inspect --format='{{.State.Health.Status}}' hader-whatsapp
```

---

## 🔒 الأمان

### نصائح مهمة

1. **غيّر كلمة مرور VNC** — لا تستخدم الافتراضية!
2. **ولّد مفتاح API قوي:**
   ```bash
   openssl rand -hex 32
   ```
3. **أغلق منفذ noVNC بعد مسح QR** (إذا لا تحتاجه دائماً):
   ```bash
   ufw deny 6080/tcp
   ```
4. **فعّل HTTPS** إذا حصلت على دومين:
   ```bash
   apt install certbot python3-certbot-nginx
   certbot --nginx
   ```

---

## 🏫 تشغيل أثناء ساعات العمل فقط

لتوفير الموارد (مناسب للميزانية المحدودة):

```bash
# إنشاء cron job لتشغيل/إيقاف أوتوماتيكي
crontab -e
```

أضف:

```cron
# تشغيل الخادم الساعة 6:30 صباحاً (أيام العمل)
30 6 * * 0-4 cd /opt/hader-whatsapp && docker compose -f docker-compose.whatsapp.yml up -d

# إيقاف الخادم الساعة 2:00 ظهراً
0 14 * * 0-4 cd /opt/hader-whatsapp && docker compose -f docker-compose.whatsapp.yml down
```

> **ملاحظة:** الأيام 0-4 = الأحد إلى الخميس (أيام الدوام في السعودية)

---

## 🔧 حل المشاكل

### Chrome لا يعمل
```bash
# تحقق من الذاكرة
free -h

# زد حجم shared memory
# في docker-compose.whatsapp.yml: shm_size: '4g'
```

### QR لا يظهر في noVNC
```bash
# تحقق من Xvfb
docker exec hader-whatsapp pgrep Xvfb

# تحقق من x11vnc
docker exec hader-whatsapp pgrep x11vnc
```

### الواجهة لا تتصل بالخادم
1. تحقق أن `WHATSAPP_API_KEY` متطابق بين الخادم والمتصفح
2. تحقق من فتح المنفذ: `curl http://YOUR_VPS_IP:5001/api/status`
3. تحقق من CORS: أضف دومين الواجهة في `WHATSAPP_CORS_ORIGINS`

---

## 📁 هيكل الملفات

```
/opt/hader-whatsapp/
├── .env                          # إعدادات البيئة
├── Dockerfile.whatsapp           # صورة Docker
├── docker-compose.whatsapp.yml   # تكوين Docker Compose
└── whatsapp/
    ├── server.py                 # خادم Flask API
    ├── whatsapp_pro_tool.py      # محرك Selenium
    ├── engine_controller.py      # متحكم المحرك
    ├── sqlite_db.py              # قاعدة بيانات SQLite
    ├── bridge.py                 # جسر Supabase
    ├── requirements.txt          # مكتبات Python
    └── deploy/
        ├── entrypoint.sh         # سكريبت تشغيل الحاوية
        ├── supervisord.conf      # إدارة العمليات
        ├── nginx-whatsapp.conf   # إعدادات Nginx
        └── setup-vps.sh          # سكريبت إعداد VPS
```
