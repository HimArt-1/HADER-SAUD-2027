// =============================================================================
// نظام حاضر (Hader) - Database Service (Slim Entry Point)
// =============================================================================
// Orchestrates provider selection and delegates all calls.
// All types, helpers, CloudProvider, and LocalProvider are in separate modules.

import { supabase, getSupabaseDebugInfo } from './supabase';
import { logger } from './logger';
import {
  Student, AttendanceRecord, ExitRecord, ViolationRecord, Notification,
  DashboardStats, ReportFilter, DailySummary, SystemSettings,
  DiagnosticResult, SchoolClass, User,
  ClassStatsSummary, AuthAuditLog, ClientErrorLog, ATTENDANCE_DEFAULTS,
  DismissalRecord, DismissalCallRequest, DismissalSchedule, ActivityLogEntry, ActivityAction, STORAGE_KEYS,
  GuardianExcuseRecord
} from '../types';
import { CanonicalStudent } from '../types/import';
import { HybridProvider, hybridProvider } from './hybridProvider';
import { syncService } from './syncService';

// Import from split modules
import {
  StorageMode, SyncState, SyncStatus,
  IDatabaseProvider, IStudentAffairsProvider, AuthAuditLogFilters, ClientErrorLogFilters,
  CONFIG_KEY, KIOSK_SETTINGS_KEY, isBrowser, MarkAttendanceFastResult
} from './dbTypes';
import { CloudProvider, cloudProviderRef } from './cloudProvider';
import { LocalProvider } from './localProvider';
import {
  getLocalISODate, getLocalDateStr,
  getSyncedDate, mapAttendance, mapNotificationRow
} from './dbHelpers';
import { resolveRecorder } from './recorderResolver';

// Import settings broadcast service for cross-tab cache invalidation
import { subscribeToSettingsUpdates } from './settingsBroadcast';
import { staticCache, CACHE_KEYS } from './cache';
import {
  decideAttendanceTiming,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate
} from '../modules/attendance';
import { createRosterModule, type RosterModule } from '../modules/roster';
import { createDismissalModule, type DismissalModule } from '../modules/dismissal';
import { createSettingsModule, type SettingsModule } from '../modules/settings';
import { createNotificationsModule, type NotificationsModule } from '../modules/notifications';
import { createStudentAffairsModule, type StudentAffairsModule } from '../modules/studentAffairs';

// Re-export for consumers (preserves all existing import paths)
export type { StorageMode, SyncState, SyncStatus } from './dbTypes';
export { getLocalISODate, getLocalDateStr, normalizeStudentId, buildStructureFromStudents } from './dbHelpers';
export { resolveRecorder } from './recorderResolver';
export { subscribeToSettingsUpdates } from './settingsBroadcast';

type DatabaseProvider = IDatabaseProvider & IStudentAffairsProvider;

class Database implements IDatabaseProvider, IStudentAffairsProvider {
  private provider: DatabaseProvider;
  private hybridProvider: HybridProvider | null = null;
  private mode: StorageMode;
  private readonly hasSupabaseConfig: boolean;
  private readonly allowLocalFallback: boolean;
  private readonly unsafeLocalFallback: boolean;
  private readonly isProduction: boolean;
  private rosterModule!: RosterModule;
  private dismissalModule!: DismissalModule;
  private settingsModule!: SettingsModule;
  private notificationsModule!: NotificationsModule;
  private studentAffairsModule!: StudentAffairsModule;

