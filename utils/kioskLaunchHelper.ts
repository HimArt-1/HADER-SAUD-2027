/**
 * Kiosk Launch Helper - نظام حاضر
 * يدير خيارات تشغيل كشك الحضور: مكان الفتح (شاشة خارجية HDMI، تبويب جديد، نفس النافذة)
 * وأنماط التدوير (طبيعي، إلتفاف يمين، إلتفاف يسار) وإعدادات التثبيت التلقائي.
 */

export type KioskLaunchTarget = 'external' | 'new_tab' | 'same_window';
export type KioskRotation = 'none' | 'right' | 'left';

export interface KioskLaunchPreferences {
  target: KioskLaunchTarget;
  rotation: KioskRotation;
  autoLaunch: boolean;
}

export const KIOSK_STORAGE_KEYS = {
  LAUNCH_TARGET: 'hader:kiosk:launch_target',
  ROTATION: 'hader:kiosk:rotation',
  LAUNCH_AUTO: 'hader:kiosk:launch_auto',
} as const;

/**
 * استرجاع تفضيلات فتح الكشك المحفوظة
 */
export function getKioskLaunchPreferences(): KioskLaunchPreferences {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {
      target: 'same_window',
      rotation: 'none',
      autoLaunch: false,
    };
  }

  try {
    const rawTarget = localStorage.getItem(KIOSK_STORAGE_KEYS.LAUNCH_TARGET);
    const target: KioskLaunchTarget =
      rawTarget === 'external' || rawTarget === 'new_tab' || rawTarget === 'same_window'
        ? rawTarget
        : 'same_window';

    const rawRotation = localStorage.getItem(KIOSK_STORAGE_KEYS.ROTATION);
    const rotation: KioskRotation =
      rawRotation === 'right' || rawRotation === 'left' || rawRotation === 'none'
        ? rawRotation
        : 'none';

    const autoLaunch = localStorage.getItem(KIOSK_STORAGE_KEYS.LAUNCH_AUTO) === 'true';

    return { target, rotation, autoLaunch };
  } catch {
    return {
      target: 'same_window',
      rotation: 'none',
      autoLaunch: false,
    };
  }
}

/**
 * حفظ تفضيلات فتح الكشك
 */
export function saveKioskLaunchPreferences(prefs: Partial<KioskLaunchPreferences>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    if (prefs.target) {
      localStorage.setItem(KIOSK_STORAGE_KEYS.LAUNCH_TARGET, prefs.target);
    }
    if (prefs.rotation) {
      localStorage.setItem(KIOSK_STORAGE_KEYS.ROTATION, prefs.rotation);
    }
    if (prefs.autoLaunch !== undefined) {
      localStorage.setItem(KIOSK_STORAGE_KEYS.LAUNCH_AUTO, prefs.autoLaunch ? 'true' : 'false');
    }
  } catch {
    // تجاهل أخطاء localStorage
  }
}

/**
 * مسح التثبيت التلقائي للسماح بظهور نافذة الخيارات مجدداً
 */
export function clearKioskAutoLaunch(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.removeItem(KIOSK_STORAGE_KEYS.LAUNCH_AUTO);
  } catch {
    // تجاهل أخطاء localStorage
  }
}

/**
 * بناء مسار الكشك مع بارامتر التدوير إن وجد
 */
export function buildKioskUrl(rotation: KioskRotation = 'none'): string {
  if (rotation && rotation !== 'none') {
    return `/kiosk?rotate=${rotation}`;
  }
  return '/kiosk';
}

/**
 * تنفيذ تشغيل الكشك بحسب الخيارات المحددة
 */
export async function executeKioskLaunch(
  options: {
    target: KioskLaunchTarget;
    rotation: KioskRotation;
    autoLaunch?: boolean;
  },
  navigate: (path: string) => void
): Promise<void> {
  // 1. حفظ تفضيل التدوير فوراً
  saveKioskLaunchPreferences({
    target: options.target,
    rotation: options.rotation,
    autoLaunch: options.autoLaunch,
  });

  const kioskUrl = buildKioskUrl(options.rotation);

  // 2. التنفيذ بحسب وجهة الفتح
  switch (options.target) {
    case 'external': {
      let opened = false;

      // محاولة استخدام Window Management API إن كانت مدعومة في المتصفح الحديث
      if (typeof window !== 'undefined' && 'getScreenDetails' in window) {
        try {
          const screenDetails = await (window as any).getScreenDetails();
          if (screenDetails && screenDetails.screens && screenDetails.screens.length > 1) {
            const current = screenDetails.currentScreen;
            const secondary = screenDetails.screens.find((s: any) => s !== current) || screenDetails.screens[1];
            if (secondary) {
              const { availLeft, availTop, availWidth, availHeight } = secondary;
              const win = window.open(
                kioskUrl,
                'hader_kiosk_external_screen',
                `left=${availLeft},top=${availTop},width=${availWidth},height=${availHeight},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`
              );
              if (win) {
                opened = true;
                try {
                  win.focus();
                } catch {
                  // تجاهل خطأ التركيز
                }
              }
            }
          }
        } catch {
          // في حال عدم توفر الصلاحية أو رفض المستخدم، المتابعة للبديل التلقائي
        }
      }

      // البديل الذكي: نافذة منبثقة مستقلة بأبعاد كاملة في الشاشة الممتدة (Extended Display)
      if (!opened && typeof window !== 'undefined') {
        const screenWidth = window.screen.availWidth || 1920;
        const screenHeight = window.screen.availHeight || 1080;
        const anyScreen = window.screen as any;
        const leftOffset = anyScreen.isExtended
          ? ((anyScreen.availLeft ?? 0) + screenWidth)
          : (anyScreen.availLeft ?? 0);
        const topOffset = anyScreen.availTop ?? 0;

        const win = window.open(
          kioskUrl,
          'hader_kiosk_external_screen',
          `left=${leftOffset},top=${topOffset},width=${screenWidth},height=${screenHeight},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
        );

        if (win) {
          opened = true;
          try {
            win.focus();
          } catch {
            // تجاهل
          }
        } else {
          // إذا منع المتصفح النوافذ المنبثقة، نفتح في تبويب جديد كبديل آمن
          window.open(kioskUrl, '_blank');
          opened = true;
        }
      }
      break;
    }

    case 'new_tab': {
      if (typeof window !== 'undefined') {
        const win = window.open(kioskUrl, '_blank');
        if (win) {
          try {
            win.focus();
          } catch {
            // تجاهل
          }
        } else {
          // بديل إذا تم حجب التبويب
          navigate(kioskUrl);
        }
      } else {
        navigate(kioskUrl);
      }
      break;
    }

    case 'same_window':
    default: {
      navigate(kioskUrl);
      break;
    }
  }
}
