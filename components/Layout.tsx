import React, { useState, useEffect, useRef, createContext, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Shield, Users, Clock, LayoutDashboard, Settings, UserCircle, Activity, X, Bell, Calendar, ChevronLeft, ChevronRight, Headphones, Sun, Moon, MessageSquare, Download, Apple, Monitor, Loader2, CheckCircle2, AlertCircle, ScanLine, FileText, ShieldAlert, Send, DoorOpen, Megaphone, HelpCircle, Info, Cloud, RefreshCw, Sparkles, Globe, Wifi, WifiOff, ClipboardList } from 'lucide-react';
import { localDb } from '../services/localDb';
import { Role, User, STORAGE_KEYS, Notification } from '../types';
import { db } from '../services/db';
import { appSettings } from '../services/settings';
import { notificationCenter } from '../services/notifications';
import {
  downloadDesktopApp,
  hasValidLauncherTarget,
  getLauncherTargetInfo,
  getMaskedCredentials,
  NativeReleaseUnavailableError,
  probeNativeRelease,
  type DownloadChannel,
  type DownloadResult,
  type Platform,
} from '../services/downloadService';
import { APP_VERSION, getBuildId } from '../services/desktopBuildInfo';
import { checkDesktopAutoUpdate, type DesktopUpdateStatus } from '../services/desktopAutoUpdate';
import SyncStatus from './SyncStatus';
import Footer from './Footer';
import { ToastProvider } from './Toast';
import { DesktopAppInfo } from './DesktopAppInfo';
import { isElectron } from '../hooks/useElectron';
import { PAGE_HELP } from '../constants/pageHelp';
import { applyDarkMode, getCurrentColorMode, getStoredColorMode } from '../utils/colorMode';

export const NotificationContext = createContext<{
  notifications: Notification[];
  unreadCount: number;
  markAllRead: () => void;
} | null>(null);

type SourceStyle = {
  label: string;
  icon: typeof Bell;
  iconClass: string;
  chipClass: string;
  cardClass: string;
};

const NOTIFICATION_SOURCE_STYLES: Record<number | 'default', SourceStyle> = {
  1: {
    label: 'الدعم الفني',
    icon: Headphones,
    iconClass: 'text-secondary-300 drop-shadow-[0_0_8px_rgb(var(--color-secondary-500)_/_0.5)]',
    chipClass: 'bg-secondary-500/20 text-secondary-100 border border-secondary-500/30',
    cardClass: 'border border-secondary-500/20 bg-secondary-500/5'
  },
  2: {
    label: 'الإدارة',
    icon: Shield,
    iconClass: 'text-indigo-300 drop-shadow-[0_0_8px_rgba(99,102,241,0.45)]',
    chipClass: 'bg-indigo-500/20 text-indigo-100 border border-indigo-500/30',
    cardClass: 'border border-indigo-500/20 bg-indigo-500/5'
  },
  3: {
    label: 'الإشراف',
    icon: Activity,
    iconClass: 'text-amber-300 drop-shadow-[0_0_8px_rgba(245,158,11,0.45)]',
    chipClass: 'bg-amber-500/20 text-amber-100 border border-amber-500/30',
    cardClass: 'border border-amber-500/20 bg-amber-500/5'
  },
  default: {
    label: 'النظام',
    icon: Bell,
    iconClass: 'text-primary-300 drop-shadow-[0_0_8px_rgb(var(--color-primary-500)_/_0.45)]',
    chipClass: 'bg-primary-500/20 text-primary-100 border border-primary-500/30',
    cardClass: 'border border-primary-500/20 bg-primary-500/5'
  }
};

const getNotificationStyle = (notif: Notification): SourceStyle =>
  NOTIFICATION_SOURCE_STYLES.default;

