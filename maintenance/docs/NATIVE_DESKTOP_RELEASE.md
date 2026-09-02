# نشر نسخة حاضر الأصلية لـ macOS وWindows

## ما الذي يتم بناؤه؟

- `Hader-<version>-mac-universal.dmg`: تطبيق Electron موحّد لأجهزة Mac بمعالجات Intel وApple Silicon.
- `Hader-<version>-windows-x64-Setup.exe`: مثبّت NSIS لويندوز 64 بت.
- `desktop-manifest.json`: فهرس إصدار يحتوي روابط الملفين وأحجامهما وبصمات SHA-256 للتحقق المستقل.

زر التحميل داخل حاضر يقرأ الفهرس المنشور مع الموقع من:

`https://hader-saud-2027.vercel.app/api/desktop-release`

يمرّر هذا المسار تلقائيًا `desktop-manifest.json` من أحدث GitHub Release،
فتصل الإصدارات القادمة إلى الموقع دون نسخ يدوي. لا يُستخدم رابط
`releases/latest/download` مباشرة من المتصفح لأن استجابة إعادة التوجيه لا
تسمح بجلب JSON عبر CORS.

إن تعذّر الوصول إلى إصدار أصلي، يعرض التطبيق البديل الخفيف بوضوح. هذا البديل
يفتح حاضر عبر Chrome أو Edge، لكنه لا يدعم نافذة جلسة نور المعزولة.

تفتح نسخة Electron الأصلية نشر حاضر الحي على
`https://hader-saud-2027.vercel.app` داخل نافذة موثوقة، لذلك تستخدم إعداد
Supabase الموجود في نشر Vercel ولا تُضمَّن أسرار قاعدة البيانات في المثبّت.
تبقى ملفات `dist` داخل الحزمة شاشة طوارئ عند تعذّر الوصول إلى رابط الإنتاج.

## إعداد مستودع GitHub

أضف القيم التالية من **Settings → Secrets and variables → Actions** قبل النشر:

### Secrets

- `MAC_CSC_LINK`: شهادة Apple Developer ID Application بصيغة P12 مشفّرة Base64.
- `MAC_CSC_KEY_PASSWORD`: كلمة مرور شهادة Apple.
- `APPLE_ID`: بريد حساب Apple Developer المستخدم للتوثيق.
- `APPLE_APP_SPECIFIC_PASSWORD`: كلمة مرور خاصة بالتطبيق من Apple.
- `APPLE_TEAM_ID`: معرّف فريق Apple Developer.
- `WIN_CSC_LINK`: شهادة Windows Code Signing بصيغة PFX مشفّرة Base64.
- `WIN_CSC_KEY_PASSWORD`: كلمة مرور شهادة Windows.

### Variables

- `VITE_APP_MODE=hybrid`
- `VITE_ALLOW_LOCAL_FALLBACK=false`
- `VITE_APP_URL=https://<نطاق-حاضر-الفعلي>`

يُجبر سير البناء `VITE_ENABLE_BOOTSTRAP_ADMIN=false`، فلا تُضمّن بيانات مدير
تهيئة داخل ملفات سطح المكتب.

## التحقق اليدوي قبل إصدار رسمي

شغّل سير **Validate Native Desktop Builds** من تبويب Actions. يبني DMG وEXE
ويرفعهما كملفات مؤقتة لمدة سبعة أيام دون إنشاء إصدار عام.

## نشر إصدار رسمي

يجب أن يطابق الوسم إصدار `package.json`:

```bash
git tag -a v1.0.0 -m "Hader Desktop v1.0.0"
git push origin v1.0.0
```

سير **Publish Native Desktop Release** يبني النظامين بشكل مستقل، ويرفض نشر
إصدار ناقص إن غاب أحد المثبّتين، ثم ينشر الإصدار ويجعله أحدث إصدار تلقائياً.

## التوقيع الرقمي

يمكن لسير التحقق اليدوي بناء حزم غير موقّعة لأغراض الاختبار الداخلي. أما سير
النشر الرسمي فيرفض البدء ما لم توجد شهادتا Apple وWindows وبيانات notarization،
ثم يتحقق من توقيع macOS وتذكرة Apple ومن Authenticode على Windows قبل رفع
الملفات. لا تُخزّن الشهادات أو كلمات مرورها داخل Git مطلقاً.
