import React, { useEffect, useState } from 'react';
import { db, getLocalISODate } from '../services/db';
import { auth } from '../services/auth';
import { Role, SystemSettings, DiagnosticResult, SocialLinks, User, Notification, STORAGE_KEYS, AuthAuditLog, ClientErrorLog, AuthAuditAction, ClientErrorSeverity, ClientErrorSource, ATTENDANCE_DEFAULTS } from '../types';
import { Activity, CheckCircle, Server, RefreshCw, Power, Database, Cloud, HardDrive, ToggleLeft, ToggleRight, Save, ShieldCheck, AlertTriangle, XCircle, Megaphone, Send, Loader2, Image, Palette, X, Headset, MessageCircle, Instagram, Link, Building, UserCircle, Wifi, WifiOff, Clock, Terminal, Network, Monitor, RotateCw, RotateCcw, Focus, Zap, FileText, TrendingUp, TrendingDown, Minus, Copy, Trash2 } from 'lucide-react';
import { supabase, getSupabaseDebugInfo } from '../services/supabase';
import { sanitize } from '../services/telemetry';
import { bootstrapAdminConfig, validateBootstrapAdmin } from '../services/bootstrapAdmin';
import { useCleanup, useSafeAsync } from '../hooks/useResourceManagement';
import { logError } from '../types/errors';
import { useToast } from '../components/Toast';
import { useAdminTheme } from '../hooks/useAdminTheme';
import { NumberTicker } from '../components/ui/NumberTicker';
import { notificationCenter } from '../services/notifications';
import { studentAffairs } from '../services/studentAffairs';

const bootstrapAdminStatus = validateBootstrapAdmin();
const isBootstrapFeatureEnabled = bootstrapAdminStatus.enabled;
const isBootstrapAdminConfigured = bootstrapAdminStatus.ok;

type SqlQueueEntry = {
  id: string;
  table: string;
  action: string;
  sql: string;
  created_at: string;
};