interface LayoutProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // Default collapsed
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showToast, setShowToast] = useState<{ notif: Notification, visible: boolean } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dark_mode, setDarkMode] = useState(() => getCurrentColorMode() === 'dark');
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [downloadModal, setDownloadModal] = useState<{
    open: boolean;
    platform: Platform | null;
    status: 'idle' | 'downloading' | 'success' | 'error';
    progress: number;
    message: string;
    channel?: DownloadChannel;
    nativeAvailable?: boolean;
    canUseLightweight?: boolean;
    result?: DownloadResult;
    isOnline?: boolean;
  }>({ open: false, platform: null, status: 'idle', progress: 0, message: '' });
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateStatus | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const lastReadKey = `hader:lastNotifSeen:${user?.id}`;
  const renderNotificationIcon = (notif: Notification, big = false) => {
    const style = getNotificationStyle(notif);
    const Icon = style.icon;
    return <Icon className={`${big ? 'w-10 h-10' : 'w-5 h-5'} ${style.iconClass}`} />;
  };

  const upsertNotifications = useCallback((incoming: Notification | Notification[]) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    setNotifications(prev => {
      const map = new Map<string, Notification>();
      [...list, ...prev].forEach(item => {
        if (item.id) map.set(item.id, item);
      });
      return Array.from(map.values())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 50);
    });
  }, []);

  // Load dark mode setting
  useEffect(() => {
    const applySettingsState = (settings: { dark_mode?: boolean }) => {
      if (settings.dark_mode !== undefined) {
        const savedMode = getStoredColorMode();
        const shouldUseDark = savedMode ? savedMode === 'dark' : settings.dark_mode !== false;
        setDarkMode(shouldUseDark);
        applyDarkMode(shouldUseDark, false);
      }
    };
    const unsubscribe = appSettings.subscribe(applySettingsState);
    appSettings.load().then(applySettingsState).catch(console.error);
    return unsubscribe;
  }, []);

  // Probe for a newer desktop launcher in the background (non-blocking).
  useEffect(() => {
    let cancelled = false;
    const idleId = (window as any).requestIdleCallback?.(() => {
      checkDesktopAutoUpdate()
        .then((status) => {
          if (!cancelled) setDesktopUpdate(status);
        })
        .catch(() => undefined);
    }, { timeout: 4000 }) ?? setTimeout(() => {
      checkDesktopAutoUpdate()
        .then((status) => {
          if (!cancelled) setDesktopUpdate(status);
        })
        .catch(() => undefined);
    }, 1500);
    return () => {
      cancelled = true;
      if (typeof idleId === 'number') clearTimeout(idleId);
      else (window as any).cancelIdleCallback?.(idleId);
    };
  }, []);

  // Toggle dark mode
  const toggleDarkMode = async () => {
    const newMode = !dark_mode;
    setDarkMode(newMode);
    applyDarkMode(newMode);

    try {
      await appSettings.execute({ type: 'patch', changes: { dark_mode: newMode } });
    } catch (e) {
      setDarkMode(!newMode);
      applyDarkMode(!newMode);
      console.error('Failed to save dark mode setting', e);
    }
  };

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  /** Notification hooks MUST run unconditionally (Rules of Hooks) — guarded inside. */
  useEffect(() => {
    if (!user) return;
    let active = true;
    notificationCenter.load({ type: 'user', recipient: user })
      .then(initial => {
        if (active && initial.length) {
          upsertNotifications(initial);
        }
      })
      .catch(console.error);
    return () => { active = false; };
  }, [user, upsertNotifications]);

  useEffect(() => {
    if (!user) return;
    const subscription = notificationCenter.subscribe(user, (notif: Notification) => {
      upsertNotifications(notif);
      if (notif.is_popup) {
        setShowToast({ notif, visible: true });
        setTimeout(() => setShowToast(null), 6000);
      }
    });
    return () => { subscription?.unsubscribe(); };
  }, [user, upsertNotifications]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    const currentLastReadKey = `hader:lastNotifSeen:${user.id}`;
    const lastSeenRaw = localStorage.getItem(currentLastReadKey);
    const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : 0;
    const count = notifications.filter(n => {
      const created = new Date(n.created_at).getTime();
      return created > lastSeen;
    }).length;
    setUnreadCount(count);
  }, [notifications, user]);

  const handleNotificationClick = useCallback((notif: Notification) => {
    setBellOpen(false);

    if (user?.role === Role.GUARDIAN) {
      navigate('/parents');
    } else {
      if (notif.type === 'dismissal_call') {
        navigate('/call-board');
      } else if (notif.type === 'attendance' || notif.type === 'behavior') {
        navigate('/supervision');
      } else if (notif.type === 'announcement' || notif.type === 'general') {
        if (user?.role === Role.SITE_ADMIN) {
          navigate('/support');
        } else {
          navigate('/');
        }
      } else {
        if (user?.role === Role.SITE_ADMIN) {
          navigate('/support');
        } else {
          navigate('/');
        }
      }
    }
  }, [user, navigate]);

  // Auto-backup before logout
  const handleBackupAndLogout = async () => {
    setBackupInProgress(true);
    try {
      const students = await localDb.students.toArray();
      const logs = await localDb.attendance_logs.toArray();
      const classes = await localDb.classes.toArray();

      const backup = {
        version: 1,
        timestamp: new Date().toISOString(),
        type: 'auto_logout_backup',
        data: { students, logs, classes }
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hader_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      localStorage.setItem('hader_last_backup_date', new Date().toISOString());
    } catch (e) {
      console.error('Backup failed:', e);
    } finally {
      setBackupInProgress(false);
      setShowLogoutModal(false);
      onLogout();
    }
  };

  // Kiosk mode for student attendance — no chrome (same hook count every render; see above).
  if (!user) return <>{children}</>;
  if (location.pathname === '/kiosk') return <>{children}</>;
  if (location.pathname === '/dismissal-kiosk') return <>{children}</>;
  if (location.pathname === '/call-board') return <>{children}</>;

  const markAllRead = () => {
    localStorage.setItem(lastReadKey, Date.now().toString());
    setUnreadCount(0);
  };

  // Download handler
  const handleDownload = async (platform: Platform, preferredChannel?: DownloadChannel) => {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    setDownloadModal({
      open: true,
      platform,
      status: 'downloading',
      progress: 0,
      message: 'جاري التحضير…',
      isOnline,
      channel: preferredChannel,
      nativeAvailable: preferredChannel === 'lightweight' ? false : undefined,
    });

    if (preferredChannel !== 'lightweight') {
      // Fire the native-release probe in the background — genuinely non-blocking.
      probeNativeRelease(platform)
        .then(probe => {
          setDownloadModal(prev => ({ ...prev, nativeAvailable: probe.available }));
        })
        .catch(() => {
          setDownloadModal(prev => ({ ...prev, nativeAvailable: false }));
        });
    }

    try {
      const result = await downloadDesktopApp(platform, {
        preferredChannel,
        onProgress: (progress) => {
          setDownloadModal(prev => ({
            ...prev,
            progress: progress.progress,
            message: progress.message,
            channel: progress.channel ?? prev.channel,
          }));
        }
      });

      setDownloadModal(prev => ({
        ...prev,
        status: 'success',
        progress: 100,
        message: result.channel === 'native'
          ? 'تم بدء تنزيل النسخة الرسمية في المتصفح ✅'
          : 'تم تنزيل المشغّل الذكي بنجاح ✅',
        channel: result.channel,
        result,
      }));

      // Auto close after success
      setTimeout(() => {
        setDownloadModal({ open: false, platform: null, status: 'idle', progress: 0, message: '' });
      }, 4500);
    } catch (error) {
      setDownloadModal(prev => ({
        ...prev,
        status: 'error',
        message: error instanceof Error ? error.message : 'حدث خطأ أثناء التنزيل',
        canUseLightweight: error instanceof NativeReleaseUnavailableError,
      }));
    }
  };

  // Download Modal Component
  const DownloadModal = downloadModal.open && (() => {
    const platform = downloadModal.platform;
    const platformLabel = platform === 'mac' ? 'macOS' : 'Windows';
    const channel = downloadModal.channel ?? 'native';
    const masked = getMaskedCredentials();
    const closeable = downloadModal.status !== 'downloading';
    const closeModal = () => closeable && setDownloadModal({ open: false, platform: null, status: 'idle', progress: 0, message: '' });
    const fileSizeKB = downloadModal.result?.fileSize ? Math.max(1, Math.round(downloadModal.result.fileSize / 1024)) : null;

    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <button type="button" aria-label="إغلاق نافذة التنزيل" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} />
        <div className="relative glass-card rounded-3xl border border-primary-500/30 p-7 max-w-lg w-full animate-fade-in-up shadow-[0_30px_80px_rgb(var(--color-primary-600)_/_0.25)]">
          {/* Header */}
          <div className="flex items-start gap-4 mb-5">
            <div className={`flex-shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center transition-all
              ${downloadModal.status === 'downloading' ? 'bg-primary-500/15 animate-pulse' :
                downloadModal.status === 'success' ? 'bg-emerald-500/20 ring-1 ring-emerald-400/40' :
                downloadModal.status === 'error' ? 'bg-red-500/20 ring-1 ring-red-400/40' : 'bg-primary-500/10'}`}>
              {downloadModal.status === 'downloading' && <Loader2 className="w-8 h-8 text-primary-300 animate-spin" />}
              {downloadModal.status === 'success' && <CheckCircle2 className="w-8 h-8 text-emerald-300" />}
              {downloadModal.status === 'error' && <AlertCircle className="w-8 h-8 text-red-300" />}
              {downloadModal.status === 'idle' && (platform === 'mac' ? <Apple className="w-8 h-8 text-primary-300" /> : <Monitor className="w-8 h-8 text-primary-300" />)}
            </div>
            <div className="flex-1 min-w-0 text-right">
              <div className="flex items-center gap-2 justify-end flex-wrap">
                <h3 className="text-lg font-bold text-white leading-tight">
                  {downloadModal.status === 'success' ? 'تم التنزيل بنجاح' :
                    downloadModal.status === 'error' ? 'تعذّر إكمال التنزيل' :
                    `تطبيق نظام حاضر لـ ${platformLabel}`}
                </h3>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border
                  ${channel === 'native'
                    ? 'bg-secondary-500/15 text-secondary-200 border-secondary-500/30'
                    : 'bg-primary-500/15 text-primary-200 border-primary-500/30'}`}>
                  {channel === 'native' ? <><Sparkles className="w-3 h-3" /> Native</> : <><Cloud className="w-3 h-3" /> App Mode</>}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">{downloadModal.message}</p>
            </div>
          </div>

          {/* Progress bar */}
          {downloadModal.status === 'downloading' && (
            <div className="mb-5">
              <div className="h-2 bg-slate-700/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-400 via-primary-500 to-secondary-500 transition-all duration-300 rounded-full"
                  style={{ width: `${downloadModal.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
                <span>{downloadModal.progress}%</span>
                <span className="flex items-center gap-1.5">
                  {downloadModal.isOnline ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-amber-400" />}
                  {downloadModal.isOnline ? 'متصل بالخادم' : 'بدون اتصال'}
                </span>
              </div>
            </div>
          )}

          {/* Sync & live deployment info */}
          {(downloadModal.status === 'downloading' || downloadModal.status === 'success') && (
            <div className="bg-slate-900/40 border border-primary-500/15 rounded-2xl p-4 mb-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary-300 uppercase tracking-wider">
                  <RefreshCw className="w-3.5 h-3.5" />
                  مزامنة لحظية
                </span>
                <span className="text-[10px] text-slate-500">الحزمة تتصل بالخادم الحي</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <p className="text-slate-500 mb-0.5">الخادم الحيّ</p>
                  <p className="text-primary-200 font-mono truncate" title={masked.url}>{masked.url}</p>
                </div>
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <p className="text-slate-500 mb-0.5">بصمة البناء</p>
                  <p className="text-primary-200 font-mono">{masked.key}</p>
                </div>
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <p className="text-slate-500 mb-0.5">الإصدار</p>
                  <p className="text-primary-200 font-mono">v{APP_VERSION}</p>
                </div>
                <div className="bg-black/20 rounded-lg p-2 border border-white/5">
                  <p className="text-slate-500 mb-0.5">القناة</p>
                  <p className="text-primary-200 font-medium">
                    {channel === 'native' ? 'مثبّت رسمي' : 'مشغّل ذكي'}
                  </p>
                </div>
              </div>
              {downloadModal.nativeAvailable === false && channel !== 'native' && (
                <p className="text-[10px] text-amber-400/80 leading-relaxed flex items-start gap-1.5">
                  <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  لا توجد نسخة Electron رسمية على الخادم بعد — سيُستخدم مشغّل Chrome/Edge الخفيف، وهو لا يدعم جلسة نور الآمنة.
                </p>
              )}
              {downloadModal.nativeAvailable === true && (
                <p className="text-[10px] text-secondary-300/90 leading-relaxed flex items-start gap-1.5">
                  <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  تم اكتشاف نسخة Electron أصلية تدعم جلسة نور الآمنة — سيبدأ تنزيل المثبّت الرسمي مباشرة.
                </p>
              )}
            </div>
          )}

          {/* Success summary */}
          {downloadModal.status === 'success' && downloadModal.result && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 mb-4 text-[11px] space-y-1">
              <p className="text-emerald-300 font-bold">📦 ملف التنزيل:</p>
              <p className="text-emerald-100 font-mono break-all">{downloadModal.result.filename}</p>
              {fileSizeKB !== null && (
                <p className="text-emerald-200/70">الحجم: ~{fileSizeKB} KB · حزمة خفيفة بدون تثبيت Node.js</p>
              )}
              <p className="text-emerald-200/70 mt-2">
                {channel === 'native'
                  ? 'بعد اكتمال التنزيل من المتصفح، شغّل ملف التثبيت واتبع الخطوات.'
                  : platform === 'mac'
                    ? 'فك الضغط، اسحب Hader.app إلى Applications، ثم انقر مرّتين لفتحه — بدون نافذة Terminal.'
                    : 'فك الضغط، انقر مرّتين على Hader.vbs (تشغيل صامت) أو شغّل Install-Shortcut.bat لإنشاء اختصار سطح المكتب.'}
              </p>
              {downloadModal.result.iconEmbedded && (
                <p className="text-emerald-200/60 mt-1.5 inline-flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  أيقونة التطبيق متعدّدة الأحجام مدمجة داخل الحزمة
                </p>
              )}
            </div>
          )}

          {/* Error help */}
          {downloadModal.status === 'error' && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 text-[11px] space-y-1.5">
              <p className="text-red-200 font-bold">تعذّر إكمال العملية</p>
              <p className="text-red-200/80 leading-relaxed">
                إذا استمرّ الخطأ: تأكد من اتصال الإنترنت، ومن أن المتصفح يسمح بتنزيل الملفات،
                ثم أعد المحاولة. النسخة الخفيفة متاحة باختيار صريح، لكنها لا تدعم جلسة نور الآمنة.
              </p>
            </div>
          )}

          {/* Actions */}
          {downloadModal.status !== 'downloading' && (
            <div className="flex gap-2">
              <button
                onClick={closeModal}
                className="flex-1 py-3 rounded-xl bg-white/10 text-white hover:bg-white/15 transition-all font-medium border border-white/10"
              >
                إغلاق
              </button>
              {downloadModal.status === 'success' && (
                <button
                  onClick={() => platform && handleDownload(platform)}
                  className="flex-1 py-3 rounded-xl bg-primary-500/20 text-primary-100 hover:bg-primary-500/30 transition-all font-medium border border-primary-500/30 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> إعادة التنزيل
                </button>
              )}
              {downloadModal.status === 'error' && downloadModal.canUseLightweight && (
                <button
                  onClick={() => platform && handleDownload(platform, 'lightweight')}
                  className="flex-1 py-3 rounded-xl bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 transition-all font-medium border border-amber-500/30 flex items-center justify-center gap-2"
                >
                  <Cloud className="w-4 h-4" /> تنزيل النسخة الخفيفة
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  })();

  // Mobile Scanner Section for Sidebar
  const ScannerSection = (user.role === Role.SITE_ADMIN || user.role === Role.SCHOOL_ADMIN || user.role === Role.SUPERVISOR_GLOBAL || user.role === Role.SUPERVISOR_CLASS || user.role === Role.WATCHER) && (
    <div className={`border-t border-primary-500/10 transition-all duration-300 ${sidebarCollapsed ? 'p-2' : 'p-4'}`}>
      {!sidebarCollapsed && (
        <p className="text-[10px] text-primary-500/60 uppercase tracking-wider mb-3 font-bold">📱 ماسح الجوال</p>
      )}
      <button
        onClick={() => navigate('/scanner')}
        title={sidebarCollapsed ? 'ماسح الباركود' : undefined}
        className={`group relative flex items-center rounded-xl transition-all duration-300 overflow-hidden w-full hover:scale-105
          ${sidebarCollapsed
            ? 'p-3 justify-center bg-gradient-to-br from-emerald-900 to-teal-950 border border-emerald-700/50 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]'
            : 'gap-3 px-4 py-3 bg-gradient-to-br from-emerald-900 to-teal-950 border border-emerald-700/50 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]'
          }`}
      >
        <ScanLine className={`text-emerald-300 group-hover:text-white transition-colors ${sidebarCollapsed ? 'w-5 h-5' : 'w-5 h-5'}`} />
        {!sidebarCollapsed && (
          <div className="text-right">
            <span className="text-sm text-emerald-200 group-hover:text-white font-medium block">ماسح الباركود</span>
            <span className="text-[10px] text-emerald-400/70">للجوال - iOS & Android</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/10 to-emerald-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
      </button>
    </div>
  );

  // Download Section Component for Sidebar (Hidden in Electron)
  const launcherEnabled = hasValidLauncherTarget();
  const launcherTarget = getLauncherTargetInfo();
  const DownloadSection = !isElectron() && (user.role === Role.SITE_ADMIN || user.role === Role.SCHOOL_ADMIN) && (
    <div className={`border-t border-primary-500/10 transition-all duration-300 ${sidebarCollapsed ? 'p-2' : 'p-4'}`}>
      {!sidebarCollapsed && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] text-primary-500/60 uppercase tracking-wider font-bold">📥 تطبيق سطح المكتب</p>
          {desktopUpdate?.hasUpdate ? (
            <span
              className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-200 bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 rounded-full animate-pulse"
              title={`نسخة جديدة v${desktopUpdate.latestVersion} متاحة`}
            >
              <Sparkles className="w-2.5 h-2.5" /> v{desktopUpdate.latestVersion} متاحة
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
              <Cloud className="w-2.5 h-2.5" /> Synced
            </span>
          )}
        </div>
      )}
      <div className={`flex gap-2 ${sidebarCollapsed ? 'flex-col items-center' : ''}`}>
        {/* Mac Download */}
        <button
          onClick={() => handleDownload('mac')}
          disabled={!launcherEnabled}
          title={sidebarCollapsed ? `تنزيل لـ macOS · v${APP_VERSION} (build ${getBuildId()})` : undefined}
          aria-label="تنزيل تطبيق Mac"
          className={`group relative flex items-center rounded-xl transition-all duration-300 overflow-hidden
            ${!launcherEnabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
            ${sidebarCollapsed
              ? 'p-3 justify-center bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600/50 hover:border-primary-500/50 hover:shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.3)]'
              : 'flex-1 gap-2 px-3 py-2.5 bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600/50 hover:border-primary-500/50 hover:shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.3)]'
            }`}
        >
          <Apple className={`text-slate-300 group-hover:text-white transition-colors ${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'}`} />
          {!sidebarCollapsed && <span className="text-xs text-slate-300 group-hover:text-white font-medium">macOS</span>}
          <div className="absolute inset-0 bg-gradient-to-r from-primary-500/0 via-primary-500/10 to-primary-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
        </button>

        {/* Windows Download */}
        <button
          onClick={() => handleDownload('windows')}
          disabled={!launcherEnabled}
          title={sidebarCollapsed ? `تنزيل لـ Windows · v${APP_VERSION} (build ${getBuildId()})` : undefined}
          aria-label="تنزيل تطبيق Windows"
          className={`group relative flex items-center rounded-xl transition-all duration-300 overflow-hidden
            ${!launcherEnabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
            ${sidebarCollapsed
              ? 'p-3 justify-center bg-gradient-to-br from-secondary-900 to-secondary-950 border border-secondary-700/50 hover:border-secondary-500/50 hover:shadow-[0_0_15px_rgb(var(--color-secondary-400)_/_0.3)]'
              : 'flex-1 gap-2 px-3 py-2.5 bg-gradient-to-br from-secondary-900 to-secondary-950 border border-secondary-700/50 hover:border-secondary-500/50 hover:shadow-[0_0_15px_rgb(var(--color-secondary-400)_/_0.3)]'
            }`}
        >
          <Monitor className={`text-secondary-300 group-hover:text-white transition-colors ${sidebarCollapsed ? 'w-5 h-5' : 'w-4 h-4'}`} />
          {!sidebarCollapsed && <span className="text-xs text-secondary-300 group-hover:text-white font-medium">Windows</span>}
          <div className="absolute inset-0 bg-gradient-to-r from-secondary-500/0 via-secondary-500/10 to-secondary-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
        </button>
      </div>
      {!sidebarCollapsed && launcherEnabled && (
        <p className={`text-[9px] mt-2 text-center leading-relaxed flex items-center justify-center gap-1 ${launcherTarget.isLocal || !launcherTarget.isSecureContext ? 'text-amber-300/85' : 'text-slate-500'}`}>
          <Globe className="w-2.5 h-2.5" />
          {launcherTarget.isLocal
            ? 'حزمة محلية للاختبار · تعمل ما دام الخادم المحلي شغالاً'
            : launcherTarget.isSecureContext
              ? 'نافذة سطح مكتب مستقلة · مزامنة لحظية · تحديثات تلقائية'
              : 'يفضّل HTTPS لضمان PWA والعمل دون اتصال'}
        </p>
      )}
      {!sidebarCollapsed && !launcherEnabled && (
        <p className="text-[9px] text-amber-400/80 mt-2 text-center">⚠️ يجب نشر التطبيق على عنوان HTTPS أوّلًا</p>
      )}
    </div>
  );

  // Bell Icon and Popover - Neon Cyan Style
  const NotificationPopover = () => (
    <div
      className="absolute top-full right-0 mt-3 z-50 max-h-[70vh] glass-card rounded-3xl border border-primary-500/30 shadow-[0_0_40px_rgb(var(--color-primary-500)_/_0.15)] overflow-y-auto animate-fade-in-up backdrop-blur-xl flex flex-col rtl text-right"
      dir="rtl"
      style={{ width: 'min(320px, calc(100vw - 8px))', right: 0 }}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-primary-500/20">
        <span className="font-bold text-lg text-white">الإشعارات</span>
        <button onClick={() => setBellOpen(false)} aria-label="إغلاق الإشعارات" className="p-1 hover:bg-primary-500/10 rounded-full text-slate-400 hover:text-primary-400 transition-colors"><X className="w-5 h-5" /></button>
      </div>
      <ul className="divide-y divide-primary-500/10 py-1 px-2">
        {notifications.length === 0 && (<li className="text-center text-slate-400 py-8">لا توجد إشعارات حالياً</li>)}
        {notifications.slice(0, 12).map((notif, idx) => {
          const style = getNotificationStyle(notif);
          return (
            <li
              key={notif.id + idx}
              onClick={() => handleNotificationClick(notif)}
              className={`flex gap-3 items-start p-4 rounded-2xl cursor-pointer transition-all group hover:scale-[1.02] ${style.cardClass}`}
            >
              <span className="flex-shrink-0 w-10 h-10 rounded-2xl bg-black/30 flex items-center justify-center">{renderNotificationIcon(notif)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex gap-2 items-center mb-1">
                  <span className="text-sm font-bold text-white truncate">{notif.title || 'تنبيه'}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${style.chipClass}`}>{style.label}</span>
                  {notif.is_popup && <span className="text-[10px] bg-white/10 text-white rounded-full px-2 py-0.5 ml-2 animate-pulse font-bold border border-white/10">منبّه</span>}
                </div>
                <div className="text-[13px] text-slate-200 truncate">{notif.message}</div>
                <div className="text-xs text-slate-400 mt-1 flex gap-2 items-center">
                  <Calendar className="w-3 h-3 inline opacity-60" /> {(new Date(notif.created_at)).toLocaleString('ar-SA')}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {user?.role !== Role.GUARDIAN && (
        <button
          onClick={() => { setBellOpen(false); navigate('/support'); }}
          className="shadow-inner px-4 py-2 text-xs font-bold font-sans mt-2 mb-4 mx-8 bg-gradient-to-r from-primary-500 to-secondary-600 text-white rounded-xl hover:scale-105 transition-all hover:shadow-[0_0_20px_rgb(var(--color-primary-500)_/_0.4)]"
        >
          كل الدعم الفني والتنبيهات
        </button>
      )}
    </div>
  );

  const NotificationIcon = (
    <div className="relative">
      <button
        ref={bellRef}
        onClick={() => {
          setBellOpen(o => !o);
          markAllRead();
        }}
        className="relative p-2 rounded-full hover:bg-primary-500/10 transition flex items-center justify-center group mx-2 hover:shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.3)]"
        aria-label="الإشعارات"
      >
        <Bell className="w-7 h-7 text-primary-400 drop-shadow-lg" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-gradient-to-r from-primary-500 to-secondary-600 text-white text-xs rounded-full px-1.5 py-0.5 shadow-[0_0_10px_rgb(var(--color-primary-500)_/_0.5)] animate-pulse border-2 border-slate-900" style={{ fontFamily: 'Tajawal' }}>
            {unreadCount}
          </span>
        )}
      </button>
      {bellOpen && <NotificationPopover />}
    </div>
  );

  // Toast Popup (Glass/Neon Cyan, Fade-in/out)
  const Toast = showToast && showToast.visible && (() => {
    const style = getNotificationStyle(showToast.notif);
    return (
      <div
        onClick={() => {
          handleNotificationClick(showToast.notif);
          setShowToast(null);
        }}
        className={`fixed z-[140] bottom-8 right-8 md:right-10 max-w-xs w-[340px] glass-card ${style.cardClass} shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.2)] animate-fade-in-up backdrop-blur-2xl p-5 flex items-center cursor-pointer hover:scale-105 transition-transform`}
        dir="rtl"
      >
        <div className="flex-shrink-0 mr-3">{renderNotificationIcon(showToast.notif, true)}</div>
        <div className="flex-1 text-right">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-lg font-bold text-white">{showToast.notif.title || "تنبيه جديد"}</div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${style.chipClass}`}>{style.label}</span>
          </div>
          <div className="text-sm text-primary-200 mb-1">{showToast.notif.message}</div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowToast(null);
            }}
            className="text-xs bg-white/10 text-white/80 font-bold rounded-xl px-4 py-1 mt-1 hover:bg-white/20 transition border border-white/20"
          >
            إغلاق
          </button>
        </div>
      </div>
    );
  })();

  const menuItems = [
    { label: 'الرئيسية', icon: LayoutDashboard, path: '/', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.WATCHER, Role.SUPERVISOR_CLASS] },
    { label: 'الإدارة', icon: Settings, path: '/admin', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN] },
    { label: 'كشك الحضور', icon: Clock, path: '/kiosk', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.KIOSK, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS] },
    { label: 'المراقبة اليومية', icon: Activity, path: '/watcher', roles: [Role.SITE_ADMIN, Role.WATCHER, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS] },
    { label: 'الإشراف', icon: Shield, path: '/supervision', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS] },
    { label: 'التقارير', icon: FileText, path: '/reports', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS] },
    { label: 'الاستبيانات', icon: ClipboardList, path: '/surveys', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN] },
    { label: 'الدعم الفني', icon: Headphones, path: '/support', roles: [Role.SITE_ADMIN] },
    { label: 'إدارة الرسائل', icon: MessageSquare, path: '/whatsapp', roles: [] },
    { label: 'تحكم تيلجرام', icon: Send, path: '/telegram', roles: [Role.SITE_ADMIN] },
    { label: 'كشك الانصراف', icon: DoorOpen, path: '/dismissal-kiosk', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.KIOSK, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS] },
    { label: 'لوحة النداءات', icon: Megaphone, path: '/call-board', roles: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS] },
  ];

  const allowedItems = menuItems.filter(item => {
    if (item.path === '/whatsapp') return user.role === Role.SITE_ADMIN || user.can_use_whatsapp;
    return item.roles.includes(user.role);
  });

  // Dark Mode Toggle Button Component
  const DarkModeToggle = (
    <button
      onClick={toggleDarkMode}
      className={`p-2 rounded-xl transition-all border ${dark_mode
        ? 'bg-white/5 border-white/10 text-yellow-400 hover:bg-yellow-500/10 hover:border-yellow-500/30'
        : 'bg-black/5 border-black/10 text-indigo-600 hover:bg-indigo-500/10 hover:border-indigo-500/30'
        }`}
      title={dark_mode ? 'تبديل للوضع الفاتح' : 'تبديل للوضع الداكن'}
      aria-label={dark_mode ? 'تبديل للوضع الفاتح' : 'تبديل للوضع الداكن'}
    >
      {dark_mode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );

  // Help Button Component
  const HelpButton = (
    <button
      onClick={() => setShowHelpModal(true)}
      className={`p-2 rounded-xl transition-all border ${dark_mode
        ? 'bg-primary-500/10 border-primary-500/20 text-primary-400 hover:bg-primary-500/20 hover:border-primary-500/40'
        : 'bg-secondary-50 border-secondary-100 text-secondary-600 hover:bg-secondary-100 hover:border-secondary-200'
        }`}
      title="المساعد الذكي / المساعدة"
      aria-label="فتح المساعد الذكي"
    >
      <HelpCircle className="w-5 h-5" />
    </button>
  );

  return (
    <ToastProvider>
      <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead }}>
        <div className={`app-shell min-h-[100dvh] w-full max-w-full overflow-x-hidden flex flex-col md:flex-row ${dark_mode ? 'text-gray-100' : 'text-gray-800'}`}>
          {/* Topbar for mobile */}
          <div className={`md:hidden safe-top ${dark_mode ? 'glass' : 'bg-white/80 backdrop-blur-lg'} px-4 pb-3 pt-4 flex justify-between items-center z-20 border-b ${dark_mode ? 'border-white/10' : 'border-gray-200'} sticky top-0`}>
            <img
              src="/images/hader-logo.png"
              alt="حاضر"
              className="h-16 w-auto object-contain drop-shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.5)]"
              onError={(e) => { e.currentTarget.outerHTML = `<h1 class="text-2xl font-bold font-serif ${dark_mode ? 'text-white text-glow' : 'text-gray-800'}">حاضر</h1>`; }}
            />
            <div className="flex items-center gap-2 ml-auto">
              {NotificationIcon}
              {/* Mobile Scanner Button - Show for admins, supervisors, and watchers */}
              {(user.role === Role.SITE_ADMIN || user.role === Role.SCHOOL_ADMIN || user.role === Role.SUPERVISOR_GLOBAL || user.role === Role.SUPERVISOR_CLASS || user.role === Role.WATCHER) && (
                <button
                  onClick={() => navigate('/scanner')}
                  className="relative p-2 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 transition flex items-center justify-center group hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] border border-emerald-500/30"
                  aria-label="ماسح الباركود"
                >
                  <ScanLine className="w-6 h-6 text-emerald-400 drop-shadow-lg" />
                </button>
              )}
              <button
                onClick={() => setSidebarOpen(prev => !prev)}
                className={`p-2 rounded-lg ${dark_mode ? 'bg-white/5 border-white/10 text-white' : 'bg-black/5 border-black/10 text-gray-700'} border`}
                aria-label={sidebarOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
                aria-expanded={sidebarOpen}
              >
                {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
              <button
                onClick={() => setShowHelpModal(true)}
                className={`p-2 rounded-lg ${dark_mode ? 'bg-primary-500/20 border-primary-500/30 text-primary-400' : 'bg-secondary-50 border-secondary-100 text-secondary-600'} border`}
                aria-label="فتح المساعد الذكي"
              >
                <HelpCircle className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Sidebar - Collapsible on Click */}
          <aside
            className={`
            fixed inset-y-0 right-0 z-30 glass-panel flex flex-col transition-[transform,opacity] duration-300 ease-out transform
            ${sidebarOpen ? 'translate-x-0 opacity-100 pointer-events-auto' : 'translate-x-full opacity-0 pointer-events-none'}
            md:translate-x-0 md:opacity-100 md:pointer-events-auto md:static md:inset-auto md:flex md:flex-col
            border-l border-white/5
            ${sidebarCollapsed ? 'md:w-20' : 'md:w-72'} w-[min(18rem,calc(100vw-3rem))] safe-top safe-bottom
          `}
          >
            {/* Logo - Click to toggle - Futuristic Neon Style */}
            <div
              className={`border-b border-primary-500/10 relative transition-all duration-300 cursor-pointer hover:bg-primary-500/5 ${sidebarCollapsed ? 'p-4 md:p-3' : 'p-6'}`}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <button
                onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }}
                className="md:hidden absolute top-4 left-4 p-2 rounded-full bg-white/5 text-slate-400 hover:text-primary-400 transition-colors"
                aria-label="إغلاق القائمة"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center text-center">
                {/* Logo with Glass Frame */}
                <div className={`relative group transition-all duration-300 ${sidebarCollapsed ? 'mb-2' : 'mb-6'}`}>
                  {/* Refined Backside Glow */}
                  <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-500/20 blur-[50px] pointer-events-none transition-all duration-500 ${sidebarCollapsed ? 'w-16 h-16 opacity-40' : 'w-40 h-40 opacity-60 group-hover:opacity-80'}`}></div>

                  <div className={`relative z-10 flex items-center justify-center transition-all duration-300 ${sidebarCollapsed ? 'h-12' : 'h-24'}`}>
                    <img
                      src="/images/hader-logo.png"
                      alt="حاضر"
                      className={`relative object-contain transition-all duration-300 drop-shadow-[0_0_20px_rgb(var(--color-primary-500)_/_0.3)] hover:drop-shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.5)] ${sidebarCollapsed ? 'h-10' : 'h-28'}`}
                      onError={(e) => {
                        e.currentTarget.parentElement!.innerHTML = `<span class="font-bold text-transparent bg-clip-text bg-gradient-to-br from-primary-400 to-secondary-400 ${sidebarCollapsed ? 'text-xl' : 'text-3xl'}">حاضر</span>`;
                      }}
                    />
                  </div>
                </div>
                <div className={`overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'md:w-0 md:h-0 md:opacity-0' : 'w-full opacity-100'}`}>
                  <p className="text-[10px] text-primary-400/60 mt-1 font-light tracking-widest uppercase">نظام إدارة الحضور</p>
                </div>
                {/* Toggle indicator */}
                <div className={`hidden md:flex items-center justify-center mt-2 text-primary-500/50 transition-all ${sidebarCollapsed ? 'md:mt-1' : ''}`}>
                  <ChevronLeft className={`w-4 h-4 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </div>

            {/* User Info - Neon Style */}
            <div className={`border-b border-primary-500/10 transition-all duration-300 ${sidebarCollapsed ? 'p-2 md:p-2' : 'p-6'}`}>
              <div className={`flex items-center rounded-xl bg-primary-500/5 border border-primary-500/10 transition-all duration-300 hover:border-primary-500/30 ${sidebarCollapsed ? 'p-2 justify-center md:justify-center' : 'gap-4 p-3'}`}>
                <div className={`rounded-full bg-gradient-to-br from-primary-500 to-secondary-600 p-[2px] flex-shrink-0 transition-all duration-300 ${sidebarCollapsed ? 'w-10 h-10' : 'w-10 h-10'}`}>
                  <div className="w-full h-full rounded-full bg-slate-900 dark:bg-slate-900 bg-white flex items-center justify-center">
                    <UserCircle className="w-5 h-5 text-primary-400" />
                  </div>
                </div>
                <div className={`overflow-hidden transition-all duration-300 ${sidebarCollapsed ? 'md:hidden w-0' : 'flex-1'}`}>
                  <p className="text-sm font-bold text-white truncate">{user.name}</p>
                  <p className="text-[10px] text-primary-400 uppercase tracking-wider truncate">{user.role.replace('_', ' ')}</p>
                </div>
              </div>
            </div>

            {/* Navigation - Neon Style */}
            <nav className="flex-1 overflow-y-auto py-4">
              <ul className={`space-y-2 transition-all duration-300 ${sidebarCollapsed ? 'px-2' : 'px-4'}`}>
                {allowedItems.map((item) => (
                  <li key={item.path}>
                    <button
                      onClick={() => {
                        navigate(item.path);
                        setSidebarOpen(false);
                      }}
                      title={sidebarCollapsed ? item.label : undefined}
                      className={`relative w-full flex items-center rounded-xl transition-all duration-300 group overflow-hidden ${sidebarCollapsed ? 'justify-center p-3' : 'gap-4 px-4 py-3.5'
                        } ${location.pathname === item.path
                          ? 'bg-primary-500/10 text-white shadow-[0_0_25px_rgb(var(--color-primary-500)_/_0.2)] border border-primary-500/30'
                          : 'text-slate-400 hover:bg-primary-500/5 hover:text-white hover:border hover:border-primary-500/20 border border-transparent'
                        }`}
                    >
                      {location.pathname === item.path && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary-400 to-secondary-500 rounded-r-full"></div>
                      )}
                      <item.icon className={`flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${sidebarCollapsed ? 'w-6 h-6' : 'w-5 h-5'} ${location.pathname === item.path ? 'text-primary-400' : 'text-slate-500 group-hover:text-primary-400'}`} />
                      <span className={`font-medium tracking-wide whitespace-nowrap transition-all duration-300 ${location.pathname === item.path ? 'font-bold' : ''} ${sidebarCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Mobile Scanner Section */}
            {ScannerSection}

            {/* Download Section - Desktop Apps */}
            {DownloadSection}

            {/* Logout - Neon Style */}
            <div className={`border-t border-primary-500/10 transition-all duration-300 ${sidebarCollapsed ? 'p-2' : 'p-6'}`}>
              <button
                onClick={() => setShowLogoutModal(true)}
                title={sidebarCollapsed ? 'تسجيل خروج' : undefined}
                className={`w-full flex items-center text-red-400 hover:text-white hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/30 hover:shadow-[0_0_15px_rgba(239,68,68,0.2)] group ${sidebarCollapsed ? 'justify-center p-3' : 'justify-center gap-2 px-4 py-3'
                  }`}
              >
                <LogOut className={`group-hover:-translate-x-1 transition-transform ${sidebarCollapsed ? 'w-6 h-6' : 'w-5 h-5'}`} />
                <span className={`transition-all duration-300 ${sidebarCollapsed ? 'md:hidden' : ''}`}>تسجيل خروج</span>
              </button>
            </div>

            {/* Footer */}
            <div className={`text-center transition-all duration-300 ${sidebarCollapsed ? 'p-2 md:p-1' : 'p-4'}`}>
              <p className={`text-[10px] text-primary-500/40 font-light transition-all duration-300 ${sidebarCollapsed ? 'md:hidden' : ''}`}>© 2024 Hader System</p>
            </div>
          </aside>

          {/* Main Content */}
          <main className={`min-w-0 w-full max-w-full flex-1 overflow-y-auto overflow-x-hidden p-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:p-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))] md:p-8 relative z-10 scroll-smooth flex flex-col ${dark_mode ? '' : 'bg-transparent'}`}>
            {/* Desktop Header Bar with Sync Status, Dark Mode Toggle and Notifications */}
            <div className="hidden md:flex items-center justify-between mb-6">
              {/* Desktop App Info - Only visible in Electron */}
              <DesktopAppInfo />
              <div className="flex items-center gap-3 ml-auto">
                {NotificationIcon}
                <SyncStatus />
                {DarkModeToggle}
                {HelpButton}
              </div>
            </div>
            <div className="flex-1 min-w-0 w-full max-w-full">
              {children}
            </div>
            {/* Footer */}
            <Footer />
          </main>

          {/* Overlay for mobile */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-20 md:hidden transition-opacity"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          {/* Mobile Popover for notifications - only show on mobile */}
          {/* Toast notification for popups */}
          {Toast}
          {/* Logout Confirmation Modal */}
          {showLogoutModal && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <button type="button" aria-label="إغلاق نافذة تسجيل الخروج" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !backupInProgress && setShowLogoutModal(false)} />
              <div className="relative glass-card rounded-3xl border border-red-500/30 p-8 max-w-md w-full animate-fade-in-up">
                <div className="text-center mb-6">
                  <div className="w-20 h-20 mx-auto rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                    <ShieldAlert className="w-10 h-10 text-red-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">تسجيل الخروج</h3>
                  <p className="text-sm text-slate-400">هل تريد أخذ نسخة احتياطية قبل الخروج؟</p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleBackupAndLogout}
                    disabled={backupInProgress}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {backupInProgress ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> جاري النسخ...</>
                    ) : (
                      <><Download className="w-5 h-5" /> نسخ احتياطي ثم خروج</>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowLogoutModal(false);
                      onLogout();
                    }}
                    disabled={backupInProgress}
                    className="w-full py-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 font-bold hover:bg-red-500/30 transition-all disabled:opacity-50"
                  >
                    خروج بدون نسخ
                  </button>
                  <button
                    onClick={() => setShowLogoutModal(false)}
                    disabled={backupInProgress}
                    className="w-full py-2.5 rounded-xl text-slate-400 hover:text-white transition-all text-sm disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Download Modal */}
          {DownloadModal}
          
          {/* Help Assistant Modal */}
          {showHelpModal && (() => {
            const currentPath = location.pathname;
            const help = PAGE_HELP[currentPath] || PAGE_HELP['/'];
            
            return (
              <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
                <button type="button" aria-label="إغلاق نافذة المساعدة" className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setShowHelpModal(false)} />
                <div className="relative glass-card rounded-[2rem] border border-primary-500/30 p-8 max-w-2xl w-full animate-fade-in-up overflow-hidden" dir="rtl">
                  {/* Background Glow */}
                  <div className="absolute -top-24 -left-24 w-48 h-48 bg-primary-500/20 rounded-full blur-[80px] pointer-events-none"></div>
                  
                  <div className="flex items-center justify-between mb-8 relative z-10">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
                        <HelpCircle className="w-7 h-7 text-white" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-white">{help.title}</h3>
                        <p className="text-primary-400/70 text-sm">{help.description}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowHelpModal(false)}
                      className="p-2 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors"
                      aria-label="إغلاق نافذة المساعدة"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10 mb-8">
                    {help.features.map((feature, idx) => (
                      <div key={idx} className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-primary-500/30 transition-all group">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-8 h-8 rounded-lg bg-primary-500/20 flex items-center justify-center text-primary-400">
                            <feature.icon className="w-5 h-5" />
                          </div>
                          <h4 className="font-bold text-white">{feature.title}</h4>
                        </div>
                        <p className="text-xs text-slate-400">{feature.text}</p>
                      </div>
                    ))}
                  </div>

                  {help.tips.length > 0 && (
                    <div className="bg-gradient-to-r from-primary-500/10 to-secondary-500/10 border border-primary-500/20 rounded-2xl p-6 relative overflow-hidden">
                      <div className="flex items-center gap-4 relative z-10">
                        <div className="p-3 bg-primary-500/20 rounded-xl">
                          <Info className="w-6 h-6 text-primary-400" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-bold text-white mb-1">نصيحة ذكية</h4>
                          <p className="text-sm text-slate-400">{help.tips[0]}</p>
                        </div>
                        <button 
                          onClick={() => { setShowHelpModal(false); navigate('/support'); }}
                          className="px-6 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white font-bold transition-all shadow-lg shadow-primary-500/20"
                        >
                          المزيد من المساعدة
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </NotificationContext.Provider>
    </ToastProvider>
  );
};

export default Layout;
