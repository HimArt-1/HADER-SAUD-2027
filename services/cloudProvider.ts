// =============================================================================
// نظام حاضر (Hader) - Cloud Provider
// =============================================================================
// Cloud database provider using Supabase with offline-first kiosk support

import { supabase, getSupabaseDebugInfo, logError, supabaseStatus } from './supabase';
import { logger } from './logger';
import {
  Student, AttendanceRecord, ExitRecord, ViolationRecord, Notification,
  DashboardStats, ReportFilter, DailySummary, STORAGE_KEYS, SystemSettings,
  DiagnosticResult, Role, SchoolClass, User, AppTheme, ClassStatsSummary,
  AuthAuditLog, ClientErrorLog, RecorderInfo, ATTENDANCE_DEFAULTS,
  GuardianExcuseRecord
} from '../types';
import { CanonicalStudent } from '../types/import';
import { appCache, staticCache, realtimeCache, CACHE_KEYS } from './cache';
import { localDb, queueChange, getLastSyncTime, setLastSyncTime, recordSyncTombstone } from './localDb';
import { cacheHolidays, getCachedHolidays, normalizeAcademicHolidays } from './academicCalendarService';
import { syncService } from './syncService';
import { SyncState as SyncStateType } from './syncTypes';
import { broadcastSettingsUpdate } from './settingsBroadcast';
import { buildBootstrapAdminUser, validateBootstrapAdmin } from './bootstrapAdmin';
import {
  SyncState, KioskAttendanceEvent, MarkAttendanceFastResult, KioskStorage, KioskSettingsType,
  IDatabaseProvider, IStudentAffairsProvider, AuthAuditLogFilters, ClientErrorLogFilters,
  CACHE_TTL,
  KIOSK_CACHE_KEY, KIOSK_QUEUE_KEY, KIOSK_SETTINGS_KEY,
  KIOSK_ATTENDANCE_KEY, DEVICE_ID_KEY, isBrowser
} from './dbTypes';
import { ensurePasswordForCloud } from './security';
import { applySettingsRowToCloud, rememberRemoteSettingsPk, resolveSettingsUpsertId } from './settingsRemoteId';
import {
  mapStudent, mapAttendance, mapSettingsFromDB, mapSettingsToDB,
  mapNotificationRow, getLocalISODate, getLocalDateStr,
  getSyncedNow, getSyncedDate, getSyncedISOString,
  normalizeStudentId, normalizeClassName, normalizeSectionName,
  normalizeAssignedClasses, normalizeAssignedSections,
  buildClassSectionTargetId, buildStructureFromStudents, safeParse,
  readSqlQueue, pushSqlQueueEntry, sqlEscape, sqlValue, buildUpsertSql, getRandomMessage
} from './dbHelpers';
import { resolveRecorder } from './recorderResolver';
import { accessPolicy } from '../modules/access';
import {
  decideAttendanceTiming,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate
} from '../modules/attendance';

const { notificationMatchesUser } = accessPolicy;

// Module-level reference to CloudProvider for cross-tab cache invalidation
export let cloudProviderRef: CloudProvider | null = null;

const EXIT_REQUESTER_COLUMNS = ['requester_relation', 'requester_relation_other'];

const isMissingExitRequesterColumnError = (error: any) => {
  const message = String(error?.message || '');
  return EXIT_REQUESTER_COLUMNS.some(column =>
    message.includes(`'${column}' column`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`exits.${column}`)
  );
};

const stripExitRequesterColumns = <T extends Record<string, any>>(payload: T): T => {
  const next = { ...payload };
  for (const column of EXIT_REQUESTER_COLUMNS) delete next[column];
  return next;
};

const mapGuardianExcuseRow = (row: any): GuardianExcuseRecord => ({
  id: row.id,
  student_id: row.student_id,
  student_name: row.student_name ?? null,
  class_name: row.class_name ?? null,
  section: row.section ?? null,
  guardian_id: row.guardian_id ?? null,
  guardian_name: row.guardian_name ?? null,
  guardian_phone: row.guardian_phone ?? null,
  absence_date: row.absence_date,
  reason: row.reason,
  attachment_url: row.attachment_url,
  attachment_path: row.attachment_path,
  attachment_name: row.attachment_name ?? null,
  attachment_type: row.attachment_type ?? null,
  attachment_size: row.attachment_size ?? null,
  status: row.status || 'pending',
  admin_notes: row.admin_notes ?? null,
  reviewed_by: row.reviewed_by ?? null,
  reviewed_by_label: row.reviewed_by_label ?? null,
  reviewed_at: row.reviewed_at ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at ?? null
});

export class LocalKioskStorage implements KioskStorage {
  private memorySnapshot: Student[] | null = null;
  private memoryAttendance: { date: string; ids: string[] } | null = null;
  private memoryQueue: KioskAttendanceEvent[] = [];

  private read(key: string) {
    if (!isBrowser) return null;
    return localStorage.getItem(key);
  }

  private write(key: string, value: any) {
    if (!isBrowser) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('[KioskStorage] Failed to write', key, error);
    }
  }

  async loadSnapshot(): Promise<Student[] | null> {
    const cached = safeParse<Student[]>(this.read(KIOSK_CACHE_KEY));
    if (cached) {
      this.memorySnapshot = cached;
      return cached;
    }
    return this.memorySnapshot;
  }

  async saveSnapshot(students: Student[]): Promise<void> {
    this.memorySnapshot = students;
    this.write(KIOSK_CACHE_KEY, students);
  }

  async loadAttendanceCache(): Promise<string[]> {
    const today = getLocalISODate();
    const cached = safeParse<{ date: string; ids: string[] }>(this.read(KIOSK_ATTENDANCE_KEY)) || this.memoryAttendance;
    if (cached && cached.date === today) {
      return cached.ids || [];
    }
    return [];
  }

  async saveAttendanceCache(ids: string[]): Promise<void> {
    const payload = { date: getLocalISODate(), ids };
    this.memoryAttendance = payload;
    this.write(KIOSK_ATTENDANCE_KEY, payload);
  }

  async loadQueue(): Promise<KioskAttendanceEvent[]> {
    const cached = safeParse<KioskAttendanceEvent[]>(this.read(KIOSK_QUEUE_KEY));
    if (cached) {
      this.memoryQueue = cached;
      return cached;
    }
    return this.memoryQueue;
  }

  async saveQueue(events: KioskAttendanceEvent[]): Promise<void> {
    this.memoryQueue = events;
    this.write(KIOSK_QUEUE_KEY, events);
  }
}


// Supabase Broadcast Helper for Dismissal Calls (Realtime fallback)
const broadcastDismissalEvent = async (event: string, callId: string) => {
    if (!supabaseStatus.isConfigured || typeof window === 'undefined') return;
    try {
        const channel = supabase.channel('dismissal_calls_sync');
        channel.subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
                channel.send({
                    type: 'broadcast',
                    event: event,
                    payload: { id: callId }
                });
                setTimeout(() => supabase.removeChannel(channel), 1000);
            }
        });
    } catch (e) {
        console.warn('Failed to broadcast dismissal event', e);
    }
};

export class CloudProvider implements IDatabaseProvider, IStudentAffairsProvider {
  private static readonly PERF_THRESHOLDS_MS = {
    kioskPreloadWarn: 2000,
    getStudentsWarn: 1200,
    forceSyncWarn: 3000,
    backgroundTickWarn: 800,
  };

  // Offline-First: Local cache for instant kiosk access
  private localStudentsCache: Student[] = [];
  private attendanceCache: string[] = [];
  private queueCache: KioskAttendanceEvent[] = [];
  private kioskStorage: KioskStorage = new LocalKioskStorage();
  private kioskSettings: KioskSettingsType | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private periodicSyncInterval: ReturnType<typeof setInterval> | null = null;
  private syncState: SyncState = { status: 'idle', pending: 0 };
  private syncListeners: ((state: SyncState) => void)[] = [];
  private deviceId: string | null = null;
  // BroadcastChannel for instant cross-tab attendance sync
  private attendanceBroadcast: BroadcastChannel | null = null;

  // Store event listener references for cleanup
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;

  constructor() {
    // Set module-level reference for cross-tab cache invalidation
    cloudProviderRef = this;

    if (isBrowser) {
      // Store handler references for cleanup
      this.onlineHandler = () => {
        this.setSyncStatus({ ...this.syncState, status: 'online' });
        syncService.syncNow('up').catch(e => logger.warn('Sync', 'Online sync failed:', e));
      };
      this.offlineHandler = () => {
        this.setSyncStatus({ ...this.syncState, status: 'offline' });
      };

      window.addEventListener('online', this.onlineHandler);
      window.addEventListener('offline', this.offlineHandler);

      // BroadcastChannel for instant cross-tab attendance sync
      if ('BroadcastChannel' in window) {
        try {
          this.attendanceBroadcast = new BroadcastChannel('hader:attendance:channel');
          logger.debug('Kiosk', 'Attendance BroadcastChannel initialized');
        } catch (e) {
          console.warn('[Kiosk] BroadcastChannel not available:', e);
        }
      }

      // Listen for background sync updates to invalidate local cache
      window.addEventListener('hader:settings-synced', () => {
        this.invalidateKioskSettingsCache();
        logger.debug('Kiosk', 'Settings invalidated after sync-down');
      });

      // Periodic sync delegated to SyncService — no longer running our own timer
      // (SyncService handles sync_queue draining)
    }
  }

  private async writeDeleteTombstone(tableName: string, recordId: string): Promise<void> {
    const deletedAt = new Date().toISOString();
    await recordSyncTombstone(tableName, recordId, deletedAt, false);

    try {
      const { error } = await supabase
        .from('sync_tombstones')
        .upsert({
          id: `${tableName}:${recordId}`,
          table_name: tableName,
          record_id: recordId,
          deleted_at: deletedAt,
          created_at: deletedAt
        }, { onConflict: 'id' });

      if (!error) {
        await localDb.sync_tombstones.update(`${tableName}:${recordId}`, { _synced: true });
      } else {
        logger.warn('Sync', `Failed to write tombstone for ${tableName}:${recordId}`, error);
      }
    } catch (error) {
      logger.warn('Sync', `Failed to write tombstone for ${tableName}:${recordId}`, error);
    }
  }

