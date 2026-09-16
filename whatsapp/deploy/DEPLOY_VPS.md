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
# نسخ الملفات المطلوبة
scp -r Dockerfile.whatsapp docker-compose.whatsapp.yml whatsapp/ .env root@YOUR_VPS_IP:/opt/hader-whatsapp/
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
# 🔐 مفتاح API — ولّد واحد جديد!
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
إذا أردت رؤية سطح المكتب الافتراضي للمتصفح لأي سبب تشخيصي:
```bash
# من جهازك المحلي:
ssh -L 6080:127.0.0.1:6080 root@YOUR_VPS_IP
# ثم افتح في المتصفح المحلي:
http://localhost:6080/vnc.html
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