const Support: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [diagLoading, setDiagLoading] = useState(false);
  const { addCleanup } = useCleanup();
  const safeAsync = useSafeAsync();
  const toast = useToast();
  const showToast = toast.showToast;

  // Theme is read-only here. Admin is the only page allowed to change it.
  useAdminTheme();

  // State
  const [settings, setSettings] = useState<SystemSettings>({ system_ready: true, school_active: true, logo_url: '', dark_mode: true });
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);

  // Social Links State
  const [social_links, setSocialLinks] = useState<SocialLinks>({ support_url: '', whatsapp: '', instagram: '' });

  // Broadcast Form
  const [broadcast, setBroadcast] = useState<{
    role: 'all' | 'admin' | 'supervisor' | 'guardian' | 'user' | 'kiosk';
    message: string;
    title: string;
    type: 'announcement' | 'general' | 'command';
    is_popup: boolean;
    userId: string;
  }>({
    role: 'all',
    message: '',
    title: '',
    type: 'announcement',
    is_popup: false,
    userId: ''
  });
  const [users, setUsers] = useState<User[]>([]);

  const [sqlQueue, setSqlQueue] = useState<SqlQueueEntry[]>([]);
  const [sqlFilter, setSqlFilter] = useState<'all' | 'users' | 'students' | 'classes'>('all');

  // System Stats
  const [systemStats, setSystemStats] = useState<any>(null);

  // Database Connection Status
  const [dbStatus, setDbStatus] = useState<{
    connected: boolean;
    lastCheck: string;
    responseTime: number;
    tables: { name: string; accessible: boolean }[];
    error?: string;
  } | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);

  // Advanced Debug Panels State
  const [activeDebugTab, setActiveDebugTab] = useState<'database' | 'connectivity' | 'kiosk' | 'auth_logs' | 'error_logs'>('database');
  const [activeMainTab, setActiveMainTab] = useState<'controls' | 'diagnostics' | 'logs' | 'broadcast' | 'debug' | 'security'>(
    () => {
      const saved = localStorage.getItem('hader:support-tab');
      if (saved && ['controls', 'diagnostics', 'logs', 'broadcast', 'debug', 'security'].includes(saved)) {
        return saved as 'controls' | 'diagnostics' | 'logs' | 'broadcast' | 'debug' | 'security';
      }
      return 'controls';
    }
  );
  const [dbQueryStats, setDbQueryStats] = useState<{ success: number; failed: number; errors: Array<{ code: string; table: string; time: string; message: string }> }>({ success: 0, failed: 0, errors: [] });
  const [connectivityStatus, setConnectivityStatus] = useState<Record<string, { status: 'ok' | 'degraded' | 'error'; lastSuccess?: string; lastError?: { status: number; message: string; time: string } }>>({});
  const [kioskStatus, setKioskStatus] = useState<{
    main: { online: boolean; lastHeartbeat?: string; browser?: string; screenOrientation?: string; uiRotation?: 'none' | 'right' | 'left' };
    mini: { visible: boolean; size?: { width: number; height: number }; rotation?: 'none' | 'right' | 'left'; barcodeFocus?: boolean; lastScan?: string };
    logs: Array<{ type: 'success' | 'error' | 'warning'; message: string; time: string; details?: any }>;
  }>({
    main: { online: false },
    mini: { visible: false },
    logs: []
  });
  const [authLogs, setAuthLogs] = useState<AuthAuditLog[]>([]);
  const [authLogsLoading, setAuthLogsLoading] = useState(false);
  const [authLogFilters, setAuthLogFilters] = useState({
    range: '24h',
    action: 'all',
    role: 'all',
    search: ''
  });
  const [errorLogs, setErrorLogs] = useState<ClientErrorLog[]>([]);
  const [errorLogsLoading, setErrorLogsLoading] = useState(false);
  const [errorLogFilters, setErrorLogFilters] = useState({
    range: '24h',
    severity: 'all',
    source: 'all',
    path: '',
    search: ''
  });
  const [selectedErrorLog, setSelectedErrorLog] = useState<ClientErrorLog | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(90);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [saveRetentionLoading, setSaveRetentionLoading] = useState(false);
  const [authExportRange, setAuthExportRange] = useState<'24h' | '7d' | '30d' | 'custom'>('24h');
  const [authExportFrom, setAuthExportFrom] = useState('');
  const [authExportTo, setAuthExportTo] = useState('');
  const [authExportLimit, setAuthExportLimit] = useState(1000);
  const [authExportLoading, setAuthExportLoading] = useState(false);
  const [errorExportRange, setErrorExportRange] = useState<'24h' | '7d' | '30d' | 'custom'>('24h');
  const [errorExportFrom, setErrorExportFrom] = useState('');
  const [errorExportTo, setErrorExportTo] = useState('');
  const [errorExportLimit, setErrorExportLimit] = useState(1000);
  const [errorExportLoading, setErrorExportLoading] = useState(false);

  const isDev = import.meta.env.DEV;
  const params = new URLSearchParams(window.location.search);
  const debugFlag = params.get('__debug') === '1';
  const canViewDevPanel =
    currentUser?.role === Role.SITE_ADMIN &&
    (isDev || debugFlag);

  // Persist active tab to localStorage
  useEffect(() => {
    localStorage.setItem('hader:support-tab', activeMainTab);
  }, [activeMainTab]);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const init = async () => {
      setAuthLoading(true);
      try {
        const user = await auth.getCurrentUser();
        if (cancelled) return;
        setCurrentUser(user);

        if (!user) {
          setAuthError('يجب تسجيل الدخول كمدير نظام للوصول لواجهة الدعم الفني');
          setLoading(false);
          return;
        }

        if (user.role !== Role.SITE_ADMIN) {
          setAuthError('هذه الصفحة مخصصة لمدير النظام فقط');
          setLoading(false);
          return;
        }

        setAuthorized(true);
        await loadData();
        await checkDatabaseStatus();
        interval = setInterval(checkDatabaseStatus, 30000);
      } catch (e: any) {
        if (cancelled) return;
        setAuthError(e?.message || 'تعذر تحميل بيانات الدعم الفني');
        setLoading(false);
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!authorized) return;
    db.getUsers().then(setUsers).catch((error) => {
      logError(error, 'Support - Get Users');
    });

    // Initialize connectivity status
    const initialStatus: Record<string, { status: 'ok' | 'degraded' | 'error'; lastSuccess?: string; lastError?: { status: number; message: string; time: string } }> = {
      'kiosk-api': { status: 'ok' },
      'watcher-stats': { status: 'ok' },
      'admin-reports': { status: 'ok' },
      'supervision-data': { status: 'ok' }
    };
    setConnectivityStatus(initialStatus);

    // Load kiosk status from localStorage
    const kioskRotation = localStorage.getItem('hader:kiosk:rotation') as 'none' | 'right' | 'left' | null;
    setKioskStatus(prev => ({
      ...prev,
      main: {
        ...prev.main,
        online: true, // Assume online if localStorage is accessible
        browser: navigator.userAgent,
        uiRotation: kioskRotation || 'none'
      }
    }));
  }, [authorized]);

  const loadSqlQueue = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SQL_QUEUE);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Ensure we only render the latest 100 queries to prevent performance bottlenecks
      return parsed.slice(0, 100);
    } catch (e) {
      console.warn('Failed to parse SQL Queue, rendering empty array');
      return [];
    }
  };

  useEffect(() => {
    const refreshQueue = () => setSqlQueue(loadSqlQueue());
    refreshQueue();

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.SQL_QUEUE) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(refreshQueue, 150);
      }
    };

    const handleQueueUpdate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(refreshQueue, 150);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('hader:sql-queue-update', handleQueueUpdate as EventListener);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('hader:sql-queue-update', handleQueueUpdate as EventListener);
    };
  }, []);

  const formatLogTime = (value: string) => {
    if (!value) return '';
    return new Date(value).toLocaleString('ar-SA', { hour12: false });
  };

  const resolveRange = (range: string) => {
    const to = new Date();
    const from = new Date(to);
    if (range === '7d') {
      from.setDate(to.getDate() - 7);
    } else if (range === '30d') {
      from.setDate(to.getDate() - 30);
    } else {
      from.setHours(to.getHours() - 24);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  };

  const resolveExportRange = (range: '24h' | '7d' | '30d' | 'custom', fromValue: string, toValue: string) => {
    if (range === 'custom' && fromValue && toValue) {
      const from = new Date(fromValue);
      const to = new Date(toValue);
      to.setHours(23, 59, 59, 999);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    return resolveRange(range);
  };

  const sanitizeExportValue = (value: unknown) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return sanitize(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return sanitize(
        JSON.stringify(value, (_key, item) => (typeof item === 'string' ? sanitize(item) : item))
      );
    } catch {
      return sanitize(String(value));
    }
  };

  const truncateExport = (value: string, limit: number) => {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}…`;
  };

  const csvEscape = (value: unknown) => {
    if (value === null || value === undefined) return '""';
    const normalized = String(value).replace(/\r?\n/g, '\\n').replace(/"/g, '""');
    return `"${normalized}"`;
  };

  const downloadFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportAuthLogs = async (format: 'csv' | 'json') => {
    setAuthExportLoading(true);
    try {
      const { from, to } = resolveExportRange(authExportRange, authExportFrom, authExportTo);
      const logs = await db.getAuthAuditLogs({
        from,
        to,
        action: authLogFilters.action !== 'all' ? (authLogFilters.action as AuthAuditAction) : undefined,
        role: authLogFilters.role !== 'all' ? authLogFilters.role : undefined,
        search: authLogFilters.search.trim() || undefined,
        limit: authExportLimit,
        offset: 0
      });

      const exportRows = logs.map((log) => ({
        created_at: log.created_at,
        action: log.action,
        actor_label: log.actor_label || 'anonymous',
        actor_user_id: log.actor_user_id || '',
        actor_role: log.actor_role || '',
        path: log.path || '',
        user_agent: log.user_agent || ''
      }));

      const filename = `hader_auth_logs_${from.slice(0, 10)}_to_${to.slice(0, 10)}.${format}`;

      if (format === 'json') {
        const sanitized = exportRows.map((row) => ({
          ...row,
          actor_label: sanitizeExportValue(row.actor_label),
          actor_user_id: sanitizeExportValue(row.actor_user_id),
          actor_role: sanitizeExportValue(row.actor_role),
          path: sanitizeExportValue(row.path),
          user_agent: sanitizeExportValue(row.user_agent)
        }));
        downloadFile(filename, JSON.stringify(sanitized, null, 2), 'application/json');
      } else {
        const headers = ['created_at', 'action', 'actor_label', 'actor_user_id', 'actor_role', 'path', 'user_agent'];
        const lines = [
          headers.join(','),
          ...exportRows.map((row) =>
            [
              row.created_at,
              row.action,
              sanitizeExportValue(row.actor_label),
              sanitizeExportValue(row.actor_user_id),
              sanitizeExportValue(row.actor_role),
              sanitizeExportValue(row.path),
              sanitizeExportValue(row.user_agent)
            ]
              .map((cell) => csvEscape(String(cell)))
              .join(',')
          )
        ];
        downloadFile(filename, lines.join('\n'), 'text/csv');
      }
      showToast('تم التصدير', 'success');
    } catch (error) {
      console.error('Auth export failed', error);
      showToast('تعذر تصدير السجلات', 'error');
    } finally {
      setAuthExportLoading(false);
    }
  };

  const exportErrorLogs = async (format: 'csv' | 'json') => {
    setErrorExportLoading(true);
    try {
      const { from, to } = resolveExportRange(errorExportRange, errorExportFrom, errorExportTo);
      const logs = await db.getClientErrorLogs({
        from,
        to,
        severity: errorLogFilters.severity !== 'all' ? (errorLogFilters.severity as ClientErrorSeverity) : undefined,
        source: errorLogFilters.source !== 'all' ? (errorLogFilters.source as ClientErrorSource) : undefined,
        path: errorLogFilters.path.trim() || undefined,
        search: errorLogFilters.search.trim() || undefined,
        limit: errorExportLimit,
        offset: 0
      });

      const exportRows = logs.map((log) => ({
        created_at: log.created_at,
        severity: log.severity,
        source: log.source,
        message: truncateExport(sanitizeExportValue(log.message), 2000),
        stack: truncateExport(sanitizeExportValue(log.stack || ''), 8000),
        path: sanitizeExportValue(log.path || ''),
        meta: sanitizeExportValue(log.meta ?? {})
      }));

      const filename = `hader_error_logs_${from.slice(0, 10)}_to_${to.slice(0, 10)}.${format}`;

      if (format === 'json') {
        downloadFile(filename, JSON.stringify(exportRows, null, 2), 'application/json');
      } else {
        const headers = ['created_at', 'severity', 'source', 'message', 'stack', 'path', 'meta'];
        const lines = [
          headers.join(','),
          ...exportRows.map((row) =>
            [
              row.created_at,
              row.severity,
              row.source,
              row.message,
              row.stack,
              row.path,
              row.meta
            ]
              .map((cell) => csvEscape(String(cell)))
              .join(',')
          )
        ];
        downloadFile(filename, lines.join('\n'), 'text/csv');
      }
      showToast('تم التصدير', 'success');
    } catch (error) {
      logError(error, 'Support - Error Export');
      showToast('تعذر تصدير السجلات', 'error');
    } finally {
      setErrorExportLoading(false);
    }
  };

  const handleSaveRetention = async () => {
    setSaveRetentionLoading(true);
    try {
      const normalizedRetention = Math.max(1, retentionDays || 90);
      setRetentionDays(normalizedRetention);
      const nextSettings = { ...settings, telemetry_retention_days: normalizedRetention };
      await db.saveSettings(nextSettings);
      setSettings(nextSettings);
      showToast('تم حفظ مدة الاحتفاظ', 'success');
    } catch (error) {
      logError(error, 'Support - Save Retention');
      showToast('تعذر حفظ مدة الاحتفاظ', 'error');
    } finally {
      setSaveRetentionLoading(false);
    }
  };

  const handleCleanupNow = async () => {
    setCleanupLoading(true);
    try {
      const normalizedRetention = Math.max(1, retentionDays || 90);
      setRetentionDays(normalizedRetention);
      const result = await db.cleanupTelemetryLogs(normalizedRetention);
      showToast(`تم حذف ${result.auth_deleted} سجل دخول/خروج و ${result.error_deleted} سجل أخطاء`, 'success');
      if (activeDebugTab === 'auth_logs') {
        loadAuthLogs();
      }
      if (activeDebugTab === 'error_logs') {
        loadErrorLogs();
      }
    } catch (error) {
      console.error('Cleanup failed', error);
      showToast('تعذر تنفيذ التنظيف', 'error');
    } finally {
      setCleanupLoading(false);
    }
  };

  const authActionLabels: Record<AuthAuditAction, { label: string; badge: string }> = {
    LOGIN: { label: 'تسجيل دخول', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    LOGOUT: { label: 'تسجيل خروج', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
    SESSION_RESTORE: { label: 'استرجاع جلسة', badge: 'bg-primary-500/20 text-primary-300 border-primary-500/30' },
    SESSION_EXPIRED: { label: 'انتهاء جلسة', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30' }
  };

  const severityLabels: Record<ClientErrorSeverity, { label: string; badge: string }> = {
    ERROR: { label: 'خطأ', badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
    WARN: { label: 'تحذير', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      logError(error, 'Support - Copy Failed');
    }
  };

  const loadAuthLogs = async () => {
    setAuthLogsLoading(true);
    try {
      const { from, to } = resolveRange(authLogFilters.range);
      const data = await db.getAuthAuditLogs({
        from,
        to,
        action: authLogFilters.action !== 'all' ? (authLogFilters.action as AuthAuditAction) : undefined,
        role: authLogFilters.role !== 'all' ? authLogFilters.role : undefined,
        search: authLogFilters.search.trim() || undefined,
        limit: 200,
        offset: 0
      });
      setAuthLogs(data);
    } catch (error) {
      console.error('Failed to load auth logs', error);
      setAuthLogs([]);
    } finally {
      setAuthLogsLoading(false);
    }
  };

  const loadErrorLogs = async () => {
    setErrorLogsLoading(true);
    try {
      const { from, to } = resolveRange(errorLogFilters.range);
      const data = await db.getClientErrorLogs({
        from,
        to,
        severity: errorLogFilters.severity !== 'all' ? (errorLogFilters.severity as ClientErrorSeverity) : undefined,
        source: errorLogFilters.source !== 'all' ? (errorLogFilters.source as ClientErrorSource) : undefined,
        path: errorLogFilters.path.trim() || undefined,
        search: errorLogFilters.search.trim() || undefined,
        limit: 200,
        offset: 0
      });
      setErrorLogs(data);
    } catch (error) {
      console.error('Failed to load error logs', error);
      setErrorLogs([]);
    } finally {
      setErrorLogsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!authorized || activeDebugTab !== 'auth_logs') return;
    const handle = setTimeout(() => {
      if (active) loadAuthLogs();
    }, 200);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [authorized, activeDebugTab, authLogFilters]);

  useEffect(() => {
    let active = true;
    if (!authorized || activeDebugTab !== 'error_logs') return;
    const handle = setTimeout(() => {
      if (active) loadErrorLogs();
    }, 200);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [authorized, activeDebugTab, errorLogFilters]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, stats] = await Promise.all([
        db.getSettings(),
        fetchSystemStats()
      ]);
      setSettings(s);
      setRetentionDays(s.telemetry_retention_days ?? 90);
      // Load social links if available
      if (s.social_links) {
        setSocialLinks(s.social_links);
      }
      await runDiagnostics();
    } catch (error) {
      logError(error, 'Support - Load Settings');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const checkDatabaseStatus = async () => {
    setCheckingDb(true);
    const startTime = Date.now();
    try {
      // Test connection by querying a simple table
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id')
        .limit(1);

      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('id')
        .limit(1);

      const { data: classesData, error: classesError } = await supabase
        .from('classes')
        .select('id')
        .limit(1);

      const { data: attendanceData, error: attendanceError } = await supabase
        .from('attendance_logs')
        .select('id')
        .limit(1);

      const { data: supervisorsData, error: supervisorsError } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'SUPERVISOR_GLOBAL')
        .limit(1);

      const responseTime = Date.now() - startTime;
      const connected = !usersError && !studentsError;

      // Update query stats
      if (connected) {
        setDbQueryStats(prev => ({ ...prev, success: prev.success + 1 }));
      } else {
        const errors = [usersError, studentsError, classesError, attendanceError, supervisorsError].filter(Boolean);
        setDbQueryStats(prev => ({
          ...prev,
          failed: prev.failed + errors.length,
          errors: [
            ...errors.map((err: any) => ({
              code: err?.code || 'UNKNOWN',
              table: err?.table || 'unknown',
              time: new Date().toLocaleString('ar-SA'),
              message: err?.message || 'خطأ غير معروف'
            })),
            ...prev.errors.slice(0, 9)
          ]
        }));
      }

      setDbStatus({
        connected,
        lastCheck: new Date().toLocaleString('ar-SA'),
        responseTime,
        tables: [
          { name: 'users', accessible: !usersError },
          { name: 'students', accessible: !studentsError },
          { name: 'classes', accessible: !classesError },
          { name: 'attendance_logs', accessible: !attendanceError },
          { name: 'supervisors', accessible: !supervisorsError }
        ],
        error: usersError?.message || studentsError?.message || undefined
      });
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      setDbQueryStats(prev => ({
        ...prev,
        failed: prev.failed + 1,
        errors: [
          {
            code: error?.code || 'EXCEPTION',
            table: 'unknown',
            time: new Date().toLocaleString('ar-SA'),
            message: error?.message || 'خطأ في الاتصال'
          },
          ...prev.errors.slice(0, 9)
        ]
      }));
      setDbStatus({
        connected: false,
        lastCheck: new Date().toLocaleString('ar-SA'),
        responseTime,
        tables: [],
        error: error?.message || 'خطأ في الاتصال'
      });
    } finally {
      setCheckingDb(false);
    }
  };

  const loadDebugInfo = async () => {
    try {
      setDebugLoading(true);
      setDebugError(null);

      const full = db.getFullDebugInfo();

      let health: { ok: boolean; error?: string } = { ok: true };
      try {
        const { error } = await supabase
          .from('settings')
          .select('id')
          .limit(1);
        if (error) {
          health = { ok: false, error: error.message };
        }
      } catch (e: any) {
        health = { ok: false, error: e?.message || 'Unknown error' };
      }

      const safeSupabase = {
        isConfigured: !!full.supabase?.isConfigured,
      };

      const safeDebug = {
        environment: full.isProduction ? 'production' : 'development',
        dbMode: full.mode,
        provider: (full as any).provider,
        supabase: safeSupabase,
        sync: full.syncStatus || null,
        health,
        timestamp: full.timestamp,
      };

      setDebugInfo(safeDebug);
    } catch (e: any) {
      setDebugError(e?.message || 'فشل تحميل معلومات debug');
    } finally {
      setDebugLoading(false);
    }
  };

  const copyDebugInfo = () => {
    if (!debugInfo) return;
    const payload = JSON.stringify(debugInfo, null, 2);
    navigator.clipboard.writeText(payload).then(() => {
      toast.success('تم نسخ تقرير debug إلى الحافظة');
    }).catch(() => {
      toast.error('تعذر نسخ تقرير debug');
    });
  };

  const fetchSystemStats = async () => {
    try {
      const [students, attendance, violations, exits, users] = await Promise.all([
        db.getStudents(),
        db.getAttendance(),
        studentAffairs.load({ type: 'violations' }).then(result => result.violations),
        studentAffairs.load({ type: 'exits', date: getLocalISODate() }).then(result => result.exits),
        db.getUsers()
      ]);
      const today = getLocalISODate();
      const todayAttendance = attendance.filter(a => a.date === today);
      const stats = {
        totalStudents: students.length,
        totalUsers: users.length,
        todayAttendance: todayAttendance.length,
        totalViolations: violations.length,
        todayExits: exits.length,
        systemStatus: settings.system_ready && settings.school_active ? 'نشط' : 'معطل'
      };
      setSystemStats(stats);
      return stats;
    } catch (error) {
      logError(error, 'Support - Get System Stats');
      return null;
    }
  };

  const runDiagnostics = async () => {
    setDiagLoading(true);
    try {
      const results = await db.runDiagnostics();
      setDiagnostics(results);
    } catch (error) {
      logError(error, 'Support - Run Diagnostics');
    }
    finally { setDiagLoading(false); }
  };

  const toggleSetting = async (key: keyof SystemSettings) => {
    const newSettings = { ...settings, [key]: !settings[key as any] };
    setSettings(newSettings);
    await db.saveSettings(newSettings);
    // Re-run diagnostics if school active status changes (optional logic)
    if (key === 'school_active') runDiagnostics();
  };

  const saveLogo = async () => {
    await db.saveSettings(settings);
    toast.success('تم حفظ رابط الشعار');
  };

  const saveSocialLinks = async () => {
    const updatedSettings = { ...settings, social_links };
    setSettings(updatedSettings);
    await db.saveSettings(updatedSettings);
    toast.success('تم حفظ روابط التواصل ✓');
  };

  const handleBroadcast = async () => {
    if (!broadcast.message || !broadcast.title) {
      toast.warning('يرجى إدخال العنوان والرسالة');
      return;
    }
    if (broadcast.role === 'user' && !broadcast.userId) {
      toast.warning('يرجى اختيار المستخدم المستهدف');
      return;
    }

    let target_audience: Notification['target_audience'];
    let target_id: string | undefined;
    switch (broadcast.role) {
      case 'admin':
        target_audience = 'admin';
        break;
      case 'supervisor':
        target_audience = 'supervisor';
        break;
      case 'guardian':
        target_audience = 'guardian';
        break;
      case 'user':
        target_audience = 'user';
        target_id = broadcast.userId;
        break;
      case 'kiosk':
        target_audience = 'kiosk';
        break;
      default:
        target_audience = 'all';
    }

    const notification = {
      id: '',
      title: broadcast.title,
      message: broadcast.message,
      type: broadcast.type,
      target_audience,
      target_id,
      created_at: new Date().toISOString(),
      is_popup: broadcast.is_popup,
      created_by: auth.getSession()?.id
    };

    await notificationCenter.execute({ type: 'send', notification });
    toast.success('تم إرسال الرسالة بنجاح');
    setBroadcast({ role: 'all', message: '', title: '', type: 'announcement', is_popup: false, userId: '' });
  };

  const filteredSqlQueue = sqlQueue.filter((entry) => {
    if (sqlFilter === 'all') return true;
    return entry.table === sqlFilter;
  });

  const handleCopySql = async (sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      toast.success('تم نسخ أمر SQL بنجاح.');
    } catch (error) {
      logError(error, 'Support - Copy SQL');
      toast.error('تعذر نسخ أمر SQL. حاول مرة أخرى.');
    }
  };

  const handleCopyAllSql = async () => {
    if (filteredSqlQueue.length === 0) {
      toast.warning('لا توجد أوامر SQL للنسخ حالياً.');
      return;
    }
    const text = filteredSqlQueue.map((entry) => entry.sql).join('\n\n');
    await handleCopySql(text);
  };

  const handleClearSqlQueue = () => {
    localStorage.removeItem(STORAGE_KEYS.SQL_QUEUE);
    setSqlQueue([]);
  };

  if (authLoading || loading) {
    return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-white w-10 h-10" /></div>;
  }

  if (authError) {
    return (
      <div className="max-w-2xl mx-auto mt-16 glass-card p-8 rounded-3xl border border-red-500/30 bg-red-500/5 text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-red-200 text-lg font-bold">
          <AlertTriangle className="w-5 h-5" />
          <span>{authError}</span>
        </div>
        <p className="text-slate-300 text-sm">يرجى تسجيل الدخول بحساب مدير النظام الذي ضبطته في متغيرات البيئة ثم إعادة المحاولة.</p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => window.location.replace('/')}
            className="px-5 py-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20"
          >
            العودة للواجهة الرئيسية
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded-xl bg-primary-500/20 border border-primary-400/40 text-primary-100 hover:bg-primary-500/30"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      {/* ═══════════════════════════════════════════════════════════════
          ✨ Header - Modern Gradient Style
          ═══════════════════════════════════════════════════════════════ */}
      <header className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h2 className="text-4xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-primary-400 via-secondary-400 to-secondary-500">لوحة تحكم الدعم الفني</h2>
          <div className="flex items-center gap-4">
            <p className="text-slate-400 flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full animate-pulse shadow-lg ${dbStatus?.connected ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-red-500 shadow-red-500/50'}`}></span>
              {dbStatus?.connected ? 'النظام متصل ونشط' : 'الخدمة غير متصلة'}
            </p>
            <div className="h-4 w-[1px] bg-white/10 hidden md:block"></div>
            <div className="hidden md:flex items-center gap-3 text-[10px] text-slate-500 font-mono">
              <div className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-primary-500" />
                <span>{dbStatus?.responseTime || 0}ms</span>
              </div>
              <div className="flex items-center gap-1">
                <Database className="w-3 h-3 text-emerald-500" />
                <span>{dbStatus?.tables.filter(t => t.accessible).length || 0} Tables OK</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchSystemStats} className="p-3 bg-gradient-to-br from-primary-500/10 to-secondary-500/10 border border-primary-500/30 rounded-xl hover:bg-primary-500/20 hover:shadow-lg hover:shadow-primary-500/20 text-primary-300 hover:text-primary-200 transition-all duration-300" title="تحديث الإحصائيات">
            <RefreshCw className="w-5 h-5" />
          </button>
          <button onClick={() => window.location.reload()} className="p-3 bg-gradient-to-br from-secondary-500/10 to-primary-500/10 border border-secondary-500/30 rounded-xl hover:bg-secondary-500/20 hover:shadow-lg hover:shadow-secondary-500/20 text-secondary-300 hover:text-secondary-200 transition-all duration-300" title="إعادة تحميل النظام">
            <RotateCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════
          📊 System Stats Dashboard - Modern Glass Cards
          ═══════════════════════════════════════════════════════════════ */}
      {systemStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="group glass-card p-5 rounded-2xl border border-primary-500/30 hover:border-primary-400/50 transition-all duration-300 hover:shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.2)] hover:scale-[1.02]">
            <div className="text-xs text-slate-400 mb-2 font-medium">حالة النظام</div>
            <div className={`text-2xl font-bold font-mono transition-all duration-300 ${settings.system_ready && settings.school_active ? 'text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.6)]' : 'text-red-400 drop-shadow-[0_0_12px_rgba(239,68,68,0.6)]'
              }`}>
              {systemStats.systemStatus}
            </div>
            <div className="text-xs text-slate-500 mt-1">وضع التخزين: سحابي</div>
          </div>
          <div className="group glass-card p-5 rounded-2xl border border-primary-500/30 hover:border-primary-400/50 transition-all duration-300 hover:shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.2)] hover:scale-[1.02]">
            <div className="text-xs text-slate-400 mb-2 font-medium">إجمالي الطلاب</div>
            <div className="text-2xl font-bold font-mono text-white group-hover:text-primary-300 transition-colors">
              <NumberTicker value={systemStats.totalStudents} />
            </div>
            <div className="text-xs text-slate-500 mt-1">حضور اليوم: {systemStats.todayAttendance}</div>
          </div>
          <div className="group glass-card p-5 rounded-2xl border border-primary-500/30 hover:border-primary-400/50 transition-all duration-300 hover:shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.2)] hover:scale-[1.02]">
            <div className="text-xs text-slate-400 mb-2 font-medium">المستخدمين</div>
            <div className="text-2xl font-bold font-mono text-primary-400 drop-shadow-[0_0_10px_rgb(var(--color-primary-500)_/_0.6)] group-hover:drop-shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.8)] transition-all">
              <NumberTicker value={systemStats.totalUsers} />
            </div>
            <div className="text-xs text-slate-500 mt-1">مخالفات: {systemStats.totalViolations}</div>
          </div>
          <div className="group glass-card p-5 rounded-2xl border border-primary-500/30 hover:border-primary-400/50 transition-all duration-300 hover:shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.2)] hover:scale-[1.02]">
            <div className="text-xs text-slate-400 mb-2 font-medium">الاستئذان اليوم</div>
            <div className="text-2xl font-bold font-mono text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.6)] group-hover:drop-shadow-[0_0_15px_rgba(245,158,11,0.8)] transition-all">
              <NumberTicker value={systemStats.todayExits} />
            </div>
            <div className="text-xs text-slate-500 mt-1">طلبات خروج</div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          🗂️ Main Navigation Tabs
          ═══════════════════════════════════════════════════════════════ */}
      <div className="glass-card rounded-2xl border border-white/10 p-1.5">
        <div className="flex gap-1 overflow-x-auto">
          <button onClick={() => setActiveMainTab('controls')} className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition-all duration-300 ${activeMainTab === 'controls' ? 'bg-primary-500/20 text-primary-300 border border-primary-500/40 shadow-lg shadow-primary-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
            <Power className="w-4 h-4" /> ⚙️ تحكم النظام
          </button>
          <button onClick={() => setActiveMainTab('diagnostics')} className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition-all duration-300 ${activeMainTab === 'diagnostics' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-lg shadow-emerald-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
            <ShieldCheck className="w-4 h-4" /> 🩺 التشخيص
          </button>
          <button onClick={() => setActiveMainTab('logs')} className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition-all duration-300 ${activeMainTab === 'logs' ? 'bg-secondary-500/20 text-secondary-300 border border-secondary-500/40 shadow-lg shadow-secondary-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
            <FileText className="w-4 h-4" /> 📋 السجلات
          </button>
          <button onClick={() => setActiveMainTab('broadcast')} className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition-all duration-300 ${activeMainTab === 'broadcast' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-lg shadow-amber-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
            <Megaphone className="w-4 h-4" /> 📢 البث
          </button>
          <button onClick={() => setActiveMainTab('debug')} className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition-all duration-300 ${activeMainTab === 'debug' ? 'bg-secondary-500/20 text-secondary-300 border border-secondary-500/40 shadow-lg shadow-secondary-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
            <Terminal className="w-4 h-4" /> 🔬 Debug
          </button>
          <button onClick={() => setActiveMainTab('security')} className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold whitespace-nowrap transition-all duration-300 ${activeMainTab === 'security' ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-lg shadow-red-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
            <AlertTriangle className="w-4 h-4" /> 🔐 أمان
          </button>
        </div>
      </div>

      {/* ═══ Tab: Controls ═══ */}
      <div className={activeMainTab === 'controls' ? 'animate-fade-in' : 'hidden'}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* 1. System Controls & Theme */}
          <div className="lg:col-span-1 space-y-6">
            <div className="glass-card p-6 rounded-[2rem] border border-primary-500/20 hover:border-primary-500/30 transition-all duration-300">
              <h3 className="font-bold flex items-center gap-2 mb-6 text-white text-lg font-serif">
                <Power className="text-primary-400 w-5 h-5 drop-shadow-[0_0_8px_rgb(var(--color-primary-500)_/_0.6)]" /> تحكم النظام
              </h3>

              <div className="space-y-4">
                {/* Toggle 1 - System Ready */}
                <div className={`p-5 rounded-2xl border transition-all duration-300 ${settings.system_ready
                  ? 'bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                  : 'bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/40 shadow-lg shadow-red-500/10'
                  }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-bold text-white">حالة النظام</div>
                      <div className="text-xs text-gray-400">System Ready</div>
                    </div>
                    <button
                      onClick={() => toggleSetting('system_ready')}
                      className={`hover:scale-110 transition-transform duration-300 ${settings.system_ready ? 'text-emerald-400' : 'text-red-400'
                        }`}
                    >
                      {settings.system_ready ? <ToggleRight className="w-10 h-10" /> : <ToggleLeft className="w-10 h-10" />}
                    </button>
                  </div>
                  <div className={`text-xs mt-2 p-2 rounded-lg ${settings.system_ready
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/20 text-red-300'
                    }`}>
                    {settings.system_ready ? '✓ النظام نشط وجاهز للعمل' : '⚠ النظام معطل - جميع الوظائف متوقفة'}
                  </div>
                </div>

                {/* Toggle 2 - School Active */}
                <div className={`p-5 rounded-2xl border transition-all ${settings.school_active
                  ? 'bg-secondary-500/10 border-secondary-500/30'
                  : 'bg-amber-500/10 border-amber-500/30'
                  }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-bold text-white">تفعيل المدرسة</div>
                      <div className="text-xs text-gray-400">School Active</div>
                    </div>
                    <button
                      onClick={() => toggleSetting('school_active')}
                      className={`hover:scale-110 transition-transform ${settings.school_active ? 'text-secondary-400' : 'text-amber-400'
                        }`}
                    >
                      {settings.school_active ? <ToggleRight className="w-10 h-10" /> : <ToggleLeft className="w-10 h-10" />}
                    </button>
                  </div>
                  <div className={`text-xs mt-2 p-2 rounded-lg ${settings.school_active
                    ? 'bg-secondary-500/20 text-secondary-300'
                    : 'bg-amber-500/20 text-amber-300'
                    }`}>
                    {settings.school_active ? '✓ المدرسة نشطة - الحضور مفعّل' : '⚠ المدرسة معطلة - لا يمكن تسجيل الحضور'}
                  </div>
                </div>

                {/* Database Connection Dashboard */}
                <div className="p-5 bg-gradient-to-br from-primary-500/10 to-secondary-500/10 rounded-2xl border border-primary-500/30">
                  <div className="font-bold text-white mb-4 flex items-center gap-2">
                    <Database className="w-5 h-5 text-primary-400" /> لوحة تحكم قاعدة البيانات
                  </div>

                  {/* Connection Status */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-300">حالة الاتصال</span>
                      {checkingDb ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
                      ) : dbStatus?.connected ? (
                        <div className="flex items-center gap-2">
                          <Wifi className="w-4 h-4 text-emerald-400" />
                          <span className="text-xs text-emerald-400 font-bold">متصل</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <WifiOff className="w-4 h-4 text-red-400" />
                          <span className="text-xs text-red-400 font-bold">غير متصل</span>
                        </div>
                      )}
                    </div>

                    {dbStatus && (
                      <>
                        <div className="text-xs text-gray-400 mb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-3 h-3" />
                            آخر فحص: {dbStatus.lastCheck}
                          </div>
                          <div className="flex items-center gap-2">
                            <Activity className="w-3 h-3" />
                            زمن الاستجابة: {dbStatus.responseTime}ms
                          </div>
                        </div>

                        {dbStatus.error && (
                          <div className="p-2 bg-red-500/20 border border-red-500/30 rounded-lg mb-3">
                            <div className="text-xs text-red-300 font-bold mb-1">خطأ:</div>
                            <div className="text-xs text-red-400">{dbStatus.error}</div>
                          </div>
                        )}

                        {/* Tables Status */}
                        <div className="space-y-2">
                          <div className="text-xs text-gray-400 font-bold mb-2">حالة الجداول:</div>
                          {dbStatus.tables.map((table) => (
                            <div key={table.name} className="flex items-center justify-between p-2 bg-black/20 rounded-lg">
                              <span className="text-xs text-gray-300">{table.name}</span>
                              {table.accessible ? (
                                <CheckCircle className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <XCircle className="w-3 h-3 text-red-400" />
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <button
                      onClick={checkDatabaseStatus}
                      disabled={checkingDb}
                      className="w-full mt-4 py-2 bg-primary-600/20 hover:bg-primary-600/30 border border-primary-500/30 rounded-lg text-primary-300 text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                      {checkingDb ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          جاري الفحص...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3 h-3" />
                          فحص الاتصال الآن
                        </>
                      )}
                    </button>

                    {/* Supabase Info */}
                    <div className="mt-4 pt-4 border-t border-primary-500/20">
                      <div className="text-xs text-gray-400 mb-2">معلومات Supabase:</div>
                      <div className="text-xs text-gray-500 space-y-1">
                        <div className="flex items-center gap-2">
                          <Cloud className="w-3 h-3 text-primary-400" />
                          <span>وضع التخزين: سحابي (Cloud Only)</span>
                        </div>
                        {(() => {
                          const debugInfo = getSupabaseDebugInfo();
                          return (
                            <div className="text-[10px] text-gray-600 mt-2 p-2 bg-black/20 rounded">
                              URL: {debugInfo.url ? '✓ متوفر' : '✗ غير متوفر'}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Theme Settings - Admin only */}
            <div className="glass-card p-6 rounded-[2rem] border border-white/10">
              <h3 className="font-bold flex items-center gap-2 mb-3 text-white text-lg font-serif">
                <Palette className="text-secondary-400 w-5 h-5" /> ثيمات النظام
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                تغيير الثيم متاح من لوحة الإدارة فقط لضمان تطبيق لون واحد ومتناسق على كل الواجهات.
              </p>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-secondary-500 shadow-lg shadow-primary-500/20" />
                  <div>
                    <p className="text-sm font-bold text-white">الثيم الحالي مطبق تلقائياً</p>
                    <p className="text-xs text-slate-400">استخدم: الإدارة ← الثيمات لتغيير مظهر النظام.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* School Info Settings */}
            <div className="glass-card p-6 rounded-[2rem] border border-white/10">
              <h3 className="font-bold flex items-center gap-2 mb-4 text-white text-lg font-serif">
                <Building className="text-emerald-400 w-5 h-5" /> معلومات المدرسة
              </h3>
              <p className="text-xs text-gray-500 mb-4">هذه البيانات ستظهر في صفحة الترحيب الرئيسية</p>

              <div className="space-y-4">
                {/* School Name */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 flex items-center gap-2">
                    <Building className="w-3 h-3 text-emerald-400" /> اسم المدرسة
                  </label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm"
                    placeholder="مدرسة الأمير سعود بن جلوي المتوسطة"
                    value={settings.school_name || ''}
                    onChange={(e) => setSettings({ ...settings, school_name: e.target.value })}
                  />
                </div>

                {/* Principal Name */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 flex items-center gap-2">
                    <UserCircle className="w-3 h-3 text-secondary-400" /> اسم مدير المدرسة
                  </label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm"
                    placeholder="أ.حسام بن محمد يار"
                    value={settings.principal_name || ''}
                    onChange={(e) => setSettings({ ...settings, principal_name: e.target.value })}
                  />
                </div>

                {/* Save Button */}
                <button
                  onClick={async () => {
                    await db.saveSettings(settings);
                    toast.success('تم حفظ معلومات المدرسة ✓');
                  }}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-emerald-500/25 transition-all"
                >
                  <Save className="w-4 h-4" />
                  حفظ معلومات المدرسة
                </button>
              </div>
            </div>

            {/* Logo Settings */}
            <div className="glass-card p-6 rounded-[2rem] border border-white/10">
              <h3 className="font-bold flex items-center gap-2 mb-4 text-white text-lg font-serif">
                <Image className="text-primary-400 w-5 h-5" /> شعار المدرسة
              </h3>
              <div className="space-y-2">
                <label className="text-xs text-gray-400">رابط الشعار (Logo URL)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm"
                    placeholder="https://..."
                    value={settings.logo_url || ''}
                    onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })}
                  />
                  <button onClick={saveLogo} className="p-3 bg-white/10 rounded-xl hover:bg-primary-600 transition-colors">
                    <Save className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Social Links Management */}
            <div className="glass-card p-6 rounded-[2rem] border border-white/10">
              <h3 className="font-bold flex items-center gap-2 mb-4 text-white text-lg font-serif">
                <Link className="text-primary-400 w-5 h-5" /> روابط التواصل (الفوتر)
              </h3>
              <p className="text-xs text-gray-500 mb-4">هذه الروابط ستظهر كأيقونات في أسفل صفحات النظام</p>

              <div className="space-y-4">
                {/* Support URL */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 flex items-center gap-2">
                    <Headset className="w-3 h-3 text-secondary-400" /> رابط الدعم الفني
                  </label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm"
                    placeholder="https://support.example.com"
                    value={social_links.support_url || ''}
                    onChange={(e) => setSocialLinks({ ...social_links, support_url: e.target.value })}
                  />
                </div>

                {/* WhatsApp */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 flex items-center gap-2">
                    <MessageCircle className="w-3 h-3 text-emerald-400" /> رقم واتساب
                  </label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm font-mono"
                    placeholder="966501234567 أو https://wa.me/..."
                    value={social_links.whatsapp || ''}
                    onChange={(e) => setSocialLinks({ ...social_links, whatsapp: e.target.value })}
                  />
                  <p className="text-[10px] text-gray-600">أدخل الرقم مع رمز الدولة بدون + أو رابط كامل</p>
                </div>

                {/* Instagram */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 flex items-center gap-2">
                    <Instagram className="w-3 h-3 text-secondary-400" /> حساب انستجرام
                  </label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm"
                    placeholder="@username أو https://instagram.com/..."
                    value={social_links.instagram || ''}
                    onChange={(e) => setSocialLinks({ ...social_links, instagram: e.target.value })}
                  />
                </div>

                {/* Save Button */}
                <button
                  onClick={saveSocialLinks}
                  className="w-full py-3 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary-500/25 transition-all"
                >
                  <Save className="w-4 h-4" />
                  حفظ روابط التواصل
                </button>

                {/* Preview */}
                {(social_links.support_url || social_links.whatsapp || social_links.instagram) && (
                  <div className="pt-4 border-t border-white/10">
                    <p className="text-xs text-gray-500 mb-3">معاينة الأيقونات:</p>
                    <div className="flex items-center justify-center gap-4 p-4 bg-black/20 rounded-xl">
                      {social_links.support_url && (
                        <span className="text-gray-500 hover:text-secondary-400 transition-all cursor-pointer hover:scale-110" title="الدعم الفني">
                          <Headset className="w-5 h-5" />
                        </span>
                      )}
                      {social_links.whatsapp && (
                        <span className="text-gray-500 hover:text-emerald-400 transition-all cursor-pointer hover:scale-110" title="واتساب">
                          <MessageCircle className="w-5 h-5" />
                        </span>
                      )}
                      {social_links.instagram && (
                        <span className="text-gray-500 hover:text-secondary-400 transition-all cursor-pointer hover:scale-110" title="انستجرام">
                          <Instagram className="w-5 h-5" />
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ═══ Tab: Logs (SQL Editor + Debug Auth/Error Logs) ═══ */}
      <div className={activeMainTab === 'logs' ? 'animate-fade-in' : 'hidden'}>
        <div className="space-y-6">
          <div className="glass-card p-8 rounded-[2rem] border border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold flex items-center gap-3 text-white text-xl font-serif mb-1">
                  <Terminal className="text-primary-400 w-6 h-6" />
                  مساعد SQL Editor الذكي
                </h3>
                <p className="text-xs text-gray-400">
                  يتم توليد أوامر SQL تلقائياً عند إضافة المستخدمين أو الطلاب أو الفصول لتحديث البيانات على جميع الأجهزة.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopyAllSql}
                  className="px-3 py-2 rounded-xl border border-primary-500/30 bg-primary-500/10 text-primary-200 text-xs font-bold hover:bg-primary-500/20 transition-all flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  نسخ الكل
                </button>
                <button
                  onClick={handleClearSqlQueue}
                  className="px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-xs font-bold hover:bg-red-500/20 transition-all flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  مسح السجل
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { id: 'all', label: 'الكل' },
                { id: 'users', label: 'المستخدمين' },
                { id: 'students', label: 'الطلاب' },
                { id: 'classes', label: 'الفصول' }
              ].map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setSqlFilter(filter.id as typeof sqlFilter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${sqlFilter === filter.id
                    ? 'bg-primary-500/20 border-primary-500/40 text-primary-200'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {filteredSqlQueue.length > 0 ? (
                filteredSqlQueue.map((entry, index) => (
                  <div key={entry.id} className="p-4 rounded-xl border border-white/5 bg-[#0f172a]/90 backdrop-blur-md hover:border-primary-500/30 transition-all duration-300 animate-fade-in-up" style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 text-xs text-slate-300">
                        <Terminal className="w-4 h-4 text-primary-400 drop-shadow-[0_0_8px_rgb(var(--color-primary-400)_/_0.8)]" />
                        <span className="font-mono bg-primary-500/10 text-primary-300 px-2 py-0.5 rounded border border-primary-500/20">{entry.table}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {new Date(entry.created_at).toLocaleString('ar-SA')}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopySql(entry.sql)}
                        className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-200 hover:bg-primary-500/20 hover:text-primary-300 hover:border-primary-500/30 transition-all group flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3 group-hover:scale-110 transition-transform" /> نسخ
                      </button>
                    </div>
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-r from-primary-500/5 to-secondary-500/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                      <pre className="text-xs text-emerald-300 font-mono whitespace-pre-wrap break-words leading-relaxed p-4 bg-[#020617] rounded-lg border border-slate-800 shadow-inner overflow-x-auto selection:bg-primary-500/30">
                        {entry.sql}
                      </pre>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-xs text-slate-500 py-8">
                  لا توجد أوامر SQL جديدة بعد.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Tab: Diagnostics ═══ */}
      <div className={activeMainTab === 'diagnostics' ? 'animate-fade-in' : 'hidden'}>
        <div className="space-y-6">
          {/* Diagnostics Panel */}
          <div className="glass-card p-8 rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-900/70 to-slate-800/50 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-bold flex items-center gap-3 text-white text-xl font-serif mb-1">
                  <ShieldCheck className="text-emerald-400 w-6 h-6" /> لوحة تحليل الأخطاء
                </h3>
                <p className="text-xs text-gray-400">فحص شامل لحالة النظام والبيانات</p>
              </div>
              <button
                onClick={runDiagnostics}
                disabled={diagLoading}
                className="px-4 py-2 bg-primary-600/20 border border-primary-500/30 rounded-xl text-primary-300 hover:bg-primary-600/30 flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {diagLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                فحص الآن
              </button>
            </div>

            {diagnostics.length === 0 && !diagLoading && (
              <div className="text-center py-12 text-gray-500">
                <ShieldCheck className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                <p>لم يتم تشغيل الفحص بعد. اضغط "فحص الآن" للبدء.</p>
              </div>
            )}

            {diagLoading && (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary-400 animate-spin" />
                <p className="text-gray-400">جاري فحص النظام...</p>
              </div>
            )}

            {diagnostics.length > 0 && !diagLoading && (
              <>
                <div className="mb-4 flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                    <span className="text-gray-400">سليم ({diagnostics.filter(d => d.status === 'ok').length})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                    <span className="text-gray-400">تحذير ({diagnostics.filter(d => d.status === 'warning').length})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-gray-400">خطأ ({diagnostics.filter(d => d.status === 'error').length})</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {diagnostics.map((diag, index) => (
                    <div
                      key={diag.key}
                      className={`p-5 rounded-2xl border backdrop-blur-sm transition-all hover:scale-[1.02] animate-fade-in-up ${diag.status === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_4px_20px_-4px_rgba(16,185,129,0.1)] hover:shadow-[0_8px_30px_-4px_rgba(16,185,129,0.25)]' :
                        diag.status === 'warning' ? 'bg-amber-500/10 border-amber-500/30 shadow-[0_4px_20px_-4px_rgba(245,158,11,0.1)] hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.25)]' :
                          'bg-red-500/10 border-red-500/30 shadow-[0_4px_20px_-4px_rgba(239,68,68,0.1)] hover:shadow-[0_8px_30px_-4px_rgba(239,68,68,0.25)]'
                        }`}
                      style={{ animationFillMode: 'both', animationDelay: `${index * 80}ms` }}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <h4 className={`font-bold text-lg ${diag.status === 'ok' ? 'text-emerald-400' :
                          diag.status === 'warning' ? 'text-amber-400' : 'text-red-400'
                          }`}>{diag.title}</h4>
                        {diag.status === 'ok' ? <CheckCircle className="w-6 h-6 text-emerald-500" /> :
                          diag.status === 'warning' ? <AlertTriangle className="w-6 h-6 text-amber-500" /> :
                            <XCircle className="w-6 h-6 text-red-500" />}
                      </div>
                      <p className="text-sm text-gray-300 mb-3 leading-relaxed">{diag.message}</p>
                      {diag.count !== undefined && (
                        <div className="text-xs bg-black/20 px-2 py-1 rounded-lg text-gray-400 inline-block mb-2">
                          العدد: {diag.count}
                        </div>
                      )}
                      {diag.hint && (
                        <div className="text-xs bg-black/30 p-3 rounded-lg text-gray-300 border border-white/10 flex items-start gap-2 mt-3">
                          <span className="text-primary-400 font-bold text-base">💡</span>
                          <div>
                            <div className="font-bold text-primary-400 mb-1">اقتراح الإصلاح:</div>
                            <div>{diag.hint}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* System Stats Summary */}
          {systemStats && (
            <div className="glass-card p-6 rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-900/70 to-slate-800/50">
              <h3 className="font-bold flex items-center gap-3 text-white text-lg font-serif mb-4">
                <Activity className="text-primary-400 w-5 h-5" /> ملخص حالة النظام
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <div className="text-2xl font-bold text-emerald-400">{systemStats.totalStudents}</div>
                  <div className="text-xs text-gray-400 mt-1">إجمالي الطلاب</div>
                </div>
                <div className="p-3 rounded-xl bg-primary-500/10 border border-primary-500/20 text-center">
                  <div className="text-2xl font-bold text-primary-400">{systemStats.todayAttendance}</div>
                  <div className="text-xs text-gray-400 mt-1">حضور اليوم</div>
                </div>
                <div className="p-3 rounded-xl bg-secondary-500/10 border border-secondary-500/20 text-center">
                  <div className="text-2xl font-bold text-secondary-400">{systemStats.totalUsers}</div>
                  <div className="text-xs text-gray-400 mt-1">المستخدمين</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                  <div className="text-2xl font-bold text-amber-400">{systemStats.todayExits}</div>
                  <div className="text-xs text-gray-400 mt-1">استئذان اليوم</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Tab: Broadcast ═══ */}
      <div className={activeMainTab === 'broadcast' ? 'animate-fade-in' : 'hidden'}>
        <div className="space-y-6">
          {/* 3. Broadcast Center - Enhanced */}
          <div className="glass-card p-8 rounded-[2rem] border border-white/10">
            <h3 className="font-bold flex items-center gap-3 mb-6 text-white text-xl font-serif">
              <Megaphone className="text-secondary-400 w-6 h-6" /> مركز البث والإعلانات
            </h3>

            <div className="space-y-6">
              {/* Message Type Selection */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setBroadcast({ ...broadcast, type: 'announcement' })}
                  className={`p-4 rounded-xl border transition-all ${broadcast.type === 'announcement'
                    ? 'bg-primary-500/20 border-primary-500 text-primary-400'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                >
                  <div className="font-bold mb-1">إعلان</div>
                  <div className="text-xs">إعلانات عامة</div>
                </button>
                <button
                  onClick={() => setBroadcast({ ...broadcast, type: 'general' })}
                  className={`p-4 rounded-xl border transition-all ${broadcast.type === 'general'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                >
                  <div className="font-bold mb-1">تنبيه</div>
                  <div className="text-xs">تنبيهات مهمة</div>
                </button>
                <button
                  onClick={() => setBroadcast({ ...broadcast, type: 'command' })}
                  className={`p-4 rounded-xl border transition-all ${broadcast.type === 'command'
                    ? 'bg-red-500/20 border-red-500 text-red-400'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                >
                  <div className="font-bold mb-1">أمر</div>
                  <div className="text-xs">أوامر تنفيذية</div>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">الجمهور المستهدف</label>
                  <select
                    className="w-full input-glass p-4 rounded-xl"
                    value={broadcast.role}
                    onChange={(e) => setBroadcast({ ...broadcast, role: e.target.value as any, userId: '' })}
                  >
                    <option value="all">الجميع (All Users)</option>
                    <option value="admin">الإدارة (Admins)</option>
                    <option value="supervisor">المشرفين (Supervisors)</option>
                    <option value="guardian">أولياء الأمور (Guardians)</option>
                    <option value="kiosk">كشك الحضور (Kiosk)</option>
                    <option value="user">مستخدم محدد</option>
                  </select>
                  {broadcast.role === 'user' && (
                    <div className="mt-3">
                      <label className="block text-xs text-gray-400 mb-1">اختيار المستخدم</label>
                      <select
                        className="w-full input-glass p-3 rounded-xl text-sm"
                        value={broadcast.userId}
                        onChange={(e) => setBroadcast({ ...broadcast, userId: e.target.value })}
                      >
                        <option value="">اختر المستخدم...</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.role.replace('_', ' ')})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/10 cursor-pointer hover:bg-white/10 transition-colors">
                    <input
                      type="checkbox"
                      checked={broadcast.is_popup}
                      onChange={(e) => setBroadcast({ ...broadcast, is_popup: e.target.checked })}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-300">إظهار كمنبّه فوري (Popup)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">عنوان الرسالة</label>
                <input
                  type="text"
                  className="w-full input-glass p-4 rounded-xl"
                  placeholder="مثال: إعلان مهم / تنبيه عاجل / تذكير"
                  value={broadcast.title}
                  onChange={(e) => setBroadcast({ ...broadcast, title: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">نص الرسالة</label>
                <textarea
                  className="w-full input-glass p-4 rounded-xl h-32 resize-none"
                  placeholder="اكتب محتوى الرسالة هنا..."
                  value={broadcast.message}
                  onChange={(e) => setBroadcast({ ...broadcast, message: e.target.value })}
                />
              </div>

              <button
                onClick={handleBroadcast}
                disabled={!broadcast.message || !broadcast.title || (broadcast.role === 'user' && !broadcast.userId)}
                className="w-full py-4 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl font-bold text-white shadow-lg hover:shadow-primary-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" /> إرسال الرسالة
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Tab: Debug ═══ */}
      <div className={activeMainTab === 'debug' ? 'animate-fade-in' : 'hidden'}>
        <div className="glass-card p-6 rounded-2xl border border-primary-500/30 bg-gradient-to-br from-slate-900/50 to-slate-800/50">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Terminal className="w-6 h-6 text-primary-400" />
              <div>
                <h3 className="text-xl font-bold text-white">منطقة Debug المتقدمة</h3>
                <p className="text-xs text-slate-400">مراقبة شاملة لقاعدة البيانات، الاتصالات، والكشك</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b border-white/10 pb-2">
            <button
              onClick={() => setActiveDebugTab('database')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeDebugTab === 'database'
                ? 'bg-primary-500/20 text-primary-400 border border-primary-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <Database className="w-4 h-4" />
              قاعدة البيانات
            </button>
            <button
              onClick={() => setActiveDebugTab('connectivity')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeDebugTab === 'connectivity'
                ? 'bg-secondary-500/20 text-secondary-400 border border-secondary-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <Network className="w-4 h-4" />
              الاتصال بين الأقسام
            </button>
            <button
              onClick={() => setActiveDebugTab('kiosk')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeDebugTab === 'kiosk'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <Monitor className="w-4 h-4" />
              حالة الكشك
            </button>
            <button
              onClick={() => setActiveDebugTab('auth_logs')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeDebugTab === 'auth_logs'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <FileText className="w-4 h-4" />
              سجل الدخول والخروج
            </button>
            <button
              onClick={() => setActiveDebugTab('error_logs')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeDebugTab === 'error_logs'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
            >
              <AlertTriangle className="w-4 h-4" />
              سجل الأخطاء
            </button>
          </div>

          {/* Database Debug Panel */}
          {activeDebugTab === 'database' && (
            <DatabaseDebugPanel
              dbStatus={dbStatus}
              checkingDb={checkingDb}
              onCheck={checkDatabaseStatus}
              queryStats={dbQueryStats}
              onStatsUpdate={setDbQueryStats}
            />
          )}

          {/* Connectivity Debug Panel */}
          {activeDebugTab === 'connectivity' && (
            <ConnectivityDebugPanel
              connectivityStatus={connectivityStatus}
              onStatusUpdate={setConnectivityStatus}
            />
          )}

          {/* Kiosk Debug Panel */}
          {activeDebugTab === 'kiosk' && (
            <KioskDebugPanel
              kioskStatus={kioskStatus}
              onStatusUpdate={setKioskStatus}
            />
          )}

          {activeDebugTab === 'auth_logs' && (
            <div className="space-y-4">
              <div className="glass-card p-5 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900/50 to-emerald-900/10">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h4 className="text-lg font-bold text-white">إعدادات الاحتفاظ والتنظيف</h4>
                    <p className="text-xs text-gray-400">يتم حذف السجلات الأقدم تلقائياً حسب المدة المحددة.</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">مدة الاحتفاظ (بالأيام)</label>
                      <input
                        type="number"
                        min={1}
                        className="input-glass px-3 py-2 rounded-lg text-sm w-40"
                        value={retentionDays}
                        onChange={(e) => setRetentionDays(Number(e.target.value) || 0)}
                      />
                    </div>
                    <button
                      onClick={handleSaveRetention}
                      disabled={saveRetentionLoading}
                      className="self-end px-4 py-2 rounded-lg text-xs font-bold text-emerald-200 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                    >
                      {saveRetentionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      حفظ المدة
                    </button>
                    <button
                      onClick={handleCleanupNow}
                      disabled={cleanupLoading}
                      className="self-end px-4 py-2 rounded-lg text-xs font-bold text-amber-200 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                    >
                      {cleanupLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      تنظيف الآن
                    </button>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900/40 to-emerald-900/10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-emerald-400" />
                    <h4 className="text-lg font-bold text-white">سجل الدخول والخروج</h4>
                  </div>
                  <button
                    onClick={loadAuthLogs}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-emerald-200 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all flex items-center gap-2"
                  >
                    <RefreshCw className="w-3 h-3" />
                    تحديث
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">النطاق الزمني</label>
                    <select
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      value={authLogFilters.range}
                      onChange={(e) => setAuthLogFilters({ ...authLogFilters, range: e.target.value })}
                    >
                      <option value="24h">آخر 24 ساعة</option>
                      <option value="7d">آخر 7 أيام</option>
                      <option value="30d">آخر 30 يوم</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">الإجراء</label>
                    <select
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      value={authLogFilters.action}
                      onChange={(e) => setAuthLogFilters({ ...authLogFilters, action: e.target.value })}
                    >
                      <option value="all">كل الإجراءات</option>
                      <option value="LOGIN">تسجيل دخول</option>
                      <option value="LOGOUT">تسجيل خروج</option>
                      <option value="SESSION_RESTORE">استرجاع جلسة</option>
                      <option value="SESSION_EXPIRED">انتهاء جلسة</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">الدور</label>
                    <select
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      value={authLogFilters.role}
                      onChange={(e) => setAuthLogFilters({ ...authLogFilters, role: e.target.value })}
                    >
                      <option value="all">كل الأدوار</option>
                      <option value={Role.SITE_ADMIN}>مدير النظام</option>
                      <option value={Role.SCHOOL_ADMIN}>مدير المدرسة</option>
                      <option value={Role.SUPERVISOR_GLOBAL}>مشرف عام</option>
                      <option value={Role.SUPERVISOR_CLASS}>مشرف صف</option>
                      <option value={Role.WATCHER}>مراقب</option>
                      <option value={Role.KIOSK}>كشك</option>
                      <option value={Role.CALL_STATION}>محطة نداء</option>
                      <option value={Role.GUARDIAN}>ولي أمر</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">بحث (معرف/هوية)</label>
                    <input
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      placeholder="ابحث عن مستخدم..."
                      value={authLogFilters.search}
                      onChange={(e) => setAuthLogFilters({ ...authLogFilters, search: e.target.value })}
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-white/10 bg-white/5 mb-4">
                  <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-2 block">نطاق التصدير</label>
                      <select
                        className="w-full input-glass p-2 rounded-lg text-sm"
                        value={authExportRange}
                        onChange={(e) => setAuthExportRange(e.target.value as '24h' | '7d' | '30d' | 'custom')}
                      >
                        <option value="24h">آخر 24 ساعة</option>
                        <option value="7d">آخر 7 أيام</option>
                        <option value="30d">آخر 30 يوم</option>
                        <option value="custom">نطاق مخصص</option>
                      </select>
                    </div>
                    {authExportRange === 'custom' && (
                      <>
                        <div>
                          <label className="text-xs text-gray-400 mb-2 block">من</label>
                          <input
                            type="date"
                            className="input-glass p-2 rounded-lg text-sm"
                            value={authExportFrom}
                            onChange={(e) => setAuthExportFrom(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 mb-2 block">إلى</label>
                          <input
                            type="date"
                            className="input-glass p-2 rounded-lg text-sm"
                            value={authExportTo}
                            onChange={(e) => setAuthExportTo(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="text-xs text-gray-400 mb-2 block">حد الصفوف</label>
                      <select
                        className="input-glass p-2 rounded-lg text-sm w-32"
                        value={authExportLimit}
                        onChange={(e) => setAuthExportLimit(Number(e.target.value))}
                      >
                        <option value={1000}>1000</option>
                        <option value={5000}>5000</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => exportAuthLogs('csv')}
                        disabled={authExportLoading}
                        className="px-4 py-2 rounded-lg text-xs font-bold text-emerald-200 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                      >
                        {authExportLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                        تصدير CSV
                      </button>
                      <button
                        onClick={() => exportAuthLogs('json')}
                        disabled={authExportLoading}
                        className="px-4 py-2 rounded-lg text-xs font-bold text-primary-200 border border-primary-500/30 bg-primary-500/10 hover:bg-primary-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                      >
                        {authExportLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                        تصدير JSON
                      </button>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-white/10">
                        <th className="py-3 px-2">الوقت</th>
                        <th className="py-3 px-2">الإجراء</th>
                        <th className="py-3 px-2">المستخدم/الهوية</th>
                        <th className="py-3 px-2">الدور</th>
                        <th className="py-3 px-2">المسار</th>
                        <th className="py-3 px-2">الجهاز</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authLogsLoading && (
                        Array.from({ length: 4 }).map((_, i) => (
                          <tr key={`skel-${i}`} className="animate-pulse border-b border-white/5">
                            <td className="py-4 px-2"><div className="h-4 bg-white/10 rounded w-16"></div></td>
                            <td className="py-4 px-2"><div className="h-4 bg-white/10 rounded-full w-20"></div></td>
                            <td className="py-4 px-2">
                              <div className="h-4 bg-white/10 rounded w-24 mb-2"></div>
                              <div className="h-2 bg-white/5 rounded w-16"></div>
                            </td>
                            <td className="py-4 px-2"><div className="h-4 bg-white/10 rounded w-12"></div></td>
                            <td className="py-4 px-2"><div className="h-4 bg-white/10 rounded w-32"></div></td>
                            <td className="py-4 px-2"><div className="h-4 bg-white/10 rounded w-20"></div></td>
                          </tr>
                        ))
                      )}
                      {!authLogsLoading && authLogs.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-gray-500">
                            لا توجد سجلات بعد ضمن النطاق المحدد.
                          </td>
                        </tr>
                      )}
                      {!authLogsLoading && authLogs.map((log) => {
                        const actionMeta = authActionLabels[log.action];
                        return (
                          <tr key={log.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="py-3 px-2 text-xs text-gray-300">{formatLogTime(log.created_at)}</td>
                            <td className="py-3 px-2">
                              <span className={`text-xs px-2 py-1 rounded-full border ${actionMeta?.badge || 'border-white/10 text-gray-300'}`}>
                                {actionMeta?.label || log.action}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-xs text-gray-200">
                              <div className="font-semibold">{log.actor_label || 'anonymous'}</div>
                              <div className="text-[10px] text-gray-500">{log.actor_user_id || '—'}</div>
                            </td>
                            <td className="py-3 px-2 text-xs text-gray-300">{log.actor_role || '—'}</td>
                            <td className="py-3 px-2 text-xs text-gray-400">{log.path || '/'}</td>
                            <td className="py-3 px-2 text-xs text-gray-500">
                              {(log.user_agent || '').slice(0, 28)}
                              {(log.user_agent || '').length > 28 ? '…' : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeDebugTab === 'error_logs' && (
            <div className="space-y-4">
              <div className="glass-card p-5 rounded-2xl border border-rose-500/20 bg-gradient-to-br from-slate-900/50 to-rose-900/10">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h4 className="text-lg font-bold text-white">إعدادات الاحتفاظ والتنظيف</h4>
                    <p className="text-xs text-gray-400">تطبق على سجل الدخول والخروج وسجل الأخطاء.</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">مدة الاحتفاظ (بالأيام)</label>
                      <input
                        type="number"
                        min={1}
                        className="input-glass px-3 py-2 rounded-lg text-sm w-40"
                        value={retentionDays}
                        onChange={(e) => setRetentionDays(Number(e.target.value) || 0)}
                      />
                    </div>
                    <button
                      onClick={handleSaveRetention}
                      disabled={saveRetentionLoading}
                      className="self-end px-4 py-2 rounded-lg text-xs font-bold text-rose-200 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                    >
                      {saveRetentionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      حفظ المدة
                    </button>
                    <button
                      onClick={handleCleanupNow}
                      disabled={cleanupLoading}
                      className="self-end px-4 py-2 rounded-lg text-xs font-bold text-amber-200 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                    >
                      {cleanupLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      تنظيف الآن
                    </button>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 rounded-2xl border border-rose-500/20 bg-gradient-to-br from-slate-900/40 to-rose-900/10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                    <h4 className="text-lg font-bold text-white">سجل الأخطاء</h4>
                  </div>
                  <button
                    onClick={loadErrorLogs}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-rose-200 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 transition-all flex items-center gap-2"
                  >
                    <RefreshCw className="w-3 h-3" />
                    تحديث
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">النطاق الزمني</label>
                    <select
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      value={errorLogFilters.range}
                      onChange={(e) => setErrorLogFilters({ ...errorLogFilters, range: e.target.value })}
                    >
                      <option value="24h">آخر 24 ساعة</option>
                      <option value="7d">آخر 7 أيام</option>
                      <option value="30d">آخر 30 يوم</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">الشدة</label>
                    <select
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      value={errorLogFilters.severity}
                      onChange={(e) => setErrorLogFilters({ ...errorLogFilters, severity: e.target.value })}
                    >
                      <option value="all">كل المستويات</option>
                      <option value="ERROR">خطأ</option>
                      <option value="WARN">تحذير</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">المصدر</label>
                    <select
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      value={errorLogFilters.source}
                      onChange={(e) => setErrorLogFilters({ ...errorLogFilters, source: e.target.value })}
                    >
                      <option value="all">كل المصادر</option>
                      <option value="window.onerror">window.onerror</option>
                      <option value="unhandledrejection">unhandledrejection</option>
                      <option value="react-boundary">react-boundary</option>
                      <option value="console.error">console.error</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">المسار</label>
                    <input
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      placeholder="/admin"
                      value={errorLogFilters.path}
                      onChange={(e) => setErrorLogFilters({ ...errorLogFilters, path: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">بحث</label>
                    <input
                      className="w-full input-glass p-2 rounded-lg text-sm"
                      placeholder="ابحث داخل الرسالة..."
                      value={errorLogFilters.search}
                      onChange={(e) => setErrorLogFilters({ ...errorLogFilters, search: e.target.value })}
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-white/10 bg-white/5 mb-4">
                  <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-2 block">نطاق التصدير</label>
                      <select
                        className="w-full input-glass p-2 rounded-lg text-sm"
                        value={errorExportRange}
                        onChange={(e) => setErrorExportRange(e.target.value as '24h' | '7d' | '30d' | 'custom')}
                      >
                        <option value="24h">آخر 24 ساعة</option>
                        <option value="7d">آخر 7 أيام</option>
                        <option value="30d">آخر 30 يوم</option>
                        <option value="custom">نطاق مخصص</option>
                      </select>
                    </div>
                    {errorExportRange === 'custom' && (
                      <>
                        <div>
                          <label className="text-xs text-gray-400 mb-2 block">من</label>
                          <input
                            type="date"
                            className="input-glass p-2 rounded-lg text-sm"
                            value={errorExportFrom}
                            onChange={(e) => setErrorExportFrom(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 mb-2 block">إلى</label>
                          <input
                            type="date"
                            className="input-glass p-2 rounded-lg text-sm"
                            value={errorExportTo}
                            onChange={(e) => setErrorExportTo(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="text-xs text-gray-400 mb-2 block">حد الصفوف</label>
                      <select
                        className="input-glass p-2 rounded-lg text-sm w-32"
                        value={errorExportLimit}
                        onChange={(e) => setErrorExportLimit(Number(e.target.value))}
                      >
                        <option value={1000}>1000</option>
                        <option value={5000}>5000</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => exportErrorLogs('csv')}
                        disabled={errorExportLoading}
                        className="px-4 py-2 rounded-lg text-xs font-bold text-rose-200 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                      >
                        {errorExportLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                        تصدير CSV
                      </button>
                      <button
                        onClick={() => exportErrorLogs('json')}
                        disabled={errorExportLoading}
                        className="px-4 py-2 rounded-lg text-xs font-bold text-primary-200 border border-primary-500/30 bg-primary-500/10 hover:bg-primary-500/20 transition-all flex items-center gap-2 disabled:opacity-60"
                      >
                        {errorExportLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                        تصدير JSON
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {errorLogsLoading && Array.from({ length: 3 }).map((_, i) => (
                    <div key={`err-skel-${i}`} className="p-5 rounded-xl border border-white/5 bg-white/5 animate-pulse flex flex-col gap-4 mb-3">
                      <div className="flex gap-3 items-center">
                        <div className="h-3 w-16 bg-white/20 rounded"></div>
                        <div className="h-4 w-12 bg-white/20 rounded-full"></div>
                        <div className="h-3 w-20 bg-white/10 rounded"></div>
                      </div>
                      <div className="h-4 w-full bg-white/10 rounded"></div>
                      <div className="h-4 w-2/3 bg-white/10 rounded"></div>
                    </div>
                  ))}
                  {!errorLogsLoading && errorLogs.length === 0 && (
                    <div className="py-6 text-center text-gray-500">
                      لا توجد أخطاء مسجلة ضمن النطاق المحدد.
                    </div>
                  )}
                  {!errorLogsLoading && errorLogs.map((log) => {
                    const severityMeta = severityLabels[log.severity];
                    return (
                      <div
                        key={log.id}
                        className="p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>{formatLogTime(log.created_at)}</span>
                            <span className={`px-2 py-0.5 rounded-full border ${severityMeta?.badge || 'border-white/10 text-gray-300'}`}>
                              {severityMeta?.label || log.severity}
                            </span>
                            <span className="text-[10px] text-gray-500">{log.source}</span>
                          </div>
                          <div className="text-sm text-gray-200 max-h-12 overflow-hidden">{log.message}</div>
                          <div className="text-xs text-gray-500">المسار: {log.path || '/'}</div>
                        </div>
                        <button
                          onClick={() => setSelectedErrorLog(log)}
                          className="px-4 py-2 rounded-lg text-xs font-bold text-rose-200 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 transition-all"
                        >
                          عرض التفاصيل
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {
        selectedErrorLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="glass-card w-full max-w-4xl rounded-3xl border border-rose-500/30 p-6 bg-slate-900/80">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-xl font-bold text-white">تفاصيل الخطأ</h4>
                  <p className="text-xs text-gray-400">تأكد من أن الرسائل لا تحتوي على أي بيانات حساسة.</p>
                </div>
                <button
                  onClick={() => setSelectedErrorLog(null)}
                  className="text-gray-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-white/10 bg-black/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">الرسالة</span>
                    <button
                      onClick={() => handleCopy(selectedErrorLog.message)}
                      className="text-xs text-primary-300 flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> نسخ
                    </button>
                  </div>
                  <pre className="text-xs text-gray-200 whitespace-pre-wrap">{selectedErrorLog.message}</pre>
                </div>

                {selectedErrorLog.stack && (
                  <div className="p-4 rounded-xl border border-white/10 bg-black/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-300">Stack trace</span>
                      <button
                        onClick={() => handleCopy(selectedErrorLog.stack || '')}
                        className="text-xs text-primary-300 flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> نسخ
                      </button>
                    </div>
                    <pre className="text-xs text-gray-200 whitespace-pre-wrap max-h-60 overflow-y-auto">{selectedErrorLog.stack}</pre>
                  </div>
                )}

                <div className="p-4 rounded-xl border border-white/10 bg-black/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">البيانات المرفقة (meta)</span>
                    <button
                      onClick={() => handleCopy(JSON.stringify(selectedErrorLog.meta ?? {}, null, 2))}
                      className="text-xs text-primary-300 flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> نسخ
                    </button>
                  </div>
                  <pre className="text-xs text-gray-200 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {JSON.stringify(selectedErrorLog.meta ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* ═══ Tab: Security ═══ */}
      <div className={activeMainTab === 'security' ? 'animate-fade-in' : 'hidden'}>
        <div className="space-y-6">
          {canViewDevPanel && (
            <div className="glass-card p-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-bold text-yellow-100">
                    لوحة Debug للمطورين (Supabase / Database)
                  </span>
                </div>
                <button
                  onClick={() => setShowDevPanel(v => !v)}
                  className="text-xs text-yellow-300 flex items-center gap-1"
                >
                  {showDevPanel ? (
                    <>
                      إخفاء التفاصيل <ToggleLeft className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      عرض التفاصيل <ToggleRight className="w-3 h-3" />
                    </>
                  )}
                </button>
              </div>

              {showDevPanel && (
                <div className="space-y-3 text-[11px] text-yellow-100/90">
                  <div className="flex items-center gap-2">
                    <Server className="w-3 h-3" />
                    <span>البيئة الحالية: {import.meta.env.PROD ? 'Production' : 'Development'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Database className="w-3 h-3" />
                    <span>وضع قاعدة البيانات: {debugInfo?.dbMode || db.getMode()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Cloud className="w-3 h-3" />
                    <span>
                      Supabase مهيأ: {debugInfo?.supabase?.isConfigured ? '✓ نعم' : '✗ لا'}
                    </span>
                  </div>
                  {debugInfo?.sync && (
                    <div className="flex items-center gap-2">
                      <Activity className="w-3 h-3" />
                      <span>
                        حالة المزامنة: {debugInfo.sync.status} – عناصر معلّقة: {debugInfo.sync.pending}
                      </span>
                    </div>
                  )}
                  {debugInfo?.health && (
                    <div className="flex items-center gap-2">
                      {debugInfo.health.ok ? (
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                      )}
                      <span>
                        فحص Supabase: {debugInfo.health.ok ? 'الاتصال سليم' : `مشكلة: ${debugInfo.health.error}`}
                      </span>
                    </div>
                  )}

                  {debugError && (
                    <div className="flex items-center gap-2 text-red-300">
                      <XCircle className="w-3 h-3" />
                      <span>{debugError}</span>
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={loadDebugInfo}
                      disabled={debugLoading}
                      className="flex-1 py-1.5 text-[11px] rounded-lg border border-yellow-400/40 bg-yellow-500/10 hover:bg-yellow-500/20 flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      {debugLoading ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          تحديث معلومات debug
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3 h-3" />
                          تحديث معلومات debug
                        </>
                      )}
                    </button>

                    <button
                      onClick={copyDebugInfo}
                      disabled={!debugInfo}
                      className="px-3 py-1.5 text-[11px] rounded-lg border border-yellow-400/40 bg-yellow-500/10 hover:bg-yellow-500/20 disabled:opacity-60"
                    >
                      نسخ تقرير debug
                    </button>
                  </div>

                  <div className="text-[10px] text-yellow-200/70 mt-1">
                    * هذه اللوحة للمطور فقط الدعم الفني ومدير النظام.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Retention & Cleanup Settings */}
          <div className="glass-card p-8 rounded-[2rem] border border-white/10">
            <div className="flex items-center gap-3 mb-6">
              <Clock className="w-6 h-6 text-primary-400" />
              <div>
                <h3 className="text-lg font-bold text-white">سياسة الاحتفاظ بالبيانات</h3>
                <p className="text-xs text-slate-400">تنظيف السجلات القديمة تلقائياً لضمان استقرار النظام</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-300 mb-2">عدد أيام الاحتفاظ بالسجلات</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      className="flex-1 px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white outline-none focus:border-primary-500/50 transition-all font-mono"
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(parseInt(e.target.value) || 90)}
                    />
                    <button
                      onClick={handleSaveRetention}
                      disabled={saveRetentionLoading}
                      className="px-6 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold disabled:opacity-50 transition-all flex items-center justify-center min-w-[80px]"
                    >
                      {saveRetentionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'حفظ'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2 italic">
                    * سيشمل التنظيف المجدول سجلات الدخول (Auth Logs) وسجلات أخطاء المتصفح (Error Logs).
                  </p>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/20">
                <h4 className="text-sm font-bold text-amber-400 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> تنظيف يدوي فوري
                </h4>
                <p className="text-xs text-slate-400 mb-4 leading-relaxed">يمكنك مسح السجلات القديمة يدوياً الآن لتوفير مساحة في قاعدة البيانات المحلية والسحابية.</p>
                <button
                  onClick={handleCleanupNow}
                  disabled={cleanupLoading}
                  className="w-full py-3 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 rounded-xl text-amber-300 text-xs font-bold flex items-center justify-center gap-2 transition-all"
                >
                  {cleanupLoading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      جاري المسح...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3 h-3" />
                      مسح البيانات القديمة الآن
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="max-w-xl mx-auto mt-16 mb-10 space-y-4">
            {isBootstrapFeatureEnabled ? (
              <>
                <div
                  className={`p-4 rounded-xl border ${isBootstrapAdminConfigured ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/50 bg-amber-500/5'
                    }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {isBootstrapAdminConfigured ? (
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                    <span>بيانات حساب المدير الجذري</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-300 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">المستخدم:</span>
                      <code className="px-2 py-0.5 bg-black/40 rounded-md border border-white/5">{bootstrapAdminConfig.username || 'غير محدد'}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">الاسم:</span>
                      <span>{bootstrapAdminConfig.name}</span>
                    </div>
                  </div>

                  {bootstrapAdminStatus.errors.length > 0 && (
                    <div className="mt-3 text-xs text-amber-200 space-y-1">
                      <p className="font-semibold">يجب إصلاح العناصر التالية قبل إعادة الضبط:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {bootstrapAdminStatus.errors.map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {bootstrapAdminStatus.warnings.length > 0 && (
                    <div className="mt-2 text-[11px] text-amber-100/80 space-y-0.5">
                      <p className="font-semibold">تحسينات أمان موصى بها:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {bootstrapAdminStatus.warnings.map((warn, idx) => (
                          <li key={idx}>{warn}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!isBootstrapAdminConfigured) {
                      toast.error(
                        bootstrapAdminStatus.errors.join('\n') ||
                        'يجب ضبط VITE_BOOTSTRAP_ADMIN_USERNAME/VITE_BOOTSTRAP_ADMIN_PASSWORD بقيم قوية قبل إعادة التهيئة.'
                      );
                      return;
                    }

                    const confirmMessage = `تحذير: سيتم حذف جميع البيانات وإعادة تهيئة النظام مع إنشاء حساب المدير (${bootstrapAdminConfig.username}). هل أنت متأكد؟`;

                    if (window.confirm(confirmMessage)) {
                      localStorage.clear();
                      // إضافة مستخدم bootstrap من الإعدادات الآمنة
                      localStorage.setItem(
                        'hader:users',
                        JSON.stringify([
                          { id: 'bootstrap-admin', username: bootstrapAdminConfig.username, password: bootstrapAdminConfig.password, name: bootstrapAdminConfig.name, role: 'SITE_ADMIN' }
                        ])
                      );
                      // إعدادات افتراضية مع التلميحات المطلوبة
                      localStorage.setItem(
                        'hader:settings',
                        JSON.stringify({
                          system_ready: true,
                          school_active: true,
                          logo_url: '',
                          dark_mode: true,
                          assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
                          grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD,
                          school_name: '',
                          principal_name: '',
                          kiosk_settings: { school_name: 'مدرسة الأمير سعود بن جلوي المتوسطة', principal_name: 'أ.حسام بن محمد يار' }
                        })
                      );
                      window.location.reload();
                    }
                  }}
                  className="w-full py-4 bg-gradient-to-r from-red-600 to-secondary-500 hover:to-red-800 text-white font-bold text-lg rounded-2xl border border-red-700 shadow-lg transition-all mt-10 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!isBootstrapAdminConfigured}
                >
                  🛑 إعادة ضبط المصنع / حذف جميع بيانات النظام
                </button>
              </>
            ) : (
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 text-sm text-slate-300">
                تم تعطيل `Bootstrap Admin` افتراضيًا لأسباب أمنية. استخدم إنشاء مدير عبر البيانات المحلية أو قاعدة البيانات بدل تمرير كلمة مرور داخل متغيرات `VITE_*`.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 🔧 Database Debug Panel Component
// ═══════════════════════════════════════════════════════════════
interface DatabaseDebugPanelProps {
  dbStatus: {
    connected: boolean;
    lastCheck: string;
    responseTime: number;
    tables: { name: string; accessible: boolean }[];
    error?: string;
  } | null;
  checkingDb: boolean;
  onCheck: () => void;
  queryStats: { success: number; failed: number; errors: Array<{ code: string; table: string; time: string; message: string }> };
  onStatsUpdate: (stats: { success: number; failed: number; errors: Array<{ code: string; table: string; time: string; message: string }> }) => void;
}

const DatabaseDebugPanel: React.FC<DatabaseDebugPanelProps> = ({
  dbStatus,
  checkingDb,
  onCheck,
  queryStats,
  onStatsUpdate
}) => {
  // Determine connection status
  const getConnectionStatus = () => {
    if (!dbStatus) return { label: 'غير معروف', color: 'text-slate-400', bg: 'bg-slate-500/20', icon: Minus };
    if (!dbStatus.connected) return { label: 'Offline', color: 'text-red-400', bg: 'bg-red-500/20', icon: WifiOff };
    if (dbStatus.responseTime > 1000) return { label: 'Degraded', color: 'text-amber-400', bg: 'bg-amber-500/20', icon: AlertTriangle };
    return { label: 'Online', color: 'text-emerald-400', bg: 'bg-emerald-500/20', icon: Wifi };
  };

  const connectionStatus = getConnectionStatus();
  const StatusIcon = connectionStatus.icon;

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`p-4 rounded-xl border ${connectionStatus.bg} border-white/10`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">حالة الاتصال</span>
            <StatusIcon className={`w-5 h-5 ${connectionStatus.color}`} />
          </div>
          <p className={`text-2xl font-bold ${connectionStatus.color}`}>{connectionStatus.label}</p>
          {dbStatus && (
            <p className="text-xs text-slate-500 mt-1">زمن الاستجابة: {dbStatus.responseTime}ms</p>
          )}
        </div>

        <div className="p-4 rounded-xl border border-primary-500/20 bg-primary-500/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">الاستعلامات الناجحة</span>
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400">{queryStats.success}</p>
          <p className="text-xs text-slate-500 mt-1">آخر 5 دقائق</p>
        </div>

        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">الاستعلامات الفاشلة</span>
            <XCircle className="w-5 h-5 text-red-400" />
          </div>
          <p className="text-2xl font-bold text-red-400">{queryStats.failed}</p>
          <p className="text-xs text-slate-500 mt-1">آخر 5 دقائق</p>
        </div>
      </div>

      {/* Tables Status */}
      <div className="p-4 rounded-xl border border-white/10 bg-slate-800/30">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Database className="w-4 h-4 text-primary-400" />
          حالة الجداول الأساسية
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {dbStatus?.tables.map((table) => (
            <div key={table.name} className="p-3 rounded-lg bg-black/20 border border-white/5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-300 font-mono">{table.name}</span>
                {table.accessible ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
              </div>
              <p className="text-[10px] text-slate-500">
                {table.accessible ? '✓ قابل للقراءة/الكتابة' : '✗ غير متاح'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Error Log */}
      {queryStats.errors.length > 0 && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10">
          <h4 className="text-sm font-bold text-red-400 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            آخر الأخطاء المتعلقة بالـ DB
          </h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {queryStats.errors.slice(0, 10).map((error, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-black/30 border border-red-500/20">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1">
                    <p className="text-xs font-bold text-red-300">كود الخطأ: {error.code}</p>
                    <p className="text-[10px] text-slate-400 mt-1">الجدول: {error.table}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{error.message}</p>
                  </div>
                  <span className="text-[10px] text-slate-500">{error.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onCheck}
        disabled={checkingDb}
        className="w-full py-3 bg-primary-600/20 hover:bg-primary-600/30 border border-primary-500/30 rounded-xl text-primary-300 text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
      >
        {checkingDb ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري الفحص...
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4" />
            فحص الاتصال الآن
          </>
        )}
      </button>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 🌐 Connectivity Debug Panel Component
// ═══════════════════════════════════════════════════════════════
interface ConnectivityDebugPanelProps {
  connectivityStatus: Record<string, { status: 'ok' | 'degraded' | 'error'; lastSuccess?: string; lastError?: { status: number; message: string; time: string } }>;
  onStatusUpdate: (status: Record<string, { status: 'ok' | 'degraded' | 'error'; lastSuccess?: string; lastError?: { status: number; message: string; time: string } }>) => void;
}

const ConnectivityDebugPanel: React.FC<ConnectivityDebugPanelProps> = ({
  connectivityStatus,
  onStatusUpdate
}) => {
  const [testing, setTesting] = useState<string | null>(null);

  const routes = [
    { id: 'kiosk-api', name: 'كشك الحضور → API → Supabase', path: '/kiosk' },
    { id: 'watcher-stats', name: 'واجهة المراقب → API الإحصاءات', path: '/watcher' },
    { id: 'admin-reports', name: 'واجهة المدير → تقارير الحضور', path: '/admin' },
    { id: 'supervision-data', name: 'بوابة الإشراف → بيانات الطلاب والفصول', path: '/supervision' }
  ];

  const testRoute = async (routeId: string, routeName: string) => {
    setTesting(routeId);
    try {
      const startTime = Date.now();
      // Simulate API test - in real implementation, this would call actual endpoints
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      const responseTime = Date.now() - startTime;

      const newStatus = {
        status: responseTime < 1000 ? 'ok' as const : 'degraded' as const,
        lastSuccess: new Date().toLocaleString('ar-SA'),
        lastError: undefined
      };

      onStatusUpdate({ ...connectivityStatus, [routeId]: newStatus });
    } catch (error: any) {
      onStatusUpdate({
        ...connectivityStatus,
        [routeId]: {
          status: 'error' as const,
          lastError: {
            status: 500,
            message: error?.message || 'خطأ غير معروف',
            time: new Date().toLocaleString('ar-SA')
          }
        }
      });
    } finally {
      setTesting(null);
    }
  };

  const getStatusIcon = (status: 'ok' | 'degraded' | 'error') => {
    switch (status) {
      case 'ok': return <CheckCircle className="w-5 h-5 text-emerald-400" />;
      case 'degraded': return <AlertTriangle className="w-5 h-5 text-amber-400" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-400" />;
    }
  };

  const getStatusLabel = (status: 'ok' | 'degraded' | 'error') => {
    switch (status) {
      case 'ok': return '✅ يعمل';
      case 'degraded': return '⚠ متقطع';
      case 'error': return '❌ لا يعمل';
    }
  };

  return (
    <div className="space-y-4">
      {routes.map((route) => {
        const status = connectivityStatus[route.id] || { status: 'ok' as const };
        return (
          <div key={route.id} className="p-4 rounded-xl border border-white/10 bg-slate-800/30">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                {getStatusIcon(status.status)}
                <div>
                  <h4 className="text-sm font-bold text-white">{route.name}</h4>
                  <p className="text-xs text-slate-400">مسار: {route.path}</p>
                </div>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${status.status === 'ok' ? 'bg-emerald-500/20 text-emerald-400' :
                status.status === 'degraded' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                {getStatusLabel(status.status)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              {status.lastSuccess && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-[10px] text-slate-400 mb-1">آخر نجاح</p>
                  <p className="text-xs text-emerald-400 font-mono">{status.lastSuccess}</p>
                </div>
              )}
              {status.lastError && (
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-[10px] text-slate-400 mb-1">آخر فشل</p>
                  <p className="text-xs text-red-400 font-mono">{status.lastError.time}</p>
                  <p className="text-[10px] text-red-300 mt-1">HTTP {status.lastError.status}: {status.lastError.message}</p>
                </div>
              )}
            </div>

            <button
              onClick={() => testRoute(route.id, route.name)}
              disabled={testing === route.id}
              className="w-full py-2 bg-secondary-600/20 hover:bg-secondary-600/30 border border-secondary-500/30 rounded-lg text-secondary-300 text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {testing === route.id ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  جاري الاختبار...
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  اختبار الاتصال
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 🖥️ Kiosk Debug Panel Component
// ═══════════════════════════════════════════════════════════════
interface KioskDebugPanelProps {
  kioskStatus: {
    main: { online: boolean; lastHeartbeat?: string; browser?: string; screenOrientation?: string; uiRotation?: 'none' | 'right' | 'left' };
    mini: { visible: boolean; size?: { width: number; height: number }; rotation?: 'none' | 'right' | 'left'; barcodeFocus?: boolean; lastScan?: string };
    logs: Array<{ type: 'success' | 'error' | 'warning'; message: string; time: string; details?: any }>;
  };
  onStatusUpdate: (status: {
    main: { online: boolean; lastHeartbeat?: string; browser?: string; screenOrientation?: string; uiRotation?: 'none' | 'right' | 'left' };
    mini: { visible: boolean; size?: { width: number; height: number }; rotation?: 'none' | 'right' | 'left'; barcodeFocus?: boolean; lastScan?: string };
    logs: Array<{ type: 'success' | 'error' | 'warning'; message: string; time: string; details?: any }>;
  }) => void;
}

const KioskDebugPanel: React.FC<KioskDebugPanelProps> = ({
  kioskStatus,
  onStatusUpdate
}) => {
  const [rotation, setRotation] = useState<'none' | 'right' | 'left'>('none');

  // Listen for kiosk status updates via localStorage events
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'hader:kiosk:status') {
        try {
          const status = JSON.parse(e.newValue || '{}');
          onStatusUpdate({
            ...kioskStatus,
            main: { ...kioskStatus.main, ...status.main },
            mini: { ...kioskStatus.mini, ...status.mini }
          });
        } catch (err) {
          logError(err, 'Support - Parse Kiosk Status');
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [kioskStatus, onStatusUpdate]);

  // Check kiosk rotation from localStorage
  useEffect(() => {
    const storedRotation = localStorage.getItem('hader:kiosk:rotation') as 'none' | 'right' | 'left' | null;
    if (storedRotation) {
      setRotation(storedRotation);
      onStatusUpdate({
        ...kioskStatus,
        main: { ...kioskStatus.main, uiRotation: storedRotation }
      });
    }
  }, []);

  const getRotationIcon = (rot: 'none' | 'right' | 'left') => {
    switch (rot) {
      case 'right': return <RotateCw className="w-4 h-4" />;
      case 'left': return <RotateCcw className="w-4 h-4" />;
      default: return <Monitor className="w-4 h-4" />;
    }
  };

  const getRotationLabel = (rot: 'none' | 'right' | 'left') => {
    switch (rot) {
      case 'right': return 'Rotated Right (90°)';
      case 'left': return 'Rotated Left (-90°)';
      default: return 'Normal';
    }
  };

  const sendResetUI = () => {
    // Send message via BroadcastChannel or localStorage event
    const channel = new BroadcastChannel('hader-kiosk-control');
    channel.postMessage({ type: 'reset-ui' });
    channel.close();

    onStatusUpdate({
      ...kioskStatus,
      logs: [
        { type: 'success', message: 'تم إرسال أمر Reset UI للكشك', time: new Date().toLocaleString('ar-SA') },
        ...kioskStatus.logs.slice(0, 9)
      ]
    });
  };

  const sendRefocusBarcode = () => {
    const channel = new BroadcastChannel('hader-kiosk-control');
    channel.postMessage({ type: 'refocus-barcode' });
    channel.close();

    onStatusUpdate({
      ...kioskStatus,
      logs: [
        { type: 'success', message: 'تم إرسال أمر إعادة التركيز على حقل الباركود', time: new Date().toLocaleString('ar-SA') },
        ...kioskStatus.logs.slice(0, 9)
      ]
    });
  };

  return (
    <div className="space-y-6">
      {/* Main Kiosk Status */}
      <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/10">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Monitor className="w-4 h-4 text-amber-400" />
          الكشك الرئيسي (الشاشة الثانية)
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-black/20 border border-white/5">
            <p className="text-xs text-slate-400 mb-1">الحالة</p>
            <p className={`text-sm font-bold ${kioskStatus.main.online ? 'text-emerald-400' : 'text-red-400'}`}>
              {kioskStatus.main.online ? 'Online' : 'Offline'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-white/5">
            <p className="text-xs text-slate-400 mb-1">آخر Heartbeat</p>
            <p className="text-xs text-slate-300 font-mono">
              {kioskStatus.main.lastHeartbeat || 'غير متوفر'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-white/5">
            <p className="text-xs text-slate-400 mb-1">المتصفح/النظام</p>
            <p className="text-xs text-slate-300">
              {kioskStatus.main.browser || navigator.userAgent.split(' ')[0]}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-white/5">
            <p className="text-xs text-slate-400 mb-1">اتجاه الواجهة</p>
            <div className="flex items-center gap-2">
              {getRotationIcon(kioskStatus.main.uiRotation || 'none')}
              <p className="text-xs text-slate-300">
                {getRotationLabel(kioskStatus.main.uiRotation || 'none')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Mini-Kiosk Status */}
      <div className="p-4 rounded-xl border border-secondary-500/20 bg-secondary-500/10">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Monitor className="w-4 h-4 text-secondary-400" />
          الميني-كشك (داخل واجهة المراقب)
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-black/20 border border-white/5">
            <p className="text-xs text-slate-400 mb-1">الحالة</p>
            <p className={`text-sm font-bold ${kioskStatus.mini.visible ? 'text-emerald-400' : 'text-slate-500'}`}>
              {kioskStatus.mini.visible ? 'ظاهر' : 'مخفي'}
            </p>
          </div>
          {kioskStatus.mini.size && (
            <div className="p-3 rounded-lg bg-black/20 border border-white/5">
              <p className="text-xs text-slate-400 mb-1">الحجم الحالي</p>
              <p className="text-xs text-slate-300 font-mono">
                {kioskStatus.mini.size.width} × {kioskStatus.mini.size.height}px
              </p>
            </div>
          )}
          <div className="p-3 rounded-lg bg-black/20 border border-white/5">
            <p className="text-xs text-slate-400 mb-1">اتجاه الميني-كشك</p>
            <div className="flex items-center gap-2">
              {getRotationIcon(kioskStatus.mini.rotation || 'none')}
              <p className="text-xs text-slate-300">
                {getRotationLabel(kioskStatus.mini.rotation || 'none')}
              </p>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-black/20 border border-white/5">
            <p className="text-xs text-slate-400 mb-1">حالة حقل الباركود</p>
            <p className={`text-xs font-bold ${kioskStatus.mini.barcodeFocus ? 'text-emerald-400' : 'text-slate-500'}`}>
              {kioskStatus.mini.barcodeFocus ? 'Yes (فوكس نشط)' : 'No'}
            </p>
            {kioskStatus.mini.lastScan && (
              <p className="text-[10px] text-slate-500 mt-1">آخر قراءة: {kioskStatus.mini.lastScan}</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="p-4 rounded-xl border border-primary-500/20 bg-primary-500/10">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary-400" />
          أدوات سريعة
        </h4>
        <div className="flex gap-3">
          <button
            onClick={sendResetUI}
            className="flex-1 py-2 bg-primary-600/20 hover:bg-primary-600/30 border border-primary-500/30 rounded-lg text-primary-300 text-xs font-bold flex items-center justify-center gap-2 transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Reset UI للكشك
          </button>
          <button
            onClick={sendRefocusBarcode}
            className="flex-1 py-2 bg-primary-600/20 hover:bg-primary-600/30 border border-primary-500/30 rounded-lg text-primary-300 text-xs font-bold flex items-center justify-center gap-2 transition-all"
          >
            <Focus className="w-3 h-3" />
            إعادة التركيز على الباركود
          </button>
        </div>
      </div>

      {/* Kiosk Logs */}
      <div className="p-4 rounded-xl border border-white/10 bg-slate-800/30">
        <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary-400" />
          Log تفاعلات الكشك (آخر 10 عمليات)
        </h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {kioskStatus.logs.length > 0 ? (
            kioskStatus.logs.map((log, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg border ${log.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20' :
                  log.type === 'error' ? 'bg-red-500/10 border-red-500/20' :
                    'bg-amber-500/10 border-amber-500/20'
                  }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1">
                    <p className={`text-xs font-bold ${log.type === 'success' ? 'text-emerald-300' :
                      log.type === 'error' ? 'text-red-300' :
                        'text-amber-300'
                      }`}>
                      {log.message}
                    </p>
                    {log.details && (
                      <p className="text-[10px] text-slate-400 mt-1">{JSON.stringify(log.details)}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500">{log.time}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">لا توجد سجلات حالياً</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Support;