  constructor() {
    // Production has one operational data path: Supabase as source of truth
    // with IndexedDB as local cache/offline queue. The legacy cloud/local/hybrid
    // labels are normalized here so devices cannot silently diverge.
    const envMode = import.meta.env.VITE_APP_MODE as StorageMode;
    const isTest = import.meta.env.MODE === 'test' || Boolean(import.meta.env.TEST || import.meta.env.VITEST);
    const allowLocalFallbackEnv = String(import.meta.env.VITE_ALLOW_LOCAL_FALLBACK || '').toLowerCase();
    this.isProduction = import.meta.env.PROD;
    this.allowLocalFallback = allowLocalFallbackEnv === '1' || allowLocalFallbackEnv === 'true' || allowLocalFallbackEnv === 'yes';
    this.hasSupabaseConfig = !!import.meta.env.VITE_SUPABASE_URL &&
      import.meta.env.VITE_SUPABASE_URL !== 'https://your-project.supabase.co' &&
      !!import.meta.env.VITE_SUPABASE_ANON_KEY;
    this.unsafeLocalFallback = this.isProduction && !this.hasSupabaseConfig && !this.allowLocalFallback;

    if (isTest) {
      this.mode = 'local';
    } else if (this.hasSupabaseConfig) {
      this.mode = 'cloud';
    } else if (!this.isProduction && envMode === 'local') {
      this.mode = 'local';
    } else {
      this.mode = 'local';
    }

    // Remove stale user-selected modes. Runtime mode is now derived from the
    // deployment configuration, not from per-device localStorage.
    try {
      if (localStorage.getItem(CONFIG_KEY)) {
        localStorage.removeItem(CONFIG_KEY);
      }
    } catch {
      // Ignore storage failures; provider selection above is already deterministic.
    }

    // Debug Logging - Log to console for verification on any device
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'NOT_SET';
    logger.info('DB', `Init: mode=${this.mode.toUpperCase()}, env=${envMode || 'NOT_SET'}, supabase=${this.hasSupabaseConfig ? 'YES' : 'NO'}, ${this.isProduction ? 'PRODUCTION' : 'DEV'}`);

    if (this.mode === 'cloud') {
      this.hybridProvider = hybridProvider;
      this.provider = this.createHybridBridge();
      logger.info('DB', '✅ Using Cloud-first Provider (Supabase + IndexedDB cache)');

      // Start sync service
      if (this.hasSupabaseConfig) {
        syncService.startAutoSync();
        logger.info('DB', '🔄 Auto-sync enabled');
      } else {
        console.warn('⚠️  Supabase not configured - offline cache cannot sync');
      }
    } else if (this.unsafeLocalFallback) {
      const message = '❌ Production guard: Supabase config is missing and local fallback is blocked. This build can diverge across devices.';
      this.provider = this.createBlockedProvider(message);
      logger.error('DB', message);
      console.error(message);
    } else {
      this.provider = new LocalProvider();
      console.warn('⚠️  Using LocalProvider (localStorage only - NOT synced to cloud)');
    }

    this.settingsModule = createSettingsModule({
      loadSettings: () => this.provider.getSettings(),
      saveSettings: async settings => {
        await this.provider.saveSettings(settings);
      },
      subscribeToUpdates: listener => subscribeToSettingsUpdates(incoming => {
        staticCache.delete(CACHE_KEYS.SETTINGS);
        cloudProviderRef?.invalidateKioskSettingsCache();
        void this.provider.getSettings()
          .then(listener)
          .catch(error => {
            logger.warn('Settings', 'Failed to reload a broadcast update:', error);
            listener(incoming);
          });
      }),
      invalidateCaches: () => {
        staticCache.delete(CACHE_KEYS.SETTINGS);
        cloudProviderRef?.invalidateKioskSettingsCache();
      },
      applyAppearance: settings => {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        const themeVariables = {
          '--color-primary-400': settings.theme?.primary_400,
          '--color-primary-500': settings.theme?.primary_500,
          '--color-primary-600': settings.theme?.primary_600,
          '--color-secondary-400': settings.theme?.secondary_400,
          '--color-secondary-500': settings.theme?.secondary_500,
          '--color-secondary-600': settings.theme?.secondary_600
        };
        Object.entries(themeVariables).forEach(([name, value]) => {
          if (value) root.style.setProperty(name, value);
        });
        if (settings.dark_mode !== undefined) {
          root.classList.toggle('dark', settings.dark_mode);
          root.classList.toggle('light-mode', !settings.dark_mode);
        }
      }
    });

    this.rosterModule = createRosterModule({
      loadStudents: options => this.provider.getStudents(options),
      loadClasses: () => this.provider.getClasses(),
      saveStudents: students => this.provider.saveStudents(students),
      updateStudent: student => this.provider.updateStudent(student),
      renameStudentId: (currentId, nextId) => this.provider.renameStudentId(currentId, nextId),
      deleteStudent: studentId => this.provider.deleteStudent(studentId),
      saveClass: async schoolClass => { await this.provider.saveClass(schoolClass); },
      deleteClass: classId => this.provider.deleteClass(classId)
    }, {
      canRefreshMissing: () =>
        this.hasSupabaseConfig &&
        typeof navigator !== 'undefined' &&
        navigator.onLine,
      onRefreshError: error => logger.warn('Roster', 'Student lookup refresh failed:', error),
      onLookupMiss: details => {
        if (import.meta.env.DEV) console.debug('[Roster] Student lookup failed', details);
      }
    });

    this.notificationsModule = createNotificationsModule({
      saveNotification: async notification => {
        if (this.hybridProvider) await this.hybridProvider.saveNotification(notification);
        else await this.provider.saveNotification(notification);
      },
      saveNotifications: async notifications => {
        if (this.hybridProvider) await this.hybridProvider.saveNotifications(notifications);
        else await this.provider.saveNotifications(notifications);
      },
      loadStudentNotifications: (studentId, className) => this.hybridProvider
        ? this.hybridProvider.getStudentNotifications(studentId, className)
        : this.provider.getStudentNotifications(studentId, className),
      loadAllNotifications: limit => this.hybridProvider
        ? this.hybridProvider.getNotifications(limit)
        : this.provider.getAllNotifications(limit),
      subscribeToInserts: (recipient, listener) => {
        if (!this.hybridProvider) {
          return this.provider.subscribeToNotifications(recipient, listener);
        }
        if (!this.hasSupabaseConfig) return { unsubscribe: () => undefined };

        const channelName = `notifications_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const channel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notifications' },
            payload => listener(mapNotificationRow(payload.new))
          )
          .subscribe();
        return { unsubscribe: () => { void supabase.removeChannel(channel); } };
      }
    }, {
      onSubscriptionError: error => logger.warn('Notifications', 'Delivery failed:', error)
    });

    this.studentAffairsModule = createStudentAffairsModule({
      saveExit: async (record, mode) => {
        if (this.hybridProvider) await this.hybridProvider.saveExit(record);
        else if (mode === 'update') await this.provider.updateExit(record);
        else await this.provider.addExit(record);
      },
      deleteExit: exitId => this.hybridProvider
        ? this.hybridProvider.deleteExit(exitId)
        : this.provider.deleteExit(exitId),
      loadExits: date => this.hybridProvider
        ? this.hybridProvider.getExits(date)
        : this.provider.getExits(date),
      loadStudentExits: studentId => this.hybridProvider
        ? this.hybridProvider.getStudentExits(studentId)
        : this.provider.getStudentExits(studentId),
      saveViolation: async record => {
        if (this.hybridProvider) await this.hybridProvider.saveViolation(record);
        else await this.provider.addViolation(record);
      },
      deleteViolation: violationId => this.hybridProvider
        ? this.hybridProvider.deleteViolation(violationId)
        : this.provider.deleteViolation(violationId),
      loadViolations: studentId => this.hybridProvider
        ? this.hybridProvider.getViolations(studentId)
        : this.provider.getViolations(studentId),
      loadViolationsForDate: date => this.hybridProvider
        ? this.hybridProvider.getViolationsForDate(date)
        : this.provider.getViolationsForDate(date),
      saveExcuse: async (record, mode) => {
        if (this.hybridProvider) {
          if (mode === 'update') await this.hybridProvider.updateGuardianExcuse(record);
          else await this.hybridProvider.saveGuardianExcuse(record);
        } else if (mode === 'update') await this.provider.updateGuardianExcuse(record);
        else await this.provider.addGuardianExcuse(record);
      },
      loadExcuses: filters => {
        const providerFilters = filters ? {
          student_id: filters.studentId,
          status: filters.status,
          limit: filters.limit
        } : undefined;
        return this.hybridProvider
          ? this.hybridProvider.getGuardianExcuses(providerFilters)
          : this.provider.getGuardianExcuses(providerFilters);
      },
      sendNotification: async notification => {
        await this.notificationsModule.execute({ type: 'send', notification });
      }
    }, {
      onNotificationError: error =>
        logger.warn('StudentAffairs', 'Related notification failed:', error)
    });

    this.dismissalModule = createDismissalModule({
      addRecord: record => this.provider.addDismissal(record),
      loadTodayRecords: () => this.provider.getTodayDismissals(),
      loadStudentRecords: studentId => this.provider.getStudentDismissals(studentId),
      loadRecordsByRange: (startDate, endDate) =>
        this.provider.getDismissalsByDateRange(startDate, endDate),
      isDismissedToday: studentId => this.provider.isStudentDismissedToday(studentId),
      loadSchedules: () => this.provider.getDismissalSchedules(),
      saveSchedules: schedules => this.provider.saveDismissalSchedules(schedules),
      addCall: call => this.provider.addDismissalCall(call),
      loadActiveCalls: () => this.provider.getActiveDismissalCalls(),
      updateCallStatus: (callId, status) =>
        this.provider.updateDismissalCallStatus(callId, status),
      subscribeToCalls: listener => this.provider.subscribeToDismissalCalls(listener),
      findStudent: studentId => this.rosterModule.findStudent(studentId),
      saveNotification: async notification => {
        await this.notificationsModule.execute({ type: 'send', notification });
      }
    }, {
      onNotificationError: error =>
        logger.warn('Dismissal', 'Failed to create guardian dismissal notification:', error)
    });

    // Load settings once on boot to initialize appearance and cross-tab updates.
    this.settingsModule.load().catch((error) => {
      logger.error('DB', 'Failed to load settings during boot', error);
    });
  }

  private createBlockedProvider(message: string): DatabaseProvider {
    const blocked = async () => {
      throw new Error(message);
    };

    const diagnostics: DiagnosticResult[] = [{
      key: 'production-cloud-guard',
      title: 'حاجز بيئة الإنتاج',
      status: 'error',
      message: 'تم منع تشغيل قاعدة البيانات المحلية داخل بيئة إنتاج بدون إعدادات Supabase.',
      hint: 'أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY أو فعّل VITE_ALLOW_LOCAL_FALLBACK بشكل صريح عند الحاجة.'
    }];

    return new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'runDiagnostics') return async () => diagnostics;
        if (prop === 'getSyncStatus') {
          return () => ({
            status: 'error',
            pending: 0,
            lastError: message
          } satisfies SyncState);
        }
        if (prop === 'onSyncStatusChange') return () => () => undefined;
        if (prop === 'subscribeToAttendance') return () => ({ unsubscribe: () => undefined });
        if (prop === 'subscribeToDismissalCalls') return () => ({ unsubscribe: () => undefined });
        if (prop === 'forceSyncNow') return blocked;
        return blocked;
      }
    }) as DatabaseProvider;
  }

  // Create a bridge that wraps HybridProvider to match IDatabaseProvider interface
  private createHybridBridge(): DatabaseProvider {
    const hp = this.hybridProvider!;

    // Helper to get unmarked students
    const getUnmarkedStudentsHelper = async (date: string, cls: string, sec: string) => {
      const students = await hp.getStudents();
      const attendance = await hp.getAttendance(date);
      const attendedIds = new Set(
        uniqueAttendanceByStudentDate(attendance, date).map(a => a.student_id)
      );
      return students.filter(s =>
        s.class_name === cls &&
        s.section === sec &&
        s.is_active !== false &&
        !attendedIds.has(s.id)
      );
    };

    // Create a bridge object that delegates to HybridProvider
    // Using type assertion since HybridProvider doesn't implement all methods
    const bridge = {
      // Students
      getStudents: (options?: { forceSync?: boolean }) => hp.getStudents(options),
      getStudentsByGuardian: (p: string) => hp.getStudentsByGuardian(p),
      getStudentById: (id: string) => hp.getStudentById(id),
      saveStudents: (s: Student[]) => hp.saveStudents(s),
      updateStudent: (s: Student) => hp.updateStudent(s),
      renameStudentId: (c: string, n: string) => hp.renameStudentId(c, n),
      deleteStudent: (id: string) => hp.deleteStudent(id),

      // Attendance
      getAttendance: (d?: string) => hp.getAttendance(d),
      getAllAttendance: () => hp.getAllAttendance(),
      saveAttendanceBatch: (r: AttendanceRecord[]) => hp.saveAttendanceBatch(r),
      deleteAttendanceRange: (s: string, e: string) => hp.deleteAttendanceRange(s, e),
      getAttendanceRange: (s: string, e: string) => hp.getAttendanceRange(s, e),
      getStudentAttendance: (id: string) => hp.getStudentAttendance(id),
      markAttendance: (id: string) => hp.markAttendance(id),
      addManualAttendance: (r: { student_id: string; date: string; time: string }) => hp.addManualAttendance(r),
      addManualAbsence: (r: { student_id: string; date: string }) => hp.addManualAbsence(r),
      deleteAttendance: (s: string, d: string) => hp.deleteAttendance(s, d),
      getUnmarkedStudents: getUnmarkedStudentsHelper,
      subscribeToAttendance: (callback: (record: AttendanceRecord) => void) => {
        const realtimeHandler = (event: Event) => {
          const customEvent = event as CustomEvent<{ table?: string; record?: unknown }>;
          if (customEvent.detail?.table === 'attendance_logs' && customEvent.detail.record) {
            callback(mapAttendance(customEvent.detail.record));
          }
        };

        // BroadcastChannel for instant cross-tab sync
        let bc: BroadcastChannel | null = null;
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          try {
            bc = new BroadcastChannel('hader:attendance:channel');
            bc.onmessage = (event: MessageEvent) => {
              if (event.data?.type === 'attendance-marked' && event.data?.record) {
                callback(event.data.record);
              }
            };
          } catch (_) { /* ignore */ }
        }

        window.addEventListener('hader:realtime-update', realtimeHandler);

        return {
          unsubscribe: () => {
            window.removeEventListener('hader:realtime-update', realtimeHandler);
            if (bc) { bc.close(); bc = null; }
          }
        };
      },

      // Bulk operations
      bulkMarkAllPresent: async ({ class_name, section, date }: { class_name: string; section: string; date: string }) => {
        const unmarked = await getUnmarkedStudentsHelper(date, class_name, section);
        const now = new Date();
        const records = unmarked.map(s => ({
          id: crypto.randomUUID(),
          student_id: s.id,
          date,
          timestamp: now.toISOString(),
          status: 'present' as const,
          minutes_late: 0,
          recorded_by_label: 'admin-bulk'
        }));
        await hp.saveAttendanceBatch(records);
        return { success: true, message: `تم تسجيل ${records.length} طالب`, count: records.length, students: unmarked };
      },
      bulkMarkAbsent: async ({ student_ids, date }: { student_ids: string[]; date: string }) => {
        const now = new Date();
        const existingRecords = await hp.getAttendance(date);
        const existingMap = new Map(existingRecords.map(r => [r.student_id, r]));

        const toInsert: any[] = [];
        const toUpdate: any[] = [];

        for (const id of student_ids) {
          const existing = existingMap.get(id);
          if (existing) {
            if (existing.status !== 'absent') {
              toUpdate.push({ ...existing, status: 'absent' as const, minutes_late: 0, timestamp: now.toISOString() });
            }
            // Skip if already absent
          } else {
            toInsert.push({
              id: crypto.randomUUID(),
              student_id: id,
              date,
              timestamp: now.toISOString(),
              status: 'absent' as const,
              minutes_late: 0,
              recorded_by_label: 'admin-bulk'
            });
          }
        }

        if (toInsert.length > 0) await hp.saveAttendanceBatch(toInsert);
        if (toUpdate.length > 0) await hp.saveAttendanceBatch(toUpdate);

        // 📱 Trigger WhatsApp for Absent Students
        // We do this asynchronously to not block UI
        if (typeof window !== 'undefined') {
          setTimeout(async () => {
            const settings = await this.getSettings();
            if (settings?.whatsapp_triggers?.on_absent) {
              const allProcessed = [...toInsert, ...toUpdate];
              const students = await this.getStudents();

              for (const record of allProcessed) {
                const student = students.find(s => s.id === record.student_id);
                if (student && student.guardian_phone) {
                  this._triggerWhatsApp(record, student);
                }
              }
            }
          }, 100);
        }

        return { success: true, message: `تم تسجيل ${toInsert.length + toUpdate.length} غياب`, count: toInsert.length + toUpdate.length };
      },
      updateAttendanceStatus: async ({ student_ids, date, new_status }: { student_ids: string[]; date: string; new_status: 'present' | 'late' | 'absent' }) => {
        const students = await this.getStudents();
        for (const id of student_ids) {
          const existing = (await hp.getAttendance(date)).find(a => a.student_id === id);
          if (existing) {
            const updatedRecord = { ...existing, status: new_status, minutes_late: new_status === 'late' ? existing.minutes_late : 0, timestamp: new Date().toISOString() };
            await hp.saveAttendanceBatch([updatedRecord]);

            // 📱 Trigger WhatsApp
            const student = students.find(s => s.id === id);
            if (student) {
              this._triggerWhatsApp(updatedRecord, student);
            }
          }
        }
        return { success: true, message: `تم تحديث ${student_ids.length} سجل`, updated_count: student_ids.length };
      },
      bulkMarkLate: async ({ student_ids, date, time }: { student_ids: string[]; date: string; time: string }) => {
        const timestamp = new Date(`${date}T${time}`);
        const settings = await hp.getSettings();
        const assemblyTime = settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME;
        const gracePeriod = settings.grace_period || ATTENDANCE_DEFAULTS.GRACE_PERIOD;
        const [assemblyHour, assemblyMinute] = assemblyTime.split(':').map(Number);
        const cutoff = new Date(`${date}T${assemblyTime}`);
        cutoff.setHours(assemblyHour || 0, (assemblyMinute || 0) + gracePeriod, 0, 0);
        const minutesLate = Math.max(0, Math.floor((timestamp.getTime() - cutoff.getTime()) / 60000));
        const existingRecords = await hp.getAttendance(date);
        const existingMap = new Map(existingRecords.map(r => [r.student_id, r]));

        const toInsert: any[] = [];
        const toUpdate: any[] = [];

        for (const id of student_ids) {
          const existing = existingMap.get(id);
          if (existing) {
            if (existing.status !== 'late') {
              toUpdate.push({ ...existing, status: 'late' as const, minutes_late: minutesLate, timestamp: timestamp.toISOString() });
            }
          } else {
            toInsert.push({
              id: crypto.randomUUID(),
              student_id: id,
              date,
              timestamp: timestamp.toISOString(),
              status: 'late' as const,
              minutes_late: minutesLate,
              recorded_by_label: 'admin-bulk'
            });
          }
        }

        if (toInsert.length > 0) await hp.saveAttendanceBatch(toInsert);
        if (toUpdate.length > 0) await hp.saveAttendanceBatch(toUpdate);
        return { success: true, message: `تم تسجيل ${toInsert.length + toUpdate.length} متأخر`, count: toInsert.length + toUpdate.length };
      },

      // Daily Summary
      getDailySummary: async (date: string) => {
        const stats = await hp.getDashboardStats(date);
        return {
          date,
          present_count: stats.present_count,
          late_count: stats.late_count,
          absent_count: stats.absent_count,
          total_students: stats.total_students,
          attendance_rate: stats.attendance_rate
        } as DailySummary;
      },
      saveDailySummary: async () => { },

      // Dashboard & Reports — Real implementations from IndexedDB
      getDashboardStats: () => hp.getDashboardStats(),
      getWeeklyStats: async () => {
        const days = ['\u0627\u0644\u0623\u062d\u062f', '\u0627\u0644\u0625\u062b\u0646\u064a\u0646', '\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621', '\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621', '\u0627\u0644\u062e\u0645\u064a\u0633'];
        const allStudents = await hp.getStudents();
        const students = allStudents.filter(s => s.is_active !== false && (s.is_active as any) !== 0);
        const total = students.length;
        if (total === 0) return days.map(day => ({ day, presence: 0 }));

        const result: any[] = [];
        const today = new Date();
        for (let i = 4; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          const dayIndex = date.getDay();
          const dayAttendance = uniqueAttendanceByStudentDate(await hp.getAttendance(dateStr), dateStr);
          const attended = dayAttendance.filter(a => a.status === 'present' || a.status === 'late').length;
          result.push({ day: days[dayIndex] || days[0], presence: Math.round((attended / total) * 100) });
        }
        return result;
      },
      getClassStats: async () => {
        const allStudents = await hp.getStudents();
        const students = allStudents.filter(s => s.is_active !== false && (s.is_active as any) !== 0);
        const today = getLocalISODate();
        const todayAttendance = uniqueAttendanceByStudentDate(await hp.getAttendance(today), today);
        const attendedIds = new Set(todayAttendance.filter(a => a.status === 'present' || a.status === 'late').map(a => a.student_id));

        const classMap = new Map<string, number>();
        for (const s of students) {
          const cls = s.class_name || '\u063a\u064a\u0631 \u0645\u062d\u062f\u062f';
          if (!classMap.has(cls)) classMap.set(cls, 0);
          if (!attendedIds.has(s.id)) {
            classMap.set(cls, (classMap.get(cls) || 0) + 1);
          }
        }
        return Array.from(classMap.entries()).map(([name, absent]) => ({ name, absent }));
      },
      getAttendanceReport: async (filters: ReportFilter) => {
        const allAttendance = await hp.getAllAttendance();
        const filteredLogs = uniqueAttendanceByStudentDate(
          allAttendance.filter(a => a.date >= filters.date_from && a.date <= filters.date_to)
        );
        let students = await hp.getStudents();
        if (filters.class_name) students = students.filter(s => s.class_name === filters.class_name);
        if (filters.section) students = students.filter(s => s.section === filters.section);
        const studentsById = new Map(students.map(student => [student.id, student]));

        const details = filteredLogs.map(log => {
          const student = studentsById.get(log.student_id);
          if (!student) return null;
          return { student_id: log.student_id, studentName: student.name, className: student.class_name, section: student.section, date: log.date, time: log.timestamp, status: log.status };
        }).filter(Boolean);

        return {
          summary: { totalRecords: details.length, late: details.filter(d => d!.status === 'late').length, present: details.filter(d => d!.status === 'present').length },
          details: details as any[]
        };
      },
      getClassProfileStats: async (className: string, section: string, fromDate: string, toDate: string) => {
        const students = (await hp.getStudents()).filter(s => s.class_name === className && (!section || s.section === section));
        const studentIds = students.map(s => s.id);
        const days = Math.max(1, Math.floor((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1);
        if (studentIds.length === 0) return { present: 0, late: 0, absent: 0, exits: 0, violations: 0, totalStudents: 0, days };

        const allAttendance = await hp.getAllAttendance();
        const filtered = uniqueAttendanceByStudentDate(
          allAttendance.filter(a => studentIds.includes(a.student_id) && a.date >= fromDate && a.date <= toDate)
        );
        const counts = getAttendanceStatusCounts(filtered, studentIds.length * days);
        const present = counts.present;
        const late = counts.late;
        const absent = counts.absent;

        return { present, late, absent, exits: 0, violations: 0, totalStudents: studentIds.length, days };
      },

      // Exits
      addExit: record => this.addExit(record),
      updateExit: record => this.updateExit(record),
      deleteExit: exitId => this.deleteExit(exitId),
      getExits: date => this.getExits(date),
      getTodayExits: () => this.getTodayExits(),
      getStudentExits: studentId => this.getStudentExits(studentId),

      // Violations
      addViolation: record => this.addViolation(record),
      deleteViolation: violationId => this.deleteViolation(violationId),
      getViolations: studentId => this.getViolations(studentId),
      getViolationsForDate: date => this.getViolationsForDate(date),
      getTodayViolations: () => this.getTodayViolations(),

      addGuardianExcuse: record => this.addGuardianExcuse(record),
      updateGuardianExcuse: async (r: GuardianExcuseRecord) => { await hp.updateGuardianExcuse(r); },
      getGuardianExcuses: filters => this.getGuardianExcuses(filters),

      // Notifications
      saveNotification: async (notification: Notification) => {
        await this.notificationsModule.execute({ type: 'send', notification });
      },
      saveNotifications: async (notifications: Notification[]) => {
        await this.notificationsModule.execute({ type: 'send-many', notifications });
      },
      getStudentNotifications: (studentId: string, className: string) =>
        this.notificationsModule.load({ type: 'student', studentId, className }),
      getUserNotifications: (user: User, limit = 30) =>
        this.notificationsModule.load({ type: 'user', recipient: user, limit }),
      getAllNotifications: (limit?: number) =>
        this.notificationsModule.load({ type: 'all', limit }),
      subscribeToNotifications: (user: User | 'kiosk', callback: (notification: Notification) => void) =>
        this.notificationsModule.subscribe(user, callback),

      // Classes
      getClasses: () => hp.getClasses(),
      getClassesGroupedByGrade: async () => {
        const classes = await hp.getClasses();
        const grouped: Record<string, SchoolClass[]> = {};
        classes.forEach(c => {
          const key = (c.name || 'غير محدد').trim();
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(c);
        });
        return grouped;
      },
      getStudentsByClass: async (className: string, section?: string) => {
        const students = await hp.getStudents();
        return students.filter(s => s.class_name === className && (!section || s.section === section));
      },
      saveClass: async (c: SchoolClass) => { await hp.saveClass(c); },
      deleteClass: (id: string) => hp.deleteClass(id),

      // Users
      getUsers: () => hp.getUsers(),
      saveUser: (u: User) => hp.saveUser(u),
      deleteUser: (id: string) => hp.deleteUser(id),

      // Settings implementation continues below...
      // Settings
      getSettings: () => hp.getSettings(),
      saveSettings: async (s: SystemSettings) => { await hp.saveSettings(s); },
      sendBroadcast: async (targetRole: string, message: string, title: string) => {
        await this.notificationsModule.execute({
          type: 'broadcast',
          title,
          message,
          targetAudience: targetRole as Notification['target_audience']
        });
      },
      runDiagnostics: async () => [] as DiagnosticResult[],

      // Telemetry
      getAuthAuditLogs: async () => [] as AuthAuditLog[],
      getClientErrorLogs: async () => [] as ClientErrorLog[],
      cleanupTelemetryLogs: async () => ({ auth_deleted: 0, error_deleted: 0 }),

      // Dismissals — delegated to HybridProvider (cloud-direct for realtime calls)
      addDismissal: (record: any) => hp.addDismissal(record),
      getTodayDismissals: () => hp.getTodayDismissals(),
      getStudentDismissals: (id: string) => hp.getStudentDismissals(id),
      getDismissalsByDateRange: (s: string, e: string) => hp.getDismissalsByDateRange(s, e),
      isStudentDismissedToday: (id: string) => hp.isStudentDismissedToday(id),
      getDismissalSchedules: () => hp.getDismissalSchedules(),
      saveDismissalSchedules: (s: any[]) => hp.saveDismissalSchedules(s),
      addDismissalCall: (c: any) => hp.addDismissalCall(c),
      getActiveDismissalCalls: () => hp.getActiveDismissalCalls(),
      updateDismissalCallStatus: (id: string, st: string) => hp.updateDismissalCallStatus(id, st),
      subscribeToDismissalCalls: (cb: any) => hp.subscribeToDismissalCalls(cb)
    } as DatabaseProvider;

    return bridge;
  }

  getMode(): StorageMode {
    return this.mode;
  }

  setMode(mode: StorageMode) {
    if (this.isProduction || this.hasSupabaseConfig) {
      logger.warn('DB', `Storage mode switching is disabled. Requested=${mode}, active=${this.mode}`);
      return;
    }

    logger.info('DB', `🔄 Switching development Database Mode: ${this.mode.toUpperCase()} → ${mode.toUpperCase()}`);
    localStorage.setItem(CONFIG_KEY, mode);
    window.location.reload();
  }

  // Check if hybrid mode is active
  isHybridMode(): boolean {
    return this.hybridProvider !== null;
  }

  // Get sync status - supports hybrid and cloud modes
  getSyncStatus(): SyncState {
    if (this.hybridProvider) {
      const status = this.hybridProvider.getSyncStatus();
      return {
        status: status.status as SyncState['status'],
        pending: status.pending,
        lastSync: status.lastSync,
        lastError: status.lastError
      };
    }
    if (this.provider instanceof CloudProvider) {
      return (this.provider as CloudProvider).getSyncStatus();
    }
    return { status: 'online', pending: 0 };
  }

  // Get pending count
  getPendingCount(): number {
    if (this.hybridProvider) {
      return this.hybridProvider.getSyncStatus().pending;
    }
    if (this.provider instanceof CloudProvider) {
      return (this.provider as CloudProvider).getPendingCount();
    }
    return 0;
  }

  // Subscribe to sync status changes
  onSyncStatusChange(callback: (status: SyncStatus) => void): () => void {
    if (this.hybridProvider) {
      return this.hybridProvider.onSyncStatusChange((status) => {
        callback({
          status: status.status as SyncState['status'],
          pending: status.pending,
          lastSync: status.lastSync,
          lastError: status.lastError
        });
      });
    }
    if (this.provider instanceof CloudProvider) {
      return (this.provider as CloudProvider).onSyncStatusChange(callback);
    }
    return () => { }; // No-op for LocalProvider
  }

  // Force sync - supports hybrid and cloud modes
  async forceSyncNow(): Promise<void> {
    if (this.hybridProvider) {
      await this.hybridProvider.forceSyncNow();
    } else if (this.provider instanceof CloudProvider) {
      await (this.provider as CloudProvider).forceSyncNow();
    }
  }

  // Get hybrid diagnostics
  async getHybridDiagnostics() {
    if (this.hybridProvider) {
      return this.hybridProvider.getDiagnostics();
    }
    return null;
  }

  // Debug Helper - log current state
  getDebugInfo() {
    return {
      mode: this.mode,
      operationalMode: this.hybridProvider ? 'cloud-first-cache' : 'local-dev',
      isHybrid: this.hybridProvider !== null,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      supabaseConfigured: this.hasSupabaseConfig,
      allowLocalFallback: this.allowLocalFallback,
      unsafeLocalFallback: this.unsafeLocalFallback,
      isProduction: this.isProduction,
      timestamp: new Date().toISOString()
    };
  }

  // --- Delegate all calls to provider ---
  getStudents(options?: { forceSync?: boolean }) { return this.provider.getStudents(options); }
  getStudentsByGuardian(p: string) { return this.provider.getStudentsByGuardian(p); }
  getStudentById(id: string) { return this.provider.getStudentById(id); }
  getRosterModule() { return this.rosterModule; }

  async getStudentByAnyId(inputId: string): Promise<Student | null> {
    return this.rosterModule.findStudent(inputId);
  }

  async syncClassesFromStudents() {
    const { structure } = await this.rosterModule.execute({ type: 'sync-structure' });
    if (!structure) throw new Error('تعذر مزامنة هيكل الصفوف');
    if (import.meta.env.DEV) console.debug('[Structure] Sync summary', structure);
    return structure;
  }

  async saveStudents(s: Student[]) {
    const result = await this.rosterModule.execute({ type: 'save-students', students: s });
    return result.savedStudents;
  }

  async importStudents(students: CanonicalStudent[]) {
    const mapped: Student[] = students.map(student => ({
      id: student.id,
      name: student.name,
      class_name: student.gradeLevel,
      section: student.sectionName,
      guardian_phone: student.guardianPhone,
      is_active: true
    }));
    const result = await this.rosterModule.execute({
      type: 'import-students',
      students: mapped
    });
    return result.savedStudents;
  }

  async updateStudent(s: Student) {
    const { student } = await this.rosterModule.execute({ type: 'update-student', student: s });
    if (!student) throw new Error('تعذر تحديث الطالب');
    return student;
  }

  async renameStudentId(currentId: string, nextId: string) {
    const { student } = await this.rosterModule.execute({
      type: 'rename-student',
      currentId,
      nextId
    });
    if (!student) throw new Error('تعذر تغيير معرف الطالب');
    return student;
  }

  async deleteStudent(id: string) {
    await this.rosterModule.execute({ type: 'delete-student', studentId: id });
  }

  // ═══════════════════════════════════════════════════════════════
  // 📱 Smart WhatsApp Triggers - Instant Notifications
  // ═══════════════════════════════════════════════════════════════
  private async _triggerWhatsApp(record: AttendanceRecord, student: Student) {
    try {
      if (typeof window === 'undefined') return;

      const settings = await this.getSettings();
      const triggers = settings.whatsapp_triggers;

      if (!triggers) return;

      // 1. Determine if we should send based on triggers
      let shouldSend = false;
      let templateCategory = '';
      let statusLabel = '';

      if (record.status === 'present' && triggers.on_present) {
        shouldSend = true;
        templateCategory = 'present';
        statusLabel = 'حضور';
      } else if (record.status === 'late' && triggers.on_late) {
        shouldSend = true;
        templateCategory = 'late';
        statusLabel = 'تأخر';
      } else if (record.status === 'absent' && triggers.on_absent) {
        shouldSend = true;
        templateCategory = 'absence';
        statusLabel = 'غياب';
      }

      if (!shouldSend) return;

      // 2. Resolve Template
      const template = settings.whatsapp_templates?.find(t => t.category === templateCategory) ||
        settings.whatsapp_templates?.find(t => t.id === 'tpl_' + templateCategory) ||
        (templateCategory === 'present' ? settings.whatsapp_templates?.find(t => t.id === 'tpl_general') : null) ||
        settings.whatsapp_templates?.[0];

      if (!template) return;

      const phone = student.guardian_phone || student.whatsapp_phone;
      if (!phone) return;

      // 3. Process Content & Placeholders
      let content = template.content;
      const dateStr = getLocalISODate();
      const now = new Date();
      const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
      const minutesLate = record.minutes_late || 0;

      // Advanced placeholder replacement
      content = content
        .replace(/\{(StudentName|student_name|name|student|اسم|الطالب|اسم_الطالب)\}/gi, student.name)
        .replace(/\{(Date|date|تاريخ|التاريخ)\}/gi, dateStr)
        .replace(/\{(Time|time|وقت|الوقت)\}/gi, timeStr)
        .replace(/\{(Class|class|class_name|فصل|الفصل|الصف)\}/gi, student.class_name || '')
        .replace(/\{(Section|section|شعبة|الشعبة|القسم)\}/gi, student.section || '')
        .replace(/\{(Status|status|حالة|الحالة)\}/gi, statusLabel)
        .replace(/\{(MinutesLate|minutes_late|تأخر_دقائق|دقائق)\}/gi, String(minutesLate));

      const payload = [{
        phone,
        message: content,
        student_name: student.name,
        status_label: statusLabel,
        meta: {
          timestamp: now.toISOString(),
          record_id: record.id
        }
      }];

      void import('./whatsappGateway').then(({ whatsappGateway }) =>
        whatsappGateway.enqueue(payload)
      ).then(() => {
        logger.info('WhatsApp', `Instant notification queued for: ${student.name} (${statusLabel})`);
      }).catch(() => {
        // Log locally if server is down, but don't crash UI
        console.warn('[WhatsApp] Local server offline. Notification not sent.');
      });

    } catch (e) {
      console.error('[WhatsApp] Smart Trigger Critical Fail:', e);
    }
  }

  saveNotification(notification: Notification) {
    return this.notificationsModule.execute({ type: 'send', notification }).then(() => undefined);
  }
  saveNotifications(notifications: Notification[]) {
    return this.notificationsModule.execute({ type: 'send-many', notifications }).then(() => undefined);
  }
  getStudentNotifications(student_id: string, className: string) {
    return this.notificationsModule.load({ type: 'student', studentId: student_id, className });
  }
  getUserNotifications(user: User, limit?: number) {
    return this.notificationsModule.load({ type: 'user', recipient: user, limit });
  }
  getAllNotifications(limit?: number) {
    return this.notificationsModule.load({ type: 'all', limit });
  }
  subscribeToNotifications(user: User | 'kiosk', callback: (notification: Notification) => void) {
    return this.notificationsModule.subscribe(user, callback);
  }
  getNotificationsModule() { return this.notificationsModule; }
  getStudentAffairsModule() { return this.studentAffairsModule; }
  async addGuardianExcuse(record: GuardianExcuseRecord) {
    await this.studentAffairsModule.execute({ type: 'submit-excuse', excuse: record, notifyAdmin: false });
  }
  updateGuardianExcuse(record: GuardianExcuseRecord) {
    return this.provider.updateGuardianExcuse(record);
  }
  async getGuardianExcuses(filters?: { student_id?: string; status?: GuardianExcuseRecord['status'] | 'all'; limit?: number }) {
    return (await this.studentAffairsModule.load({
      type: 'excuses',
      filters: filters ? {
        studentId: filters.student_id,
        status: filters.status,
        limit: filters.limit
      } : undefined
    })).excuses;
  }

  getAttendance(d?: string) { return this.provider.getAttendance(d); }
  getAttendanceRange(s: string, e: string) { return this.provider.getAttendanceRange(s, e); }
  getAllAttendance() { return this.provider.getAllAttendance(); }
  saveAttendanceBatch(r: AttendanceRecord[]) { return this.provider.saveAttendanceBatch(r); }
  deleteAttendanceRange(s: string, e: string) { return this.provider.deleteAttendanceRange(s, e); }
  getStudentAttendance(id: string) { return this.provider.getStudentAttendance(id); }
  async markAttendance(id: string) {
    const res = await this.provider.markAttendance(id);
    if (res.success && res.record && res.student) {
      this._triggerWhatsApp(res.record, res.student);
    }
    return res;
  }
  addManualAttendance(record: { student_id: string; date: string; time: string }) {
    return this.provider.addManualAttendance(record);
  }
  addManualAbsence(record: { student_id: string; date: string }) {
    return this.provider.addManualAbsence(record);
  }
  deleteAttendance(student_id: string, date: string) {
    return this.provider.deleteAttendance(student_id, date);
  }
  getUnmarkedStudents(date: string, class_name: string, section: string) {
    return this.provider.getUnmarkedStudents(date, class_name, section);
  }
  bulkMarkAllPresent(params: { class_name: string; section: string; date: string }) {
    return this.provider.bulkMarkAllPresent(params);
  }
  bulkMarkAbsent(params: { student_ids: string[]; date: string }) {
    return this.provider.bulkMarkAbsent(params);
  }

  bulkMarkLate(params: { student_ids: string[]; date: string; time: string }) {
    return this.provider.bulkMarkLate(params);
  }
  updateAttendanceStatus(params: { student_ids: string[]; date: string; new_status: 'present' | 'absent' | 'late' }) {
    return this.provider.updateAttendanceStatus(params);
  }
  subscribeToAttendance(cb: (r: AttendanceRecord) => void) { return this.provider.subscribeToAttendance(cb); }
  getDailySummary(d: string) { return this.provider.getDailySummary(d); }
  saveDailySummary(s: DailySummary) { return this.provider.saveDailySummary(s); }
  getDashboardStats() { return this.provider.getDashboardStats(); }
  getWeeklyStats() { return this.provider.getWeeklyStats(); }
  getClassStats() { return this.provider.getClassStats(); }
  getAttendanceReport(f: ReportFilter) { return this.provider.getAttendanceReport(f); }
  async addExit(record: ExitRecord) {
    await this.studentAffairsModule.execute({
      type: 'save-exit',
      id: record.id,
      studentId: record.student_id,
      reason: record.reason,
      requesterRelation: record.requester_relation || 'other',
      requesterRelationOther: record.requester_relation_other || 'غير محدد',
      notes: record.notes,
      supervisorName: record.supervisor_name,
      createdBy: record.created_by,
      occurredAt: record.exit_time,
      date: record.date
    });
  }
  async updateExit(record: ExitRecord) {
    await this.studentAffairsModule.execute({
      type: 'save-exit',
      exitId: record.id,
      studentId: record.student_id,
      reason: record.reason,
      requesterRelation: record.requester_relation || 'other',
      requesterRelationOther: record.requester_relation_other || 'غير محدد',
      notes: record.notes,
      supervisorName: record.supervisor_name,
      createdBy: record.created_by,
      occurredAt: record.exit_time,
      date: record.date
    });
  }
  async deleteExit(exitId: string) {
    await this.studentAffairsModule.execute({ type: 'delete-exit', exitId });
  }
  async getExits(date?: string) {
    return (await this.studentAffairsModule.load({ type: 'exits', date })).exits;
  }
  async getTodayExits() {
    return (await this.studentAffairsModule.load({ type: 'exits', date: getLocalISODate() })).exits;
  }
  async getStudentExits(studentId: string) {
    return (await this.studentAffairsModule.load({ type: 'student', studentId })).exits;
  }
  async addViolation(record: ViolationRecord) {
    await this.studentAffairsModule.execute({
      type: 'record-violation',
      id: record.id,
      studentId: record.student_id,
      violationType: record.type,
      level: record.level,
      description: record.description,
      actionTaken: record.action_taken,
      summonGuardian: record.summon_guardian,
      guardianNotified: record.guardian_notified,
      createdBy: record.created_by,
      createdByLabel: record.created_by_label,
      occurredAt: record.created_at,
      date: record.date
    });
  }
  async deleteViolation(violationId: string) {
    await this.studentAffairsModule.execute({ type: 'delete-violation', violationId });
  }
  async getViolations(studentId?: string) {
    return (await this.studentAffairsModule.load({ type: 'violations', studentId })).violations;
  }
  async getViolationsForDate(date: string) {
    return (await this.studentAffairsModule.load({ type: 'violations', date })).violations;
  }
  async getTodayViolations() {
    return (await this.studentAffairsModule.load({
      type: 'violations',
      date: getLocalISODate()
    })).violations;
  }
  // Notification methods are now implemented above

  // ═══════════════════════════════════════════════════════════════
  // 🚪 Dismissal System Methods — نظام الانصراف
  // ═══════════════════════════════════════════════════════════════
  getDismissalModule() { return this.dismissalModule; }

  async addDismissal(record: DismissalRecord): Promise<void> {
    await this.dismissalModule.execute({
      type: 'record-dismissal',
      studentId: record.student_id,
      method: record.method,
      recordedBy: record.recorded_by,
      recordedByLabel: record.recorded_by_label,
      pickedUpBy: record.picked_up_by,
      notes: record.notes,
      id: record.id,
      occurredAt: record.exit_time,
      date: record.date
    });
  }

  async getTodayDismissals(): Promise<DismissalRecord[]> {
    return (await this.dismissalModule.load({ type: 'today' })).records;
  }

  async getStudentDismissals(studentId: string): Promise<DismissalRecord[]> {
    return (await this.dismissalModule.load({ type: 'student', studentId })).records;
  }

  async getDismissalsByDateRange(startDate: string, endDate: string): Promise<DismissalRecord[]> {
    return (await this.dismissalModule.load({ type: 'range', startDate, endDate })).records;
  }

  async isStudentDismissedToday(studentId: string): Promise<boolean> {
    return (await this.dismissalModule.load({ type: 'dismissed-today', studentId })).dismissed ?? false;
  }

  // ── Dismissal Schedules ────────────────────────────────
  async getDismissalSchedules(): Promise<DismissalSchedule[]> {
    return (await this.dismissalModule.load({ type: 'schedules' })).schedules;
  }

  async saveDismissalSchedules(schedules: DismissalSchedule[]): Promise<void> {
    await this.dismissalModule.execute({ type: 'save-schedules', schedules });
  }

  async addDismissalCall(call: DismissalCallRequest): Promise<void> {
    await this.dismissalModule.execute({
      type: 'request-call',
      student: {
        id: call.student_id,
        name: call.student_name,
        class_name: call.class_name,
        section: call.section
      },
      requester: { id: call.requested_by, name: call.requested_by_name },
      id: call.id,
      requestTime: call.request_time
    });
  }

  async getActiveDismissalCalls(): Promise<DismissalCallRequest[]> {
    return (await this.dismissalModule.load({ type: 'active-calls' })).calls;
  }

  async updateDismissalCallStatus(callId: string, status: DismissalCallRequest['status']): Promise<void> {
    await this.dismissalModule.execute({ type: 'transition-call', callId, status });
  }

  subscribeToDismissalCalls(callback: (calls: DismissalCallRequest[]) => void): { unsubscribe: () => void } {
    return this.dismissalModule.subscribe(callback);
  }


  // Structure & Users
  getClasses() { return this.provider.getClasses(); }
  getClassesGroupedByGrade() { return this.provider.getClassesGroupedByGrade(); }
  getStudentsByClass(className: string, section?: string) { return this.provider.getStudentsByClass(className, section); }
  getClassProfileStats(className: string, section: string, fromDate: string, toDate: string) { return this.provider.getClassProfileStats(className, section, fromDate, toDate); }
  async saveClass(c: SchoolClass) {
    await this.rosterModule.execute({ type: 'save-class', schoolClass: c });
  }
  async deleteClass(cid: string) {
    await this.rosterModule.execute({ type: 'delete-class', classId: cid });
  }
  getUsers() { return this.provider.getUsers(); }
  saveUser(u: User) { return this.provider.saveUser(u); }
  deleteUser(uid: string) { return this.provider.deleteUser(uid); }

  // Support Extensions
  getSettingsModule() { return this.settingsModule; }
  getSettings() { return this.settingsModule.load(); }
  async saveSettings(s: SystemSettings) {
    await this.settingsModule.execute({ type: 'replace', settings: s });
  }
  /**
   * Recalculate today's attendance statuses based on new timing settings.
   * When assembly_time or grace_period change, existing records may need
   * their status updated from 'present'→'late' or 'late'→'present'.
   */
  async recalculateTodayAttendance(
    newAssemblyTime: string,
    newGracePeriod: number,
    newAbsenceTime: string
  ): Promise<{
    total: number;
    updated: number;
    presentToLate: number;
    lateToPresent: number;
    toAbsent: number;
    fromAbsent: number;
    details: { studentId: string; oldStatus: string; newStatus: string; minutesLate: number }[];
  }> {
    const today = getLocalISODate();
    const records = await this.provider.getAttendance(today);

    // Calculate new cutoffs
    const [h, m] = newAssemblyTime.split(':').map(Number);
    const [ah, am] = newAbsenceTime.split(':').map(Number);

    const toUpdate: AttendanceRecord[] = [];
    const details: { studentId: string; oldStatus: string; newStatus: string; minutesLate: number }[] = [];
    let presentToLate = 0;
    let lateToPresent = 0;
    let toAbsent = 0;
    let fromAbsent = 0;

    for (const record of records) {
      // Missing timestamp means this was an auto-absent record without physical presentation
      if (!record.timestamp) {
        continue;
      }

      const ts = new Date(record.timestamp);
      if (isNaN(ts.getTime())) continue;

      // Build out the cutoffs relative to the timestamp's date to avoid midnight crossover bugs
      const assemblyCutoff = new Date(ts);
      assemblyCutoff.setHours(h, (m || 0) + (newGracePeriod || 0), 0, 0);

      const absenceCutoff = new Date(ts);
      absenceCutoff.setHours(ah, am, 0, 0);

      let newStatus: 'present' | 'late' | 'absent' = 'present';
      let minutes_late = 0;

      if (ts.getTime() > absenceCutoff.getTime()) {
        newStatus = 'absent';
        minutes_late = Math.floor((ts.getTime() - assemblyCutoff.getTime()) / 60000);
      } else if (ts.getTime() > assemblyCutoff.getTime()) {
        newStatus = 'late';
        minutes_late = Math.floor((ts.getTime() - assemblyCutoff.getTime()) / 60000);
      } else {
        newStatus = 'present';
        minutes_late = 0;
      }

      if (newStatus !== record.status || minutes_late !== (record.minutes_late || 0)) {
        const oldStatus = record.status;
        
        if (oldStatus === 'present' && newStatus === 'late') presentToLate++;
        else if (oldStatus === 'late' && newStatus === 'present') lateToPresent++;
        else if (oldStatus !== 'absent' && newStatus === 'absent') toAbsent++;
        else if (oldStatus === 'absent' && newStatus !== 'absent') fromAbsent++;

        toUpdate.push({
          ...record,
          status: newStatus as any,
          minutes_late
        });

        details.push({
          studentId: record.student_id,
          oldStatus: oldStatus || 'unknown',
          newStatus,
          minutesLate: minutes_late
        });
      }
    }

    // Save updated records in batch
    if (toUpdate.length > 0) {
      await this.provider.saveAttendanceBatch(toUpdate);
    }

    const evaluableRecordsCount = records.filter(r => !!r.timestamp).length;

    return {
      total: evaluableRecordsCount,
      updated: toUpdate.length,
      presentToLate,
      lateToPresent,
      toAbsent,
      fromAbsent,
      details
    };
  }

  async sendBroadcast(targetRole: string, message: string, title: string) {
    await this.notificationsModule.execute({
      type: 'broadcast',
      title,
      message,
      targetAudience: targetRole as Notification['target_audience']
    });
  }
  async runDiagnostics() {
    const results = await this.provider.runDiagnostics();
    if (this.unsafeLocalFallback) {
      return results;
    }
    return results;
  }
  getAuthAuditLogs(filters: AuthAuditLogFilters) { return this.provider.getAuthAuditLogs(filters); }
  getClientErrorLogs(filters: ClientErrorLogFilters) { return this.provider.getClientErrorLogs(filters); }
  cleanupTelemetryLogs(retentionDays: number) { return this.provider.cleanupTelemetryLogs(retentionDays); }

  // ------------------------------------------------------------------
  // Offline-First Kiosk Methods (Only work with CloudProvider)
  // ------------------------------------------------------------------
  async preloadForKiosk() {
    const invalidateStudentLookup = () => this.rosterModule.invalidate();

    // ═══════════════════════════════════════════════════════════════
    // 🔄 HYBRID MODE: Use HybridProvider's preloadForKiosk
    // ═══════════════════════════════════════════════════════════════
    if (this.hybridProvider) {
      const result = await this.hybridProvider.preloadForKiosk();
      invalidateStudentLookup();
      return result;
    }

    if (this.provider instanceof CloudProvider) {
      const result = await (this.provider as CloudProvider).preloadForKiosk();
      invalidateStudentLookup();
      return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // 🏠 LOCAL MODE: Preload students from localStorage
    // ═══════════════════════════════════════════════════════════════
    if (this.provider instanceof LocalProvider) {
      try {
        const students = await this.provider.getStudents();
        const settings = await this.provider.getSettings();

        // Save settings for kiosk use
        if (isBrowser) {
          const kioskSettings = {
            assembly_time: settings?.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
            grace_period: settings?.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD,
            ...settings
          };
          localStorage.setItem(KIOSK_SETTINGS_KEY, JSON.stringify(kioskSettings));
        }

        const result = {
          ok: true,
          usedLocalSnapshot: true,
          cloudAvailable: false,
          studentCount: students.length,
          message: students.length === 0 ? 'لا يوجد طلاب مسجلين. يرجى إضافة الطلاب من لوحة الإدارة.' : undefined
        };
        invalidateStudentLookup();
        return result;
      } catch (error: any) {
        console.error('[Kiosk Local] Preload error:', error);
        return {
          ok: false,
          usedLocalSnapshot: false,
          cloudAvailable: false,
          studentCount: 0,
          message: error?.message || 'تعذر تحميل بيانات الطلاب من الوضع المحلي'
        };
      }
    }

    return Promise.resolve({ ok: false, usedLocalSnapshot: false, cloudAvailable: false, studentCount: 0, message: 'الوضع المحلي غير مدعوم' });
  }

  async markAttendanceFast(id: string): Promise<MarkAttendanceFastResult> {
    // ═══════════════════════════════════════════════════════════════
    // ☁️ CLOUD MODE: Use CloudProvider's optimized fast path
    // ═══════════════════════════════════════════════════════════════
    if (this.provider instanceof CloudProvider) {
      return (this.provider as CloudProvider).markAttendanceFast(id);
    }

    // ═══════════════════════════════════════════════════════════════
    // 🔀 HYBRID MODE: Use HybridProvider.markAttendance + immediate sync
    // HybridProvider saves to IndexedDB + queues for sync. We then
    // trigger syncNow('up') fire-and-forget for instant cloud push.
    // ═══════════════════════════════════════════════════════════════
    const inputId = id?.trim();
    if (!inputId) {
      return {
        ok: false,
        code: 'not_found' as const,
        message: 'الطالب غير موجود. تحقق من المعرف أو الرمز.'
      };
    }

    // Check if student exists
    const students = await this.provider.getStudents();
    const student = students.find(s => s.id === inputId);
    if (!student) {
      return {
        ok: false,
        code: 'not_found' as const,
        message: 'الطالب غير موجود. تحقق من المعرف أو الرمز.'
      };
    }

    // Apply the school-day policy before duplicate lookup so a holiday scan
    // never appears as a successful duplicate and emergency flows stay closed.
    const operationalSettings = await this.provider.getSettings();
    const timing = decideAttendanceTiming({
      occurredAt: getSyncedDate(),
      settings: {
        assembly_time: operationalSettings.assembly_time,
        grace_period: operationalSettings.grace_period,
        absence_time: operationalSettings.absence_time,
        work_days: operationalSettings.attendance_settings?.work_days ?? operationalSettings.work_days
      },
      holidays: operationalSettings.attendance_settings?.academic_holidays
    });
    if (timing.allowed === false) {
      return {
        ok: false,
        code: 'closed' as const,
        message: timing.reason === 'holiday'
          ? 'الكشك متوقف اليوم حسب التقويم الدراسي.'
          : 'تعذر تحديد وقت الحضور.'
      };
    }

    // Check if already marked today
    const today = timing.date;
    const todayAttendance = await this.provider.getAttendance(today);
    const existingRecord = todayAttendance.find(a => a.student_id === inputId);
    const alreadyMarked = existingRecord && existingRecord.status !== 'absent';

    if (alreadyMarked) {
      // Get stats for duplicate case
      const studentAttendance = await this.provider.getStudentAttendance(inputId);
      const late_count = studentAttendance.filter(a => a.status === 'late').length;
      const totalMinutes = studentAttendance.reduce((sum, a) => sum + (a.minutes_late || 0), 0);

      return {
        ok: true,
        code: 'duplicate' as const,
        status: existingRecord?.status,
        student,
        minutes_late: existingRecord?.minutes_late || 0,
        timestamp: existingRecord?.timestamp,
        message: 'تم تسجيل الطالب مسبقاً لهذا اليوم',
        stats: {
          late_count,
          todayMinutes: existingRecord?.minutes_late || 0,
          totalMinutes
        }
      };
    }

    // Mark attendance via provider (HybridProvider saves to IndexedDB + sync_queue)
    const legacy = await this.provider.markAttendance(inputId);

    if (!legacy.success) {
      return {
        ok: false,
        code: 'not_found' as const,
        message: legacy.message
      };
    }

    const recStatus = legacy.record?.status;
    const result: MarkAttendanceFastResult = {
      ok: legacy.success,
      code: recStatus === 'late' || recStatus === 'absent' ? 'late' : 'present',
      status: recStatus === 'absent' || recStatus === 'late' || recStatus === 'present' ? recStatus : undefined,
      student: legacy.student,
      minutes_late: legacy.record?.minutes_late || 0,
      timestamp: legacy.record?.timestamp,
      message: legacy.message,
      stats: legacy.stats
    };

    if (legacy.success && legacy.record && legacy.student) {
      this._triggerWhatsApp(legacy.record, legacy.student);
    }

    // ✅ HYBRID: Trigger immediate sync to cloud (fire-and-forget)
    // HybridProvider.markAttendance already re-enables syncNow internally,
    // but we add a safety net here for the Kiosk/Scanner path
    if (this.hybridProvider && legacy.success) {
      syncService.syncNow('up').catch(e => 
        logger.warn('DB', 'markAttendanceFast hybrid sync failed:', e)
      );
    }

    return result;
  }

  // getSyncStatus, getPendingCount, onSyncStatusChange, and forceSyncNow 
  // are now defined earlier in the class to support HybridProvider

  /**
   * Get comprehensive debug information for verification
   * Call from browser console: db.getFullDebugInfo()
   */
  getFullDebugInfo() {
    const supabaseInfo = getSupabaseDebugInfo();
    const dbInfo = this.getDebugInfo();

    return {
      ...dbInfo,
      supabase: supabaseInfo,
      provider: this.provider.constructor.name,
      syncStatus: this.provider instanceof CloudProvider ?
        { ...(this.provider as CloudProvider).getSyncStatus() } :
        undefined
    };
  }
  // ── Activity Log ──────────────────────────────────────────────
  private _getActivityLog(): ActivityLogEntry[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVITY_LOG) || '[]');
    } catch { return []; }
  }

  private _saveActivityLog(entries: ActivityLogEntry[]): void {
    // Keep max 500 entries
    const trimmed = entries.slice(0, 500);
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_LOG, JSON.stringify(trimmed));
  }

  async logActivity(action: ActivityAction, description: string, opts?: {
    user_id?: string; user_name?: string;
    target_id?: string; target_name?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const entry: ActivityLogEntry = {
      id: crypto.randomUUID(),
      action,
      description,
      user_id: opts?.user_id,
      user_name: opts?.user_name,
      target_id: opts?.target_id,
      target_name: opts?.target_name,
      metadata: opts?.metadata,
      created_at: new Date().toISOString()
    };
    const log = this._getActivityLog();
    log.unshift(entry);
    this._saveActivityLog(log);
  }

  async getActivityLog(limit?: number): Promise<ActivityLogEntry[]> {
    const log = this._getActivityLog();
    return limit ? log.slice(0, limit) : log;
  }

  async clearActivityLog(): Promise<void> {
    localStorage.removeItem(STORAGE_KEYS.ACTIVITY_LOG);
  }
}

export const db = new Database();

// Export debug info globally for browser console access
if (typeof window !== 'undefined') {
  (window as any).__haderDebug = {
    db: db,
    getInfo: () => db.getFullDebugInfo(),
    logInfo: () => console.table(db.getFullDebugInfo())
  };
  logger.info('System', '✅ Hader Ready — __haderDebug.logInfo() for diagnostics, localStorage.setItem("hader:debug","true") for verbose logs');
}
