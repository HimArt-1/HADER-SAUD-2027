import React, { useEffect, useState, Suspense, useCallback } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { auth } from './services/auth';
import { User, STORAGE_KEYS, Role, SystemSettings } from './types';
import { withTimeout } from './utils/async';
import { logError, NetworkError } from './types/errors';
import { useElectronMenu } from './hooks/useElectron';
import { THEME_CONFIG } from './components/admin/constants';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { accessPolicy, type ProtectedRouteKey } from './modules/access';
import { applyAdminThemeKeyToDOM, applyAdminThemeToDOM } from './hooks/useAdminTheme';
import { applyDarkMode, getStoredColorMode } from './utils/colorMode';
import { hasSurveyAdminAccess } from './services/surveys';

const { canAccessRoute } = accessPolicy;

const Layout = lazyWithRetry(() => import('./components/Layout'));
const PWAInstallPrompt = lazyWithRetry(() => import('./components/PWAInstallPrompt'));
const Login = lazyWithRetry(() => import('./pages/Login'));
const Landing = lazyWithRetry(() => import('./pages/Landing'));
const Demo = lazyWithRetry(() => import('./pages/Demo'));
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const Admin = lazyWithRetry(() => import('./pages/Admin'));
const Support = lazyWithRetry(() => import('./pages/Support'));
const Kiosk = lazyWithRetry(() => import('./pages/Kiosk'));
const Watcher = lazyWithRetry(() => import('./pages/Watcher'));
const Supervision = lazyWithRetry(() => import('./pages/Supervision'));
const Parents = lazyWithRetry(() => import('./pages/Parents'));
const WhatsAppControl = lazyWithRetry(() => import('./pages/WhatsAppControl'));
const TelegramControl = lazyWithRetry(() => import('./pages/TelegramControl'));
const StorageCenter = lazyWithRetry(() => import('./pages/StorageCenter'));
const MobileScanner = lazyWithRetry(() => import('./pages/MobileScanner'));
const Diagnostics = lazyWithRetry(() => import('./pages/Diagnostics'));
const Reports = lazyWithRetry(() => import('./pages/Reports'));
const Surveys = lazyWithRetry(() => import('./pages/Surveys'));
const PublicSurvey = lazyWithRetry(() => import('./pages/PublicSurvey'));

const NotFound = lazyWithRetry(() => import('./pages/NotFound'));
const DismissalKiosk = lazyWithRetry(() => import('./pages/DismissalKiosk'));
const CallBoard = lazyWithRetry(() => import('./pages/CallBoard'));
const GuardDispatcher = lazyWithRetry(() => import('./pages/GuardDispatcher'));

