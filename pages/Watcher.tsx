import React, { useDeferredValue, useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { db, getLocalISODate } from '../services/db';
import { dismissals } from '../services/dismissals';
import { auth } from '../services/auth';
import { Role, Student, AttendanceRecord, DailySummary } from '../types';
import { Users, Clock, AlertCircle, CheckCircle, RefreshCcw, Loader2, Search, Send, Check, Printer, Download, Monitor, X, ChevronsUpDown, ArrowUp, ArrowDown, MessageSquare, DoorOpen, Megaphone, QrCode, Wifi, WifiOff } from 'lucide-react';
import { FileService, ExportColumn } from '../services/fileService';
import { MiniKiosk } from '../components/MiniKiosk';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useSyncRefresh } from '../hooks/useSyncRefresh';
import { logError } from '../types/errors';
import { logger } from '../services/logger';
import { useToast } from '../components/Toast';
import { useAdminTheme } from '../hooks/useAdminTheme';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import {
  buildManualAttendanceSeed,
  buildWatcherDailyState,
  filterWatcherStudents,
  getWatcherStudentsForTab,
  type WatcherAttendanceTab
} from '../components/watcher/watcherDailyRules';

const QuickSendModal = lazyWithRetry(() => import('../components/whatsapp/QuickSendModal'));
const BarcodeStudio = lazyWithRetry(() =>
  import('../components/BarcodeStudio').then((module) => ({ default: module.BarcodeStudio }))
);

