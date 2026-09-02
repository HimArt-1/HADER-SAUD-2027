# دليل بناء تطبيق سطح المكتب - نظام حاضر

## المتطلبات

### متطلبات أساسية
- Node.js 18+ 
- npm 9+

### متطلبات إضافية حسب المنصة

#### macOS
- Xcode Command Line Tools: `xcode-select --install`
- لتوقيع التطبيق: Apple Developer Account

#### Windows
- Visual Studio Build Tools (للتجميع من macOS)
- أو Windows 10/11 للبناء الأصلي

## التثبيت

```bash
# تثبيت المتطلبات
npm install

# توليد الأيقونات (اختياري - تم توليدها مسبقاً)
npm run electron:icons
```

## التشغيل في وضع التطوير

```bash
# تشغيل التطبيق في وضع التطوير
npm run electron:dev
```

هذا الأمر:
1. يشغل خادم Vite على المنفذ 5173
2. ينتظر حتى يصبح الخادم جاهزاً
3. يشغل Electron ويحمل التطبيق

## البناء للإنتاج

### بناء لـ macOS فقط
```bash
npm run electron:build:mac
```

النتيجة:
- `release/نظام حاضر-1.0.0-arm64.dmg` (Apple Silicon)
- `release/نظام حاضر-1.0.0-x64.dmg` (Intel)
- `release/نظام حاضر-1.0.0-arm64-mac.zip`
- `release/نظام حاضر-1.0.0-x64-mac.zip`

### بناء لـ Windows فقط
```bash
npm run electron:build:win
```

النتيجة:
- `release/نظام حاضر Setup 1.0.0.exe` (مثبت NSIS)
- `release/نظام حاضر 1.0.0.exe` (نسخة محمولة)

### بناء لـ Linux فقط
```bash
npm run electron:build:linux
```

النتيجة:
- `release/نظام حاضر-1.0.0.AppImage`
- `release/نظام حاضر_1.0.0_amd64.deb`

### بناء لجميع المنصات
```bash
npm run electron:build:all
```

> ⚠️ **ملاحظة**: البناء عبر المنصات قد يتطلب أدوات إضافية:
> - للبناء لـ Windows من macOS: يحتاج `wine` و `mono`
> - للبناء لـ macOS من Windows: غير مدعوم

## هيكل مجلد الإخراج

```
release/
├── نظام حاضر-1.0.0-arm64.dmg     # macOS DMG (Apple Silicon)
├── نظام حاضر-1.0.0-x64.dmg       # macOS DMG (Intel)
├── نظام حاضر Setup 1.0.0.exe     # Windows Installer
├── نظام حاضر 1.0.0.exe           # Windows Portable
├── نظام حاضر-1.0.0.AppImage      # Linux AppImage
└── نظام حاضر_1.0.0_amd64.deb     # Linux Debian Package
```

## تخصيص البناء

### تغيير معلومات التطبيق
عدّل `package.json`:
```json
{
  "name": "hader-system",
  "version": "1.0.0",
  "description": "نظام حاضر - نظام متكامل لإدارة حضور الطلاب",
  "author": "Hader Team"
}
```

### تغيير الأيقونات
1. ضع الأيقونة الجديدة في `public/logo512.png`
2. شغل `npm run electron:icons`

### إعدادات البناء المتقدمة
عدّل قسم `build` في `package.json`:
```json
{
  "build": {
    "appId": "sa.hader.app",
    "productName": "نظام حاضر",
    "mac": { ... },
    "win": { ... },
    "linux": { ... }
  }
}
```

## توقيع التطبيق

### macOS (اختياري)
1. احصل على Apple Developer Certificate
2. عيّن متغيرات البيئة:
```bash
export CSC_LINK="path/to/certificate.p12"
export CSC_KEY_PASSWORD="your-password"
```
3. ابنِ التطبيق

### Windows (اختياري)
1. احصل على Code Signing Certificate
2. عيّن متغيرات البيئة:
```bash
export WIN_CSC_LINK="path/to/certificate.pfx"
export WIN_CSC_KEY_PASSWORD="your-password"
```
3. ابنِ التطبيق

## استكشاف الأخطاء

### خطأ: "Cannot find module 'electron'"
```bash
npm install
```

### خطأ: "Icon not found"
```bash
npm run electron:icons
```

### خطأ: البناء لـ Windows من macOS
```bash
# تثبيت wine (مطلوب للبناء عبر المنصات)
brew install --cask wine-stable
```

### خطأ: "Code signing failed"
- تأكد من صحة الشهادة
- تأكد من متغيرات البيئة
- أو أضف `--mac --config.mac.identity=null` لتخطي التوقيع

## الأوامر المتاحة

| الأمر | الوصف |
|-------|--------|
| `npm run dev` | تشغيل خادم التطوير (ويب فقط) |
| `npm run electron:dev` | تشغيل Electron في وضع التطوير |
| `npm run electron:build` | بناء للمنصة الحالية |
| `npm run electron:build:mac` | بناء لـ macOS |
| `npm run electron:build:win` | بناء لـ Windows |
| `npm run electron:build:linux` | بناء لـ Linux |
| `npm run electron:build:all` | بناء لجميع المنصات |
| `npm run electron:icons` | توليد الأيقونات |

## الدعم

للمساعدة أو الإبلاغ عن مشاكل، تواصل مع فريق الدعم الفني.