  /**
   * Cleanup method to prevent memory leaks
   * Should be called when the provider is no longer needed
   */
  cleanup(): void {
    // Clear intervals
    if (this.periodicSyncInterval) {
      clearInterval(this.periodicSyncInterval);
      this.periodicSyncInterval = null;
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    // Close BroadcastChannel
    if (this.attendanceBroadcast) {
      this.attendanceBroadcast.close();
      this.attendanceBroadcast = null;
    }

    // Remove event listeners
    if (isBrowser) {
      if (this.onlineHandler) {
        window.removeEventListener('online', this.onlineHandler);
        this.onlineHandler = null;
      }
      if (this.offlineHandler) {
        window.removeEventListener('offline', this.offlineHandler);
        this.offlineHandler = null;
      }
    }

    // Clear listeners
    this.syncListeners = [];
  }

  // Get sync status
  getSyncStatus(): SyncState { return this.syncState; }
  getPendingCount(): number { return this.syncState.pending; }

  // Subscribe to sync status changes
  onSyncStatusChange(callback: (state: SyncState) => void): () => void {
    this.syncListeners.push(callback);
    return () => {
      this.syncListeners = this.syncListeners.filter(l => l !== callback);
    };
  }

  private setSyncStatus(next: SyncState) {
    this.syncState = next;
    this.syncListeners.forEach(l => l(next));
  }

  private async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    if (!isBrowser) {
      this.deviceId = 'server-device';
      return this.deviceId;
    }
    try {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing) {
        this.deviceId = existing;
        return existing;
      }
      const generated = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, generated);
      this.deviceId = generated;
      return generated;
    } catch (error) {
      console.warn('[Kiosk] Failed to persist device id, using memory id', error);
      this.deviceId = this.deviceId || `memory-${crypto.randomUUID?.() || getSyncedNow()}`;
      return this.deviceId;
    }
  }

  private async getQueue(): Promise<KioskAttendanceEvent[]> {
    // Always reload from storage to avoid stale cache
    const cached = await this.kioskStorage.loadQueue();
    this.queueCache = cached;
    this.setSyncStatus({ ...this.syncState, pending: cached.length });
    return cached;
  }

  private async setQueue(queue: KioskAttendanceEvent[]) {
    this.queueCache = queue;
    await this.kioskStorage.saveQueue(queue);
    this.setSyncStatus({ ...this.syncState, pending: queue.length });
  }

  private async getAttendanceCache(): Promise<string[]> {
    // Always reload from storage to avoid stale cache
    this.attendanceCache = await this.kioskStorage.loadAttendanceCache();
    return this.attendanceCache;
  }

  private async setAttendanceCache(ids: string[]) {
    this.attendanceCache = ids;
    await this.kioskStorage.saveAttendanceCache(ids);
  }

  private async loadTodayAttendance(): Promise<string[]> {
    const today = getLocalISODate();
    const { data, error } = await supabase
      .from('attendance_logs')
      .select('student_id')
      .eq('date', today);
    if (error || !data) return [];
    return data.map(l => String(l.student_id));
  }

  private async saveKioskSettings(settings: SystemSettings) {
    try {
      const attendanceSettings = settings.attendance_settings || {};
      const holidays = normalizeAcademicHolidays(attendanceSettings.academic_holidays);
      const payload = {
        assembly_time: settings.assembly_time,
        grace_period: settings.grace_period,
        absence_time: settings.absence_time,
        work_days: attendanceSettings.work_days ?? settings.work_days,
        academic_holidays: holidays,
        late_message: settings.kiosk_settings?.late_message ?? settings.late_message,
        early_message: settings.kiosk_settings?.early_message ?? settings.early_message,
        late_messages: settings.kiosk_settings?.late_messages ?? settings.late_messages,
        early_messages: settings.kiosk_settings?.early_messages ?? settings.early_messages
      };
      this.kioskSettings = payload;
      if (isBrowser) {
        localStorage.setItem(KIOSK_SETTINGS_KEY, JSON.stringify(payload));
        cacheHolidays(holidays);
      }
    } catch (error) {
      console.warn('[Kiosk] Failed to persist settings', error);
    }
  }

  /** Clear the kioskSettings in-memory + localStorage cache so next read fetches fresh values */
  invalidateKioskSettingsCache(): void {
    this.kioskSettings = null;
    if (isBrowser) {
      localStorage.removeItem(KIOSK_SETTINGS_KEY);
    }
    logger.debug('Kiosk', 'Settings cache invalidated');
  }

  private async getCachedKioskSettings(): Promise<KioskSettingsType> {
    if (this.kioskSettings) return this.kioskSettings;
    if (isBrowser) {
      const cached = safeParse<KioskSettingsType>(localStorage.getItem(KIOSK_SETTINGS_KEY));
      if (cached) {
        this.kioskSettings = cached;
        return cached;
      }
    }
    try {
      const settings = await this.getSettings();
      const attendanceSettings = settings.attendance_settings || {};
      this.kioskSettings = {
        assembly_time: settings.assembly_time,
        grace_period: settings.grace_period,
        absence_time: settings.absence_time,
        work_days: attendanceSettings.work_days ?? settings.work_days,
        academic_holidays: normalizeAcademicHolidays(attendanceSettings.academic_holidays),
        late_message: settings.kiosk_settings?.late_message ?? settings.late_message,
        early_message: settings.kiosk_settings?.early_message ?? settings.early_message,
        late_messages: settings.kiosk_settings?.late_messages ?? settings.late_messages,
        early_messages: settings.kiosk_settings?.early_messages ?? settings.early_messages
      };
      return this.kioskSettings;
    } catch {
      return { 
        assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME, 
        grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD, 
        absence_time: ATTENDANCE_DEFAULTS.ABSENCE_TIME,
        work_days: [...ATTENDANCE_DEFAULTS.WORK_DAYS] 
      };
    }
  }

  /**
   * @deprecated — Sync is now handled by SyncService.
   * All callers should use syncService.syncNow() directly.
   */
  private async processSyncQueue(_force = false) {
    syncService.syncNow('up').catch(e => logger.warn('Sync', 'SyncService delegation failed:', e));
  }



  // ═══════════════════════════════════════════════════════════════
  // Preload students for Kiosk (Turbo Kiosk - Offline-First)
  // ═══════════════════════════════════════════════════════════════
  async preloadForKiosk(): Promise<{ ok: boolean; usedLocalSnapshot: boolean; cloudAvailable: boolean; studentCount: number; message?: string; }> {
    const startedAt = performance.now();
    const result = { ok: false, usedLocalSnapshot: false, cloudAvailable: false, studentCount: 0, message: '' as string | undefined };

    try {
      // ═══════════════════════════════════════════════════════════════
      // Step 1: Try to load students from Supabase (explicit columns only)
      // ═══════════════════════════════════════════════════════════════
      try {
        const { data, error } = await supabase
          .from('students')
          .select('id, name, class_name, section, guardian_phone')
          .eq('is_active', true); // Only active students

        if (!error && data && data.length > 0) {
          this.localStudentsCache = data.map(mapStudent);
          await this.kioskStorage.saveSnapshot(this.localStudentsCache);
          result.cloudAvailable = true;
          result.ok = true;
          result.studentCount = this.localStudentsCache.length;
        } else if (error) {
          console.warn('[Kiosk] Failed to load students from cloud, will fallback', error);
        }
      } catch (cloudError: any) {
        console.warn('[Kiosk] Cloud fetch error, trying local snapshot', cloudError);
      }

      // ═══════════════════════════════════════════════════════════════
      // Step 2: Fallback to local snapshot if cloud failed
      // ═══════════════════════════════════════════════════════════════
      if (!result.ok) {
        const snapshot = await this.kioskStorage.loadSnapshot();
        if (snapshot && snapshot.length > 0) {
          this.localStudentsCache = snapshot;
          result.usedLocalSnapshot = true;
          result.ok = true;
          result.studentCount = snapshot.length;
          result.message = 'استخدام البيانات المحلية لعدم توفر الاتصال';
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // Step 3: If no data available, throw error
      // ═══════════════════════════════════════════════════════════════
      if (!result.ok) {
        throw new Error('لا يوجد اتصال ولا توجد نسخة محلية للطلاب');
      }

      // Ensure snapshot is saved (even if from cloud)
      await this.kioskStorage.saveSnapshot(this.localStudentsCache);

      // ═══════════════════════════════════════════════════════════════
      // Step 4: Load and persist system settings (assembly time + grace period)
      // ═══════════════════════════════════════════════════════════════
      let settings: SystemSettings | null = null;
      try {
        settings = await this.getSettings();
        await this.saveKioskSettings(settings);
      } catch (error) {
        console.warn('[Kiosk] Unable to fetch settings from cloud, using cached', error);
        const cachedSettings = safeParse<SystemSettings | null>(isBrowser ? localStorage.getItem(KIOSK_SETTINGS_KEY) : null);
        if (cachedSettings) {
          settings = cachedSettings;
        } else {
          // Fallback to defaults
          settings = {
            assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
            grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD
          } as SystemSettings;
          await this.saveKioskSettings(settings);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // Step 5: Load today's attendance (only student_id for today's date)
      // ═══════════════════════════════════════════════════════════════
      let todayAttendanceIds: string[] = [];
      if (result.cloudAvailable) {
        try {
          const today = getLocalISODate();
          const { data: attendanceData, error: attendanceError } = await supabase
            .from('attendance_logs')
            .select('student_id, status')
            .eq('date', today);

          if (!attendanceError && attendanceData) {
            // ✅ استثناء الغائبين من الكاش لأنهم قابلين لإعادة التسجيل
            todayAttendanceIds = attendanceData
              .filter((r: any) => r.status !== 'absent')
              .map((r: any) => String(r.student_id));
          }
        } catch (error) {
          console.warn('[Kiosk] Failed to load today attendance from cloud', error);
        }
      } else {
        // Use cached attendance if cloud unavailable
        todayAttendanceIds = await this.kioskStorage.loadAttendanceCache();
      }

      // Merge local queue into attendance IDs to avoid re-marking locally queued students
      const localQueue = await this.kioskStorage.loadQueue();
      const today = getLocalISODate();
      const localQueueIds = localQueue
        .filter(q => q.date === today)
        .map(q => q.student_id);
      const mergedIds = [...new Set([...todayAttendanceIds, ...localQueueIds])];

      // Save attendance cache
      await this.setAttendanceCache(mergedIds);

      // ═══════════════════════════════════════════════════════════════
      // Step 6: Initialize sync status and start background sync
      // ═══════════════════════════════════════════════════════════════
      const queue = await this.getQueue();
      this.setSyncStatus({
        status: result.cloudAvailable ? 'online' : 'offline',
        pending: queue.length,
        lastSync: result.cloudAvailable ? getSyncedISOString() : undefined
      });

      // Start background sync engine
      this.startBackgroundSync();

      const elapsedMs = Math.round(performance.now() - startedAt);
      const level = elapsedMs > CloudProvider.PERF_THRESHOLDS_MS.kioskPreloadWarn ? 'warn' : 'info';
      logger[level](
        'Performance',
        `[Kiosk] preloadForKiosk completed in ${elapsedMs}ms (cloud=${result.cloudAvailable}, snapshot=${result.usedLocalSnapshot}, students=${result.studentCount})`
      );

      return result;
    } catch (e: any) {
      console.error('[Kiosk] Preload failed:', e);
      const queue = await this.getQueue().catch(() => []);
      this.setSyncStatus({
        status: 'error',
        pending: queue.length,
        lastError: e?.message || 'تعذر تهيئة وضع الكشك'
      });
      return {
        ...result,
        ok: false,
        message: e?.message || 'تعذر تهيئة وضع الكشك',
        studentCount: this.localStudentsCache.length || 0
      };
    } finally {
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs > CloudProvider.PERF_THRESHOLDS_MS.kioskPreloadWarn) {
        logger.warn('Performance', `[Kiosk] preloadForKiosk slow path detected: ${elapsedMs}ms`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Fast attendance marking (PURE LOCAL - No Supabase calls)
  // ═══════════════════════════════════════════════════════════════
  async markAttendanceFast(inputId: string): Promise<MarkAttendanceFastResult> {
    // ═══════════════════════════════════════════════════════════════
    // Step 1: Validate and normalize input
    // ═══════════════════════════════════════════════════════════════
    const id = inputId?.trim();
    if (!id) {
      return { ok: false, code: 'not_found', message: 'الطالب غير موجود. تحقق من المعرف أو الرمز.' };
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 1.5: Check Work Days (School Days) + Academic Holidays
    // ═══════════════════════════════════════════════════════════════
    const settings = await this.getCachedKioskSettings();
    const academicHolidays = settings.academic_holidays ?? getCachedHolidays();
    const timing = decideAttendanceTiming({
      occurredAt: getSyncedDate(),
      settings,
      holidays: academicHolidays,
      // A physical scan proves arrival. Even after the automatic absence cutoff,
      // the student must become late rather than remain absent.
      markAfterAbsenceAsAbsent: false
    });

    if (timing.allowed === false) {
      return {
        ok: false,
        code: 'closed',
        message: timing.reason === 'holiday'
          ? '⛔ عذراً، النظام متوقف اليوم (عطلة رسمية)'
          : 'تعذر تحديد وقت الحضور'
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 2: Load student from cache (fallback to snapshot if needed)
    // ═══════════════════════════════════════════════════════════════
    if (!this.localStudentsCache.length) {
      const cached = await this.kioskStorage.loadSnapshot();
      this.localStudentsCache = cached || [];
    }

    const student = this.localStudentsCache.find(s => s.id === id);
    if (!student) {
      return { ok: false, code: 'not_found', message: 'الطالب غير موجود. تحقق من المعرف أو الرمز.' };
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 3: Check if already marked today (from cache or queue)
    // ═══════════════════════════════════════════════════════════════
    const today = timing.date;
    const attendanceIds = await this.getAttendanceCache();
    const queue = await this.getQueue();
    const inQueue = queue.some(q => q.student_id === id && q.date === today);
    const alreadyMarked = attendanceIds.includes(id) || inQueue;

    if (alreadyMarked) {
      const queuedRecord = queue.find(q => q.student_id === id && q.date === today);

      // Calculate stats from queue only (PURE LOCAL)
      const studentQueueRecords = queue.filter(q => q.student_id === id);
      const late_count = studentQueueRecords.filter(q => q.status === 'late').length;
      const totalMinutes = studentQueueRecords.reduce((sum, q) => sum + (q.minutes_late || 0), 0);

      return {
        ok: true,
        code: 'duplicate',
        status: queuedRecord?.status || 'present',
        student,
        minutes_late: queuedRecord?.minutes_late || 0,
        timestamp: queuedRecord?.timestamp,
        message: 'تم تسجيل الطالب مسبقاً لهذا اليوم',
        stats: {
          late_count,
          todayMinutes: queuedRecord?.minutes_late || 0,
          totalMinutes
        }
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 4: Compute attendance status (present/late) from settings
    // ═══════════════════════════════════════════════════════════════
    const isLate = timing.status !== 'present';
    const minutes_late = timing.minutes_late;
    const timestamp = timing.timestamp;

    // ═══════════════════════════════════════════════════════════════
    // Step 5: Create attendance event
    // ═══════════════════════════════════════════════════════════════
    const status = timing.status;
    const event: KioskAttendanceEvent = {
      id: `local_${getSyncedNow()}_${id}`,
      student_id: id,
      status: status,
      minutes_late,
      timestamp,
      date: today,
      device_id: await this.getDeviceId(),
      created_at: timestamp
    };

    // ═══════════════════════════════════════════════════════════════
    // Step 6: Update queue and attendance cache (PURE LOCAL)
    // ═══════════════════════════════════════════════════════════════
    const updatedQueue = [...queue, event];
    await this.setQueue(updatedQueue);

    const updatedAttendance = [...attendanceIds, id];
    await this.setAttendanceCache(updatedAttendance);

    // ═══════════════════════════════════════════════════════════════
    // Step 6.1: إرسال فوري إلى Supabase (fire-and-forget)
    // هذا يُفعّل Supabase Realtime لباقي الأجهزة عبر الشبكة
    // ═══════════════════════════════════════════════════════════════
    this.pushAttendanceToCloud(event).catch(err => {
      console.warn('[Kiosk] فشل الإرسال الفوري، سيُعاد عبر sync:', err);
    });

    // ═══════════════════════════════════════════════════════════════
    // Step 6.5: Notify other pages/tabs about the new attendance (REALTIME LOCAL)
    // ═══════════════════════════════════════════════════════════════
    const attendanceRecord: AttendanceRecord = {
      id: event.id,
      student_id: event.student_id,
      date: event.date,
      timestamp: event.timestamp,
      status: event.status,
      minutes_late: event.minutes_late,
      recorded_by: null,
      recorded_by_label: 'kiosk',
      device_id: event.device_id
    };

    // Dispatch custom event for same-tab listeners
    window.dispatchEvent(new CustomEvent('hader:attendance-update', {
      detail: { record: attendanceRecord, student }
    }));

    // Dispatch storage event for cross-tab communication
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'hader:attendance_logs',
      newValue: JSON.stringify([attendanceRecord])
    }));

    // بث عبر BroadcastChannel للتبويبات الأخرى في نفس المتصفح (أسرع من StorageEvent)
    if (this.attendanceBroadcast) {
      try {
        this.attendanceBroadcast.postMessage({
          type: 'attendance-marked',
          record: attendanceRecord,
          student
        });
      } catch (e) { /* ignore broadcast errors */ }
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 7: Calculate stats from queue only (PURE LOCAL - no cloud calls)
    // ═══════════════════════════════════════════════════════════════
    const studentQueueRecords = updatedQueue.filter(q => q.student_id === id);
    const late_count = studentQueueRecords.filter(q => q.status === 'late').length;
    const totalMinutes = studentQueueRecords.reduce((sum, q) => sum + (q.minutes_late || 0), 0);

    const stats = {
      late_count,
      todayMinutes: minutes_late,
      totalMinutes
    };

    // ═══════════════════════════════════════════════════════════════
    // Step 8: Get message from settings
    // ═══════════════════════════════════════════════════════════════
    const message = isLate
      ? getRandomMessage(settings?.late_messages, settings?.late_message, 'لقد تأخرت عن التجمع')
      : getRandomMessage(settings?.early_messages, settings?.early_message, 'أهلاً بك! وصلت في الوقت المناسب');

    return {
      ok: true,
      code: isLate ? 'late' : 'present',
      status: event.status,
      student,
      minutes_late,
      timestamp,
      message,
      stats
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Instant Cloud Push - Sends attendance to Supabase immediately
  // Triggers Supabase Realtime for cross-device sync
  // ═══════════════════════════════════════════════════════════════
  private async pushAttendanceToCloud(event: KioskAttendanceEvent): Promise<void> {
    const recorder = await resolveRecorder('kiosk');
    const payload = {
      student_id: event.student_id,
      date: event.date,
      timestamp: event.timestamp,
      status: event.status,
      minutes_late: event.minutes_late,
      recorded_by: recorder.recorded_by,
      recorded_by_label: 'kiosk', // Always force 'kiosk' for Telegram channel routing
      device_id: event.device_id,
    };

    const { error } = await supabase
      .from('attendance_logs')
      .upsert(payload, { onConflict: 'student_id,date', ignoreDuplicates: false });

    if (!error || error.code === '23505') {
      // نجح الإرسال أو مكرر — نحذف من الكيوش المحلي لتجنب الإرسال المزدوج
      const queue = await this.getQueue();
      const filtered = queue.filter(q => q.id !== event.id);
      await this.setQueue(filtered);
      if (error?.code === '23505') {
        logger.debug('Kiosk', 'سجل مكرر في السحابة، تم تجاهله');
      } else {
        logger.debug('Kiosk', '✅ تم الإرسال الفوري إلى السحابة');
      }
    } else {
      // ═══════════════════════════════════════════════════════════════
      // فشل الإرسال الفوري → نضيف إلى sync_queue للمحاولة عبر SyncService
      // هذا يضمن وصول السجل إلى Supabase حتى لو فشل الإرسال الفوري
      // ═══════════════════════════════════════════════════════════════
      console.error('[Kiosk] ❌ فشل الإرسال الفوري:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      try {
        await queueChange('attendance_logs', 'INSERT', payload);
        // حذف من kiosk queue لتجنب الازدواج — syncService سيتولى الأمر
        const queue = await this.getQueue();
        const filtered = queue.filter(q => q.id !== event.id);
        await this.setQueue(filtered);
        logger.debug('Kiosk', '🔄 تمت إضافة السجل إلى طابور المزامنة للمحاولة لاحقاً');
      } catch (queueErr) {
        console.error('[Kiosk] فشل إضافة السجل إلى طابور المزامنة:', queueErr);
        // يبقى في kiosk queue كملاذ أخير
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Background Sync Engine - Start periodic sync loop
  // ═══════════════════════════════════════════════════════════════
  startBackgroundSync() {
    if (this.syncInterval) return; // Already running

    // Delegate periodic sync to SyncService (which has its own optimized timer)
    syncService.startAutoSync();

    // Set a lightweight status-check timer + kiosk queue drain
    this.syncInterval = setInterval(async () => {
      const tickStartedAt = performance.now();
      try {
        const remaining = await localDb.sync_queue.count();
        const status = !navigator.onLine ? 'offline' : remaining > 0 ? 'syncing' : 'online';
        this.setSyncStatus({
          ...this.syncState,
          status,
          pending: remaining,
          ...(remaining === 0 ? { lastSync: new Date().toISOString() } : {})
        });

        // ═══════════════════════════════════════════════════════════════
        // Drain kiosk queue → sync_queue (safety net for stuck records)
        // ═══════════════════════════════════════════════════════════════
        if (navigator.onLine) {
          const kioskQueue = await this.getQueue();
          if (kioskQueue.length > 0) {
            logger.debug('Kiosk', `🔄 Draining ${kioskQueue.length} stuck kiosk queue items to sync_queue`);
            for (const event of kioskQueue) {
              const recorder = await resolveRecorder('kiosk');
              await queueChange('attendance_logs', 'INSERT', {
                student_id: event.student_id,
                date: event.date,
                timestamp: event.timestamp,
                status: event.status,
                minutes_late: event.minutes_late,
                recorded_by: recorder.recorded_by,
                recorded_by_label: recorder.recorded_by_label,
                device_id: event.device_id,
              });
            }
            await this.setQueue([]); // Clear kiosk queue after draining
            logger.debug('Kiosk', '✅ Kiosk queue drained successfully');
          }
        }
      } catch { /* ignore */ }
      finally {
        const elapsedMs = Math.round(performance.now() - tickStartedAt);
        if (elapsedMs > CloudProvider.PERF_THRESHOLDS_MS.backgroundTickWarn) {
          logger.warn('Performance', `[Sync] background status tick took ${elapsedMs}ms`);
        } else {
          logger.debug('Performance', `[Sync] background status tick ${elapsedMs}ms`);
        }
      }
    }, 30000);
  }

  stopBackgroundSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // Force sync now (for Admin refresh button)
  async forceSyncNow(): Promise<void> {
    const startedAt = performance.now();
    await syncService.syncNow('bidirectional');
    const elapsedMs = Math.round(performance.now() - startedAt);
    const level = elapsedMs > CloudProvider.PERF_THRESHOLDS_MS.forceSyncWarn ? 'warn' : 'info';
    logger[level]('Performance', `[Sync] forceSyncNow completed in ${elapsedMs}ms`);
  }

  async getStudents(options?: { forceSync?: boolean }): Promise<Student[]> {
    const startedAt = performance.now();
    try {
      // Cloud mode should be cloud-first to keep all devices aligned.
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase
            .from('students')
            .select('id, name, class_name, section, guardian_phone, guardian_name, is_active, created_at, updated_at');

          if (!error && data) {
            const mapped = data.map(mapStudent);
            await localDb.students.bulkPut(mapped);
            const elapsedMs = Math.round(performance.now() - startedAt);
            const level = elapsedMs > CloudProvider.PERF_THRESHOLDS_MS.getStudentsWarn ? 'warn' : 'debug';
            logger[level]('Performance', `[Students] getStudents cloud path in ${elapsedMs}ms (count=${mapped.length})`);
            return mapped;
          }
        } catch (syncError) {
          console.warn('[CloudProvider] getStudents cloud-first failed, falling back to local cache', syncError);
        }
      }

      // Offline/fallback path
      const local = await localDb.students.toArray();
      const elapsedMs = Math.round(performance.now() - startedAt);
      logger.debug('Performance', `[Students] getStudents local path in ${elapsedMs}ms (count=${local.length})`);
      return local;
    } catch (error) {
      console.warn('Error reading students:', error);
      return [];
    }
  }

  // Helper to sync students from Cloud -> Local
  private async syncStudentsDown() {
    if (!navigator.onLine) return;

    const { data, error } = await supabase
      .from('students')
      .select('id, name, class_name, section, guardian_phone, guardian_name, is_active, created_at, updated_at');

    if (error || !data) return;

    // Map and Save to Local
    const mapped = data.map(mapStudent);
    await localDb.students.bulkPut(mapped);
  }

  async getStudentsByGuardian(guardian_phone: string): Promise<Student[]> {
    // 🌐 CLOUD MODE: Always fetch fresh from Supabase
    try {
      const { data, error } = await supabase
        .from('students')
        .select('id, name, class_name, section, guardian_phone, guardian_name, is_active, created_at, updated_at')
        .eq('guardian_phone', guardian_phone);

      if (error) {
        console.error('❌ Error loading students by guardian:', error);
        throw error;
      }

      const students = (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        class_name: row.class_name,
        section: row.section,
        guardian_phone: row.guardian_phone ?? '',
        guardian_name: row.guardian_name ?? '',
        is_active: row.is_active ?? true,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

      logger.debug('Students', `✅ Loaded ${students.length} students for guardian ${guardian_phone}`);
      return students;
    } catch (error) {
      console.error('❌ Failed to load students by guardian:', error);
      throw error;
    }
  }

  async getStudentById(id: string): Promise<Student | undefined> {
    // 🌐 CLOUD MODE: Always fetch fresh from Supabase
    try {
      const { data, error } = await supabase
        .from('students')
        .select('id, name, class_name, section, guardian_phone, guardian_name, is_active, created_at, updated_at')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found - return undefined
          return undefined;
        }
        console.error('❌ Error loading student:', error);
        throw error;
      }

      if (!data) return undefined;

      return {
        id: data.id,
        name: data.name,
        class_name: data.class_name,
        section: data.section,
        guardian_phone: data.guardian_phone ?? '',
        guardian_name: data.guardian_name ?? '',
        is_active: data.is_active ?? true,
        created_at: data.created_at,
        updated_at: data.updated_at
      };
    } catch (error) {
      console.error('❌ Failed to load student by ID:', error);
      throw error;
    }
  }

  async saveStudents(students: Student[]): Promise<Student[]> {
    // 🌐 CLOUD MODE: Upsert students to Supabase (insert or update)
    try {
      // Build payload - let Supabase generate IDs if not provided
      const mapped = students.map(s => ({
        id: s.id || undefined,
        name: s.name,
        class_name: s.class_name,
        section: s.section,
        guardian_phone: s.guardian_phone ?? null,
        guardian_name: s.guardian_name ?? null,
        is_active: (typeof s.is_active === 'boolean' ? s.is_active : true),
      }));

      logger.debug('Students', `📝 Upserting ${mapped.length} students to Supabase`);

      const { data, error } = await supabase
        .from('students')
        .upsert(mapped, { onConflict: 'id' })
        .select('id, name, class_name, section, guardian_phone, guardian_name, is_active, created_at, updated_at');

      if (error) {
        console.error('❌ Failed to upsert students:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('No data returned from Supabase after upsert');
      }

      const savedStudents = data.map((row: any) => ({
        id: row.id,
        name: row.name,
        class_name: row.class_name,
        section: row.section,
        guardian_phone: row.guardian_phone ?? '',
        guardian_name: row.guardian_name ?? '',
        is_active: row.is_active ?? true,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

      // Log count only, not sensitive student IDs
      logger.debug('Students', `✅ Saved ${savedStudents.length} students to Supabase`);

      savedStudents.forEach((student) => {
        const columns = [
          'id',
          'name',
          'class_name',
          'section',
          'guardian_phone',
          'guardian_name',
          'is_active',
          'created_at',
          'updated_at'
        ];
        const values = [
          sqlValue(student.id),
          sqlValue(student.name),
          sqlValue(student.class_name),
          sqlValue(student.section),
          sqlValue(student.guardian_phone ?? null),
          sqlValue(student.guardian_name ?? null),
          sqlValue(student.is_active ?? true),
          sqlValue(student.created_at ?? null),
          sqlValue(student.updated_at ?? null)
        ];
        const sql = buildUpsertSql('students', columns, values, ['id']);
        pushSqlQueueEntry({
          id: `sql-${getSyncedNow()}-${Math.random().toString(16).slice(2)}`,
          table: 'students',
          action: 'upsert',
          sql,
          created_at: getSyncedISOString()
        });
      });

      appCache.delete(CACHE_KEYS.STUDENTS);

      return savedStudents;
    } catch (error: any) {
      console.error('❌ Failed to save students to Supabase:', error);
      console.error('Error details:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });
      // Show user-friendly error
      if (error?.code === 'PGRST301' || error?.message?.includes('permission denied')) {
        throw new Error('خطأ في الصلاحيات: تأكد من إعدادات RLS في Supabase. يجب السماح بالقراءة والكتابة لجدول students.');
      }
      throw error;
    }
  }

  async updateStudent(student: Student): Promise<Student> {
    // 🌐 CLOUD MODE: Update student in Supabase and return updated record
    try {
      const payload = {
        name: student.name,
        class_name: student.class_name,
        section: student.section,
        guardian_phone: student.guardian_phone ?? null,
        guardian_name: student.guardian_name ?? null,
        is_active: (typeof student.is_active === 'boolean' ? student.is_active : true)
      };

      logger.debug('Students', `📝 Updating student in Supabase: ${student.id}`);

      const { data, error } = await supabase
        .from('students')
        .update(payload)
        .eq('id', student.id)
        .select('id, name, class_name, section, guardian_phone, guardian_name, is_active, created_at, updated_at')
        .single();

      if (error) {
        console.error('❌ Failed to update student:', error);
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from Supabase after update');
      }

      const updatedStudent: Student = {
        id: data.id,
        name: data.name,
        class_name: data.class_name,
        section: data.section,
        guardian_phone: data.guardian_phone ?? '',
        guardian_name: data.guardian_name ?? '',
        is_active: data.is_active ?? true,
        created_at: data.created_at,
        updated_at: data.updated_at
      };

      logger.debug('Students', `✅ Updated student in Supabase: ${student.id}`);

      appCache.delete(CACHE_KEYS.STUDENTS);

      return updatedStudent;
    } catch (error) {
      console.error('❌ Failed to update student:', error);
      throw error;
    }
  }

  async renameStudentId(currentId: string, nextId: string): Promise<Student> {
    try {
      if (currentId === nextId) {
        const existing = await this.getStudentById(currentId);
        if (!existing) throw new Error('الطالب غير موجود');
        return existing;
      }

      const { data: studentData, error: studentError } = await supabase
        .from('students')
        .select('*')
        .eq('id', currentId)
        .single();

      if (studentError || !studentData) {
        throw studentError || new Error('تعذر العثور على الطالب الحالي');
      }

      const payload = {
        ...studentData,
        id: nextId,
        updated_at: getSyncedISOString()
      };

      // Step 1: Insert new student
      const { error: insertError } = await supabase
        .from('students')
        .insert(payload);

      if (insertError) {
        throw insertError;
      }

      // Step 2: Update related tables — with rollback if any fail
      try {
        const updateRelated = async (table: string, column: string = 'student_id') => {
          const { error } = await supabase
            .from(table)
            .update({ [column]: nextId })
            .eq(column, currentId);
          if (error) throw error;
        };

        await Promise.all([
          updateRelated('attendance_logs'),
          updateRelated('exits'),
          updateRelated('violations')
        ]);

        const { error: notificationError } = await supabase
          .from('notifications')
          .update({ target_id: nextId })
          .eq('target_id', currentId)
          .eq('target_audience', 'student');
        if (notificationError) throw notificationError;

        // Step 3: Delete old student
        const { error: deleteError } = await supabase
          .from('students')
          .delete()
          .eq('id', currentId);

        if (deleteError) {
          throw deleteError;
        }
      } catch (relatedError) {
        // ROLLBACK: Revert related tables back to old ID, then delete the new student
        console.error('❌ renameStudentId failed at related tables, rolling back...', relatedError);
        const revertRelated = async (table: string, column: string = 'student_id') => {
          await supabase.from(table).update({ [column]: currentId }).eq(column, nextId).catch(() => { });
        };
        await Promise.all([
          revertRelated('attendance_logs'),
          revertRelated('exits'),
          revertRelated('violations'),
        ]).catch(() => { });
        await supabase.from('notifications').update({ target_id: currentId }).eq('target_id', nextId).eq('target_audience', 'student').catch(() => { });
        // Delete the newly created student
        await supabase.from('students').delete().eq('id', nextId).catch(() => { });
        throw relatedError;
      }

      const updatedStudent: Student = {
        id: nextId,
        name: studentData.name,
        class_name: studentData.class_name,
        section: studentData.section,
        guardian_phone: studentData.guardian_phone ?? '',
        guardian_name: studentData.guardian_name ?? '',
        is_active: studentData.is_active ?? true,
        created_at: studentData.created_at,
        updated_at: payload.updated_at
      };

      this.localStudentsCache = this.localStudentsCache.map((student) =>
        student.id === currentId ? { ...student, id: nextId } : student
      );
      this.attendanceCache = this.attendanceCache.map((id) => (id === currentId ? nextId : id));
      await this.kioskStorage.saveSnapshot(this.localStudentsCache);
      await this.kioskStorage.saveAttendanceCache(this.attendanceCache);
      appCache.delete(CACHE_KEYS.STUDENTS);

      return updatedStudent;
    } catch (error) {
      console.error('❌ Failed to update student ID:', error);
      throw error;
    }
  }

  async deleteStudent(student_id: string): Promise<void> {
    const { error } = await supabase.from('students').delete().eq('id', student_id);
    if (error) throw error;
    await this.writeDeleteTombstone('students', student_id);

    // Invalidate cache
    appCache.delete(CACHE_KEYS.STUDENTS);
  }

  async getAttendance(date?: string): Promise<AttendanceRecord[]> {
    // Get data from Supabase
    let query = supabase.from('attendance_logs').select('*');
    if (date) query = query.eq('date', date);
    const { data, error } = await query;
    const cloudRecords = error ? [] : data.map(mapAttendance);

    // Get local queue records that haven't been synced yet
    const queue = await this.getQueue();
    const localRecords: AttendanceRecord[] = queue
      .filter(event => !date || event.date === date)
      .map(event => ({
        id: event.id,
        student_id: event.student_id,
        date: event.date,
        timestamp: event.timestamp,
        status: event.status,
        minutes_late: event.minutes_late,
        recorded_by: null,
        recorded_by_label: 'kiosk',
        device_id: event.device_id
      }));

    // Merge: use cloud records as base, add local records that don't exist in cloud
    const cloudStudentIds = new Set(cloudRecords.filter(r => r.date === (date || r.date)).map(r => `${r.student_id}_${r.date}`));
    const uniqueLocalRecords = localRecords.filter(r => !cloudStudentIds.has(`${r.student_id}_${r.date}`));

    return uniqueAttendanceByStudentDate([...cloudRecords, ...uniqueLocalRecords], date);
  }

  async getAttendanceRange(startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    // Get data from Supabase
    const { data, error } = await supabase
      .from('attendance_logs')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });
    const cloudRecords = error ? [] : data.map(mapAttendance);

    // Get local queue records that haven't been synced yet
    const queue = await this.getQueue();
    const localRecords: AttendanceRecord[] = queue
      .filter(event => event.date >= startDate && event.date <= endDate)
      .map(event => ({
        id: event.id,
        student_id: event.student_id,
        date: event.date,
        timestamp: event.timestamp,
        status: event.status,
        minutes_late: event.minutes_late,
        recorded_by: null,
        recorded_by_label: 'kiosk',
        device_id: event.device_id
      }));

    // Merge: use cloud records as base, add local records that don't exist in cloud
    const cloudStudentDateKeys = new Set(cloudRecords.map(r => `${r.student_id}_${r.date}`));
    const uniqueLocalRecords = localRecords.filter(r => !cloudStudentDateKeys.has(`${r.student_id}_${r.date}`));

    return uniqueAttendanceByStudentDate([...cloudRecords, ...uniqueLocalRecords]);
  }

  async getAllAttendance(): Promise<AttendanceRecord[]> {
    let allData: any[] = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('attendance_logs')
        .select('*')
        .order('date', { ascending: false })
        .order('id', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error('BackUp Error:', error);
        break;
      }

      if (!data || data.length === 0) break;

      allData = [...allData, ...data];
      if (data.length < pageSize) break; // Last page
      page++;
    }

    return uniqueAttendanceByStudentDate(allData.map(mapAttendance));
  }

  async saveAttendanceBatch(records: AttendanceRecord[]): Promise<void> {
    if (!records || records.length === 0) return;

    // Supabase upsert in chunks to avoid payload limits
    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize).map(r => ({
        id: r.id,
        student_id: r.student_id,
        date: r.date,
        time: r.timestamp, // Assuming 'time' column is timestamp in DB, need to verify or use correct mapping. 
        // Wait, mapAttendance converts DB to 'timestamp'. DB column is 'timestamp' or 'created_at'? 
        // Let's check mapAttendance. 
        // mapAttendance uses row.timestamp.
        timestamp: r.timestamp,
        status: r.status,
        minutes_late: r.minutes_late || 0,
        device_id: r.device_id
      }));

      // Use the attendance uniqueness rule so repeated sync attempts do not emit 409 conflicts.
      const { error } = await supabase
        .from('attendance_logs')
        .upsert(chunk, { onConflict: 'student_id,date', ignoreDuplicates: false });
      if (error && error.code !== '23505') {
        console.error('Batch Import Error:', error);
        throw error;
      }
    }
  }

  async deleteAttendanceRange(startDate: string, endDate: string): Promise<void> {
    const { data: rowsBeforeDelete, error: selectError } = await supabase
      .from('attendance_logs')
      .select('id')
      .gte('date', startDate)
      .lte('date', endDate);
    if (selectError) {
      logger.warn('Sync', 'Unable to prefetch attendance ids for tombstones before range delete', selectError);
    }

    const { error } = await supabase
      .from('attendance_logs')
      .delete()
      .gte('date', startDate)
      .lte('date', endDate);
    if (error) {
      console.error('Delete Range Error:', error);
      throw error;
    }

    for (const row of rowsBeforeDelete || []) {
      if (row?.id) await this.writeDeleteTombstone('attendance_logs', row.id);
    }
  }

  async getStudentAttendance(student_id: string): Promise<AttendanceRecord[]> {
    const { data, error } = await supabase.from('attendance_logs').select('*').eq('student_id', student_id).order('date', { ascending: false });
    return error ? [] : uniqueAttendanceByStudentDate(data.map(mapAttendance));
  }

  async markAttendance(id: string): Promise<{ success: boolean, message: string, record?: AttendanceRecord, student?: Student, stats?: { late_count: number, todayMinutes: number, totalMinutes: number } }> {
    try {
      // 1. Offline Verification
      const student = await localDb.students.get(id);
      if (!student) {
        // Fallback: Verify online if possible? For now, offline-first means trust local.
        return { success: false, message: 'رقم الطالب غير صحيح (تأكد من تحديث البيانات)' };
      }

      // 2. Logic (Local)
      const now = getSyncedDate();
      const settings = await this.getCachedKioskSettings();
      const timing = decideAttendanceTiming({
        occurredAt: now,
        settings,
        holidays: getCachedHolidays()
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ عذراً، النظام متوقف اليوم (عطلة رسمية)'
            : 'تعذر تحديد وقت الحضور'
        };
      }
      const today = timing.date;
      const arrivalStatus = timing.status === 'absent' ? 'late' : timing.status;
      const isLate = arrivalStatus === 'late';
      const minutes_late = timing.minutes_late;

      // 3. Check Duplicate (Local)
      const existing = await localDb.attendance_logs.where({ student_id: id, date: today }).first();
      if (existing) {
        // ✅ إذا كان "غائب" → نسمح بالتعديل إلى "حاضر/متأخر"
        if (existing.status === 'absent') {
          existing.status = arrivalStatus;
          existing.minutes_late = minutes_late;
          existing.timestamp = timing.timestamp;
          await localDb.attendance_logs.put(existing);
          await queueChange('attendance_logs', 'UPDATE', existing);
          syncService.syncNow('up').catch(e => logger.warn('Sync', 'Attendance sync failed:', e));

          const allLogs = await localDb.attendance_logs.where('student_id').equals(id).toArray();
          const late_count = allLogs.filter(l => l.status === 'late').length;
          const totalMinutes = allLogs.reduce((sum, l) => sum + (l.minutes_late || 0), 0);

          return {
            success: true,
            message: isLate ? `تم تحديث الحالة إلى متأخر (${minutes_late} دقيقة)` : 'تم تحديث الحالة إلى حاضر',
            record: existing,
            student,
            stats: { late_count, todayMinutes: minutes_late, totalMinutes }
          };
        }
        return { success: false, message: `تم تسجيل الدخول مسبقاً لهذا اليوم` };
      }

      // 4. Create Record (Optimistic)
      const record: AttendanceRecord = {
        id: crypto.randomUUID(),
        student_id: id,
        date: today,
        timestamp: timing.timestamp,
        status: arrivalStatus,
        minutes_late: minutes_late
      };

      // 5. Save Local & Queue Sync
      await localDb.attendance_logs.put(record);
      await queueChange('attendance_logs', 'INSERT', record);

      // Trigger sync engine explicitly safely
      syncService.syncNow('up').catch(e => logger.warn('Sync', 'Attendance sync failed:', e));

      // 6. Calc Stats (Local)
      const allLogs = await localDb.attendance_logs.where('student_id').equals(id).toArray();
      const late_count = allLogs.filter(l => l.status === 'late').length;
      const totalMinutes = allLogs.reduce((sum, l) => sum + (l.minutes_late || 0), 0);
      const stats = { late_count, todayMinutes: minutes_late, totalMinutes };

      return {
        success: true,
        message: isLate 
          ? getRandomMessage(settings?.late_messages, settings?.late_message, 'لقد تأخرت عن التجمع')
          : getRandomMessage(settings?.early_messages, settings?.early_message, 'أهلاً بك! وصلت في الوقت المناسب'),
        record,
        student,
        stats
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ محلي في التسجيل' };
    }
  }

  async addManualAttendance(record: {
    student_id: string;
    date: string;
    time: string;
  }): Promise<{
    success: boolean;
    message: string;
    record?: AttendanceRecord;
    student?: Student;
    status?: 'present' | 'late';
    minutes_late?: number;
  }> {
    try {
      const student = await this.getStudentById(record.student_id);
      if (!student) return { success: false, message: 'رقم الطالب غير صحيح' };

      const settings = await this.getSettings();

      const timing = decideAttendanceTiming({
        occurredAt: new Date(`${record.date}T${record.time}`),
        settings,
        holidays: settings.attendance_settings?.academic_holidays
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ لا يمكن التحضير في يوم عطلة'
            : 'يرجى إدخال تاريخ ووقت صالحين'
        };
      }
      const arrivalStatus = timing.status === 'absent' ? 'late' : timing.status;

      // Resolve recorder info (UUID if authenticated, label if not)
      const recorder = await resolveRecorder('admin-manual');

      const payload = {
        student_id: record.student_id,
        date: record.date,
        timestamp: timing.timestamp,
        status: arrivalStatus,
        minutes_late: timing.minutes_late,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label,
        device_id: 'admin-manual'
      };

      // Debug log for verification
      logger.debug('Attendance', 'addManualAttendance payload sample:', {
        student_id: payload.student_id,
        recorded_by: payload.recorded_by,
        recorded_by_label: payload.recorded_by_label
      });

      const { data: existingRecord, error: existingError } = await supabase
        .from('attendance_logs')
        .select('id')
        .eq('student_id', record.student_id)
        .eq('date', record.date)
        .maybeSingle();

      if (existingError) {
        console.error('Manual attendance existing-check error', existingError);
        return { success: false, message: 'حدث خطأ أثناء التحقق من السجل' };
      }

      if (existingRecord) {
        return { success: false, message: 'تم تسجيل حضور الطالب مسبقاً لهذا اليوم' };
      }

      const { data, error } = await supabase
        .from('attendance_logs')
        .insert(payload)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') return { success: false, message: 'تم تسجيل حضور الطالب مسبقاً لهذا اليوم' };
        console.error('Manual attendance error', error);
        return { success: false, message: 'حدث خطأ أثناء التسجيل' };
      }

      return {
        success: true,
        message: arrivalStatus === 'late' ? 'تم تسجيل الحضور كمتأخر' : 'تم تسجيل الحضور بنجاح',
        record: mapAttendance(data),
        student,
        status: arrivalStatus,
        minutes_late: timing.minutes_late
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال' };
    }
  }

  async addManualAbsence(record: {
    student_id: string;
    date: string;
  }): Promise<{
    success: boolean;
    message: string;
    record?: AttendanceRecord;
    student?: Student;
  }> {
    try {
      const student = await this.getStudentById(record.student_id);
      if (!student) return { success: false, message: 'رقم الطالب غير صحيح' };

      // Resolve recorder info (UUID if authenticated, label if not)
      const recorder = await resolveRecorder('admin-manual');

      const payload = {
        student_id: record.student_id,
        date: record.date,
        timestamp: new Date(record.date).toISOString(),
        status: 'absent',
        minutes_late: 0,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label,
        device_id: 'admin-manual'
      };

      // Debug log for verification
      logger.debug('Attendance', 'addManualAbsence payload sample:', {
        student_id: payload.student_id,
        recorded_by: payload.recorded_by,
        recorded_by_label: payload.recorded_by_label
      });

      const { data: existingRecord, error: existingError } = await supabase
        .from('attendance_logs')
        .select('id')
        .eq('student_id', record.student_id)
        .eq('date', record.date)
        .maybeSingle();

      if (existingError) {
        console.error('Manual absence existing-check error', existingError);
        return { success: false, message: 'حدث خطأ أثناء التحقق من السجل' };
      }

      if (existingRecord) {
        return { success: false, message: 'تم تسجيل غياب الطالب مسبقاً لهذا اليوم' };
      }

      const { data, error } = await supabase
        .from('attendance_logs')
        .insert(payload)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') return { success: false, message: 'تم تسجيل غياب الطالب مسبقاً لهذا اليوم' };
        console.error('Manual absence error', error);
        return { success: false, message: 'حدث خطأ أثناء التسجيل' };
      }

      return {
        success: true,
        message: 'تم تسجيل غياب الطالب بنجاح',
        record: mapAttendance(data),
        student
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال' };
    }
  }

  async deleteAttendance(student_id: string, date: string): Promise<{ success: boolean; message: string }> {
    try {
      const { data: rowsBeforeDelete, error: selectError } = await supabase
        .from('attendance_logs')
        .select('id')
        .eq('student_id', student_id)
        .eq('date', date);
      if (selectError) {
        logger.warn('Sync', 'Unable to prefetch attendance id for tombstone before delete', selectError);
      }

      const { error } = await supabase
        .from('attendance_logs')
        .delete()
        .eq('student_id', student_id)
        .eq('date', date);

      if (error) {
        console.error('Delete attendance error', error);
        return { success: false, message: 'فشل حذف التسجيل' };
      }

      for (const row of rowsBeforeDelete || []) {
        if (row?.id) await this.writeDeleteTombstone('attendance_logs', row.id);
      }

      return { success: true, message: 'تم حذف التسجيل بنجاح' };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال' };
    }
  }

  async getUnmarkedStudents(date: string, class_name: string, section: string): Promise<Student[]> {
    try {
      // Get all students in class
      const allStudents = await this.getStudentsByClass(class_name, section);

      // Get students who have attendance records for this date
      const { data: attendanceRecords } = await supabase
        .from('attendance_logs')
        .select('student_id')
        .eq('date', date);

      const markedStudentIds = new Set(attendanceRecords?.map(r => r.student_id) || []);

      // Return students without attendance records
      return allStudents.filter(s => !markedStudentIds.has(s.id));
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async bulkMarkAllPresent(params: {
    class_name: string;
    section: string;
    date: string;
  }): Promise<{
    success: boolean;
    message: string;
    count: number;
    students: Student[];
  }> {
    try {
      // Get all students in class
      const allStudents = await this.getStudentsByClass(params.class_name, params.section);

      if (allStudents.length === 0) {
        return { success: false, message: 'لا يوجد طلاب في هذا الصف', count: 0, students: [] };
      }

      const settings = await this.getSettings();
      const timing = decideAttendanceTiming({
        occurredAt: new Date(`${params.date}T12:00:00`),
        settings,
        holidays: settings.attendance_settings?.academic_holidays
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ لا يمكن التحضير الجماعي في يوم عطلة'
            : 'تاريخ التحضير غير صالح',
          count: 0,
          students: []
        };
      }

      // Get students who already have records
      const { data: existingRecords } = await supabase
        .from('attendance_logs')
        .select('student_id')
        .eq('date', params.date);

      const markedStudentIds = new Set(existingRecords?.map((r: { student_id: string }) => r.student_id) || []);

      // Filter out students who already have records
      const unmarkedStudents = allStudents.filter(s => !markedStudentIds.has(s.id));

      if (unmarkedStudents.length === 0) {
        return {
          success: true,
          message: 'جميع الطلاب مسجلين مسبقاً',
          count: allStudents.length,
          students: allStudents
        };
      }

      // Resolve recorder info (UUID if authenticated, label if not)
      const recorder = await resolveRecorder('admin-bulk');

      // Create attendance records for unmarked students
      const attendanceRecords = unmarkedStudents.map(student => ({
        student_id: student.id,
        date: params.date,
        timestamp: new Date(params.date).toISOString(),
        status: 'present',
        minutes_late: 0,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label,
        device_id: 'admin-bulk'
      }));

      // Debug log for verification
      logger.debug('Attendance', 'bulkMarkAllPresent payload sample:', {
        count: attendanceRecords.length,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label
      });

      const { error } = await supabase
        .from('attendance_logs')
        .upsert(attendanceRecords, { onConflict: 'student_id,date', ignoreDuplicates: true });

      if (error) {
        console.error('Bulk mark present error:', error);
        return { success: false, message: 'حدث خطأ أثناء التسجيل الجماعي', count: 0, students: [] };
      }

      return {
        success: true,
        message: `تم تسجيل ${unmarkedStudents.length} طالب حاضرين`,
        count: allStudents.length,
        students: allStudents
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال', count: 0, students: [] };
    }
  }

  async bulkMarkAbsent(params: {
    student_ids: string[];
    date: string;
  }): Promise<{
    success: boolean;
    message: string;
    count: number;
  }> {
    try {
      if (params.student_ids.length === 0) {
        return { success: false, message: 'لم يتم تحديد أي طالب', count: 0 };
      }

      const settings = await this.getSettings();
      const timing = decideAttendanceTiming({
        occurredAt: new Date(`${params.date}T12:00:00`),
        settings,
        holidays: settings.attendance_settings?.academic_holidays
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ لا يمكن تسجيل الغياب الجماعي في يوم عطلة'
            : 'تاريخ الغياب غير صالح',
          count: 0
        };
      }

      // Resolve recorder info (UUID if authenticated, label if not)
      const recorder = await resolveRecorder('admin-bulk');

      // Create absence records
      const absenceRecords = params.student_ids.map(student_id => ({
        student_id,
        date: params.date,
        timestamp: new Date(params.date).toISOString(),
        status: 'absent',
        minutes_late: 0,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label,
        device_id: 'admin-bulk'
      }));

      // Debug log for verification
      logger.debug('Attendance', 'bulkMarkAbsent payload sample:', {
        count: absenceRecords.length,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label
      });

      const { error } = await supabase
        .from('attendance_logs')
        .upsert(absenceRecords, { onConflict: 'student_id,date', ignoreDuplicates: false });

      if (error) {
        console.error('Bulk mark absent error:', error);
        return { success: false, message: 'حدث خطأ أثناء تسجيل الغياب', count: 0 };
      }

      return {
        success: true,
        message: `تم تسجيل ${params.student_ids.length} طالب غائبين`,
        count: params.student_ids.length
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال', count: 0 };
    }
  }

  async bulkMarkLate(params: {
    student_ids: string[];
    date: string;
    time: string;
  }): Promise<{
    success: boolean;
    message: string;
    count: number;
  }> {
    try {
      if (params.student_ids.length === 0) {
        return { success: false, message: 'لم يتم تحديد أي طالب', count: 0 };
      }

      const settings = await this.getSettings();
      const timing = decideAttendanceTiming({
        occurredAt: new Date(`${params.date}T${params.time}`),
        settings,
        holidays: settings.attendance_settings?.academic_holidays
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ لا يمكن تسجيل التأخير الجماعي في يوم عطلة'
            : 'تاريخ أو وقت التأخير غير صالح',
          count: 0
        };
      }

      // Resolve recorder info
      const recorder = await resolveRecorder('admin-bulk');

      // Create late records
      const lateRecords = params.student_ids.map(student_id => ({
        student_id,
        date: params.date,
        timestamp: timing.timestamp,
        status: 'late',
        minutes_late: timing.minutes_late,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label,
        device_id: 'admin-bulk'
      }));

      const { error } = await supabase
        .from('attendance_logs')
        .upsert(lateRecords, { onConflict: 'student_id,date', ignoreDuplicates: false });

      if (error) {
        console.error('Bulk mark late error:', error);
        return { success: false, message: 'حدث خطأ أثناء تسجيل التأخير', count: 0 };
      }

      return {
        success: true,
        message: `تم تسجيل ${params.student_ids.length} طالب متأخرين`,
        count: params.student_ids.length
      };

    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال', count: 0 };
    }
  }

  async updateAttendanceStatus(params: {
    student_ids: string[];
    date: string;
    new_status: 'present' | 'absent' | 'late';
  }): Promise<{
    success: boolean;
    message: string;
    updated_count: number;
  }> {
    try {
      if (params.student_ids.length === 0) {
        return { success: false, message: 'لم يتم تحديد أي طالب', updated_count: 0 };
      }

      // Resolve recorder info (UUID if authenticated, label if not)
      const recorder = await resolveRecorder('admin-edit');

      // Create new records with updated status
      const updatedRecords = params.student_ids.map(student_id => ({
        student_id,
        date: params.date,
        timestamp: new Date(params.date).toISOString(),
        status: params.new_status,
        minutes_late: params.new_status === 'late' ? (params as any).minutes_late ?? 0 : 0,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label,
        device_id: 'admin-edit'
      }));

      // Debug log for verification
      logger.debug('Attendance', 'updateAttendanceStatus payload sample:', {
        count: updatedRecords.length,
        recorded_by: recorder.recorded_by,
        recorded_by_label: recorder.recorded_by_label
      });

      const { error } = await supabase
        .from('attendance_logs')
        .upsert(updatedRecords, { onConflict: 'student_id,date', ignoreDuplicates: false });

      if (error) {
        console.error('Update attendance status error:', error);
        return { success: false, message: 'حدث خطأ أثناء التحديث', updated_count: 0 };
      }

      const statusText = params.new_status === 'present' ? 'حاضرين' : params.new_status === 'absent' ? 'غائبين' : 'متأخرين';

      return {
        success: true,
        message: `تم تحديث ${params.student_ids.length} طالب إلى ${statusText}`,
        updated_count: params.student_ids.length
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال', updated_count: 0 };
    }
  }

  subscribeToAttendance(callback: (record: AttendanceRecord) => void): { unsubscribe: () => void } {
    // Subscribe to Supabase realtime for cloud updates
    const subscription = supabase
      .channel('attendance_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
        (payload) => {
          if (payload.new) {
            callback(mapAttendance(payload.new));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'attendance_logs' },
        (payload) => {
          if (payload.new) {
            callback(mapAttendance(payload.new));
          }
        }
      )
      .subscribe();

    // Also listen for local kiosk attendance events (for instant updates)
    const localEventHandler = (e: Event) => {
      const customEvent = e as CustomEvent<{ record: AttendanceRecord; student: Student }>;
      if (customEvent.detail?.record) {
        callback(customEvent.detail.record);
      }
    };

    // Listen for storage events (cross-tab communication)
    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'hader:attendance_logs' && e.newValue) {
        try {
          const records = JSON.parse(e.newValue) as AttendanceRecord[];
          if (records.length > 0) {
            callback(records[records.length - 1]);
          }
        } catch { /* ignore parse errors */ }
      }
    };

    window.addEventListener('hader:attendance-update', localEventHandler);
    window.addEventListener('storage', storageHandler);

    // BroadcastChannel listener for cross-tab attendance sync
    let broadcastChannel: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        broadcastChannel = new BroadcastChannel('hader:attendance:channel');
        broadcastChannel.onmessage = (event: MessageEvent) => {
          if (event.data?.type === 'attendance-marked' && event.data?.record) {
            callback(event.data.record);
          }
        };
        logger.debug('Realtime', 'Attendance BroadcastChannel listener initialized');
      } catch (e) { /* BroadcastChannel not available */ }
    }

    return {
      unsubscribe: () => {
        supabase.removeChannel(subscription);
        window.removeEventListener('hader:attendance-update', localEventHandler);
        window.removeEventListener('storage', storageHandler);
        if (broadcastChannel) {
          broadcastChannel.close();
          broadcastChannel = null;
        }
      }
    };
  }

  async getDailySummary(date: string): Promise<DailySummary | null> {
    const { data } = await supabase.from('daily_summaries').select('*').eq('date', date).maybeSingle();
    return data as DailySummary;
  }

  async saveDailySummary(summary: DailySummary): Promise<void> {
    await supabase.from('daily_summaries').upsert({ date: summary.date, summary_data: summary.summary_data });
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const students = await this.getStudents();
    const today = getLocalISODate();
    const attendance = await this.getAttendance(today);
    const settings = await this.getSettings();
    const workDays = (settings?.attendance_settings as any)?.work_days ?? settings?.work_days ?? [...ATTENDANCE_DEFAULTS.WORK_DAYS];
    const isHoliday = !workDays.includes(new Date(today).getDay());

    const total_students = students.length;
    const counts = getAttendanceStatusCounts(attendance, total_students, { date: today, isHoliday });
    const present_count = counts.present;
    const late_count = counts.late;
    const absent_count = counts.absent;
    const attendance_rate = (total_students > 0 && !isHoliday) ? (counts.attended / total_students) * 100 : 0;
    return { total_students, present_count, late_count, absent_count, attendance_rate: Math.round(attendance_rate) };
  }

  async getWeeklyStats(): Promise<any[]> {
    // Calculate real weekly stats from attendance data
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
    const { data: students } = await supabase.from('students').select('id');
    const total_students = students?.length || 0;
    if (total_students === 0) return days.map(day => ({ day, presence: 0 }));

    const result: any[] = [];
    const today = getSyncedDate();

    for (let i = 4; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = getLocalDateStr(date);
      const dayIndex = date.getDay(); // 0 = Sunday

      const { data: logs } = await supabase.from('attendance_logs').select('*').eq('date', dateStr);
      const dayLogs = uniqueAttendanceByStudentDate((logs || []).map(mapAttendance), dateStr);
      const attendedCount = dayLogs.filter((l: any) => l.status === 'present' || l.status === 'late').length;
      const presence = total_students > 0 ? Math.round((attendedCount / total_students) * 100) : 0;

      result.push({ day: days[dayIndex] || days[0], presence });
    }
    return result;
  }

  async getClassStats(): Promise<any[]> {
    // Calculate real class stats
    const { data: classes } = await supabase.from('classes').select('*');
    const { data: students } = await supabase.from('students').select('*');
    const today = getLocalISODate();
    const { data: attendance } = await supabase.from('attendance_logs').select('*').eq('date', today);

    if (!classes || classes.length === 0) return [];

    const attendedIds = new Set((attendance || []).map(a => a.student_id));

    return (classes || []).map(cls => {
      const classStudents = (students || []).filter(s => s.class_name === cls.name);
      const absent_count = classStudents.filter(s => !attendedIds.has(s.id)).length;
      return { name: cls.name, absent: absent_count };
    });
  }

  async getAttendanceReport(filters: ReportFilter): Promise<{ summary: any, details: any[] }> {
    const attendanceQuery = supabase.from('attendance_logs').select('*').gte('date', filters.date_from).lte('date', filters.date_to);
    let studentQuery = supabase.from('students').select('*');
    if (filters.class_name) studentQuery = studentQuery.eq('class_name', filters.class_name);
    if (filters.section) studentQuery = studentQuery.eq('section', filters.section);

    const [attendanceResponse, studentResponse] = await Promise.all([attendanceQuery, studentQuery]);
    if (attendanceResponse.error) throw attendanceResponse.error;
    if (studentResponse.error) throw studentResponse.error;
    const logs = attendanceResponse.data;
    const studentData = studentResponse.data;
    const allLogs = uniqueAttendanceByStudentDate((logs || []).map(mapAttendance));
    const students: Student[] = (studentData || []).map(row => mapStudent(row));
    const studentsById = new Map<string, Student>(students.map(student => [student.id, student]));

    const details = allLogs.map(log => {
      const student = studentsById.get(log.student_id);
      if (!student) return null;
      return { student_id: log.student_id, studentName: student.name, className: student.class_name, section: student.section, date: log.date, time: log.timestamp, status: log.status };
    }).filter(Boolean);

    return {
      summary: { totalRecords: details.length, late: details.filter(d => d!.status === 'late').length, present: details.filter(d => d!.status === 'present').length },
      details: details as any[]
    };
  }

  async addExit(record: ExitRecord): Promise<void> {
    const payload = {
      student_id: record.student_id,
      reason: record.reason,
      exit_time: record.exit_time,
      date: record.date, // Store date-only portion for grouping and unique constraints
      requester_relation: record.requester_relation,
      requester_relation_other: record.requester_relation_other,
      supervisor_name: record.supervisor_name,
      created_by: record.created_by,
      notes: record.notes,
      status: record.status || 'approved'
    };

    const { error } = await supabase.from('exits').insert(payload);
    if (!error) return;

    if (isMissingExitRequesterColumnError(error)) {
      const { error: retryError } = await supabase.from('exits').insert(stripExitRequesterColumns(payload));
      if (retryError) throw retryError;
      return;
    }

    throw error;
  }

  async updateExit(exit: ExitRecord): Promise<void> {
    const payload = {
      reason: exit.reason,
      requester_relation: exit.requester_relation,
      requester_relation_other: exit.requester_relation_other,
      notes: exit.notes,
    };

    const { error } = await supabase
      .from('exits')
      .update(payload)
      .eq('id', exit.id);

    if (!error) return;

    if (isMissingExitRequesterColumnError(error)) {
      const { error: retryError } = await supabase
        .from('exits')
        .update(stripExitRequesterColumns(payload))
        .eq('id', exit.id);
      if (retryError) throw retryError;
      return;
    }

    throw error;
  }

  async deleteExit(id: string): Promise<void> {
    const { error } = await supabase.from('exits').delete().eq('id', id);
    if (error) throw error;
    await this.writeDeleteTombstone('exits', id);
  }


  async getTodayExits(): Promise<ExitRecord[]> {
    const today = getLocalISODate();
    return this.getExits(today);
  }

  async getExits(date?: string): Promise<ExitRecord[]> {
    let query = supabase.from('exits').select('*').order('exit_time', { ascending: false });
    if (date) query = query.eq('date', date);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
      id: d.id,
      student_id: d.student_id,
      reason: d.reason,
      exit_time: d.exit_time,
      date: d.date,
      created_by: d.created_by,
      requester_relation: d.requester_relation,
      requester_relation_other: d.requester_relation_other,
      supervisor_name: d.supervisor_name,
      notes: d.notes,
      status: d.status
    }));
  }

  async getStudentExits(student_id: string): Promise<ExitRecord[]> {
    const { data, error } = await supabase.from('exits').select('*').eq('student_id', student_id).order('exit_time', { ascending: false });
    if (error) throw error;
    return (data || []).map((d: any) => ({
      id: d.id,
      student_id: d.student_id,
      reason: d.reason,
      exit_time: d.exit_time,
      date: d.date,
      created_by: d.created_by,
      requester_relation: d.requester_relation,
      requester_relation_other: d.requester_relation_other,
      supervisor_name: d.supervisor_name,
      notes: d.notes,
      status: d.status
    }));
  }

  async addViolation(record: ViolationRecord): Promise<void> {
    const { error } = await supabase.from('violations').upsert({
      id: record.id,
      student_id: record.student_id,
      type: record.type,
      level: record.level,
      description: record.description,
      action_taken: record.action_taken,
      summon_guardian: record.summon_guardian,
      guardian_notified: record.guardian_notified,
      created_by: record.created_by,
      created_by_label: record.created_by_label,
      created_at: record.created_at,
      date: record.date
    }, { onConflict: 'id', ignoreDuplicates: false });
    if (error) throw error;
  }

  async deleteViolation(id: string): Promise<void> {
    const { error } = await supabase.from('violations').delete().eq('id', id);
    if (error) throw error;
    await this.writeDeleteTombstone('violations', id);
  }

  async getViolations(student_id?: string): Promise<ViolationRecord[]> {
    let query = supabase.from('violations').select('*');
    if (student_id) query = query.eq('student_id', student_id);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((d: any) => ({
      id: d.id,
      student_id: d.student_id,
      type: d.type,
      description: d.description,
      level: d.level,
      action_taken: d.action_taken,
      summon_guardian: d.summon_guardian,
      guardian_notified: d.guardian_notified,
      created_by: d.created_by,
      created_by_label: d.created_by_label,
      created_at: d.created_at,
      date: d.date
    }));
  }

  async getTodayViolations(): Promise<ViolationRecord[]> {
    const today = getLocalISODate();
    return this.getViolationsForDate(today);
  }

  async getViolationsForDate(date: string): Promise<ViolationRecord[]> {
    const { data, error } = await supabase.from('violations').select('*').eq('date', date).order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((d: any) => ({
      id: d.id,
      student_id: d.student_id,
      type: d.type,
      description: d.description,
      level: d.level,
      action_taken: d.action_taken,
      summon_guardian: d.summon_guardian,
      guardian_notified: d.guardian_notified,
      created_by: d.created_by,
      created_by_label: d.created_by_label,
      created_at: d.created_at,
      date: d.date
    }));
  }

  async addGuardianExcuse(record: GuardianExcuseRecord): Promise<void> {
    const { error } = await supabase.from('guardian_excuses').insert(record);
    if (error) throw error;
  }

  async updateGuardianExcuse(record: GuardianExcuseRecord): Promise<void> {
    const { error } = await supabase
      .from('guardian_excuses')
      .update({
        status: record.status,
        admin_notes: record.admin_notes ?? null,
        reviewed_by: record.reviewed_by ?? null,
        reviewed_by_label: record.reviewed_by_label ?? null,
        reviewed_at: record.reviewed_at ?? null,
        updated_at: record.updated_at || new Date().toISOString()
      })
      .eq('id', record.id);
    if (error) throw error;
  }

  async getGuardianExcuses(filters?: {
    student_id?: string;
    status?: GuardianExcuseRecord['status'] | 'all';
    limit?: number;
  }): Promise<GuardianExcuseRecord[]> {
    let query = supabase
      .from('guardian_excuses')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.student_id) query = query.eq('student_id', filters.student_id);
    if (filters?.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters?.limit) query = query.limit(filters.limit);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapGuardianExcuseRow);
  }

  async saveNotification(notification: Notification): Promise<void> {
    const createdAt = notification.created_at || getSyncedISOString();
    const payload: any = {
      id: notification.id || crypto.randomUUID(),
      title: notification.title || 'إشعار',
      message: notification.message,
      type: notification.type || 'general',
      target_audience: notification.target_audience,
      target_id: notification.target_id || null,
      is_popup: notification.is_popup ?? false,
      priority: notification.priority ?? 0,
      created_at: createdAt
    };

    if (notification.created_by) payload.created_by = notification.created_by;
    if (notification.expires_at) payload.expires_at = notification.expires_at;

    const { error } = await supabase.from('notifications').insert(payload);
    if (error) {
      logError(error, 'CloudProvider - Save Notification');
      throw error;
    }
  }

  async getStudentNotifications(student_id: string, className: string): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .or(`target_audience.eq.all,and(target_audience.eq.class,target_id.eq."${className}"),and(target_audience.eq.student,target_id.eq."${student_id}"),and(target_audience.eq.guardian,target_id.eq."${student_id}"),and(target_audience.eq.guardian,target_id.is.null)`)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map(mapNotificationRow);
  }

  async saveNotifications(notifications: Notification[]): Promise<void> {
    if (!notifications.length) return;
    const { error } = await supabase.from('notifications').insert(notifications);
    if (error) logError(error, 'CloudProvider - Save Notifications Batch');
  }

  async getUserNotifications(user: User, limit = 30): Promise<Notification[]> {
    let query = supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (user.role === Role.GUARDIAN) {
      query = query.in('target_audience', ['all', 'guardian', 'student', 'class']).limit(50);
    } else {
      query = query.limit(limit);
    }
    
    const { data, error } = await query;
    if (error || !data) return [];
    return data.map(mapNotificationRow).filter(n => notificationMatchesUser(n, user));
  }

  async getAllNotifications(limit = 200): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(mapNotificationRow);
  }

  subscribeToNotifications(user: User | 'kiosk', callback: (n: Notification) => void): { unsubscribe: () => void } {
    const sub = supabase
      .channel('notifications_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
        const n = mapNotificationRow(payload.new);
        if (notificationMatchesUser(n, user)) {
          callback(n);
        }
      })
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(sub) };
  }

  // --- Structure & Users (Cloud) ---
  async getClasses(): Promise<SchoolClass[]> {
    // Try cache first
    const cached = staticCache.get<SchoolClass[]>(CACHE_KEYS.CLASSES);
    if (cached) return cached;

    try {
      const { data } = await supabase.from('classes').select('*');
      const classes = data || [];
      staticCache.set(CACHE_KEYS.CLASSES, classes, CACHE_TTL.CLASSES);
      return classes;
    } catch { return []; }
  }

  async getClassesGroupedByGrade(): Promise<Record<string, SchoolClass[]>> {
    const classes = await this.getClasses();
    return classes.reduce((acc, cls) => {
      const key = (cls.name || 'غير محدد').trim();
      if (!acc[key]) acc[key] = [];
      acc[key].push(cls);
      return acc;
    }, {} as Record<string, SchoolClass[]>);
  }

  async getStudentsByClass(className: string, section?: string): Promise<Student[]> {
    let query = supabase
      .from('students')
      .select('id, name, class_name, section, guardian_phone')
      .eq('class_name', className);
    if (section) query = query.eq('section', section);
    const { data, error } = await query.order('name', { ascending: true });
    if (error || !data) return [];
    return data.map(mapStudent);
  }

  async getClassProfileStats(className: string, section: string, fromDate: string, toDate: string): Promise<ClassStatsSummary> {
    const students = await this.getStudentsByClass(className, section);
    const studentIds = students.map(s => s.id);
    const days = Math.max(1, Math.floor((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1);

    if (studentIds.length === 0) {
      return { present: 0, late: 0, absent: 0, exits: 0, violations: 0, totalStudents: 0, days };
    }

    const attendanceQuery = supabase
      .from('attendance_logs')
      .select('*')
      .in('student_id', studentIds)
      .gte('date', fromDate)
      .lte('date', toDate);

    const { data: attendance } = await attendanceQuery;
    const attendanceRows = uniqueAttendanceByStudentDate((attendance || []).map(mapAttendance));
    const counts = getAttendanceStatusCounts(attendanceRows, studentIds.length * days);
    const present = counts.present;
    const late = counts.late;
    const absent = counts.absent;

    const { data: exitsData } = await supabase
      .from('exits')
      .select('id,student_id')
      .in('student_id', studentIds)
      .gte('exit_time', `${fromDate}T00:00:00`)
      .lte('exit_time', `${toDate}T23:59:59`);

    const { data: violationsData } = await supabase
      .from('violations')
      .select('id,student_id')
      .in('student_id', studentIds)
      .gte('created_at', `${fromDate}T00:00:00`)
      .lte('created_at', `${toDate}T23:59:59`);

    return {
      present,
      late,
      absent,
      exits: exitsData?.length || 0,
      violations: violationsData?.length || 0,
      totalStudents: studentIds.length,
      days,
    };
  }

  async saveClass(schoolClass: SchoolClass): Promise<void> {
    // Only include 'id' for updates (valid UUIDs). For new classes, exclude it so Supabase can generate it.
    const { id, ...rest } = schoolClass;
    const newSections = Array.isArray(rest.sections)
      ? rest.sections.map(s => String(s))
      : [];

    // First, check if a class with this name already exists to merge sections
    const normalizedName = (rest.name || '').trim();
    let existingSections: string[] = [];
    if (normalizedName) {
      const { data: existing } = await supabase
        .from('classes')
        .select('id, sections')
        .ilike('name', normalizedName)
        .limit(1)
        .single();
      if (existing) {
        existingSections = Array.isArray(existing.sections) ? existing.sections : [];
      }
    }

    // Merge sections from existing class with new sections
    const mergedSections = Array.from(new Set([...existingSections, ...newSections])).sort((a, b) => a.localeCompare(b));

    let payload: any = {
      ...rest,
      sections: mergedSections,
    };
    // Quick UUID (insert without id if id is missing or non-UUID)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (id && uuidRe.test(id)) {
      payload = { ...payload, id };
    }
    // Use onConflict: 'name' since name has UNIQUE constraint
    await supabase.from('classes').upsert(payload, { onConflict: 'name' });
    staticCache.delete(CACHE_KEYS.CLASSES);

    const classColumns = Object.keys(payload);
    const classValues = classColumns.map((column) => sqlValue((payload as Record<string, unknown>)[column]));
    const classSql = buildUpsertSql('classes', classColumns, classValues, ['name']);
    pushSqlQueueEntry({
      id: `sql-${getSyncedNow()}-${Math.random().toString(16).slice(2)}`,
      table: 'classes',
      action: 'upsert',
      sql: classSql,
      created_at: getSyncedISOString()
    });
  }

  async deleteClass(classId: string): Promise<void> {
    const { error } = await supabase.from('classes').delete().eq('id', classId);
    if (error) throw error;
    await this.writeDeleteTombstone('classes', classId);
    // Invalidate cache
    staticCache.delete(CACHE_KEYS.CLASSES);
  }

  async getUsers(): Promise<User[]> {
    // 🌐 CLOUD MODE: Always fetch from Supabase, never use local storage
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, name, role, is_active, assigned_classes, assigned_sections, email, phone, can_use_whatsapp, created_at')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('❌ Error loading users from Supabase:', error);
        throw error;
      }

      // Map database records to User type
      const users = (data ?? []).map((u: any) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        is_active: u.is_active ?? true,
        assigned_classes: normalizeAssignedClasses(u.assigned_classes) ?? undefined,
        assigned_sections: normalizeAssignedSections(u.assigned_sections) ?? undefined,
        email: u.email ?? null,
        phone: u.phone ?? null,
        can_use_whatsapp: u.can_use_whatsapp ?? false,
        created_at: u.created_at
      }));

      logger.debug('Users', `✅ Loaded ${users.length} users from Supabase`);
      return users;
    } catch (error) {
      console.error('❌ Failed to load users from Supabase:', error);
      throw error;
    }
  }

  async saveUser(user: any): Promise<User> {
    // 🌐 CLOUD MODE: Insert/update user in Supabase
    try {
      // Destructure id - should not be sent for new users
      const { id, full_name, fullName, ...rest } = user;

      // Build the payload for Supabase insertion
      const payload: any = {
        username: rest.username,
        name: rest.name || fullName || full_name,
        role: rest.role,
        is_active: rest.is_active ?? true,
        email: rest.email ?? null,
        phone: rest.phone ?? null,
      };

      if (rest.can_use_whatsapp !== undefined && rest.can_use_whatsapp !== null) {
        payload.can_use_whatsapp = !!rest.can_use_whatsapp;
      }

      const hashedPwd = await ensurePasswordForCloud(rest.password);
      if (hashedPwd) {
        payload.password = hashedPwd;
        payload.password_hash_version = 1;
      }

      const assignedClasses = normalizeAssignedClasses(rest.assigned_classes ?? rest.assignedClasses);
      const assignedSections = normalizeAssignedSections(rest.assigned_sections ?? rest.assignedSections);
      payload.assigned_classes = rest.role === Role.SUPERVISOR_CLASS ? (assignedClasses ?? []) : null;
      payload.assigned_sections = assignedSections ?? null;

      logger.debug('Users', '📝 Saving user to Supabase');

      let data: any = null;
      let error: any = null;

      if (id) {
        logger.debug('Users', `📝 Updating user in Supabase: ${id}`);
        const response = await supabase
          .from('users')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        data = response.data;
        error = response.error;
      } else {
        logger.debug('Users', '📝 Inserting new user to Supabase');
        const response = await supabase
          .from('users')
          .insert([payload])
          .select()
          .single();
        data = response.data;
        error = response.error;
      }

      if (error) {
        console.error('❌ Supabase save user error:', error);
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from Supabase after insertion');
      }

      // Map the returned data to User type
      const createdUser: User = {
        id: data.id,
        username: data.username,
        name: data.name,
        role: data.role,
        is_active: data.is_active ?? true,
        assigned_classes: normalizeAssignedClasses(data.assigned_classes) ?? undefined,
        assigned_sections: normalizeAssignedSections(data.assigned_sections) ?? undefined,
        email: data.email ?? null,
        phone: data.phone ?? null,
        can_use_whatsapp: data.can_use_whatsapp ?? false,
        created_at: data.created_at
      };

      logger.debug('Users', `✅ User saved in Supabase with ID: ${createdUser.id}`);

      const userColumns = [
        'id',
        'username',
        'password',
        'name',
        'role',
        'is_active',
        'email',
        'phone',
        'assigned_classes',
        'assigned_sections',
        'can_use_whatsapp',
        'created_at'
      ];
      const userValues = [
        sqlValue(createdUser.id),
        sqlValue(createdUser.username),
        sqlValue(payload.password ?? null),
        sqlValue(createdUser.name),
        sqlValue(createdUser.role),
        sqlValue(createdUser.is_active ?? true),
        sqlValue(createdUser.email ?? null),
        sqlValue(createdUser.phone ?? null),
        sqlValue(createdUser.assigned_classes ?? null),
        sqlValue(createdUser.assigned_sections ?? null),
        sqlValue(createdUser.can_use_whatsapp ?? false),
        sqlValue(createdUser.created_at ?? null)
      ];
      const userSql = buildUpsertSql('users', userColumns, userValues, ['id']);
      pushSqlQueueEntry({
        id: `sql-${getSyncedNow()}-${Math.random().toString(16).slice(2)}`,
        table: 'users',
        action: 'insert',
        sql: userSql,
        created_at: getSyncedISOString()
      });

      // Invalidate users cache
      appCache.delete(CACHE_KEYS.USERS);

      return createdUser;
    } catch (error: any) {
      console.error('❌ Failed to insert user into Supabase:', error);
      console.error('Error details:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });
      // Show user-friendly error
      if (error?.code === 'PGRST301' || error?.message?.includes('permission denied')) {
        throw new Error('خطأ في الصلاحيات: تأكد من إعدادات RLS في Supabase. يجب السماح بالقراءة والكتابة لجدول users.');
      }
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) throw error;
    await this.writeDeleteTombstone('users', userId);
    // Invalidate cache
    appCache.delete(CACHE_KEYS.USERS);
  }


  // Support Extensions (Cloud)
  async getSettings(): Promise<SystemSettings> {
    // Try cache first
    const cached = staticCache.get<SystemSettings>(CACHE_KEYS.SETTINGS);
    if (cached) return cached;

    const { data } = await supabase.from('settings').select('*').limit(1).maybeSingle();
    if (data) {
      rememberRemoteSettingsPk((data as { id?: string | number }).id);
      const mappedSettings = mapSettingsFromDB(data);
      staticCache.set(CACHE_KEYS.SETTINGS, mappedSettings, CACHE_TTL.SETTINGS);
      return mappedSettings;
    }
    return { system_ready: true, school_active: true, logo_url: '', school_name: '', principal_name: '' };
  }

  async saveSettings(settings: SystemSettings): Promise<void> {
    try {
      const remoteId = await resolveSettingsUpsertId();
      const payload = mapSettingsToDB(settings, remoteId);
      const { error } = await applySettingsRowToCloud(payload as Record<string, unknown>);
      if (error) throw new Error(error.message);
      // Invalidate cache
      staticCache.delete(CACHE_KEYS.SETTINGS);
      // Also invalidate kiosk settings cache so markAttendanceFast picks up new values
      this.invalidateKioskSettingsCache();
      // Broadcast to other tabs
      broadcastSettingsUpdate(settings);
    } catch (e) { console.error("Settings table might be missing", e); }
  }

  async sendBroadcast(targetRole: string, message: string, title: string): Promise<void> {
    const notification: Notification = {
      id: '',
      title: title,
      message: message,
      type: 'general',
      target_audience: 'all',
      created_at: getSyncedISOString()
    };
    await this.saveNotification(notification);
  }

  async runDiagnostics(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];
    const today = getLocalISODate();

    try {
      // 1. Check System Connection
      const { count: userCount, error: userError } = await supabase.from('users').select('*', { count: 'exact', head: true });
      results.push({
        key: 'connection',
        title: 'اتصال قاعدة البيانات',
        status: userError ? 'error' : 'ok',
        message: userError ? 'فشل الاتصال بـ Supabase' : 'الاتصال السحابي نشط ومستقر',
        hint: userError ? 'تحقق من مفاتيح API في الإعدادات' : undefined
      });

      // 2. Integrity: Students without Guardian Phone
      const { count: missingPhoneCount } = await supabase.from('students').select('*', { count: 'exact', head: true }).or('guardian_phone.is.null,guardian_phone.eq.""');
      results.push({
        key: 'integrity',
        title: 'نزاهة البيانات (أولياء الأمور)',
        status: (missingPhoneCount || 0) > 0 ? 'warning' : 'ok',
        message: (missingPhoneCount || 0) > 0 ? `يوجد ${missingPhoneCount} طالب بدون رقم جوال ولي الأمر` : 'سجلات الطلاب مكتملة',
        count: missingPhoneCount || 0,
        hint: 'استخدم لوحة الإدارة لتحديث بيانات الطلاب الناقصة'
      });

      // 3. Communication: Students without Guardian Phones (re-use count from integrity check)
      results.push({
        key: 'communication',
        title: 'قنوات التواصل',
        status: (missingPhoneCount || 0) > 0 ? 'warning' : 'ok',
        message: (missingPhoneCount || 0) > 0 ? `يوجد ${missingPhoneCount} طالب بدون رقم تواصل` : 'جميع الطلاب لديهم أرقام تواصل',
        count: missingPhoneCount || 0,
        hint: 'لن تصل رسائل الواتساب أو الإشعارات لهؤلاء الطلاب'
      });

      // 4. Operations: Daily Summary
      const summary = await this.getDailySummary(today);
      results.push({
        key: 'operations',
        title: 'التشغيل اليومي',
        status: summary ? 'ok' : 'warning',
        message: summary ? 'تم رفع التقرير اليومي بنجاح' : 'لم يتم رفع تقرير الحضور اليومي بعد',
        hint: !summary ? 'يجب على المراقب اعتماد السجلات من لوحة المتابعة' : undefined
      });

    } catch (e) {
      results.push({ key: 'fatal', title: 'خطأ حرج', status: 'error', message: 'حدث خطأ أثناء تشغيل التشخيص' });
    }

    return results;
  }

  async getAuthAuditLogs(filters: AuthAuditLogFilters): Promise<AuthAuditLog[]> {
    const {
      from,
      to,
      action,
      role,
      search,
      limit = 200,
      offset = 0
    } = filters;
    let query = supabase
      .from('auth_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (action) query = query.eq('action', action);
    if (role) query = query.eq('actor_role', role);
    if (search) {
      query = query.or(`actor_user_id.ilike.%${search}%,actor_label.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.warn('[Support] Failed to load auth audit logs', error);
      return [];
    }
    return data as AuthAuditLog[];
  }

  async getClientErrorLogs(filters: ClientErrorLogFilters): Promise<ClientErrorLog[]> {
    const {
      from,
      to,
      severity,
      source,
      path,
      search,
      limit = 200,
      offset = 0
    } = filters;
    let query = supabase
      .from('client_error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (severity) query = query.eq('severity', severity);
    if (source) query = query.eq('source', source);
    if (path) query = query.ilike('path', `%${path}%`);
    if (search) {
      query = query.or(`message.ilike.%${search}%,stack.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.warn('[Support] Failed to load client error logs', error);
      return [];
    }
    return data as ClientErrorLog[];
  }

  async cleanupTelemetryLogs(retentionDays: number): Promise<{ auth_deleted: number; error_deleted: number }> {
    const { data, error } = await supabase.rpc('cleanup_telemetry_logs', {
      retention_days: retentionDays
    });
    if (error) {
      throw error;
    }
    return {
      auth_deleted: data?.auth_deleted ?? 0,
      error_deleted: data?.error_deleted ?? 0
    };
  }

  // =============================================================================
  // PART 3: DISMISSAL SYSTEM (Supabase Integration)
  // =============================================================================

  async addDismissal(record: any): Promise<void> {
    const payload = {
      student_id: record.student_id,
      date: record.date,
      dismissal_time: record.dismissal_time ?? record.exit_time,
      method: record.method,
      picked_up_by: record.picked_up_by,
      recorded_by: record.recorded_by,
      recorded_by_label: record.recorded_by_label,
      notes: record.notes
    };

    const { error } = await supabase.from('dismissal_records').insert(payload);

    if (error) {
      console.error('[CloudProvider] Failed to add dismissal record to Supabase', error);
      throw error;
    }
  }

  async getTodayDismissals(): Promise<any[]> {
    const today = getLocalISODate();
    const { data, error } = await supabase
      .from('dismissal_records')
      .select('*')
      .eq('date', today)
      .order('dismissal_time', { ascending: false });

    if (error || !data) {
      console.error('[CloudProvider] Failed to load today dismissals', error);
      return [];
    }

    return data.map((r: any) => ({
      ...r,
      // Map back to expected properties
      id: r.id,
      student_id: r.student_id,
      date: r.date,
      dismissal_time: r.dismissal_time,
      method: r.method,
      picked_up_by: r.picked_up_by,
      recorded_by: r.recorded_by,
      recorded_by_label: r.recorded_by_label,
      notes: r.notes
    }));
  }

  async getStudentDismissals(studentId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('dismissal_records')
      .select('*')
      .eq('student_id', studentId)
      .order('date', { ascending: false });

    if (error || !data) {
      return [];
    }
    return data;
  }

  async getDismissalsByDateRange(startDate: string, endDate: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('dismissal_records')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (error || !data) {
      return [];
    }
    return data;
  }

  async isStudentDismissedToday(studentId: string): Promise<boolean> {
    const today = getLocalISODate();
    const { data, error } = await supabase
      .from('dismissal_records')
      .select('id')
      .eq('student_id', studentId)
      .eq('date', today)
      .limit(1);

    if (error) {
      console.warn('[CloudProvider] Error checking dismissed status', error);
      return false;
    }
    return (data && data.length > 0);
  }

  // ── Dismissal Schedules ────────────────────────────────
  async getDismissalSchedules(): Promise<any[]> {
    const { data, error } = await supabase
      .from('dismissal_schedules')
      .select('*');

    if (error || !data) {
      return [];
    }
    return data;
  }

  async saveDismissalSchedules(schedules: any[]): Promise<void> {
    // Basic implementation: Delete all and replace (transactional ideally, but simplified upscale)
    // Be careful with this pattern if scales.
    const { error: delError } = await supabase.from('dismissal_schedules').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delError) {
      console.error(delError);
      throw delError;
    }

    if (schedules.length > 0) {
      const payload = schedules.map(s => ({
        class_name: s.class_name,
        dismissal_time: s.dismissal_time,
        days: s.days,
        label: s.label
      }));
      const { error: insError } = await supabase.from('dismissal_schedules').insert(payload);
      if (insError) throw insError;
    }
  }

  async addDismissalCall(call: any): Promise<void> {
    const now = getSyncedISOString();
    const payload = {
      id: call.id || crypto.randomUUID(),
      student_id: call.student_id,
      student_name: call.student_name,
      class_name: call.class_name,
      section: call.section,
      requested_by: call.requested_by,
      requested_by_name: call.requested_by_name,
      status: call.status || 'pending',
      request_time: call.request_time || now,
      created_at: call.created_at || call.request_time || now
    };

    const { error } = await supabase.from('dismissal_calls').insert(payload);

    if (error) {
      console.error('[CloudProvider] Failed to add dismissal call to Supabase', error);
      throw error;
    }

    // Broadcast to other tabs so they refresh instantly
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('hader:dismissal_calls:channel');
        broadcastDismissalEvent('call_added', payload.id);
        bc.postMessage({ type: 'call_added', call: payload });
        bc.close();
      }
    } catch (_) { /* BroadcastChannel not available */ }

    // Send a system notification targeted at supervisors so they see a toast
    try {
      const notification: Notification = {
        id: crypto.randomUUID(),
        title: 'نداء انصراف جديد',
        message: `نداء انصراف للطالب ${call.student_name || call.student_id} - الصف ${call.class_name || ''} ${call.section || ''}`.trim(),
        type: 'dismissal_call' as const,
        target_audience: 'supervisor',
        target_id: buildClassSectionTargetId(call.class_name, call.section),
        is_popup: true,
        priority: 1,
        created_at: now
      };
      await this.saveNotification(notification);
    } catch (notifErr) {
      // Non-critical — don't block the call if notification fails
      console.warn('[CloudProvider] Failed to create supervisor notification for dismissal call', notifErr);
    }
  }

  async getActiveDismissalCalls(): Promise<any[]> {
    const today = getLocalISODate();

    // In Supabase, dates are UTC, to fetch today's date safely, we use gte matching the start of day.
    const startOfDay = getSyncedDate();
    startOfDay.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('dismissal_calls')
      .select('*')
      .in('status', ['pending', 'called'])
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }
    return data;
  }

  async updateDismissalCallStatus(callId: string, status: string): Promise<void> {
    const payload: any = { status };
    if (status === 'called') payload.called_at = getSyncedISOString();
    if (status === 'dismissed') payload.dismissed_at = getSyncedISOString();

    const { error } = await supabase
      .from('dismissal_calls')
      .update(payload)
      .eq('id', callId);

    if (error) {
      console.error('[CloudProvider] Failed to update call status in Supabase', error);
      throw error;
    }
  }

  // Realtime subscription for dismissal calls — mirrors HybridProvider pattern
  subscribeToDismissalCalls(callback: (calls: any[]) => void): { unsubscribe: () => void } {
    // Helper: fetch active calls and push to callback
    const fetchAndCallback = async () => {
      try {
        const calls = await this.getActiveDismissalCalls();
        callback(calls);
      } catch (err) {
        console.warn('[CloudProvider] subscribeToDismissalCalls fetchAndCallback error', err);
      }
    };

    // 1. Initial fetch
    fetchAndCallback();

    // 2. Supabase Realtime for INSERT / UPDATE on dismissal_calls
    const channel = supabase
      .channel('dismissal_calls_cloud')
      .on('broadcast', { event: 'call_added' }, () => fetchAndCallback())
      .on('broadcast', { event: 'call_updated' }, () => fetchAndCallback())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dismissal_calls' },
        () => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('hader:realtime-update'));
          }
          fetchAndCallback();
        }
      )
      .subscribe();

    // 3. BroadcastChannel for cross-tab support
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('hader:dismissal_calls:channel');
        bc.onmessage = (event) => {
          if (event.data?.type === 'call_added' || event.data?.type === 'call_updated') {
            fetchAndCallback();
          }
        };
      }
    } catch (_) { /* BroadcastChannel not available */ }

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
        if (bc) bc.close();
      }
    };
  }

}

// ------------------------------------------------------------------
// 3. Local Provider (LocalStorage)
// ------------------------------------------------------------------
const bootstrapAdminStatus = validateBootstrapAdmin();
const isBootstrapAdminSecure = bootstrapAdminStatus.ok;