const Watcher: React.FC = () => {
  // 🎨 Unified Theme
  useAdminTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [realtimeToast, setRealtimeToast] = useState<{ name: string; status: string; time: number } | null>(null);
  const [activeTab, setActiveTab] = useState<WatcherAttendanceTab>('early');
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [dataError, setDataError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [viewDate, setViewDate] = useState(() => getLocalISODate());
  const toast = useToast();

  // Data State
  const [students, setStudents] = useState<Student[]>([]);
  const studentsRef = useRef<Student[]>([]); // Ref to access current students in callback

  useEffect(() => {
    studentsRef.current = students.filter(student => student.is_active !== false);
  }, [students]);

  const [logs, setLogs] = useState<AttendanceRecord[]>([]);

  // Report State
  const [reportExists, setReportExists] = useState(false);
  const [lastSharedAt, setLastSharedAt] = useState<string | null>(null);
  const [sharedStats, setSharedStats] = useState<{ total: number; present: number; late: number; absent: number } | null>(null);
  const [shareConfirmationOpen, setShareConfirmationOpen] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'print' | null>(null);

  // ═══════════════════════════════════════════════════════════════
  // 🖥️ Mini Kiosk State
  // ═══════════════════════════════════════════════════════════════
  const [miniKioskOpen, setMiniKioskOpen] = useState(false);
  const [miniKioskPosition, setMiniKioskPosition] = useState({ x: 50, y: 50 });
  const [miniKioskSize, setMiniKioskSize] = useState({ width: 400, height: 500 });


  // Mini Kiosk Logic State (same as main Kiosk)
  const [miniKioskInput, setMiniKioskInput] = useState('');
  const [miniKioskLoading, setMiniKioskLoading] = useState(false);
  const [miniKioskInitStatus, setMiniKioskInitStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [miniKioskResult, setMiniKioskResult] = useState<{
    type: 'success' | 'error';
    message: string;
    student?: { id: string; name: string; class_name: string; section: string };
    isLate?: boolean;
    mode?: 'present' | 'late' | 'duplicate' | 'not_found' | 'closed';
  } | null>(null);
  const [miniKioskRotation, setMiniKioskRotation] = useState<'none' | 'right' | 'left'>('none');
  const miniKioskInputRef = useRef<HTMLInputElement>(null);


  // Manual Attendance Modal State
  const [showManualAttendance, setShowManualAttendance] = useState(false);
  const [quickSendStudent, setQuickSendStudent] = useState<Student | null>(null);

  // 🏷️ Barcode Studio State
  const [showBarcodeStudio, setShowBarcodeStudio] = useState(false);
  const [barcodeSelectedIds, setBarcodeSelectedIds] = useState<Set<string>>(new Set());

  // 🚪 Dismissal Call Request State
  const [showDismissalCallModal, setShowDismissalCallModal] = useState(false);
  const [dismissalCallSearch, setDismissalCallSearch] = useState('');
  const [sendingCall, setSendingCall] = useState(false);
  const fetchSeqRef = useRef(0);
  const realtimeToastTimerRef = useRef<number | null>(null);

  const dailyState = useMemo(() => buildWatcherDailyState({
    students,
    logs,
    date: viewDate
  }), [students, logs, viewDate]);
  const {
    activeStudents,
    attendanceByStudent,
    present: presentList,
    late: lateList,
    absent: absentList
  } = dailyState;
  const currentList = useMemo(() => filterWatcherStudents(
    getWatcherStudentsForTab(dailyState, activeTab),
    deferredSearchTerm
  ), [dailyState, activeTab, deferredSearchTerm]);
  const dismissalCallStudents = useMemo(
    () => filterWatcherStudents(activeStudents, dismissalCallSearch).slice(0, 50),
    [activeStudents, dismissalCallSearch]
  );
  const reportNeedsUpdate = reportExists && (!sharedStats
    || sharedStats.total !== activeStudents.length
    || sharedStats.present !== presentList.length
    || sharedStats.late !== lateList.length
    || sharedStats.absent !== absentList.length);

  useEffect(() => {
    // 1. Role Check
    auth.requireRole([Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS]);

    // 2. Initial Fetch
    void fetchDailyData();

    // 3. Realtime Subscription
    const sub = db.subscribeToAttendance((newRecord) => {
      if (newRecord.date !== getLocalISODate()) return;
      setLogs(prevLogs => {
        const keyMatch = (l: AttendanceRecord) =>
          l.student_id === newRecord.student_id && l.date === newRecord.date;
        const idx = prevLogs.findIndex(keyMatch);

        // Trigger Toast for Realtime Update
        const student = studentsRef.current.find(s => s.id === newRecord.student_id);
        if (student) {
          const toastTime = Date.now();
          setRealtimeToast({ name: student.name, status: newRecord.status, time: toastTime });
          if (realtimeToastTimerRef.current) window.clearTimeout(realtimeToastTimerRef.current);
          realtimeToastTimerRef.current = window.setTimeout(
            () => setRealtimeToast(prev => prev && prev.time === toastTime ? null : prev),
            4000
          );
        }

        if (idx === -1) return [...prevLogs, newRecord];
        const next = [...prevLogs];
        next[idx] = { ...prevLogs[idx], ...newRecord };
        return next;
      });
    });

    return () => {
      sub.unsubscribe();
      fetchSeqRef.current += 1;
      if (realtimeToastTimerRef.current) window.clearTimeout(realtimeToastTimerRef.current);
    };
  }, []);

  useLiveUpdates(() => {
    logger.debug('Watcher', 'Real-time update detected, Refreshing data...');
    void fetchDailyData(true);
  });

  useSyncRefresh(() => {
    void fetchDailyData(true);
  });

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (shareConfirmationOpen && !submitting) setShareConfirmationOpen(false);
      else if (showDismissalCallModal && !sendingCall) {
        setShowDismissalCallModal(false);
        setDismissalCallSearch('');
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sendingCall, shareConfirmationOpen, showDismissalCallModal, submitting]);

  const fetchDailyData = async (silent = false) => {
    const seq = ++fetchSeqRef.current;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setDataError('');
    try {
      // Use shared local date helper to match DB
      const today = getLocalISODate();

      const [allStudents, todaysLogs, existingSummary] = await Promise.all([
        db.getStudents(),
        db.getAttendance(today),
        db.getDailySummary(today)
      ]);

      // Ignore stale responses when a newer fetch already started.
      if (seq !== fetchSeqRef.current) return;

      setViewDate(today);
      setStudents(allStudents);
      setLogs(todaysLogs);
      setReportExists(Boolean(existingSummary));
      setLastSharedAt(existingSummary?.summary_data?.shared_at ?? null);
      setSharedStats(existingSummary?.summary_data?.stats ?? null);
      setLastUpdatedAt(new Date());

    } catch (error) {
      logError(error, 'Watcher - Fetch Daily Data');
      if (seq === fetchSeqRef.current) {
        setDataError('تعذر تحديث بيانات الحضور. تحقق من الاتصال ثم أعد المحاولة.');
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const handleShareReport = async () => {
    setShareConfirmationOpen(false);
    setSubmitting(true);
    try {
        const user = auth.getSession();
        const today = getLocalISODate();
        const now = new Date().toISOString();

        // 1. Build Snapshot JSON
        const summary: DailySummary = {
          date: today,
          summary_data: {
            stats: {
              total: activeStudents.length,
              present: presentList.length,
              late: lateList.length,
              absent: absentList.length
            },
            details: {
              present: presentList.map(s => ({ id: s.id, name: s.name })),
              late: lateList.map(s => ({ id: s.id, name: s.name })),
              absent: absentList.map(s => ({ id: s.id, name: s.name }))
            },
            shared_by: user?.username || 'Unknown',
            shared_at: now
          }
        };

        // 2. Save to Supabase
        await db.saveDailySummary(summary);

        // 3. Update UI State
        setReportExists(true);
        setLastSharedAt(now);
        setSharedStats(summary.summary_data.stats);

        // Success Feedback
        toast.success('تم اعتماد السجلات وإرسالها للإشراف بنجاح');
    } catch (error) {
      toast.error('حدث خطأ أثناء إرسال التقرير');
      logError(error, 'Watcher - Share Report');
    } finally {
      setSubmitting(false);
    }
  };

  const currentStatusLabel = activeTab === 'early' ? 'الحضور' : activeTab === 'late' ? 'التأخر' : 'الغياب';

  const exportColumns: ExportColumn[] = [
    { header: 'المعرف', key: 'id' },
    { header: 'اسم الطالب', key: 'name' },
    { header: 'الصف', key: 'class_name' },
    { header: 'الفصل', key: 'section' },
    { header: 'وقت التسجيل', key: 'time' },
    { header: 'الحالة', key: 'status' }
  ];

  const buildExportRows = () => {
    return currentList.map((student) => {
      const log = attendanceByStudent.get(student.id);
      return {
        id: student.id,
        name: student.name,
        class_name: student.class_name,
        section: student.section,
        time: log ? new Date(log.timestamp).toLocaleTimeString('ar-SA') : '-',
        status: currentStatusLabel
      };
    });
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    try {
      setExporting(format);
      const rows = buildExportRows();
      const filename = `قائمة_${currentStatusLabel}_${getLocalISODate()}`;
      if (rows.length === 0) {
        toast.warning('لا توجد بيانات لتصديرها');
        return;
      }
      if (format === 'xlsx') {
        await FileService.exportToXLSX(rows, filename);
      } else {
        await FileService.exportToCSV(rows, filename);
      }
      toast.success('تم التصدير بنجاح');
    } catch (error) {
      logError(error, `Watcher - Export ${format.toUpperCase()}`);
      toast.error('تعذر تصدير القائمة. حاول مرة أخرى.');
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = () => {
    const rows = buildExportRows();
    if (rows.length === 0) {
      toast.warning('لا توجد بيانات للطباعة');
      return;
    }
    try {
      setExporting('print');
      const filename = `قائمة_${currentStatusLabel}_${getLocalISODate()}`;
      FileService.exportToPDF(exportColumns, rows, filename, `قائمة ${currentStatusLabel}`);
    } catch (error) {
      logError(error, 'Watcher - Print');
      toast.error('تعذر فتح نافذة الطباعة.');
    } finally {
      setExporting(null);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // 🖥️ Mini Kiosk - Initialize (same logic as main Kiosk)
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (miniKioskOpen) {
      let cancelled = false;
      const initMiniKiosk = async () => {
        setMiniKioskInitStatus('loading');
        try {
          const res = await db.preloadForKiosk();
          if (cancelled) return;
          if (res.ok) {
            setMiniKioskInitStatus('ready');
            // Auto-focus input when ready
            setTimeout(() => miniKioskInputRef.current?.focus(), 100);
          } else {
            setMiniKioskInitStatus('error');
          }
        } catch (error) {
          if (cancelled) return;
          logError(error, 'Watcher - Mini Kiosk Init');
          setMiniKioskInitStatus('error');
        }
      };
      void initMiniKiosk();
      return () => { cancelled = true; };
    }
  }, [miniKioskOpen]);

  // ═══════════════════════════════════════════════════════════════
  // 🖥️ Mini Kiosk - Handle Submit (same logic as main Kiosk)
  // ═══════════════════════════════════════════════════════════════
  const handleMiniKioskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const barcode = miniKioskInput.trim();
    if (!barcode || miniKioskLoading || miniKioskInitStatus !== 'ready') return;

    setMiniKioskLoading(true);
    try {
      const result = await db.markAttendanceFast(barcode);

      if (result.ok && result.student) {
        setMiniKioskResult({
          type: 'success',
          message: result.message,
          student: {
            id: result.student.id,
            name: result.student.name,
            class_name: result.student.class_name,
            section: result.student.section
          },
          isLate: result.status === 'late',
          mode: result.code
        });
      } else {
        setMiniKioskResult({
          type: 'error',
          message: result.message
        });
      }

      setMiniKioskInput('');

      // ═══════════════════════════════════════════════════════════════
      // 🔄 Real-time Sync: Refresh Watcher data immediately (silent mode)
      // ═══════════════════════════════════════════════════════════════
      if (result.ok && result.student) {
        // Trigger immediate silent data refresh for Watcher (no loading spinner)
        void fetchDailyData(true);
      }

      // Auto-dismiss result and show input card again after delay
      setTimeout(() => {
        setMiniKioskResult(null);
        // Refocus input after showing card
        setTimeout(() => miniKioskInputRef.current?.focus(), 100);
      }, 4000);
    } catch (error) {
      logError(error, 'Watcher - Mini Kiosk Attendance');
      setMiniKioskResult({
        type: 'error',
        message: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.'
      });
      setMiniKioskInput('');
      setTimeout(() => setMiniKioskResult(null), 3000);
    } finally {
      setMiniKioskLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // 🖥️ Mini Kiosk - Rotation Handler (delegated to MiniKiosk component)
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-12 sm:space-y-8">
      {/* Header */}
      <section className="glass-card rounded-3xl p-4 sm:p-6" aria-labelledby="watcher-title">
        <div className="flex flex-col items-start justify-between gap-5 xl:flex-row">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 id="watcher-title" className="text-2xl font-bold font-serif text-white sm:text-3xl">
            المراقبة اليومية
          </h2>
          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${dataError ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'}`}>
            {dataError ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
            {dataError ? 'تعذر التحديث' : refreshing ? 'جارٍ التحديث' : 'متابعة مباشرة'}
          </span>
          {(loading || refreshing) && <Loader2 className="h-4 w-4 animate-spin text-primary-400" aria-label="جارٍ تحديث البيانات" />}
          </div>
          <p className="text-gray-400 text-sm">متابعة الحضور المباشر واعتماد التقرير للإشراف</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{new Date(`${viewDate}T00:00:00`).toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            {lastUpdatedAt && <span>آخر تحديث: {lastUpdatedAt.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>}
            {lastSharedAt && (
              <span className={reportNeedsUpdate ? 'text-amber-300' : 'text-emerald-400'}>
                {reportNeedsUpdate ? 'التقرير المرسل يحتاج تحديثًا' : `أُرسل للإشراف ${new Date(lastSharedAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}`}
              </span>
            )}
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-wrap gap-2 xl:w-auto xl:justify-end">
          {/* Manual Attendance Toggle Button */}
          <button
            onClick={() => setShowManualAttendance(true)}
            disabled={activeStudents.length === 0 || loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-white transition-all hover:bg-white/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            title="التحضير اليدوي السريع"
          >
            <Users className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-medium">تحضير يدوي</span>
          </button>

          {/* Mini Kiosk Toggle Button */}
          <button
            onClick={() => setMiniKioskOpen(!miniKioskOpen)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2 backdrop-blur-md transition-all sm:flex-none ${miniKioskOpen
              ? 'bg-primary-500/20 border-primary-500/40 text-primary-300'
              : 'bg-white/5 border-white/10 text-white hover:bg-white/10'
              }`}
            title={miniKioskOpen ? 'إغلاق الميني-كشك' : 'فتح الميني-كشك'}
          >
            <Monitor className="w-4 h-4" />
            <span className="text-sm font-medium">ميني-كشك</span>
          </button>

          {/* Dismissal Call Button */}
          <button
            onClick={() => { setDismissalCallSearch(''); setShowDismissalCallModal(true); }}
            disabled={activeStudents.length === 0 || loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-300 transition-all hover:bg-amber-500/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            title="طلب نداء انصراف"
          >
            <DoorOpen className="w-4 h-4" />
            <span className="text-sm font-medium">طلب نداء</span>
          </button>

          {/* Barcode Studio Button */}
          <button
            onClick={() => {
              setBarcodeSelectedIds(new Set(activeStudents.map(s => s.id)));
              setShowBarcodeStudio(true);
            }}
            disabled={activeStudents.length === 0 || loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-secondary-500/30 bg-secondary-500/10 px-4 py-2 text-secondary-300 transition-all hover:bg-secondary-500/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
            title="استوديو الباركود"
          >
            <QrCode className="w-4 h-4" />
            <span className="text-sm font-medium">الباركود</span>
          </button>

          <button
            onClick={() => void fetchDailyData(true)}
            disabled={loading || refreshing}
            className="group rounded-xl border border-white/10 bg-white/5 p-3 transition-colors hover:bg-white/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            title="تحديث البيانات من السيرفر"
            aria-label="تحديث بيانات الحضور"
          >
            <RefreshCcw className={`w-5 h-5 text-gray-300 group-hover:rotate-180 transition-transform duration-700 ${loading || refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShareConfirmationOpen(true)}
            disabled={submitting || loading || activeStudents.length === 0}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-bold shadow-lg transition-all sm:flex-none md:px-6 ${reportExists
              ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/30'
              : 'bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white shadow-primary-500/20'
              }`}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (
              reportExists ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />
            )}
            {reportExists ? (reportNeedsUpdate ? 'تحديث التقرير' : 'إعادة إرسال التقرير') : 'مشاركة مع الإشراف'}
          </button>
        </div>
        </div>
        {dataError && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>{dataError}</span>
            <button onClick={() => void fetchDailyData()} className="rounded-lg bg-red-500/15 px-3 py-1.5 font-semibold text-red-100 transition hover:bg-red-500/25">إعادة المحاولة</button>
          </div>
        )}
      </section>

      {/* KPI Cards - Enhanced */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5" aria-label="ملخص حضور اليوم">
        <div className="group glass-card flex h-28 flex-col justify-between rounded-2xl border border-secondary-500/40 p-4 transition-all duration-300 hover:border-secondary-500/70 sm:h-36 sm:p-6">
          <div className="flex justify-between items-start">
            <div className="text-gray-300 text-sm font-bold tracking-wide">إجمالي الطلاب</div>
            <div className="p-2.5 bg-secondary-500/20 rounded-xl group-hover:bg-secondary-500/30 transition-colors"><Users className="w-6 h-6 text-secondary-400 drop-shadow-[0_0_10px_rgb(var(--color-secondary-400)_/_0.5)]" /></div>
          </div>
          <div className="text-3xl font-black tabular-nums text-secondary-300 sm:text-5xl">{loading ? <span className="block h-9 w-14 animate-pulse rounded-lg bg-white/10 sm:h-12" /> : activeStudents.length}</div>
        </div>

        <div className="group glass-card flex h-28 flex-col justify-between rounded-2xl border border-emerald-500/40 p-4 transition-all duration-300 hover:border-emerald-500/70 sm:h-36 sm:p-6">
          <div className="flex justify-between items-start">
            <div className="text-gray-300 text-sm font-bold tracking-wide">حضور مبكر</div>
            <div className="p-2.5 bg-emerald-500/20 rounded-xl group-hover:bg-emerald-500/30 transition-colors"><CheckCircle className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" /></div>
          </div>
          <div className="text-3xl font-black tabular-nums text-emerald-300 sm:text-5xl">{loading ? <span className="block h-9 w-14 animate-pulse rounded-lg bg-white/10 sm:h-12" /> : presentList.length}</div>
        </div>

        <div className="group glass-card flex h-28 flex-col justify-between rounded-2xl border border-amber-500/40 p-4 transition-all duration-300 hover:border-amber-500/70 sm:h-36 sm:p-6">
          <div className="flex justify-between items-start">
            <div className="text-gray-300 text-sm font-bold tracking-wide">تأخر</div>
            <div className="p-2.5 bg-amber-500/20 rounded-xl group-hover:bg-amber-500/30 transition-colors"><Clock className="w-6 h-6 text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.5)]" /></div>
          </div>
          <div className="text-3xl font-black tabular-nums text-amber-300 sm:text-5xl">{loading ? <span className="block h-9 w-14 animate-pulse rounded-lg bg-white/10 sm:h-12" /> : lateList.length}</div>
        </div>

        <div className="group glass-card flex h-28 flex-col justify-between rounded-2xl border border-red-500/40 p-4 transition-all duration-300 hover:border-red-500/70 sm:h-36 sm:p-6">
          <div className="flex justify-between items-start">
            <div className="text-gray-300 text-sm font-bold tracking-wide">غائب</div>
            <div className="p-2.5 bg-red-500/20 rounded-xl group-hover:bg-red-500/30 transition-colors"><AlertCircle className="w-6 h-6 text-red-400 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]" /></div>
          </div>
          <div className="text-3xl font-black tabular-nums text-red-300 sm:text-5xl">{loading ? <span className="block h-9 w-14 animate-pulse rounded-lg bg-white/10 sm:h-12" /> : absentList.length}</div>
        </div>
      </div>

      {/* Lists Section */}
      <section className="glass-card flex min-h-[520px] flex-col overflow-hidden rounded-3xl border border-white/10" aria-label="قوائم حضور اليوم">
        {/* Tabs & Search - Enhanced */}
        <div className="bg-gradient-to-br from-black/30 to-black/10 p-5 border-b border-white/10 flex flex-col lg:flex-row justify-between gap-4">
          <div className="grid w-full grid-cols-3 rounded-xl border border-white/5 bg-black/50 p-1.5 backdrop-blur-sm lg:w-auto">
            <button
              onClick={() => setActiveTab('early')}
              aria-pressed={activeTab === 'early'}
              className={`rounded-xl px-2 py-3 text-xs font-bold transition-all duration-300 sm:px-6 sm:text-sm ${activeTab === 'early' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                <span>مبكر ({presentList.length})</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('late')}
              aria-pressed={activeTab === 'late'}
              className={`rounded-xl px-2 py-3 text-xs font-bold transition-all duration-300 sm:px-6 sm:text-sm ${activeTab === 'late' ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
            >
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>متأخر ({lateList.length})</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('absent')}
              aria-pressed={activeTab === 'absent'}
              className={`rounded-xl px-2 py-3 text-xs font-bold transition-all duration-300 sm:px-6 sm:text-sm ${activeTab === 'absent' ? 'bg-red-600 text-white shadow-lg shadow-red-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>غائب ({absentList.length})</span>
              </div>
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-3 w-full lg:w-auto">
            <div className="relative w-full md:w-72 group">
              <Search className="absolute right-3 top-3 w-4 h-4 text-gray-500 group-focus-within:text-primary-400 transition-colors" />
              <input
                type="text"
                placeholder="بحث بالاسم أو المعرّف أو الصف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="بحث في قائمة الطلاب الحالية"
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pr-10 pl-4 text-sm text-white focus:outline-none focus:border-primary-500/50 focus:bg-white/10 transition-all"
              />
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => handleExport('xlsx')}
                disabled={exporting !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/15 text-sky-200 text-sm border border-sky-500/30 hover:bg-sky-500/25 transition disabled:opacity-50"
              >
                {exporting === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="w-4 h-4" />} XLSX
              </button>
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary-500/15 text-secondary-300 text-sm border border-secondary-500/30 hover:bg-secondary-500/25 transition disabled:opacity-50"
              >
                {exporting === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="w-4 h-4" />} CSV
              </button>
              <button
                onClick={handlePrint}
                disabled={exporting !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white text-sm border border-white/20 hover:bg-white/20 transition"
              >
                {exporting === 'print' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="w-4 h-4" />} طباعة
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Card View (md:hidden) */}
        <div className="md:hidden space-y-4 p-4">
          {loading ? (
            Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-2xl border border-white/5 bg-white/5" />
            ))
          ) : currentList.length === 0 ? (
            <div className="text-center p-8 text-gray-500 bg-white/5 rounded-2xl border border-white/5">
              <Search className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="font-semibold text-gray-300">{searchTerm ? 'لا توجد نتائج مطابقة' : `لا يوجد طلاب في قائمة ${currentStatusLabel}`}</p>
              {searchTerm && <button onClick={() => setSearchTerm('')} className="mt-3 text-sm text-primary-300 hover:text-primary-200">مسح البحث</button>}
            </div>
          ) : (
            currentList.map((student) => {
              const log = attendanceByStudent.get(student.id);
              return (
                <article key={student.id} className="glass-card relative overflow-hidden rounded-2xl border border-white/10 p-4 animate-fade-in-up">
                  <div className="flex justify-between items-start mb-3 relative z-10">
                    <div>
                      <h3 className="font-bold text-lg text-white mb-0.5">{student.name}</h3>
                      <p className="text-xs text-primary-200 font-medium">{student.class_name} - {student.section}</p>
                    </div>
                    {/* Status Badge */}
                    <div>
                      {activeTab === 'early' && <span className="inline-flex items-center justify-center bg-emerald-500/20 text-emerald-300 p-2 rounded-xl border border-emerald-500/30 shadow-lg shadow-emerald-500/10"><CheckCircle className="w-5 h-5" /></span>}
                      {activeTab === 'late' && <span className="inline-flex items-center justify-center bg-amber-500/20 text-amber-300 p-2 rounded-xl border border-amber-500/30 shadow-lg shadow-amber-500/10"><Clock className="w-5 h-5" /></span>}
                      {activeTab === 'absent' && <span className="inline-flex items-center justify-center bg-red-500/20 text-red-300 p-2 rounded-xl border border-red-500/30 shadow-lg shadow-red-500/10"><AlertCircle className="w-5 h-5" /></span>}
                    </div>
                  </div>

                  <div className="flex justify-between items-end relative z-10 border-t border-white/5 pt-3 mt-1">
                    <div>
                      <div className="text-[10px] text-gray-500 font-mono mb-1">ID: {student.id}</div>
                      {activeTab !== 'absent' && (
                        <div className="text-xs text-gray-400">
                          <span className="opacity-60">وقت التسجيل: </span>
                          <span className="font-mono font-bold text-primary-300">{log ? new Date(log.timestamp).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setQuickSendStudent(student)}
                      className="p-2.5 rounded-xl bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500 hover:text-white transition-all shadow-[0_0_10px_rgba(34,197,94,0.1)] active:scale-95"
                      aria-label={`إرسال رسالة لولي أمر ${student.name}`}
                    >
                      <MessageSquare className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Background decoration */}
                  <div className="absolute top-0 left-0 w-20 h-20 bg-gradient-to-br from-white/5 to-transparent rounded-br-full -translate-x-10 -translate-y-10" />
                </article>
              );
            })
          )}
        </div>

        {/* Desktop Table View (hidden on mobile) */}
        <div className="hidden md:block overflow-x-auto flex-1 bg-gradient-to-b from-white/5 to-transparent">
          <table className="w-full text-right">
            <thead className="text-sm text-gray-300 bg-gradient-to-r from-white/10 via-white/5 to-white/10 border-b-2 border-primary-500/30 font-bold uppercase tracking-wider">
              <tr>
                <th className="p-6">المعرف</th>
                <th className="p-6">اسم الطالب</th>
                <th className="p-6">الصف</th>
                <th className="p-6">الفصل</th>
                {activeTab !== 'absent' && <th className="p-6">وقت التسجيل</th>}
                <th className="p-6">الحالة</th>
                <th className="p-6">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index} className="animate-pulse">
                  <td colSpan={activeTab === 'absent' ? 6 : 7} className="p-4"><div className="h-10 rounded-xl bg-white/5" /></td>
                </tr>
              )) : currentList.map((student) => {
                const log = attendanceByStudent.get(student.id);
                return (
                  <tr key={student.id} className="group animate-fade-in transition-colors duration-200 hover:bg-white/10">
                    <td className="p-6 font-mono text-primary-400 text-base font-semibold opacity-90 group-hover:opacity-100">{student.id}</td>
                    <td className="p-6 font-bold text-white font-serif text-lg group-hover:text-primary-300 transition-colors">{student.name}</td>
                    <td className="p-6 text-gray-300 text-base font-medium">{student.class_name}</td>
                    <td className="p-6 text-gray-300 text-base font-medium">{student.section}</td>
                    {activeTab !== 'absent' && (
                      <td className="p-6 font-mono text-base text-gray-400 group-hover:text-primary-300 transition-colors font-semibold">
                        {log ? new Date(log.timestamp).toLocaleTimeString('ar-SA') : '-'}
                      </td>
                    )}
                    <td className="p-6">
                      {activeTab === 'early' && <span className="inline-flex items-center gap-1.5 text-sm bg-emerald-500/20 text-emerald-300 px-3 py-1.5 rounded-lg border border-emerald-500/30 font-semibold"><CheckCircle className="w-3.5 h-3.5" />حاضر</span>}
                      {activeTab === 'late' && <span className="inline-flex items-center gap-1.5 text-sm bg-amber-500/20 text-amber-300 px-3 py-1.5 rounded-lg border border-amber-500/30 font-semibold"><Clock className="w-3.5 h-3.5" />متأخر</span>}
                      {activeTab === 'absent' && <span className="inline-flex items-center gap-1.5 text-sm bg-red-500/20 text-red-300 px-3 py-1.5 rounded-lg border border-red-500/30 font-semibold"><AlertCircle className="w-3.5 h-3.5" />غائب</span>}
                    </td>
                    <td className="p-6">
                      <button
                        onClick={() => setQuickSendStudent(student)}
                        className="p-2 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500 hover:text-white transition-all shadow-[0_0_10px_rgba(34,197,94,0.1)] hover:shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                        title="إرسال رسالة واتساب"
                        aria-label={`إرسال رسالة لولي أمر ${student.name}`}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && currentList.length === 0 && (
                <tr>
                  <td colSpan={activeTab === 'absent' ? 6 : 7} className="p-16 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                        <Search className="w-8 h-8 text-gray-600" />
                      </div>
                      <span>{searchTerm ? 'لا توجد نتائج مطابقة للبحث' : `لا يوجد طلاب في قائمة ${currentStatusLabel}`}</span>
                      {searchTerm && <button onClick={() => setSearchTerm('')} className="text-sm text-primary-300 hover:text-primary-200">مسح البحث</button>}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {shareConfirmationOpen && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShareConfirmationOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-report-title"
        >
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 text-right shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <button onClick={() => setShareConfirmationOpen(false)} className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white" aria-label="إغلاق تأكيد التقرير">
                <X className="h-5 w-5" />
              </button>
              <div>
                <h3 id="share-report-title" className="text-xl font-bold text-white">{reportExists ? 'تحديث التقرير اليومي' : 'اعتماد التقرير اليومي'}</h3>
                <p className="mt-1 text-sm leading-6 text-gray-400">سيُحفظ ملخص ثابت للحالات الحالية ويصبح متاحًا لبوابة الإشراف.</p>
              </div>
            </div>
            <div className="mb-6 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-200"><strong className="block text-xl tabular-nums">{presentList.length}</strong>حاضر</div>
              <div className="rounded-xl bg-amber-500/10 p-3 text-amber-200"><strong className="block text-xl tabular-nums">{lateList.length}</strong>متأخر</div>
              <div className="rounded-xl bg-red-500/10 p-3 text-red-200"><strong className="block text-xl tabular-nums">{absentList.length}</strong>غائب</div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShareConfirmationOpen(false)} className="flex-1 rounded-xl px-4 py-2.5 text-gray-300 transition hover:bg-white/10">إلغاء</button>
              <button onClick={() => void handleShareReport()} className="flex-1 rounded-xl bg-primary-600 px-4 py-2.5 font-bold text-white transition hover:bg-primary-500 active:scale-[0.98]">{reportExists ? 'تحديث وإرسال' : 'اعتماد وإرسال'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {quickSendStudent && (
        <React.Suspense fallback={null}>
          <QuickSendModal
            isOpen={!!quickSendStudent}
            onClose={() => setQuickSendStudent(null)}
            student={quickSendStudent}
            defaultTemplateId={activeTab === 'late' ? 'late_warning' : activeTab === 'absent' ? 'absent_warning' : 'custom'}
          />
        </React.Suspense>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          🖥️ Mini Kiosk - Floating Panel
          ═══════════════════════════════════════════════════════════════ */}
      <MiniKiosk
        isOpen={miniKioskOpen}
        onClose={() => setMiniKioskOpen(false)}
        position={miniKioskPosition}
        size={miniKioskSize}
        onPositionChange={setMiniKioskPosition}
        onSizeChange={setMiniKioskSize}
        rotation={miniKioskRotation}
        onRotationChange={setMiniKioskRotation}
        input={miniKioskInput}
        onInputChange={setMiniKioskInput}
        onSubmit={handleMiniKioskSubmit}
        loading={miniKioskLoading}
        initStatus={miniKioskInitStatus}
        result={miniKioskResult}
        inputRef={miniKioskInputRef}
      />
      {/* ═══════════════════════════════════════════════════════════════
          📋 Manual Attendance Modal
          ═══════════════════════════════════════════════════════════════ */}
      {showManualAttendance && (
        <ManualAttendanceModal
          isOpen={showManualAttendance}
          onClose={() => setShowManualAttendance(false)}
          students={activeStudents}
          attendanceByStudent={attendanceByStudent}
          onSuccess={() => {
            fetchDailyData();
            setShowManualAttendance(false);
          }}
        />
      )}
      {/* Realtime Toast Notification */}
      {realtimeToast && (
        <div className="fixed bottom-6 left-6 z-50 animate-slide-in-left">
          <div className={`
             flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border backdrop-blur-xl
             ${realtimeToast.status === 'late'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-100'
              : realtimeToast.status === 'absent'
                ? 'bg-red-500/10 border-red-500/30 text-red-100'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100'
            }
           `}>
            <div className={`p-2 rounded-full ${realtimeToast.status === 'late' ? 'bg-amber-500/20 text-amber-300' : realtimeToast.status === 'absent' ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
              {realtimeToast.status === 'late' ? <Clock className="w-5 h-5" /> : realtimeToast.status === 'absent' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
            </div>
            <div>
              <p className="font-bold text-sm tracking-wide">تسجيل جديد</p>
              <p className="text-lg font-serif">{realtimeToast.name}</p>
            </div>
            <button onClick={() => setRealtimeToast(null)} className="mr-4 opacity-50 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 🚪 Dismissal Call Modal */}
      {showDismissalCallModal && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm animate-fade-in sm:p-4" onClick={() => { if (!sendingCall) { setShowDismissalCallModal(false); setDismissalCallSearch(''); } }} role="dialog" aria-modal="true" aria-labelledby="dismissal-call-title">
          <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-3xl border border-white/10 bg-[#1e293b] p-5 shadow-2xl sm:max-h-[80dvh] sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 id="dismissal-call-title" className="text-xl font-bold text-white flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 rounded-xl">
                  <Megaphone className="w-5 h-5 text-amber-400" />
                </div>
                طلب نداء انصراف
              </h3>
              <button onClick={() => { setShowDismissalCallModal(false); setDismissalCallSearch(''); }} disabled={sendingCall} className="p-2 rounded-xl hover:bg-white/10 transition text-gray-400 disabled:opacity-40" aria-label="إغلاق طلب النداء">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative mb-4">
              <Search className="absolute right-3 top-3 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="بحث باسم الطالب..."
                value={dismissalCallSearch}
                onChange={(e) => setDismissalCallSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pr-10 pl-4 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-all"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {dismissalCallStudents.map((student) => (
                  <button
                    key={student.id}
                    onClick={async () => {
                      setSendingCall(true);
                      try {
                        const user = auth.getSession();
                        const result = await dismissals.execute({
                          type: 'request-call',
                          student,
                          requester: {
                            id: user?.id || 'watcher',
                            name: user?.username || 'المراقب'
                          }
                        });
                        toast.success(result.outcome === 'already-requested'
                          ? `يوجد طلب نداء نشط للطالب ${student.name}`
                          : `تم إرسال طلب نداء للطالب ${student.name}`);
                        setShowDismissalCallModal(false);
                        setDismissalCallSearch('');
                      } catch (err) {
                        logError(err, 'Watcher - Send Dismissal Call');
                        toast.error('حدث خطأ أثناء إرسال طلب النداء');
                      } finally {
                        setSendingCall(false);
                      }
                    }}
                    disabled={sendingCall}
                    className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-amber-500/10 transition-all text-right group"
                  >
                    <div>
                      <h4 className="font-bold text-white group-hover:text-amber-200 transition-colors">{student.name}</h4>
                      <p className="text-xs text-gray-400">{student.class_name} - {student.section}</p>
                    </div>
                    <DoorOpen className="w-5 h-5 text-gray-500 group-hover:text-amber-400 transition-colors" />
                  </button>
                ))}
              {dismissalCallStudents.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-gray-400">
                  <Search className="mx-auto mb-3 h-8 w-8 text-gray-600" />
                  {dismissalCallSearch ? 'لا يوجد طالب مطابق للبحث.' : 'لا يوجد طلاب نشطون لطلب النداء.'}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 🏷️ Barcode Studio Modal */}
      {showBarcodeStudio && (
        <React.Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 text-white">جاري تحميل استوديو الباركود...</div>}>
          <BarcodeStudio
            students={activeStudents}
            selectedIds={barcodeSelectedIds}
            onClose={() => setShowBarcodeStudio(false)}
          />
        </React.Suspense>
      )}
    </div>
  );
};

// =============================================================================
// Helper Component: Manual Attendance Modal
// =============================================================================

interface ManualAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  attendanceByStudent: ReadonlyMap<string, AttendanceRecord>;
  onSuccess: () => void;
}

const ManualAttendanceModal: React.FC<ManualAttendanceModalProps> = ({ isOpen, onClose, students, attendanceByStudent, onSuccess }) => {
  const toast = useToast();
  // Status: 'present' (default), 'absent', 'late'
  const [statusMap, setStatusMap] = useState<Record<string, 'present' | 'absent' | 'late'>>(
    () => buildManualAttendanceSeed({ students, attendanceByStudent }).statusMap
  );
  const [lateTimes, setLateTimes] = useState<Record<string, string>>(
    () => buildManualAttendanceSeed({ students, attendanceByStudent }).lateTimes
  );

  // Time Picker State
  const [activeTimePickerId, setActiveTimePickerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || submitting) return;
      if (confirmationOpen) setConfirmationOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [confirmationOpen, isOpen, onClose, submitting]);

  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: 'name' | 'class_name' | 'section'; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' });

  // Filter students based on search and sort
  const filteredStudents = useMemo(() => {
    const result = filterWatcherStudents(students, search);

    result.sort((a, b) => {
      let valA = a[sortConfig.key] || '';
      let valB = b[sortConfig.key] || '';

      // Secondary sort by name if sorting by class or section
      if (valA === valB && sortConfig.key !== 'name') {
        valA = a.name;
        valB = b.name;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [students, search, sortConfig]);

  const toggleSort = (key: 'name' | 'class_name' | 'section') => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return <ChevronsUpDown className="w-3 h-3 text-gray-600" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-primary-400" /> : <ArrowDown className="w-3 h-3 text-primary-400" />;
  };

  const setStatus = (id: string, status: 'present' | 'absent' | 'late') => {
    setStatusMap(prev => ({ ...prev, [id]: status }));
    if (status === 'late' && !lateTimes[id]) {
      // Default to current time or 07:45 if not set
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      setLateTimes(prev => ({ ...prev, [id]: timeStr }));
      // Open time picker automatically when Late is selected
      setActiveTimePickerId(id);
    }
  };

  const handleTimeChange = (id: string, newTime: string) => {
    setLateTimes(prev => ({ ...prev, [id]: newTime }));
  };

  const toggleSelectAllAbsence = () => {
    if (filteredStudents.length === 0) return;
    const allAbsent = filteredStudents.every(s => statusMap[s.id] === 'absent');
    const newMap = { ...statusMap };
    filteredStudents.forEach(s => {
      newMap[s.id] = allAbsent ? 'present' : 'absent';
    });
    setStatusMap(newMap);
  };

  const getStatus = (id: string) => statusMap[id] || 'absent';

  const handleSubmit = async (confirmed = false) => {
    if (students.length === 0) {
      toast.warning('لا يوجد طلاب لحفظ التحضير.');
      return;
    }
    // Calculate counts
    let absentCount = 0;
    let lateCount = 0;
    let presentCount = 0;

    const absentIds: string[] = [];
    const presentIds: string[] = [];
    const lateByTime: Record<string, string[]> = {}; // time -> student_ids[]

    students.forEach(s => {
      const status = statusMap[s.id] || 'absent';
      if (status === 'absent') {
        absentCount++;
        absentIds.push(s.id);
      } else if (status === 'late') {
        lateCount++;
        const time = lateTimes[s.id] || '07:45';
        if (!lateByTime[time]) lateByTime[time] = [];
        lateByTime[time].push(s.id);
      } else {
        presentCount++;
        presentIds.push(s.id);
      }
    });

    if (!confirmed) {
      setConfirmationOpen(true);
      return;
    }

    setConfirmationOpen(false);
    setSubmitting(true);
    try {
      const today = getLocalISODate();

      const operations: Promise<unknown>[] = [];
      if (absentIds.length > 0) {
        operations.push(db.bulkMarkAbsent({
          student_ids: absentIds,
          date: today
        }));
      }

      for (const [time, ids] of Object.entries(lateByTime)) {
        operations.push(db.bulkMarkLate({
          student_ids: ids,
          date: today,
          time: time
        }));
      }

      if (presentIds.length > 0) {
        operations.push(db.updateAttendanceStatus({
          student_ids: presentIds,
          date: today,
          new_status: 'present'
        }));
      }
      await Promise.all(operations);

      onSuccess();
      toast.success('تم تحديث التحضير بنجاح');
    } catch (error) {
      logError(error, 'Watcher - Manual Attendance Save');
      toast.error('حدث خطأ أثناء الحفظ');
    } finally {
      setSubmitting(false);
    }
  };

  // Counts for toolbar
  const currentAbsent = Object.values(statusMap).filter(s => s === 'absent').length;
  const currentLate = Object.values(statusMap).filter(s => s === 'late').length;
  const currentPresent = students.length - currentAbsent - currentLate;

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm animate-in fade-in duration-200 sm:p-4"
      onClick={() => { if (!submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-attendance-title"
    >
      <div className="flex h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f172a] shadow-2xl sm:h-[90dvh]" onClick={(event) => { event.stopPropagation(); setActiveTimePickerId(null); }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-white/5 p-4 sm:p-5">
          <div className="min-w-0">
            <h3 id="manual-attendance-title" className="text-xl font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-primary-400" />
              التحضير اليدوي الشامل
            </h3>
            <p className="mt-1 text-xs leading-5 text-gray-400 sm:text-sm">تم تحميل حالات اليوم الحالية. راجعها ثم احفظ التعديلات لجميع الطلاب.</p>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors disabled:opacity-40" aria-label="إغلاق التحضير اليدوي">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-white/10 bg-black/20 p-3 sm:p-4 md:flex-row">
          {/* Search & Sort Group */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-3 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="بحث باسم الطالب..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pr-10 pl-4 text-white focus:outline-none focus:border-primary-500/50"
                aria-label="بحث في طلاب التحضير اليدوي"
              />
            </div>

            {/* Sort Buttons */}
            <div className="flex overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => toggleSort('name')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors ${sortConfig.key === 'name' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                title="ترتيب حسب الاسم"
              >
                الاسم {getSortIcon('name')}
              </button>
              <button
                onClick={() => toggleSort('class_name')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors ${sortConfig.key === 'class_name' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                title="ترتيب حسب الصف"
              >
                الصف {getSortIcon('class_name')}
              </button>
              <button
                onClick={() => toggleSort('section')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors ${sortConfig.key === 'section' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                title="ترتيب حسب الفصل"
              >
                الفصل {getSortIcon('section')}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium sm:gap-3 sm:text-sm">
            <div className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30">
              غياب: {currentAbsent}
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
              تأخر: {currentLate}
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              حضور: {currentPresent}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar sm:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Bulk Action Card */}
            <button
              type="button"
              onClick={toggleSelectAllAbsence}
              disabled={filteredStudents.length === 0}
              className="col-span-full mb-2 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/20 p-3 text-right transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${filteredStudents.length > 0 && filteredStudents.every(s => statusMap[s.id] === 'absent') ? 'bg-red-500 border-red-500 text-white' : 'border-gray-500 text-transparent'}`}>
                <Check className="w-3.5 h-3.5" />
              </div>
              <span className="text-gray-300 font-medium select-none">تحديد الكل كغياب ({filteredStudents.length})</span>
            </button>

            {filteredStudents.map(student => {
              const status = getStatus(student.id);
              const time = lateTimes[student.id] || '07:45';

              return (
                <div
                  key={student.id}
                  className={`p-3 rounded-xl border transition-all duration-200 flex flex-col gap-3 group select-none ${status === 'absent' ? 'bg-red-500/10 border-red-500/40' :
                    status === 'late' ? 'bg-amber-500/10 border-amber-500/40' :
                      'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${status === 'absent' ? 'bg-red-500/20 text-red-400' :
                        status === 'late' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-emerald-500/20 text-emerald-400'
                        }`}>
                        {student.class_name.split(' ')[0]}
                      </div>
                      <div className="min-w-0">
                        <div className={`font-bold truncate transition-colors ${status === 'absent' ? 'text-red-200' :
                          status === 'late' ? 'text-amber-200' :
                            'text-gray-200'
                          }`}>{student.name}</div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{student.id}</span>
                          <span className="w-px h-3 bg-gray-700"></span>
                          <span className="flex items-center gap-1.5">
                            {student.class_name}
                            <span className={`flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded text-[10px] font-bold border ${status === 'absent' ? 'bg-red-500/20 border-red-500/30 text-red-300' :
                              status === 'late' ? 'bg-amber-500/20 border-amber-500/30 text-amber-300' :
                                'bg-white/10 border-white/10 text-gray-400'
                              }`}>
                              {student.section}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex bg-black/40 rounded-lg p-1 gap-1">
                    <button
                      onClick={() => setStatus(student.id, 'present')}
                      className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${status === 'present' ? 'bg-emerald-600 text-white shadow' : 'text-gray-400 hover:text-emerald-400 hover:bg-white/5'}`}
                    >
                      حاضر
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatus(student.id, 'late');
                      }}
                      className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors relative ${status === 'late' ? 'bg-amber-600 text-white shadow' : 'text-gray-400 hover:text-amber-400 hover:bg-white/5'}`}
                    >
                      متأخر
                      {status === 'late' && (
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setStatus(student.id, 'absent')}
                      className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${status === 'absent' ? 'bg-red-600 text-white shadow' : 'text-gray-400 hover:text-red-400 hover:bg-white/5'}`}
                    >
                      غائب
                    </button>
                  </div>

                  {/* Time Picker Logic */}
                  {status === 'late' && (
                    <div className="relative animate-in slide-in-from-top-1 duration-200">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTimePickerId(activeTimePickerId === student.id ? null : student.id);
                        }}
                        className="flex items-center justify-between bg-black/30 rounded-lg p-2 border border-amber-500/30 cursor-pointer hover:bg-black/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 text-amber-400 text-xs">
                          <Clock className="w-3.5 h-3.5" />
                          <span>وقت الوصول:</span>
                        </div>
                        <span className="font-mono font-bold text-amber-200 text-sm bg-amber-950/50 px-2 py-0.5 rounded">
                          {time}
                        </span>
                      </div>

                      {/* Popup Time Picker */}
                      {activeTimePickerId === student.id && (
                        <div
                          className="absolute top-full left-0 right-0 mt-2 p-3 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 flex flex-col gap-2 animate-in zoom-in-95 duration-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <label className="text-xs text-slate-400 mb-1 block">اختر الوقت:</label>
                          <input
                            type="time"
                            value={time}
                            onChange={(e) => handleTimeChange(student.id, e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono text-center focus:border-amber-500 focus:outline-none"
                          />
                          <button
                            onClick={() => setActiveTimePickerId(null)}
                            className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg mt-1"
                          >
                            تأكيد
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {filteredStudents.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-gray-500">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p>لا يوجد طلاب مطابقين للبحث</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 bg-black/20 p-3 sm:p-5">
          <div className="text-xs text-gray-500 hidden md:block">
            * سيتم تحديث حالة جميع الطلاب (الحاضرين، المتأخرين، والغائبين)
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <button
              onClick={onClose}
              className="flex-1 md:flex-none px-6 py-2.5 rounded-xl text-gray-300 hover:bg-white/10 hover:text-white transition-colors font-medium"
            >
              إلغاء
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting || students.length === 0}
              className="flex-1 md:flex-none px-8 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold shadow-lg shadow-primary-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              حفظ واعتماد
            </button>
          </div>
        </div>
        {confirmationOpen && (
          <div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={() => setConfirmationOpen(false)}>
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="manual-confirm-title">
              <h4 id="manual-confirm-title" className="text-xl font-bold text-white">تأكيد تحديث تحضير اليوم</h4>
              <p className="mt-2 text-sm leading-6 text-gray-400">سيتم تحديث حالة جميع الطلاب، بما في ذلك السجلات الموجودة مسبقًا.</p>
              <div className="my-5 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-200"><strong className="block text-xl tabular-nums">{currentPresent}</strong>حاضر</div>
                <div className="rounded-xl bg-amber-500/10 p-3 text-amber-200"><strong className="block text-xl tabular-nums">{currentLate}</strong>متأخر</div>
                <div className="rounded-xl bg-red-500/10 p-3 text-red-200"><strong className="block text-xl tabular-nums">{currentAbsent}</strong>غائب</div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setConfirmationOpen(false)} className="flex-1 rounded-xl px-4 py-2.5 text-gray-300 transition hover:bg-white/10">مراجعة الحالات</button>
                <button onClick={() => void handleSubmit(true)} className="flex-1 rounded-xl bg-primary-600 px-4 py-2.5 font-bold text-white transition hover:bg-primary-500 active:scale-[0.98]">تأكيد الحفظ</button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>,
    document.body
  );
};

export default Watcher;