const ProtectedRoute: React.FC<{
  user: User;
  route: ProtectedRouteKey;
  children: React.ReactElement;
}> = ({ user, route, children }) => {
  if (!canAccessRoute(user, route)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const getSettingsAdminThemeKey = (settings?: SystemSettings | null) => {
  const key = settings?.admin_theme ?? (settings?.kiosk_settings as any)?.admin_theme;
  return typeof key === 'string' ? key : undefined;
};

const isAdminThemeObject = (theme: unknown) => (
  Boolean(theme) &&
  typeof theme === 'object' &&
  typeof (theme as { primary_400?: unknown }).primary_400 === 'string' &&
  typeof (theme as { primary_500?: unknown }).primary_500 === 'string' &&
  typeof (theme as { secondary_500?: unknown }).secondary_500 === 'string'
);

const applySettingsThemePreference = (settings?: SystemSettings | null, animate = false) => {
  const themeKey = getSettingsAdminThemeKey(settings);
  if (themeKey && THEME_CONFIG[themeKey]) {
    try {
      localStorage.setItem(STORAGE_KEYS.ADMIN_THEME, themeKey);
      localStorage.removeItem(STORAGE_KEYS.SUPPORT_THEME);
      localStorage.removeItem('hader_current_theme');
    } catch {
      // Ignore storage failures; theme still applies for this session.
    }
    applyAdminThemeKeyToDOM(themeKey, animate);
    return true;
  }

  const legacyTheme =
    (isAdminThemeObject(settings?.theme) ? settings?.theme : undefined) ??
    (isAdminThemeObject((settings?.kiosk_settings as any)?.admin_theme_values)
      ? (settings?.kiosk_settings as any).admin_theme_values
      : undefined) ??
    (isAdminThemeObject((settings?.kiosk_settings as any)?.theme)
      ? (settings?.kiosk_settings as any).theme
      : undefined);

  if (legacyTheme) {
    applyAdminThemeToDOM(legacyTheme, animate);
    return true;
  }

  return false;
};

// Inner component to handle Electron menu navigation
const ElectronMenuHandler: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  const handleExport = useCallback(() => {
    // Dispatch custom event for export
    window.dispatchEvent(new CustomEvent('electron-export'));
  }, []);

  const handleImport = useCallback(() => {
    // Dispatch custom event for import
    window.dispatchEvent(new CustomEvent('electron-import'));
  }, []);

  useElectronMenu({
    onNavigate: handleNavigate,
    onExport: handleExport,
    onImport: handleImport
  });

  return <>{children}</>;
};

const SplashScreen: React.FC<{ title: string; subtitle?: string; mode?: 'boot' | 'page' }> = ({
  title,
  subtitle,
  mode = 'boot'
}) => (
  <div className={`splash-screen splash-screen-${mode}`} role="status" aria-live="polite" dir="rtl">
    <div className="splash-tech-grid" aria-hidden="true" />
    <div className="splash-scan-field" aria-hidden="true" />
    <div className="splash-corner splash-corner-top" aria-hidden="true" />
    <div className="splash-corner splash-corner-bottom" aria-hidden="true" />

    <div className="splash-shell">
      <div className="splash-status-row" aria-hidden="true">
        <span className="splash-status-dot" />
        <span>تهيئة نظام حاضر</span>
      </div>

      <div className="splash-logo-container">
        <div className="splash-orbit-ring splash-orbit-ring-outer" aria-hidden="true" />
        <div className="splash-orbit-ring splash-orbit-ring-inner" aria-hidden="true" />
        <div className="splash-pulse-plane" aria-hidden="true" />
        <img src="/images/hader-logo.png" alt="حاضر" className="splash-logo" />
      </div>

      <div className="splash-signal-strip" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <p className="splash-text">{title}</p>
      {subtitle && <p className="splash-subtext">{subtitle}</p>}

      <div className="splash-progress-container" aria-hidden="true">
        <div className="splash-progress-track" />
        <div className="splash-progress-bar" />
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let sessionUser: ReturnType<typeof auth.getSession> = null;
    try {
      sessionUser = auth.getSession();
      if (sessionUser) {
        setUser(sessionUser);
      }
    } catch {
      // Session read failure is non-fatal — proceed to login screen.
    }

    try {
      const savedAdminTheme = localStorage.getItem(STORAGE_KEYS.ADMIN_THEME);
      if (savedAdminTheme && THEME_CONFIG[savedAdminTheme]) {
        applyAdminThemeKeyToDOM(savedAdminTheme);
      }
    } catch {
      // Ignore storage failures; defaults remain usable.
    }

    applyDarkMode(getStoredColorMode() !== 'light', false);
    setLoading(false);

    if (!sessionUser) {
      return;
    }

    let cancelled = false;

    // Load and apply saved theme and dark mode with proper error handling
    const loadSettings = async () => {
      try {
        const { db } = await import('./services/db');
        const settings = await db.getSettings();
        if (cancelled) return;

        if (!applySettingsThemePreference(settings)) {
          // Fallback to local storage when remote settings have no admin theme yet.
          const savedAdminTheme = localStorage.getItem(STORAGE_KEYS.ADMIN_THEME);
          if (savedAdminTheme && THEME_CONFIG[savedAdminTheme]) {
            applyAdminThemeKeyToDOM(savedAdminTheme);
          }
        }

        // Apply dark mode setting (default to dark if not set)
        const savedMode = getStoredColorMode();
        applyDarkMode(savedMode ? savedMode === 'dark' : settings?.dark_mode !== false, false);
      } catch (error) {
        logError(error, 'App - Load Settings');
        // Apply default dark mode on error
        applyDarkMode(getStoredColorMode() !== 'light', false);
      }
    };

    void loadSettings();

    // Async Connection Check with proper timeout handling
    const checkConnection = async () => {
      try {
        await withTimeout(
          () => auth.checkConnection(),
          { timeoutMs: 5000 }
        );
      } catch (error) {
        if (error instanceof NetworkError && error.code === 'TIMEOUT') {
          // Timeout is expected when offline, not an error
        } else {
          logError(error, 'App - Connection Check');
        }
      }
    };

    const connectionTimer = window.setTimeout(() => {
      void checkConnection();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(connectionTimer);
    };
  }, []);

  useEffect(() => {
    if (!user || user.role === Role.GUARDIAN || user.role === Role.KIOSK || user.role === Role.CALL_STATION) {
      return;
    }

    let isActive = true;
    let stopAutoAbsence: (() => void) | null = null;

    void import('./services/autoAbsenceService')
      .then(({ autoAbsenceService }) => {
        stopAutoAbsence = () => autoAbsenceService.stop();
        if (isActive) {
          autoAbsenceService.init();
        }
      })
      .catch((error) => {
        logError(error, 'App - AutoAbsence Init');
      });

    return () => {
      isActive = false;
      stopAutoAbsence?.();
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    const unsubscribe = auth.onSessionChange((nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        void window.electronAPI?.closeNoorSession?.();
        window.location.hash = '/';
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for theme changes from Admin page (via localStorage)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.ADMIN_THEME && e.newValue) {
        if (THEME_CONFIG[e.newValue]) {
          applyAdminThemeKeyToDOM(e.newValue, true);
        }
      }
    };
    const handleSameTabThemeChange = (event: Event) => {
      const themeKey = (event as CustomEvent<{ themeKey?: string }>).detail?.themeKey;
      if (themeKey && THEME_CONFIG[themeKey]) {
        applyAdminThemeKeyToDOM(themeKey);
      }
    };
    const handleSettingsThemeChange = (event: Event) => {
      const settings = (event as CustomEvent<SystemSettings>).detail;
      applySettingsThemePreference(settings, true);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('hader:admin-theme-change', handleSameTabThemeChange);
    window.addEventListener('hader:settings-updated', handleSettingsThemeChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('hader:admin-theme-change', handleSameTabThemeChange);
      window.removeEventListener('hader:settings-updated', handleSettingsThemeChange);
    };
  }, []);

  const handleLogin = useCallback((newUser: User) => {
    setUser(newUser);
    // 🚀 Pre-fetch: Start loading students data immediately after login
    // so it's cached in IndexedDB before Dashboard mounts, eliminating
    // the empty state / "0 students" bug on mobile devices.
    import('./services/db').then(({ db }) => {
      void db.getStudents();
    }).catch(() => { /* non-critical pre-fetch */ });
  }, []);

  const handleLogout = useCallback(() => {
    auth.logout();
    setUser(null);
  }, []);

  const pageFallback = <SplashScreen title="جاري تحميل الصفحة..." mode="page" />;

  if (loading) return (
    <SplashScreen title="نظام حاضر" subtitle="جاري الاتصال بالنظام السحابي..." />
  );

  return (
    <Router future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <ElectronMenuHandler>
        <Suspense fallback={pageFallback}>
          {!user ? (
            <Routes>
              <Route path="/landing" element={<Landing />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/login" element={<Login onLogin={handleLogin} />} />
              <Route path="/survey/:token" element={<PublicSurvey />} />
              <Route path="/" element={<Landing />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/survey/:token" element={<PublicSurvey />} />

              {/* Kiosk - Full Screen without Layout */}
              <Route path="/kiosk" element={
                <ProtectedRoute user={user} route="kiosk">
                  <Kiosk />
                </ProtectedRoute>
              } />

              {/* Mobile Scanner - Full Screen for Mobile Devices */}
              <Route path="/scanner" element={
                <ProtectedRoute user={user} route="mobileScanner">
                  <MobileScanner />
                </ProtectedRoute>
              } />

              {/* Dismissal Kiosk - Full Screen */}
              <Route path="/dismissal-kiosk" element={
                <ProtectedRoute user={user} route="dismissalKiosk">
                  <DismissalKiosk />
                </ProtectedRoute>
              } />

              {/* Call Board - Full Screen Display */}
              <Route path="/call-board" element={
                <ProtectedRoute user={user} route="callBoard">
                  <CallBoard />
                </ProtectedRoute>
              } />

              {/* Guard Dispatch Station - Mobile Optimized Full Screen */}
              <Route path="/guard-station" element={
                <ProtectedRoute user={user} route="guardStation">
                  <GuardDispatcher />
                </ProtectedRoute>
              } />

              {/* All other pages with Layout */}
              <Route path="*" element={
                <Layout user={user} onLogout={handleLogout}>
                  <Routes>
                    <Route path="/" element={
                      user.role === 'guardian' ? <Parents user={user} /> :
                        user.role === 'kiosk' ? <Navigate to="/kiosk" /> :
                          user.role === 'call_station' ? <Navigate to="/guard-station" /> :
                            <Dashboard user={user} />
                    } />
                    <Route path="/admin" element={
                      canAccessRoute(user, 'admin')
                        ? <Admin /> : <Navigate to="/" />
                    } />
                    <Route path="/watcher" element={
                      canAccessRoute(user, 'watcher')
                        ? <Watcher /> : <Navigate to="/" />
                    } />
                    <Route path="/supervision" element={
                      canAccessRoute(user, 'supervision')
                        ? <Supervision user={user} /> : <Navigate to="/" />
                    } />
                    <Route path="/parents" element={
                      canAccessRoute(user, 'parents')
                        ? <Parents user={user} /> : <Navigate to="/" />
                    } />
                    <Route path="/support" element={
                      canAccessRoute(user, 'support')
                        ? <Support /> : <Navigate to="/" />
                    } />
                    <Route path="/whatsapp" element={
                      (user.role === Role.SITE_ADMIN || user.can_use_whatsapp)
                        ? <WhatsAppControl /> : <Navigate to="/" />
                    } />
                    <Route path="/telegram" element={
                      canAccessRoute(user, 'telegram')
                        ? <TelegramControl /> : <Navigate to="/" />
                    } />
                    <Route path="/storage" element={
                      canAccessRoute(user, 'storage')
                        ? <StorageCenter /> : <Navigate to="/" />
                    } />
                    <Route path="/reports" element={
                      canAccessRoute(user, 'reports')
                        ? <Reports user={user} /> : <Navigate to="/" />
                    } />
                    <Route path="/surveys" element={
                      canAccessRoute(user, 'surveys') && hasSurveyAdminAccess()
                        ? <Surveys /> : <Navigate to="/" />
                    } />
                    <Route path="/diagnostics" element={
                      canAccessRoute(user, 'diagnostics')
                        ? <Diagnostics /> : <Navigate to="/" />
                    } />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Layout>
              } />
            </Routes>
          )}
        </Suspense>
        <Suspense fallback={null}>
          <PWAInstallPrompt />
        </Suspense>
      </ElectronMenuHandler>
    </Router>
  );
};

export default App;
