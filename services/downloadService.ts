/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Desktop Download Service — premium lightweight wrappers + native fallback
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Supported channels:
 *
 *  1) **Native** (preferred when configured):
 *     If `VITE_DESKTOP_RELEASE_URL` resolves to a valid manifest, the
 *     user is sent straight to the prebuilt `.dmg` / `.exe` produced by
 *     CI. No ZIP is generated locally.
 *
 *  2) **Lightweight wrapper** (explicit fallback only):
 *     A small ZIP containing:
 *       • macOS  → a fully-formed `Hader.app` bundle (Info.plist +
 *         POSIX-executable launcher + multi-resolution `.icns` icon)
 *       • Windows → silent VBScript wrapper, BAT engine, multi-resolution
 *         `.ico`, and a one-click shortcut installer
 *
 *     Both bundles open the live deployment in Chrome / Edge / Brave
 *     **App Mode**. Because the launchers target the live URL, the
 *     desktop install is always synchronized with the cloud database,
 *     receives auto-updates from the CDN, and supports offline usage
 *     through the existing PWA service-worker pipeline. No Supabase
 *     credentials are embedded.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { logger } from './logger';
import {
  APP_URL,
  APP_LAUNCH_PATH,
  APP_VERSION,
  createBuildFingerprint,
  getBuildId,
} from './desktopBuildInfo';
import {
  lookupNativeRelease,
  startNativeReleaseDownload,
  type NativeReleaseAsset,
  type ReleaseLookupResult,
} from './desktopReleaseChecker';
import { buildIcnsFromUrl, buildIcoFromUrl } from './desktop/icns';
import { injectMacAppBundle } from './desktop/macAppBundle';
import { injectWindowsLauncher } from './desktop/windowsLauncher';
import { buildWelcomeHtml } from './desktop/welcomePage';

export type Platform = 'mac' | 'windows';

export type DownloadChannel = 'native' | 'lightweight';

export interface DownloadProgress {
  stage:
    | 'preparing'
    | 'discovering-release'
    | 'using-native'
    | 'fetching-assets'
    | 'bundling'
    | 'compressing'
    | 'finalizing'
    | 'complete';
  progress: number;
  message: string;
  channel?: DownloadChannel;
}

export interface DownloadResult {
  channel: DownloadChannel;
  filename: string;
  fileSize?: number;
  buildId: string;
  appUrl: string;
  releaseManifestUsed?: boolean;
  iconEmbedded?: boolean;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export interface DownloadOptions {
  /** Force a particular channel; otherwise a native installer is required. */
  preferredChannel?: DownloadChannel;
  /** Optional callback invoked on every progress update. */
  onProgress?: ProgressCallback;
}

const PRODUCT_NAME = 'نظام حاضر';
const BUNDLE_IDENTIFIER = 'sa.hader.lightweight';
const ICON_SOURCE_URL = '/logo512.png'; // resolved from APP_URL at runtime

export class NativeReleaseUnavailableError extends Error {
  readonly reason: ReleaseLookupResult['reason'];

  constructor(reason: ReleaseLookupResult['reason']) {
    super('لا تتوفر نسخة Electron الأصلية حالياً. يمكنك اختيار النسخة الخفيفة يدوياً، لكنها لا تدعم تكامل نور.');
    this.name = 'NativeReleaseUnavailableError';
    this.reason = reason;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers exposed for the sidebar UI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether the launcher should be allowed at all. The lightweight
 * wrapper only depends on a reachable web origin; we verify the origin
 * actually points at a real deployment (not `about:blank`, `data:`, or a
 * local Electron `file://` URL).
 */
export const hasValidLauncherTarget = (): boolean => {
  if (!APP_URL) return false;
  if (!/^https?:\/\//i.test(APP_URL)) return false;
  return true;
};

export const getLauncherTargetInfo = (): {
  appUrl: string;
  launchUrl: string;
  valid: boolean;
  isLocal: boolean;
  isSecureContext: boolean;
} => {
  try {
    const app = new URL(APP_URL);
    const launch = new URL(APP_LAUNCH_PATH || '/', APP_URL);
    const isLocal =
      ['localhost', '127.0.0.1', '::1'].includes(app.hostname) ||
      app.hostname.endsWith('.localhost');
    const valid = /^https?:$/i.test(app.protocol);
    return {
      appUrl: app.origin,
      launchUrl: launch.toString(),
      valid,
      isLocal,
      isSecureContext: app.protocol === 'https:' || isLocal,
    };
  } catch {
    return {
      appUrl: APP_URL,
      launchUrl: APP_URL,
      valid: false,
      isLocal: false,
      isSecureContext: false,
    };
  }
};

/**
 * Backwards-compatible flag: kept so older callers that still expect a
 * `hasCredentials` symbol continue to work. The new lightweight wrapper does
 * NOT embed credentials, so the button just needs a valid live origin.
 */
export const hasCredentials = (): boolean => hasValidLauncherTarget();

/** Display-friendly hostname (no protocol). */
export const getMaskedCredentials = (): { url: string; key: string } => {
  let host = APP_URL;
  try {
    host = new URL(APP_URL).host;
  } catch {
    // keep raw value
  }
  return {
    url: host,
    key: `build:${getBuildId()}`,
  };
};

/** Probe for a native release without triggering a download. */
export const probeNativeRelease = async (platform: Platform): Promise<ReleaseLookupResult> =>
  lookupNativeRelease(platform);

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const APP_LAUNCH_URL: string = (() => {
  try {
    const url = new URL(APP_LAUNCH_PATH || '/', APP_URL);
    return url.toString();
  } catch {
    return APP_URL;
  }
})();

function readme(platform: Platform): string {
  const platformLabel = platform === 'mac' ? 'macOS' : 'Windows';
  const installer = platform === 'mac' ? 'Resources/launch.command' : 'Install-Shortcut.bat';
  const launcher = platform === 'mac' ? 'Hader.app' : 'Hader.vbs';

  return `# ${PRODUCT_NAME} — Desktop (${platformLabel})

> الإصدار: \`${APP_VERSION}\` • build \`${getBuildId()}\`
> الخادم الحيّ: \`${APP_URL}\`

---

## ⚡ ما الذي يفعله هذا المشغّل؟

مشغّل **خفيف وآمن** يفتح نظام حاضر كنافذة سطح مكتب مستقلة، مرتبطة مباشرةً بنفس
قاعدة بيانات Supabase الخاصة بنسختك السحابية. تتم المزامنة تلقائيًا، ويعمل
التطبيق دون اتصال عبر آلية PWA بعد أول تشغيل ناجح.

- ✅ بدون تثبيت Node.js — بدون npm install
- ✅ تحديثات تلقائية (المتصفح يجلب أحدث نسخة من الخادم)
- ✅ نفس الحساب · نفس البيانات بين الويب وسطح المكتب
- ✅ يدعم العمل دون اتصال بعد أول تشغيل ناجح
- ✅ لا يحتوي على أي مفاتيح أو بيانات حساسة

---

## 🚀 طريقة التشغيل

${platform === 'mac'
    ? `1. فك الضغط في أي مجلد (مثل \`~/Applications\`).
2. اسحب **\`Hader.app\`** إلى مجلد \`Applications\`.
3. انقر مرّتين على **\`Hader.app\`** — ستفتح النافذة المستقلة مباشرة دون أي
   نافذة Terminal.

> **قائمة Dock**: انقر بزر الفأرة الأيمن على أيقونة Hader في Dock بعد التشغيل،
> ثم اختر *Options → Keep in Dock*.
>
> **في حال منع macOS التطبيق** (Apple Gatekeeper بسبب عدم التوقيع):
> System Settings → Privacy & Security → "افتح على أي حال".`
    : `1. فك الضغط في أي مجلد (مثل \`C:\\Hader\\\`).
2. انقر مرّتين على **\`Hader.vbs\`** — ستفتح نافذة سطح المكتب فورًا دون نافذة CMD.
3. (اختياري) شغّل **\`${installer}\`** لإضافة اختصار على سطح المكتب وفي Start Menu
   مع أيقونة \`Hader.ico\` مرفقة.`}

> إن لم يكن لديك Chrome / Edge / Brave سيُفتح التطبيق في المتصفح الافتراضي.
> للحصول على التجربة الكاملة في وضع التطبيق نوصي بتثبيت Chrome 100+ أو Edge 110+.

---

## 🌐 المزامنة والاتصال

هذا المشغّل يفتح \`${APP_LAUNCH_URL}\` مباشرةً، أي:

- يستخدم **نفس مفاتيح Supabase** المنشورة على الخادم — لا يتم تضمين مفاتيح سرية.
- جميع البيانات (الطلاب، الحضور، الإشعارات، الإعدادات) **متزامنة لحظيًا** مع
  نسختك السحابية والأجهزة الأخرى عبر Supabase Realtime.
- في حال انقطاع الإنترنت، يستخدم التطبيق ذاكرة التخزين المؤقت في المتصفح
  ويُكمل العمل، ثم تتم المزامنة عند رجوع الاتصال.

---

## 🔒 الأمان والخصوصية

- لا يحتوي هذا الملف على أي مفاتيح سرية (\`anon key\` أو غيرها).
- ملفات تعريف المتصفح المخصصة لـ App Mode محفوظة محليًا على جهازك في:
  ${platform === 'mac'
    ? `\`~/Library/Application Support/Hader/AppMode\``
    : `\`%LOCALAPPDATA%\\Hader\\AppMode\``}
- سجل تشخيصي محلي يُكتب إلى:
  ${platform === 'mac'
    ? `\`~/Library/Application Support/Hader/launcher.log\``
    : `\`%LOCALAPPDATA%\\Hader\\launcher.log\``}

---

## 🛠 استكشاف الأخطاء

| المشكلة | الحل |
|---------|-------|
| رسالة "تعذر الوصول للخادم" | تحقق من الإنترنت ثم أعد التشغيل. التطبيق سيعمل من الذاكرة المخزنة إن سبق وفُتح. |
| لا تظهر نافذة مستقلة | ثبّت Google Chrome أو Microsoft Edge. |
| ${platform === 'mac' ? 'macOS يمنع فتح Hader.app' : 'SmartScreen يحذّر من Hader.vbs'} | ${platform === 'mac' ? 'System Settings → Privacy & Security → "افتح على أي حال".' : 'انقر "More info" ثم "Run anyway".'} |
| البيانات تختلف عن النسخة السحابية | تأكد من تسجيل الدخول بنفس الحساب، ثم انقر "تحديث" داخل التطبيق. |
| ${platform === 'mac' ? 'Hader.app غير قابل للتنفيذ' : 'Hader.vbs لا يعمل'} | ${platform === 'mac' ? 'استخدم \\`xattr -dr com.apple.quarantine Hader.app\\` ثم أعد المحاولة.' : 'استخدم Hader.bat بدلًا منه (يعرض نافذة CMD مع رسائل التشخيص).'} |

---

## 📞 الدعم الفني

الموقع الرسمي: ${APP_URL}
صفحة الدعم: ${APP_URL}/#/support

---

*صُنع بعناية لفريق نظام حاضر* — \`build ${getBuildId()}\` • \`${new Date().toISOString()}\`
`;
}

function buildVersionJson(platform: Platform, iconEmbedded: boolean): string {
  const fingerprint = createBuildFingerprint('lightweight');
  return JSON.stringify(
    {
      ...fingerprint,
      target: platform,
      generatedAt: new Date().toISOString(),
      iconEmbedded,
      bundleStructure: platform === 'mac' ? 'app-bundle' : 'vbs+bat',
    },
    null,
    2
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle assembly (lightweight)
// ─────────────────────────────────────────────────────────────────────────────

interface BuildContext {
  report: (stage: DownloadProgress['stage'], progress: number, message: string) => void;
}

async function fetchIconAssets(): Promise<{ icns: Uint8Array | null; ico: Uint8Array | null }> {
  const iconUrl = (() => {
    try {
      return new URL(ICON_SOURCE_URL, APP_URL).toString();
    } catch {
      return null;
    }
  })();

  if (!iconUrl) return { icns: null, ico: null };

  const [icns, ico] = await Promise.all([
    buildIcnsFromUrl(iconUrl).catch(() => null),
    buildIcoFromUrl(iconUrl).catch(() => null),
  ]);
  return { icns, ico };
}

async function buildLightweightBundle(
  platform: Platform,
  ctx: BuildContext
): Promise<DownloadResult> {
  const { report } = ctx;
  report('preparing', 6, 'جاري تحضير حزمة المشغّل…');

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folderName = `Hader-Desktop-${platform === 'mac' ? 'Mac' : 'Windows'}`;
  const folder = zip.folder(folderName)!;

  report('fetching-assets', 18, 'جلب أيقونات التطبيق من الخادم الحيّ…');
  const icons = await fetchIconAssets();
  const iconBytes = platform === 'mac' ? icons.icns : icons.ico;
  const iconEmbedded = !!iconBytes;

  if (platform === 'mac') {
    report('bundling', 38, 'إنشاء حزمة Hader.app كاملة…');
    injectMacAppBundle(folder, 'Hader', {
      appUrl: APP_URL,
      appLaunchUrl: APP_LAUNCH_URL,
      productName: PRODUCT_NAME,
      bundleIdentifier: BUNDLE_IDENTIFIER,
      version: APP_VERSION,
      buildId: getBuildId(),
      icnsBytes: icons.icns,
    });
  } else {
    report('bundling', 38, 'إنشاء مشغّل Windows صامت + اختصارات…');
    injectWindowsLauncher(folder, {
      appUrl: APP_URL,
      appLaunchUrl: APP_LAUNCH_URL,
      productName: PRODUCT_NAME,
      version: APP_VERSION,
      buildId: getBuildId(),
      icoBytes: icons.ico,
      shortcutName: 'Hader',
    });
  }

  report('bundling', 56, 'إضافة دليل المستخدم وملفات الإصدار…');
  folder.file('README.md', readme(platform));
  folder.file(
    'Open-In-Browser.html',
    buildWelcomeHtml({
      appUrl: APP_URL,
      appLaunchUrl: APP_LAUNCH_URL,
      productName: PRODUCT_NAME,
      version: APP_VERSION,
      buildId: getBuildId(),
    })
  );
  folder.file('version.json', buildVersionJson(platform, iconEmbedded));

  report('compressing', 70, 'جاري ضغط الملفات…');
  const blob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: platform === 'mac' ? 'UNIX' : 'DOS',
    },
    (metadata) => {
      const percent = Math.round(70 + metadata.percent * 0.25);
      report('compressing', percent, `الضغط… ${Math.round(metadata.percent)}%`);
    }
  );

  report('finalizing', 96, 'بدء تنزيل الحزمة…');

  const filename = `${folderName}.zip`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  // Revoke after 60 s — enough for any browser to start the download.
  // Using 0 ms would race-condition against the browser's async download queue.
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 60_000);

  return {
    channel: 'lightweight',
    filename,
    fileSize: blob.size,
    buildId: getBuildId(),
    appUrl: APP_URL,
    releaseManifestUsed: false,
    iconEmbedded,
  };
}

async function startNativeDownload(
  platform: Platform,
  asset: NativeReleaseAsset,
  report: BuildContext['report']
): Promise<DownloadResult> {
  report('using-native', 60, 'تم العثور على نسخة مكتبية رسمية…');
  startNativeReleaseDownload(asset);
  report('finalizing', 95, 'تم بدء تنزيل الحزمة الرسمية في المتصفح.');
  const filename = decodeURIComponent(asset.url.split('/').pop() || `Hader-${platform}`);
  return {
    channel: 'native',
    filename,
    fileSize: asset.size,
    buildId: getBuildId(),
    appUrl: APP_URL,
    releaseManifestUsed: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public download orchestration
// ─────────────────────────────────────────────────────────────────────────────

export const downloadDesktopApp = async (
  platform: Platform,
  optionsOrCallback?: DownloadOptions | ProgressCallback
): Promise<DownloadResult> => {
  // Backwards compatibility: support both `(platform, onProgress)` and `(platform, options)`.
  const options: DownloadOptions =
    typeof optionsOrCallback === 'function'
      ? { onProgress: optionsOrCallback }
      : optionsOrCallback || {};

  const onProgress = options.onProgress;
  const preferredChannel = options.preferredChannel;

  const report: BuildContext['report'] = (stage, progress, message) =>
    onProgress?.({ stage, progress, message });

  if (!hasValidLauncherTarget()) {
    throw new Error('عنوان التطبيق المنشور غير متاح. تأكد من نشر النسخة على خادم HTTPS.');
  }

  try {
    if (preferredChannel !== 'lightweight') {
      report('discovering-release', 12, 'جاري البحث عن نسخة مكتبية رسمية…');
      const release = await lookupNativeRelease(platform);
      if (release.available && release.asset) {
        const result = await startNativeDownload(platform, release.asset, (s, p, m) =>
          onProgress?.({ stage: s, progress: p, message: m, channel: 'native' })
        );
        onProgress?.({ stage: 'complete', progress: 100, message: 'تم بدء التنزيل', channel: 'native' });
        return result;
      }
      // Fall through to lightweight bundle.
      logger.info('Download', 'native release unavailable; explicit lightweight choice required', {
        platform,
        reason: release.reason,
      });
      throw new NativeReleaseUnavailableError(release.reason);
    }

    const result = await buildLightweightBundle(platform, {
      report: (s, p, m) =>
        onProgress?.({ stage: s, progress: p, message: m, channel: 'lightweight' }),
    });
    onProgress?.({
      stage: 'complete',
      progress: 100,
      message: 'تم التنزيل بنجاح',
      channel: 'lightweight',
    });
    return result;
  } catch (error) {
    logger.error('Download', 'desktop app failed', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
};

export default {
  downloadDesktopApp,
  hasCredentials,
  hasValidLauncherTarget,
  getMaskedCredentials,
  probeNativeRelease,
  getLauncherTargetInfo,
};
