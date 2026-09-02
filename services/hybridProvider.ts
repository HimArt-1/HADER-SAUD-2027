// =============================================================================
// نظام حاضر (Hader) - Hybrid Provider
// =============================================================================
// Hybrid database provider that uses IndexedDB locally with cloud sync

import { supabase, supabaseStatus } from './supabase';
import { logger } from './logger';
import {
    localDb,
    queueChange,
    getSyncMeta,
    setSyncMeta,
    SyncableStudent,
    SyncableAttendance,
    SyncableUser,
    SyncableClass,
    SyncableSettings,
    SyncableExit,
    SyncableViolation,
    SyncableNotification,
    SyncableGuardianExcuse,
    SyncableDismissalRecord,
    SyncableDismissalCall,
    SyncableDismissalSchedule,
    SyncableActivityLog,
    SyncableClientErrorLog
} from './localDb';
import { syncService } from './syncService';
import { SyncState } from './syncTypes';
import { liveNotificationService } from './liveNotificationService';
import { broadcastSettingsUpdate } from './settingsBroadcast';
import {
    Student,
    AttendanceRecord,
    SchoolClass,
    User,
    SystemSettings,
    ExitRecord,
    ViolationRecord,
    Notification,
    GuardianExcuseRecord,
    DashboardStats,
    ClientErrorSeverity,
    ClientErrorSource,
    DiagnosticResult,
    Role,
    ATTENDANCE_DEFAULTS,
    DismissalRecord,
    DismissalCallRequest,
} from '../types';
import {
    buildClassSectionTargetId,
    getLocalISODate,
    mapSettingsFromDB,
    normalizeAssignedClasses,
    normalizeAssignedSections
} from './dbHelpers';
import { ensurePasswordForCloud } from './security';
import { rememberRemoteSettingsPk, resolveSettingsUpsertId } from './settingsRemoteId';
import {
    decideAttendanceTiming,
    getAttendanceStatusCounts,
    uniqueAttendanceByStudentDate
} from '../modules/attendance';
import { syncCatalog } from '../modules/sync/catalog';


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

// ==========================================
// Helper Functions
// ==========================================

const mapStudent = (row: any): Student => ({
    id: row.id,
    name: row.name,
    class_name: row.class_name,
    section: row.section,
    guardian_phone: row.guardian_phone || row.parent_phone,
    guardian_name: row.guardian_name,
    whatsapp_phone: row.whatsapp_phone,
    is_active: row.is_active ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at
});

const mapUser = (row: any): User => ({
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    assigned_classes: normalizeAssignedClasses(row.assigned_classes),
    assigned_sections: normalizeAssignedSections(row.assigned_sections),
    email: row.email,
    phone: row.phone,
    is_active: row.is_active ?? true,
    last_login: row.last_login,
    can_use_whatsapp: row.can_use_whatsapp,
    created_at: row.created_at,
    updated_at: row.updated_at
});

const mapAttendance = (row: any): AttendanceRecord => ({
    id: row.id,
    student_id: row.student_id,
    date: row.date,
    timestamp: row.timestamp || row.created_at || (row.date && row.time ? `${row.date}T${row.time}` : ''),
    status: (row.status === 'recorded' && row.type ? row.type : row.status || row.type),
    minutes_late: row.minutes_late || 0,
    recorded_by: row.recorded_by,
    recorded_by_label: row.recorded_by_label,
    device_id: row.device_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    _updated_at: row._updated_at
});

const normalizeAttendanceStatus = (status: unknown): AttendanceRecord['status'] => {
    return status === 'late' || status === 'absent' ? status : 'present';
};

const normalizeMinutesLate = (status: AttendanceRecord['status'], minutesLate: unknown): number => {
    if (status !== 'late') return 0;
    const value = Number(minutesLate ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
};

// ==========================================
// Hybrid Provider Class
// ==========================================

export class HybridProvider {
    private syncListeners: Set<(status: SyncState) => void> = new Set();
    // Persistent BroadcastChannel — created once, reused for every cross-tab broadcast
    private syncBroadcast: BroadcastChannel | null = null;
    // Stored Supabase channel ref so we can remove/reconnect it cleanly
    private realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    // Debounce timer for visibilitychange sync trigger
    private visibilityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    // TTL cache for attendance range fetches — prevents serving stale local data
    // when other devices have recorded new attendance since our last pull.
    private lastRangeFetchMs = 0;
    private lastRangeKey    = '';
    private readonly RANGE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
    private readonly FULL_ATTENDANCE_RANGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    // Coalesce parallel getAttendanceRange(...) for the same window (Dashboard + Admin + realtime).
    private attendanceRangeInflight = new Map<string, Promise<{ ok: boolean }>>();

    constructor() {
        // Subscribe to sync service events
        syncService.on((event) => {
            if (event.type === 'sync:progress' && event.data) {
                this.notifySyncListeners(event.data);
            }
        });

        // Persistent BroadcastChannel for cross-tab realtime notifications
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                this.syncBroadcast = new BroadcastChannel('hader:sync:channel');
            }
        } catch (_) { }

        // Initialize Realtime Sync
        this.setupRealtimeSubscription();
    }

    private async handleRealtimeChange(payload: any) {
        const table = payload.table;
        // Merge change directly into localDB if it's an INSERT or UPDATE
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            try {
                const record = { ...payload.new, _synced: true, _updated_at: new Date().toISOString() };
                await (localDb as any)[table].put(record);
            } catch (e) {
                logger.warn('Hybrid', `Failed to merge realtime update for ${table}`, e);
            }
        } else if (payload.eventType === 'DELETE') {
            try {
                await (localDb as any)[table].delete(payload.old.id);
            } catch (e) {
                logger.warn('Hybrid', `Failed to delete realtime update for ${table}`, e);
            }
        }

        const eventDetail = {
            table,
            eventType: payload.eventType,
            record: payload.new ?? payload.old ?? null
        };

        // Dispatch event for UI to refresh
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('hader:realtime-update', { detail: eventDetail }));
        }

        // Broadcast to other tabs via the persistent channel (no open/close per event)
        try {
            this.syncBroadcast?.postMessage({ type: 'realtime-update', ...eventDetail });
        } catch (_) { }
    }

    private setupRealtimeSubscription() {
        // Subscribe per-table instead of the whole `public` schema so Supabase
        // only pushes changes for tables this client actually consumes. A
        // schema-wide subscription receives every mutation in the database and
        // filters client-side — wasted bandwidth and refetch churn.
        let channel = supabase.channel('schema-db-changes');
        for (const table of syncCatalog.realtime()) {
            channel = channel.on(
                'postgres_changes',
                { event: '*', schema: 'public', table },
                (payload: any) => { void this.handleRealtimeChange(payload); }
            );
        }
        channel.subscribe();

        // Store ref for future cleanup/reconnect
        this.realtimeChannel = channel;

        // Wake-up Protocol for iOS / Background tab sleeping (debounced)
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    logger.debug('Hybrid', 'Document became visible! Waking up background sync...');
                    if (this.visibilityDebounceTimer) clearTimeout(this.visibilityDebounceTimer);
                    this.visibilityDebounceTimer = setTimeout(() => {
                        syncService.syncNow('bidirectional').catch(() => {});
                    }, 1000);
                }
            });
        }
    }

    // ==========================================
    // Realtime Reconnect
    // ==========================================

    async reconnectRealtime(): Promise<void> {
        if (this.realtimeChannel) {
            await supabase.removeChannel(this.realtimeChannel);
            this.realtimeChannel = null;
        }
        this.setupRealtimeSubscription();
    }

    // ==========================================
    // Sync Status Management
    // ==========================================

    onSyncStatusChange(callback: (status: SyncState) => void): () => void {
        this.syncListeners.add(callback);
        return () => this.syncListeners.delete(callback);
    }

    private notifySyncListeners(status: SyncState): void {
        this.syncListeners.forEach(cb => {
            try { cb(status); } catch (e) { console.error(e); }
        });
    }

    getSyncStatus(): SyncState {
        return syncService.getState();
    }

    async forceSyncNow(): Promise<void> {
        await syncService.syncNow('bidirectional');
    }

    // ==========================================
    // Students
    // ==========================================

    private async fetchStudentsFromCloud(): Promise<Student[]> {
        let allData: any[] = [];
        let offset = 0;
        const limit = 1000;
        while (true) {
            const { data, error } = await supabase
                .from('students')
                .select('*')
                .order('id', { ascending: true })
                .range(offset, offset + limit - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            allData = allData.concat(data);
            if (data.length < limit) break;
            offset += limit;
        }

        const mapped = allData.map(mapStudent);
        if (mapped.length > 0) {
            const syncableStudents = mapped.map(s => ({
                ...s,
                _synced: true,
                _updated_at: new Date().toISOString()
            }));
            await localDb.students.bulkPut(syncableStudents);
        }
        return mapped;
    }

    async getStudents(options?: { forceSync?: boolean }): Promise<Student[]> {
        if (options?.forceSync && supabaseStatus.isConfigured && navigator.onLine) {
            try {
                const mapped = await this.fetchStudentsFromCloud();
                if (mapped.length > 0) {
                    return mapped;
                }
            } catch (e) {
                logger.warn('Hybrid', 'Force sync students failed:', e);
            }
        }
        // Always read from local IndexedDB first (fast)
        // Note: Don't trigger sync-down here to avoid overwriting pending local changes
        let localStudents = await localDb.students.toArray();

        // Auto-fetch if local DB is empty (e.g. new device login for Guard/Supervisor)
        if (localStudents.length === 0 && supabaseStatus.isConfigured && navigator.onLine && !options?.forceSync) {
            try {
                const mapped = await this.fetchStudentsFromCloud();
                if (mapped.length > 0) {
                    localStudents = await localDb.students.toArray(); // Refresh from local DB
                }
            } catch (e) {
                logger.warn('Hybrid', 'Auto-fetch students failed:', e);
            }
        }

        return localStudents.map(mapStudent);
    }

    async getStudentById(id: string): Promise<Student | undefined> {
        const student = await localDb.students.get(id);
        return student ? mapStudent(student) : undefined;
    }

    async getStudentsByGuardian(guardian_phone: string): Promise<Student[]> {
        const students = await localDb.students
            .where('guardian_phone')
            .equals(guardian_phone)
            .toArray();
        return students.map(mapStudent);
    }

    async saveStudents(students: Student[]): Promise<Student[]> {
        const now = new Date().toISOString();

        // Prepare syncable records
        const syncableStudents: SyncableStudent[] = students.map(s => ({
            ...s,
            _synced: false,
            _updated_at: now
        }));

        // Save to IndexedDB
        await localDb.students.bulkPut(syncableStudents);

        // Queue each student individually to prevent array-as-column-name bug
        for (const s of syncableStudents) {
            await queueChange('students', 'UPSERT', s);
        }

        // REMOVED FOR BATCHING: syncNow is handled by background auto-sync

        return students;
    }

    async updateStudent(student: Student): Promise<Student> {
        const now = new Date().toISOString();

        const syncableStudent: SyncableStudent = {
            ...student,
            _synced: false,
            _updated_at: now
        };

        await localDb.students.put(syncableStudent);
        await queueChange('students', 'UPDATE', syncableStudent);

        // Wait for sync to complete to ensure cloud is updated before any sync-down
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after updateStudent:', e);
        }

        return student;
    }

    async renameStudentId(currentId: string, nextId: string): Promise<Student> {
        const existing = await localDb.students.get(currentId);
        if (!existing) {
            throw new Error('الطالب غير موجود');
        }

        const now = new Date().toISOString();

        // Delete old record
        await localDb.students.delete(currentId);

        // Create new record with new ID
        const newStudent: SyncableStudent = {
            ...existing,
            id: nextId,
            _synced: false,
            _updated_at: now
        };

        await localDb.students.put(newStudent);

        // Queue both operations
        await queueChange('students', 'DELETE', currentId);
        await queueChange('students', 'INSERT', newStudent);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after renameStudentId:', e);
        }

        return mapStudent(newStudent);
    }

    async deleteStudent(student_id: string): Promise<void> {
        await localDb.students.delete(student_id);
        await queueChange('students', 'DELETE', student_id);

        // Wait for sync to complete to ensure cloud is updated
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after deleteStudent:', e);
        }
    }

    // ==========================================
    // Attendance
    // ==========================================

    /** `ok` false = network/offline/config error — callers must not treat as “fresh empty range”. */
    private async fetchAttendanceRangeFromCloud(
        startDate: string,
        endDate: string
    ): Promise<{ ok: boolean; records: SyncableAttendance[] }> {
        if (!supabaseStatus.isConfigured || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            return { ok: false, records: [] };
        }

        try {
            // Paginate to avoid PostgREST's default 1 000-row cap.
            // We order DESC so today's records always land in the first page
            // even if the 30-day window exceeds the page size.
            const PAGE_SIZE = 1000;
            let allRows: any[] = [];
            let from = 0;
            let pageError: unknown = null;

            while (true) {
                const { data, error } = await supabase
                    .from('attendance_logs')
                    .select('id,student_id,date,timestamp,status,minutes_late,recorded_by,recorded_by_label,device_id,created_at')
                    .gte('date', startDate)
                    .lte('date', endDate)
                    .order('date', { ascending: false })
                    .range(from, from + PAGE_SIZE - 1);

                if (error) {
                    pageError = error;
                    logger.warn('Hybrid', 'Attendance cloud fetch page error:', error);
                    break;
                }
                if (!data || data.length === 0) break;

                allRows = allRows.concat(data);
                if (data.length < PAGE_SIZE) break; // last page
                from += PAGE_SIZE;
            }

            if (pageError) {
                return { ok: false, records: [] };
            }

            if (allRows.length === 0) {
                await this.rememberAttendanceHydration(startDate, endDate, 0);
                return { ok: true, records: [] };
            }

            const now = new Date().toISOString();
            const records: SyncableAttendance[] = allRows.map((row: any) => ({
                ...mapAttendance(row),
                _synced: true,
                _updated_at: row.updated_at || row.timestamp || row.created_at || now,
            }));

            await localDb.attendance_logs.bulkPut(records);
            await this.rememberAttendanceHydration(startDate, endDate, records.length);
            logger.info('Hybrid', `Attendance range hydrated from cloud: ${records.length} records (${startDate}→${endDate})`);

            return { ok: true, records };
        } catch (error) {
            logger.warn('Hybrid', 'Attendance cloud fallback failed:', error);
            return { ok: false, records: [] };
        }
    }

    async getAttendance(date?: string): Promise<AttendanceRecord[]> {
        let records: SyncableAttendance[];

        if (date) {
            records = await localDb.attendance_logs
                .where('date')
                .equals(date)
                .toArray();

            const dayMeta = await getSyncMeta(this.attendanceDayMetaKey(date));
            const dayExpired = this.getHydrationAgeMs(dayMeta) > this.RANGE_CACHE_TTL_MS;
            if (records.length === 0 || dayExpired) {
                const { ok, records: cloud } = await this.fetchAttendanceRangeFromCloud(date, date);
                records = ok
                    ? cloud
                    : records;
            }
        } else {
            records = await localDb.attendance_logs.toArray();
        }

        return uniqueAttendanceByStudentDate(records.map(mapAttendance), date);
    }

    async getAllAttendance(): Promise<AttendanceRecord[]> {
        const records = await localDb.attendance_logs.toArray();
        return uniqueAttendanceByStudentDate(records.map(mapAttendance));
    }

    private attendanceRangeMetaKey(startDate: string, endDate: string): string {
        return `attendance_range_hydrated:${startDate}:${endDate}`;
    }

    private attendanceDayMetaKey(date: string): string {
        return `attendance_day_hydrated:${date}`;
    }

    private getHydrationAgeMs(meta: any): number {
        const fetchedAt = typeof meta?.fetched_at === 'string' ? Date.parse(meta.fetched_at) : NaN;
        if (!Number.isFinite(fetchedAt)) return Number.POSITIVE_INFINITY;
        return Date.now() - fetchedAt;
    }

    private async rememberAttendanceHydration(startDate: string, endDate: string, rowCount: number): Promise<void> {
        const payload = {
            startDate,
            endDate,
            row_count: rowCount,
            fetched_at: new Date().toISOString()
        };
        await setSyncMeta(this.attendanceRangeMetaKey(startDate, endDate), payload);

        await setSyncMeta(this.attendanceDayMetaKey(endDate), payload);
    }

    async getAttendanceRange(startDate: string, endDate: string): Promise<AttendanceRecord[]> {
        let records = await localDb.attendance_logs
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();

        const rangeKey = `${startDate}|${endDate}`;
        const [rangeMeta, endDateMeta] = await Promise.all([
            getSyncMeta(this.attendanceRangeMetaKey(startDate, endDate)),
            getSyncMeta(this.attendanceDayMetaKey(endDate))
        ]);

        // Full 30-day hydration is expensive on production-sized schools. Keep
        // it persistent across reloads, then refresh today's small slice often.
        const fullRangeExpired =
            !rangeMeta ||
            this.getHydrationAgeMs(rangeMeta) > this.FULL_ATTENDANCE_RANGE_TTL_MS;
        const endDateExpired =
            !endDateMeta ||
            this.getHydrationAgeMs(endDateMeta) > this.RANGE_CACHE_TTL_MS;
        const memoryRangeExpired =
            rangeKey !== this.lastRangeKey ||
            (Date.now() - this.lastRangeFetchMs) > this.RANGE_CACHE_TTL_MS;

        const shouldFetchFullRange = fullRangeExpired || records.length === 0;
        const shouldFetchEndDateOnly = !shouldFetchFullRange && (endDateExpired || memoryRangeExpired);

        if (shouldFetchFullRange || shouldFetchEndDateOnly) {
            const fetchStartDate = shouldFetchFullRange ? startDate : endDate;
            const fetchEndDate = endDate;
            const flyKey = `${fetchStartDate}|${fetchEndDate}`;
            let pull = this.attendanceRangeInflight.get(flyKey);
            if (!pull) {
                this.lastRangeFetchMs = Date.now();
                this.lastRangeKey = rangeKey;

                pull = this.fetchAttendanceRangeFromCloud(fetchStartDate, fetchEndDate).then(({ ok }) => {
                    // On failure, reset the cache so the next call retries.
                    if (!ok) {
                        this.lastRangeFetchMs = 0;
                        this.lastRangeKey = '';
                    }
                    return { ok };
                });
                this.attendanceRangeInflight.set(flyKey, pull);
                pull.finally(() => {
                    if (this.attendanceRangeInflight.get(flyKey) === pull) {
                        this.attendanceRangeInflight.delete(flyKey);
                    }
                });
            }
            await pull;
            records = await localDb.attendance_logs
                .where('date')
                .between(startDate, endDate, true, true)
                .toArray();
        }

        return uniqueAttendanceByStudentDate(records.map(mapAttendance));
    }

    async getStudentAttendance(student_id: string): Promise<AttendanceRecord[]> {
        const records = await localDb.attendance_logs
            .where('student_id')
            .equals(student_id)
            .toArray();
        return uniqueAttendanceByStudentDate(records.map(mapAttendance));
    }

    async markAttendance(id: string): Promise<{
        success: boolean;
        message: string;
        record?: AttendanceRecord;
        student?: Student;
        stats?: { late_count: number; todayMinutes: number; totalMinutes: number };
    }> {
        const student = await localDb.students.get(id);
        if (!student) {
            return { success: false, message: 'الطالب غير موجود' };
        }

        const now = new Date();

        // Get settings for late calculation
        const settings = await this.getSettings();
        const timing = decideAttendanceTiming({
            occurredAt: now,
            settings,
            holidays: settings.attendance_settings?.academic_holidays
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
        const nowIso = timing.timestamp;
        const arrivalStatus = timing.status === 'absent' ? 'late' : timing.status;
        const isLate = arrivalStatus === 'late';
        const minutes_late = timing.minutes_late;

        // Check if already marked
        const existing = await localDb.attendance_logs
            .where({ student_id: id, date: today })
            .first();

        if (existing) {
            // ✅ إذا كان "غائب" → نسمح بالتعديل إلى "حاضر/متأخر"
            if (existing.status === 'absent') {
                const updatedRecord: SyncableAttendance = {
                    ...existing,
                    status: arrivalStatus,
                    minutes_late,
                    timestamp: nowIso,
                    _synced: false,
                    _updated_at: nowIso
                };

                await localDb.attendance_logs.put(updatedRecord);
                await queueChange('attendance_logs', 'UPDATE', updatedRecord);

                try {
                    if (typeof BroadcastChannel !== 'undefined') {
                        const bc = new BroadcastChannel('hader:attendance:channel');
                        bc.postMessage({ type: 'attendance-marked', record: mapAttendance(updatedRecord) });
                        bc.close();
                    }
                } catch (_) { /* BroadcastChannel not supported */ }

                // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
                syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'markAttendance update sync failed:', e));
                liveNotificationService.handleAttendanceRecorded(updatedRecord).catch(e => logger.warn('Hybrid', 'Live present update failed:', e));

                const allStudentRecords = await this.getStudentAttendance(id);
                const late_count = allStudentRecords.filter(r => r.status === 'late').length;
                const totalMinutes = allStudentRecords.reduce((sum, r) => sum + (r.minutes_late || 0), 0);

                return {
                    success: true,
                    message: isLate ? `تم تحديث الحالة إلى متأخر (${minutes_late} دقيقة)` : 'تم تحديث الحالة إلى حاضر',
                    record: mapAttendance(updatedRecord),
                    student: mapStudent(student),
                    stats: { late_count, todayMinutes: minutes_late, totalMinutes }
                };
            }
            // إذا كان "حاضر/متأخر" → تكرار
            return { success: false, message: 'تم تسجيل الحضور مسبقاً لهذا اليوم' };
        }

        const record: SyncableAttendance = {
            id: crypto.randomUUID(),
            student_id: id,
            date: today,
            timestamp: nowIso,
            status: arrivalStatus,
            minutes_late,
            recorded_by_label: 'hybrid-kiosk',
            _synced: false,
            _updated_at: nowIso
        };

        await localDb.attendance_logs.put(record);
        await queueChange('attendance_logs', 'INSERT', record);

        // Broadcast to other tabs for instant cross-tab sync
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('hader:attendance:channel');
                bc.postMessage({ type: 'attendance-marked', record: mapAttendance(record) });
                bc.close();
            }
        } catch (_) { /* BroadcastChannel not supported */ }

        // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
        syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'markAttendance insert sync failed:', e));
        liveNotificationService.handleAttendanceRecorded(record).catch(e => logger.warn('Hybrid', 'Live present insert failed:', e));

        // Calculate stats
        const allStudentRecords = await this.getStudentAttendance(id);
        const todayRecord = allStudentRecords.find(r => r.date === today);
        const late_count = allStudentRecords.filter(r => r.status === 'late').length;
        const todayMinutes = todayRecord?.minutes_late || 0;
        const totalMinutes = allStudentRecords.reduce((sum, r) => sum + (r.minutes_late || 0), 0);

        return {
            success: true,
            message: isLate ? `تم تسجيل التأخر (${minutes_late} دقيقة)` : 'تم تسجيل الحضور بنجاح',
            record: mapAttendance(record),
            student: mapStudent(student),
            stats: { late_count, todayMinutes, totalMinutes }
        };
    }

    async addManualAttendance(params: {
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
        const { student_id, date, time } = params;

        const student = await localDb.students.get(student_id);
        if (!student) {
            return { success: false, message: 'الطالب غير موجود' };
        }

        const settings = await this.getSettings();
        const timing = decideAttendanceTiming({
            occurredAt: new Date(`${date}T${time}`),
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
        const isLate = arrivalStatus === 'late';
        const minutes_late = timing.minutes_late;
        const nowIso = new Date().toISOString();

        // Check if already exists
        const existing = await localDb.attendance_logs
            .where({ student_id, date })
            .first();

        if (existing) {
            // ✅ إذا كان "غائب" → نسمح بالتعديل إلى "حاضر/متأخر"
            if (existing.status === 'absent') {
                const updatedRecord: SyncableAttendance = {
                    ...existing,
                    status: arrivalStatus,
                    minutes_late,
                    timestamp: timing.timestamp,
                    _synced: false,
                    _updated_at: nowIso
                };

                await localDb.attendance_logs.put(updatedRecord);
                await queueChange('attendance_logs', 'UPDATE', updatedRecord);

                try {
                    if (typeof BroadcastChannel !== 'undefined') {
                        const bc = new BroadcastChannel('hader:attendance:channel');
                        bc.postMessage({ type: 'attendance-marked', record: mapAttendance(updatedRecord) });
                        bc.close();
                    }
                } catch (_) { /* BroadcastChannel not supported */ }

                // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
                syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'addManualAttendance update sync failed:', e));
                liveNotificationService.handleAttendanceRecorded(updatedRecord).catch(e => logger.warn('Hybrid', 'Live present manual update failed:', e));

                return {
                    success: true,
                    message: 'تم تحديث حالة الحضور بنجاح',
                    record: mapAttendance(updatedRecord),
                    student: mapStudent(student),
                    status: updatedRecord.status as 'present' | 'late',
                    minutes_late
                };
            }
            return { success: false, message: 'يوجد سجل حضور لهذا اليوم' };
        }

        const record: SyncableAttendance = {
            id: crypto.randomUUID(),
            student_id,
            date,
            timestamp: timing.timestamp,
            status: arrivalStatus,
            minutes_late,
            recorded_by_label: 'admin-manual',
            _synced: false,
            _updated_at: nowIso
        };

        await localDb.attendance_logs.put(record);
        await queueChange('attendance_logs', 'INSERT', record);

        // Broadcast to other tabs for instant cross-tab sync
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('hader:attendance:channel');
                bc.postMessage({ type: 'attendance-marked', record: mapAttendance(record) });
                bc.close();
            }
        } catch (_) { /* BroadcastChannel not supported */ }

        // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
        syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'addManualAttendance insert sync failed:', e));
        liveNotificationService.handleAttendanceRecorded(record).catch(e => logger.warn('Hybrid', 'Live present manual insert failed:', e));

        return {
            success: true,
            message: 'تم إضافة الحضور بنجاح',
            record: mapAttendance(record),
            student: mapStudent(student),
            status: record.status as 'present' | 'late',
            minutes_late
        };
    }

    async addManualAbsence(params: {
        student_id: string;
        date: string;
    }): Promise<{
        success: boolean;
        message: string;
        record?: AttendanceRecord;
        student?: Student;
    }> {
        const { student_id, date } = params;

        const student = await localDb.students.get(student_id);
        if (!student) {
            return { success: false, message: 'الطالب غير موجود' };
        }

        const nowIso = new Date().toISOString();

        // Check if already exists
        const existing = await localDb.attendance_logs
            .where({ student_id, date })
            .first();

        if (existing) {
            const updatedRecord: SyncableAttendance = {
                ...existing,
                status: 'absent',
                minutes_late: 0,
                timestamp: nowIso,
                _synced: false,
                _updated_at: nowIso
            };

            await localDb.attendance_logs.put(updatedRecord);
            await queueChange('attendance_logs', 'UPDATE', updatedRecord);

            // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
            syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'addManualAbsence update sync failed:', e));

            return {
                success: true,
                message: 'تم تحديث الحالة إلى غياب',
                record: mapAttendance(updatedRecord),
                student: mapStudent(student)
            };
        }

        const record: SyncableAttendance = {
            id: crypto.randomUUID(),
            student_id,
            date,
            timestamp: nowIso,
            status: 'absent',
            minutes_late: 0,
            recorded_by_label: 'admin-manual',
            _synced: false,
            _updated_at: nowIso
        };

        await localDb.attendance_logs.put(record);
        await queueChange('attendance_logs', 'INSERT', record);

        // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
        syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'addManualAbsence insert sync failed:', e));

        return {
            success: true,
            message: 'تم تسجيل الغياب بنجاح',
            record: mapAttendance(record),
            student: mapStudent(student)
        };
    }

    async deleteAttendance(student_id: string, date: string): Promise<{ success: boolean; message: string }> {
        const existingRecords = await localDb.attendance_logs
            .where({ student_id, date })
            .toArray();

        if (existingRecords.length === 0) {
            return { success: false, message: 'السجل غير موجود' };
        }

        const ids = existingRecords.map(record => record.id);
        await localDb.attendance_logs.bulkDelete(ids);
        for (const id of ids) {
            await queueChange('attendance_logs', 'DELETE', id);
        }

        // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
        syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'deleteAttendance sync failed:', e));

        return { success: true, message: 'تم حذف السجل بنجاح' };
    }

    async deleteAttendanceRange(startDate: string, endDate: string): Promise<void> {
        const records = await localDb.attendance_logs
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();

        const ids = records.map(r => r.id);

        await localDb.attendance_logs.bulkDelete(ids);

        for (const id of ids) {
            await queueChange('attendance_logs', 'DELETE', id);
        }

        // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
        syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'deleteAttendanceRange sync failed:', e));
    }

    async saveAttendanceBatch(records: AttendanceRecord[]): Promise<void> {
        const now = new Date().toISOString();

        const syncableRecords: SyncableAttendance[] = records.map(r => {
            const status = normalizeAttendanceStatus(r.status);
            const timestamp = r.timestamp || r.created_at || now;
            return {
                ...r,
                id: r.id || crypto.randomUUID(),
                date: r.date || timestamp.split('T')[0] || getLocalISODate(),
                timestamp,
                status,
                minutes_late: normalizeMinutesLate(status, r.minutes_late),
                _synced: false,
                _updated_at: now
            };
        });

        await localDb.attendance_logs.bulkPut(syncableRecords);
        // Queue each record individually to prevent array-as-column-name bug
        for (const r of syncableRecords) {
            await queueChange('attendance_logs', 'UPSERT', r);
        }

        // ✅ Immediate sync to cloud (fire-and-forget for UI speed)
        syncService.syncNow('up').catch(e => logger.warn('Hybrid', 'saveAttendanceBatch sync failed:', e));
    }

    // ==========================================
    // Classes
    // ==========================================

    async getClasses(): Promise<SchoolClass[]> {
        let classes = await localDb.classes.toArray();

        // Auto-fetch if local DB is empty (e.g. new device login)
        if (classes.length === 0 && supabaseStatus.isConfigured && navigator.onLine) {
            try {
                const { data, error } = await supabase.from('classes').select('*');
                if (data && !error && data.length > 0) {
                    const syncableClasses = data.map((c: any) => ({
                        ...c,
                        _synced: true,
                        _updated_at: new Date().toISOString()
                    }));
                    await localDb.classes.bulkPut(syncableClasses);
                    classes = await localDb.classes.toArray(); // Refresh from local DB
                }
            } catch (e) {
                logger.warn('Hybrid', 'Auto fetch classes on empty DB failed:', e);
            }
        }

        return classes.map(c => ({
            id: c.id,
            name: c.name,
            sections: c.sections || [],
            grade_level: c.grade_level,
            is_active: c.is_active ?? true,
            created_at: c.created_at,
            updated_at: c.updated_at
        }));
    }

    async saveClass(cls: SchoolClass): Promise<SchoolClass> {
        const now = new Date().toISOString();

        const syncableClass: SyncableClass = {
            ...cls,
            id: cls.id || crypto.randomUUID(),
            _synced: false,
            _updated_at: now
        };

        await localDb.classes.put(syncableClass);
        await queueChange('classes', 'UPSERT', syncableClass);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after saveClass:', e);
        }

        return syncableClass;
    }

    async deleteClass(classId: string): Promise<void> {
        await localDb.classes.delete(classId);
        await queueChange('classes', 'DELETE', classId);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after deleteClass:', e);
        }
    }

    // ==========================================
    // Users
    // ==========================================

    private async fetchUsersFromCloud(): Promise<User[]> {
        const { data, error } = await supabase
            .from('users')
            .select('id, username, name, role, assigned_classes, assigned_sections, email, phone, is_active, can_use_whatsapp, last_login, created_at, updated_at')
            .order('created_at', { ascending: true });

        if (error) throw error;

        const users = (data ?? []).map(mapUser);
        if (users.length > 0) {
            const now = new Date().toISOString();
            await localDb.users.bulkPut(users.map(user => ({
                ...user,
                _synced: true,
                _updated_at: user.updated_at || user.created_at || now
            })));
        }

        return users;
    }

    async getUsers(): Promise<User[]> {
        if (supabaseStatus.isConfigured && navigator.onLine) {
            try {
                await this.fetchUsersFromCloud();
            } catch (error) {
                logger.warn('Hybrid', 'Failed to fetch users from cloud, using local cache:', error);
            }
        }

        const users = await localDb.users.toArray();
        return users.map(mapUser);
    }

    async getUserById(id: string): Promise<User | undefined> {
        const user = await localDb.users.get(id);
        return user || undefined;
    }

    async saveUser(user: User): Promise<User> {
        const now = new Date().toISOString();
        const isNewUser = !user.id;
        const normalizedAssignedClasses = normalizeAssignedClasses(user.assigned_classes);
        const normalizedAssignedSections = normalizeAssignedSections(user.assigned_sections);
        const userForStore: User = {
            ...user,
            assigned_classes: user.role === Role.SUPERVISOR_CLASS ? (normalizedAssignedClasses ?? []) : null as any,
            assigned_sections: normalizedAssignedSections
        };

        let passwordForStore: string | undefined = userForStore.password;
        if (userForStore.password) {
            passwordForStore = await ensurePasswordForCloud(userForStore.password);
        }

        const syncableUser: SyncableUser = {
            ...userForStore,
            id: userForStore.id || crypto.randomUUID(),
            ...(passwordForStore !== undefined ? { password: passwordForStore } : {}),
            _synced: false,
            _updated_at: now
        };

        await localDb.users.put(syncableUser);

        if (isNewUser) {
            const row = passwordForStore
                ? { ...syncableUser, password_hash_version: 1 as const }
                : syncableUser;
            await queueChange('users', 'INSERT', row);
        } else {
            const { password: _pw, ...userWithoutPassword } = syncableUser;
            if (passwordForStore) {
                await queueChange('users', 'UPSERT', {
                    ...userWithoutPassword,
                    password: passwordForStore,
                    password_hash_version: 1
                });
            } else {
                await queueChange('users', 'UPSERT', userWithoutPassword);
            }
        }

        // Wait for user sync to complete. Admin account creation must not report
        // success unless Supabase accepted the user row; otherwise the new
        // account cannot authenticate from another device/session.
        try {
            const syncResult = await syncService.syncNow('up');
            const userSyncError = syncResult.errors.find(error => error.table === 'users');
            if (userSyncError) {
                throw new Error(userSyncError.message || 'فشل مزامنة المستخدم مع قاعدة البيانات السحابية');
            }
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after saveUser:', e);
            if (isNewUser) {
                await localDb.users.delete(syncableUser.id);
            }
            throw e;
        }

        return syncableUser;
    }

    async deleteUser(userId: string): Promise<void> {
        await localDb.users.delete(userId);
        await queueChange('users', 'DELETE', userId);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after deleteUser:', e);
            throw e;
        }
    }

    // ==========================================
    // Settings
    // ==========================================

    async getSettings(): Promise<SystemSettings> {
        // ── Cloud-first: try Supabase, fallback to local ──
        if (supabaseStatus.isConfigured && navigator.onLine) {
            try {
                const { data, error } = await supabase
                    .from('settings')
                    .select('*')
                    .limit(1)
                    .maybeSingle();

                if (data && !error) {
                    rememberRemoteSettingsPk((data as { id?: string | number }).id);
                    const cloudSettings = mapSettingsFromDB(data);
                    // Update local copy so offline mode stays fresh
                    await localDb.settings.put({ ...cloudSettings, id: '00000000-0000-0000-0000-000000000000', _synced: true, _updated_at: new Date().toISOString() } as SyncableSettings);
                    return cloudSettings;
                }
            } catch (e) {
                // Cloud fetch failed — fall through to local
                logger.warn('Hybrid', 'Cloud settings fetch failed, using local:', e);
            }
        }

        // ── Fallback: local IndexedDB ──
        const settings = await localDb.settings.get('00000000-0000-0000-0000-000000000000');

        if (!settings) {
            return {
                id: '00000000-0000-0000-0000-000000000000',
                system_ready: true,
                school_active: true,
                dark_mode: true,
                assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
                grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD,
                kiosk_settings: {
                    main_title: 'نظام حاضر',
                    sub_title: 'يرجى تمرير البطاقة أو إدخال المعرف',
                    show_stats: true,
                    theme: 'dark-neon'
                }
            };
        }

        return settings;
    }

    async saveSettings(settings: SystemSettings): Promise<SystemSettings> {
        const now = new Date().toISOString();

        const syncableSettings: SyncableSettings = {
            ...settings,
            id: '00000000-0000-0000-0000-000000000000',
            _synced: false,
            _updated_at: now
        };

        await localDb.settings.put(syncableSettings);

        // Clean settings for Supabase - strip columns that don't exist in the DB table
        // and embed them inside kiosk_settings / attendance_settings JSONB
        // Supabase columns: id, system_ready, school_active, school_name, principal_name,
        //   logo_url, dark_mode, theme, kiosk_settings, security_settings,
        //   attendance_settings, social_links, notification_templates, whatsapp_templates,
        //   assembly_time, grace_period, absence_time, updated_at
        const { telemetry_retention_days, work_days, notification_templates, admin_theme, ...cleanSettings } = settings as any;
        const remoteSettingsId = await resolveSettingsUpsertId();
        // Top-level assembly/grace/absence are merged into kiosk_settings by SyncService.cleanPayloadForCloud
        // so Postgres projects without those columns still accept the row.
        const settingsPayload = {
            ...cleanSettings,
            id: remoteSettingsId,
            kiosk_settings: {
                ...(typeof cleanSettings.kiosk_settings === 'object' ? cleanSettings.kiosk_settings : {}),
                ...(telemetry_retention_days !== undefined && { telemetry_retention_days }),
                ...(admin_theme !== undefined && { admin_theme }),
                ...(settings.assembly_time !== undefined && { assembly_time: settings.assembly_time }),
                ...(settings.grace_period !== undefined && { grace_period: settings.grace_period }),
                ...(settings.absence_time !== undefined && { absence_time: settings.absence_time }),
            },
            attendance_settings: {
                ...(typeof cleanSettings.attendance_settings === 'object' ? cleanSettings.attendance_settings : {}),
                ...(work_days !== undefined && { work_days }),
                ...((settings.attendance_settings as any)?.auto_mark_time !== undefined && { auto_mark_time: (settings.attendance_settings as any).auto_mark_time }),
            },
            ...(notification_templates !== undefined && { notification_templates }),
        };
        await queueChange('settings', 'UPSERT', settingsPayload);

        // Broadcast to other tabs immediately
        broadcastSettingsUpdate(settings);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after saveSettings:', e);
        }

        return syncableSettings;
    }

    // ==========================================
    // Dashboard Stats
    // ==========================================

    async getDashboardStats(date?: string): Promise<DashboardStats> {
        const targetDate = date || getLocalISODate();

        // Get all students and filter active ones
        // Note: is_active can be true (from cloud) or 1 (from IndexedDB)
        const allStudents = await localDb.students.toArray();
        const students = allStudents.filter(s => s.is_active !== false && (s.is_active as any) !== 0);

        const attendance = await localDb.attendance_logs
            .where('date')
            .equals(targetDate)
            .toArray();

        const total_students = students.length;
        const counts = getAttendanceStatusCounts(attendance.map(mapAttendance), total_students, { date: targetDate });
        const present_count = counts.present;
        const late_count = counts.late;
        const absent_count = counts.absent;
        const attendance_rate = total_students > 0
            ? Math.round((counts.attended / total_students) * 100)
            : 0;

        return {
            total_students,
            present_count,
            late_count,
            absent_count,
            attendance_rate
        };
    }

    // ==========================================
    // Exits
    // ==========================================

    async getExits(date?: string): Promise<ExitRecord[]> {
        let exits: SyncableExit[];

        if (date) {
            exits = await localDb.exits
                .filter(e => e.exit_time?.startsWith(date))
                .toArray();
        } else {
            exits = await localDb.exits.toArray();
        }

        return exits;
    }

    async saveExit(exit: ExitRecord): Promise<ExitRecord> {
        const now = new Date().toISOString();

        const syncableExit: SyncableExit = {
            ...exit,
            id: exit.id || crypto.randomUUID(),
            _synced: false,
            _updated_at: now
        };

        await localDb.exits.put(syncableExit);
        await queueChange('exits', 'UPSERT', syncableExit);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after saveExit:', e);
        }

        return syncableExit;
    }

    async getStudentExits(student_id: string): Promise<ExitRecord[]> {
        const records = await localDb.exits
            .where('student_id')
            .equals(student_id)
            .toArray();
        return records;
    }

    async deleteExit(exitId: string): Promise<void> {
        await localDb.exits.delete(exitId);
        await queueChange('exits', 'DELETE', exitId);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after deleteExit:', e);
        }
    }

    // ==========================================
    // Guardian Excuses
    // ==========================================

    async getGuardianExcuses(filters?: {
        student_id?: string;
        status?: GuardianExcuseRecord['status'] | 'all';
        limit?: number;
    }): Promise<GuardianExcuseRecord[]> {
        let collection = localDb.guardian_excuses.orderBy('created_at').reverse();
        let rows = await collection.toArray();

        if (filters?.student_id) {
            rows = rows.filter(row => row.student_id === filters.student_id);
        }
        if (filters?.status && filters.status !== 'all') {
            rows = rows.filter(row => row.status === filters.status);
        }

        return filters?.limit ? rows.slice(0, filters.limit) : rows;
    }

    async saveGuardianExcuse(excuse: GuardianExcuseRecord): Promise<GuardianExcuseRecord> {
        const now = new Date().toISOString();
        const syncableExcuse: SyncableGuardianExcuse = {
            ...excuse,
            id: excuse.id || crypto.randomUUID(),
            status: excuse.status || 'pending',
            created_at: excuse.created_at || now,
            updated_at: excuse.updated_at || now,
            _synced: false,
            _updated_at: now
        };

        await localDb.guardian_excuses.put(syncableExcuse);
        await queueChange('guardian_excuses', 'UPSERT', syncableExcuse);

        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after saveGuardianExcuse:', e);
        }

        return syncableExcuse;
    }

    async updateGuardianExcuse(excuse: GuardianExcuseRecord): Promise<GuardianExcuseRecord> {
        return this.saveGuardianExcuse({
            ...excuse,
            updated_at: excuse.updated_at || new Date().toISOString()
        });
    }

    // ==========================================
    // Violations
    // ==========================================

    async getViolations(student_id?: string): Promise<ViolationRecord[]> {
        let violations: SyncableViolation[];

        if (student_id) {
            violations = await localDb.violations
                .where('student_id')
                .equals(student_id)
                .toArray();
        } else {
            // Default: last 30 days to avoid loading entire history
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - 30);
            const cutoffStr = cutoff.toISOString().split('T')[0];
            violations = await localDb.violations
                .where('date')
                .aboveOrEqual(cutoffStr)
                .toArray();
        }

        return violations;
    }

    /** Violations for a specific date (fast indexed query). */
    async getViolationsForDate(date: string): Promise<ViolationRecord[]> {
        return localDb.violations
            .where('date')
            .equals(date)
            .toArray();
    }

    async saveViolation(violation: ViolationRecord): Promise<ViolationRecord> {
        const now = new Date().toISOString();

        const syncableViolation: SyncableViolation = {
            ...violation,
            id: violation.id || crypto.randomUUID(),
            _synced: false,
            _updated_at: now
        };

        await localDb.violations.put(syncableViolation);
        await queueChange('violations', 'UPSERT', syncableViolation);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after saveViolation:', e);
        }

        return syncableViolation;
    }

    async deleteViolation(violationId: string): Promise<void> {
        await localDb.violations.delete(violationId);
        await queueChange('violations', 'DELETE', violationId);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after deleteViolation:', e);
        }
    }

    // ==========================================
    // Notifications
    // ==========================================

    async getNotifications(limit = 200): Promise<Notification[]> {
        // Always cap to avoid loading years of notifications
        return localDb.notifications
            .orderBy('created_at')
            .reverse()
            .limit(limit)
            .toArray();
    }

    async getStudentNotifications(studentId: string, className: string, limit = 50): Promise<Notification[]> {
        // Fetch recent subset then filter for targeting
        const recent = await localDb.notifications
            .orderBy('created_at')
            .reverse()
            .limit(500) // scan at most 500 recent
            .toArray();
        
        return recent.filter(n => 
            n.target_audience === 'all' || 
            (n.target_audience === 'guardian' && (n.target_id === studentId || !n.target_id)) ||
            (n.target_audience === 'student' && n.target_id === studentId) ||
            (n.target_audience === 'class' && (n.target_id === className || n.target_id === 'all'))
        ).slice(0, limit);
    }

    async saveNotifications(notifications: Notification[]): Promise<void> {
        if (!notifications.length) return;

        const now = new Date().toISOString();
        const syncableNotifications: SyncableNotification[] = notifications.map(n => ({
            ...n,
            id: n.id || crypto.randomUUID(),
            _synced: false,
            _updated_at: now
        }));

        await localDb.notifications.bulkPut(syncableNotifications);

        // Queue each notification individually (NOT the array) to prevent
        // Supabase from receiving array indices as column names (400 error)
        for (const n of syncableNotifications) {
            await queueChange('notifications', 'UPSERT', n);
        }

        // REMOVED FOR BATCHING: syncNow is handled by background auto-sync
    }

    async saveNotification(notification: Notification): Promise<Notification> {
        const now = new Date().toISOString();

        const syncableNotification: SyncableNotification = {
            ...notification,
            id: notification.id || crypto.randomUUID(),
            _synced: false,
            _updated_at: now
        };

        await localDb.notifications.put(syncableNotification);
        await queueChange('notifications', 'UPSERT', syncableNotification);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after saveNotification:', e);
        }

        return syncableNotification;
    }

    async deleteNotification(notificationId: string): Promise<void> {
        await localDb.notifications.delete(notificationId);
        await queueChange('notifications', 'DELETE', notificationId);

        // Wait for sync to complete
        try {
            await syncService.syncNow('up');
        } catch (e) {
            logger.warn('Hybrid', 'Sync failed after deleteNotification:', e);
        }
    }

    // ==========================================
    // Preload for Kiosk
    // ==========================================

    async preloadForKiosk(): Promise<{
        ok: boolean;
        usedLocalSnapshot: boolean;
        cloudAvailable: boolean;
        studentCount: number;
        message?: string;
    }> {
        try {
            let students: Student[] = [];
            let cloudAvailable = false;

            // Kiosk lookup must start from a fresh full student list. Incremental
            // sync can legitimately return zero rows after a device sleeps because
            // its watermark may already be ahead of unchanged student records.
            if (supabaseStatus.isConfigured && navigator.onLine) {
                try {
                    students = await this.fetchStudentsFromCloud();
                    cloudAvailable = true;
                } catch (error) {
                    logger.warn('Hybrid', 'Kiosk cloud student refresh failed, using local cache:', error);
                }

                await syncService.syncNow('down').catch((error) => {
                    logger.warn('Hybrid', 'Kiosk incremental sync failed after student refresh:', error);
                });
            }

            if (!cloudAvailable) {
                students = await localDb.students.toArray();
            }

            return {
                ok: students.length > 0,
                usedLocalSnapshot: !cloudAvailable,
                cloudAvailable,
                studentCount: students.length,
                message: students.length > 0 ? undefined : 'لا يوجد طلاب في قاعدة البيانات'
            };
        } catch (error: any) {
            return {
                ok: false,
                usedLocalSnapshot: false,
                cloudAvailable: false,
                studentCount: 0,
                message: error.message || 'فشل في تحميل البيانات'
            };
        }
    }

    // ==========================================
    // Kiosk Attendance
    // ==========================================

    async kioskMarkAttendance(studentId: string): Promise<{
        ok: boolean;
        code: string;
        message: string;
        student?: Student;
        record?: AttendanceRecord;
        stats?: {
            late_count: number;
            todayMinutes: number;
            totalMinutes: number;
        };
    }> {
        const result = await this.markAttendance(studentId);

        return {
            ok: result.success,
            code: result.success ? 'success' : 'error',
            message: result.message,
            student: result.student,
            record: result.record,
            stats: result.stats
        };
    }

    // ==========================================
    // Dismissal Records & Schedules (Cloud-Direct)
    // ==========================================

    private normalizeDismissalSchedule(schedule: any, synced: boolean, now = new Date().toISOString()): SyncableDismissalSchedule {
        const days = Array.isArray(schedule.days)
            ? schedule.days
            : Array.isArray(schedule.day_of_week)
                ? schedule.day_of_week
                : [];
        const dismissalTime = String(schedule.dismissal_time || '').slice(0, 5);
        const className =
            schedule.class_name ||
            (Array.isArray(schedule.class_names) ? schedule.class_names[0] : '') ||
            '';

        return {
            ...schedule,
            id: schedule.id || crypto.randomUUID(),
            class_name: className,
            dismissal_time: dismissalTime,
            days,
            day_of_week: days,
            label: schedule.label ?? schedule.name ?? '',
            created_at: schedule.created_at || now,
            updated_at: schedule.updated_at || now,
            _synced: synced,
            _updated_at: schedule.updated_at || now
        };
    }

    private buildDismissalScheduleCloudPayload(schedule: SyncableDismissalSchedule) {
        return {
            id: schedule.id,
            class_name: schedule.class_name,
            dismissal_time: schedule.dismissal_time,
            days: Array.isArray(schedule.days) ? schedule.days : [],
            label: schedule.label || null,
            created_at: schedule.created_at,
            updated_at: schedule.updated_at
        };
    }

    private async replaceLocalDismissalSchedules(schedules: any[], synced: boolean): Promise<SyncableDismissalSchedule[]> {
        const now = new Date().toISOString();
        const normalized = schedules.map(schedule => this.normalizeDismissalSchedule(schedule, synced, now));

        await localDb.dismissal_schedules.clear();
        if (normalized.length > 0) {
            await localDb.dismissal_schedules.bulkPut(normalized);
        }

        return normalized;
    }

    private notifyDismissalSchedulesChanged(): void {
        const eventDetail = {
            table: 'dismissal_schedules',
            eventType: 'UPSERT',
            record: null
        };

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('hader:realtime-update', { detail: eventDetail }));
        }

        try {
            this.syncBroadcast?.postMessage({ type: 'realtime-update', ...eventDetail });
        } catch (_) { }
    }

    private async queueDismissalScheduleReplacement(previous: any[], next: SyncableDismissalSchedule[]): Promise<void> {
        const nextIds = new Set(next.map(schedule => schedule.id));
        for (const schedule of previous) {
            if (schedule?.id && !nextIds.has(schedule.id)) {
                await queueChange('dismissal_schedules', 'DELETE', schedule.id);
            }
        }
        for (const schedule of next) {
            await queueChange('dismissal_schedules', 'UPSERT', schedule);
        }
    }

    async addDismissal(record: DismissalRecord): Promise<void> {
        const now = new Date().toISOString();
        const syncable: SyncableDismissalRecord = {
            ...record,
            id: record.id || crypto.randomUUID(),
            exit_time: record.exit_time || now,
            _synced: false,
            _updated_at: now
        };

        await localDb.dismissal_records.put(syncable);
        await queueChange('dismissal_records', 'INSERT', syncable);

        // Background sync if online
        if (navigator.onLine) {
            syncService.syncNow('up').catch(() => {});
        }
    }

    async getTodayDismissals(): Promise<any[]> {
        const today = getLocalISODate();
        return await localDb.dismissal_records
            .where('date')
            .equals(today)
            .toArray();
    }

    async getStudentDismissals(studentId: string): Promise<any[]> {
        return await localDb.dismissal_records
            .where('student_id')
            .equals(studentId)
            .toArray();
    }

    async getDismissalsByDateRange(startDate: string, endDate: string): Promise<any[]> {
        return await localDb.dismissal_records
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();
    }

    async isStudentDismissedToday(studentId: string): Promise<boolean> {
        const today = getLocalISODate();
        const count = await localDb.dismissal_records
            .where({ student_id: studentId, date: today })
            .count();
        return count > 0;
    }

    async getDismissalSchedules(): Promise<any[]> {
        const localSchedules = await localDb.dismissal_schedules.toArray();
        const hasPendingLocalChanges = localSchedules.some(schedule => schedule._synced === false);

        if (!hasPendingLocalChanges && navigator.onLine && supabaseStatus.isConfigured) {
            try {
                const { data, error } = await supabase
                    .from('dismissal_schedules')
                    .select('*')
                    .order('dismissal_time', { ascending: true });

                if (error) throw error;
                return await this.replaceLocalDismissalSchedules(data || [], true);
            } catch (error) {
                logger.warn('Hybrid', 'Failed to refresh dismissal schedules from cloud, using local cache:', error);
            }
        }

        return localSchedules;
    }

    async saveDismissalSchedules(schedules: any[]): Promise<void> {
        const previous = await localDb.dismissal_schedules.toArray();
        const next = await this.replaceLocalDismissalSchedules(schedules, false);

        if (navigator.onLine && supabaseStatus.isConfigured) {
            try {
                const { error: delError } = await supabase
                    .from('dismissal_schedules')
                    .delete()
                    .neq('id', '00000000-0000-0000-0000-000000000000');
                if (delError) throw delError;

                if (next.length > 0) {
                    const payload = next.map(schedule => this.buildDismissalScheduleCloudPayload(schedule));
                    const { error: insError } = await supabase.from('dismissal_schedules').insert(payload);
                    if (insError) throw insError;
                }

                await this.replaceLocalDismissalSchedules(next, true);
                this.notifyDismissalSchedulesChanged();
                return;
            } catch (error) {
                await this.queueDismissalScheduleReplacement(previous, next);
                this.notifyDismissalSchedulesChanged();
                throw error;
            }
        }

        await this.queueDismissalScheduleReplacement(previous, next);
        this.notifyDismissalSchedulesChanged();

        if (navigator.onLine) {
            syncService.syncNow('up').catch(() => {});
        }
    }

    // ==========================================
    // Dismissal Calls (Realtime / Cloud)
    // Calls are inherently realtime and rely exclusively on cloud.
    // ==========================================

    async addDismissalCall(call: DismissalCallRequest): Promise<void> {
        const now = new Date().toISOString();
        const syncable: SyncableDismissalCall = {
            ...call,
            id: call.id || crypto.randomUUID(),
            status: call.status || 'pending',
            request_time: call.request_time || now,
            _synced: false,
            _updated_at: now
        };

        // 1. Direct Cloud Push (Highest Priority for real-time responsiveness)
        let cloudSuccess = false;
        if (navigator.onLine && supabaseStatus.isConfigured) {
            try {
                const { error } = await supabase.from('dismissal_calls').insert({
                    id: syncable.id,
                    student_id: syncable.student_id,
                    student_name: syncable.student_name,
                    class_name: syncable.class_name,
                    section: syncable.section,
                    requested_by: syncable.requested_by,
                    requested_by_name: syncable.requested_by_name,
                    status: syncable.status,
                    request_time: syncable.request_time
                });
                
                if (!error) {
                    cloudSuccess = true;
                    syncable._synced = true;
                }
            } catch (e) {
                logger.warn('Hybrid', 'Instant cloud push failed, falling back to sync queue', e);
            }
        }

        // 2. Save locally for the dashboard to see it immediately
        await localDb.dismissal_calls.put(syncable);

        // 3. Queue for sync only if cloud push failed
        if (!cloudSuccess) {
            await queueChange('dismissal_calls', 'INSERT', syncable);
        }

        // 4. Local Broadcast for multi-tab support
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                const bc = new BroadcastChannel('hader:dismissal_calls:channel');
                broadcastDismissalEvent('call_added', syncable.id);
                bc.postMessage({ type: 'call_added', id: syncable.id });
                bc.close();
            }
        } catch (_) {}

        // 5. Send supervisor notification so they see a toast alert
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
            console.warn('[Hybrid] Failed to create supervisor notification for dismissal call', notifErr);
        }
    }

    async getActiveDismissalCalls(): Promise<any[]> {
        // 1. Try Cloud directly for latest state if online
        if (navigator.onLine && supabaseStatus.isConfigured) {
            try {
                const { data, error } = await supabase
                    .from('dismissal_calls')
                    .select('*')
                    .in('status', ['pending', 'called']);
                
                if (!error && data) {
                    // Cache to local DB to keep it semi-synced
                    for (const call of data) {
                        await localDb.dismissal_calls.put({ ...call, _synced: true, _updated_at: new Date().toISOString() });
                    }
                    return data;
                }
            } catch (e) {
                logger.warn('Hybrid', 'Failed to fetch active calls from cloud, using local fallback', e);
            }
        }

        // 2. Fallback to Local DB
        return await localDb.dismissal_calls
            .where('status')
            .anyOf(['pending', 'called'])
            .toArray();
    }

    async updateDismissalCallStatus(id: string, status: string): Promise<void> {
        const now = new Date().toISOString();
        const update: any = { status, _synced: false, _updated_at: now };
        if (status === 'called') update.called_at = now;
        if (status === 'dismissed') update.dismissed_at = now;

        // 1. Direct Cloud Update (Priority)
        let cloudSuccess = false;
        if (navigator.onLine && supabaseStatus.isConfigured) {
            try {
                const { error } = await supabase
                    .from('dismissal_calls')
                    .update({
                        status: update.status,
                        called_at: update.called_at,
                        dismissed_at: update.dismissed_at
                    })
                    .eq('id', id);
                
                if (!error) {
                    cloudSuccess = true;
                    update._synced = true;
                }
            } catch (e) {
                logger.warn('Hybrid', 'Instant cloud status update failed', e);
            }
        }

        // 2. Update locally
        await localDb.dismissal_calls.update(id, update);

        // 3. Queue only if cloud push failed
        if (!cloudSuccess) {
            await queueChange('dismissal_calls', 'UPDATE', { id, ...update });
        }
        
        // 4. Force sync for secondary devices
        if (navigator.onLine) {
            syncService.syncNow('up').catch(() => {});
        }
    }

    subscribeToDismissalCalls(callback: (calls: any[]) => void): { unsubscribe: () => void } {
        let channel: any = null;
        let bc: BroadcastChannel | null = null;
        
        const fetchAndCallback = async () => {
            const calls = await this.getActiveDismissalCalls();
            callback(calls);
        };

        // 1. Initial fetch
        fetchAndCallback();

        // 2. Supabase Realtime for external changes
        if (supabaseStatus.isConfigured) {
            channel = supabase
                .channel('dismissal_calls_hybrid')
                .on('broadcast', { event: 'call_added' }, () => fetchAndCallback())
                .on('broadcast', { event: 'call_updated' }, () => fetchAndCallback())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'dismissal_calls' }, async (payload: any) => {
                    // Critical Optimization: If we receive a new or updated call from the cloud,
                    // immediately save it to the local DB so that fetchAndCallback sees it instantly
                    // without waiting for the next sync cycle.
                    if (payload.new && Object.keys(payload.new).length > 0) {
                        try {
                            // Ensure it's marked as synced since it came from the cloud
                            const record = { ...payload.new, _synced: true, _updated_at: new Date().toISOString() };
                            await localDb.dismissal_calls.put(record);
                        } catch (err) {
                            console.warn('[Hybrid] Failed to pre-sync realtime record', err);
                        }
                    }
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new Event('hader:realtime-update'));
                    }
                    fetchAndCallback();
                })
                .subscribe();
        }

        // 3. Local Broadcast for multi-tab support
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                bc = new BroadcastChannel('hader:dismissal_calls:channel');
                bc.onmessage = (event) => {
                    if (event.data?.type === 'call_added' || event.data?.type === 'call_updated') {
                        fetchAndCallback();
                    }
                };
            }
        } catch (_) {}

        return { 
            unsubscribe: () => {
                if (channel) supabase.removeChannel(channel);
                if (bc) bc.close();
            } 
        };
    }

    // ==========================================
    // Telemetry & Logs
    // ==========================================

    async logActivity(action: string, details: any = {}): Promise<void> {
        const log: SyncableActivityLog = {
            id: crypto.randomUUID(),
            user_id: 'current-user', // Should ideally fetch from auth session
            action,
            details,
            created_at: new Date().toISOString(),
            _synced: false
        };
        await localDb.activity_logs.add(log);
        await queueChange('activity_logs', 'INSERT', log);
    }

    async logClientError(error: Error | string, severity: ClientErrorSeverity = 'ERROR', source: ClientErrorSource = 'console.error'): Promise<void> {
        const log: SyncableClientErrorLog = {
            id: crypto.randomUUID(),
            message: typeof error === 'string' ? error : error.message,
            stack: typeof error === 'string' ? undefined : error.stack,
            severity: severity,
            source: source,
            created_at: new Date().toISOString(),
            _synced: false
        };
        await localDb.client_error_logs.add(log);
        await queueChange('client_error_logs', 'INSERT', log);
    }

    // ==========================================
    // Diagnostics
    // ==========================================

    async getDiagnostics() {
        return syncService.getDiagnostics();
    }

    async runDiagnostics(): Promise<DiagnosticResult[]> {
        const results: DiagnosticResult[] = [];
        const syncDiag = await syncService.getDiagnostics();
        
        // 1. Connection check
        results.push({
            key: 'cloud-connection',
            title: 'الاتصال السحابي',
            status: syncDiag.supabaseConfigured && syncDiag.isOnline ? 'ok' : 'error',
            message: syncDiag.supabaseConfigured && syncDiag.isOnline 
                ? 'الاتصال بـ Supabase نشط ومستقر' 
                : 'يوجد انقطاع في الاتصال السحابي',
            hint: !syncDiag.supabaseConfigured ? 'تحقق من إعدادات Supabase' : (!syncDiag.isOnline ? 'تحقق من اتصال الإنترنت' : undefined)
        });

        // 2. Sync Queue check
        results.push({
            key: 'sync-queue',
            title: 'طابور المزامنة',
            status: syncDiag.queueSize > 100 ? 'error' : (syncDiag.queueSize > 50 ? 'warning' : 'ok'),
            count: syncDiag.queueSize,
            message: syncDiag.queueSize > 0 
                ? `يوجد ${syncDiag.queueSize} عنصر في انتظار المزامنة` 
                : 'جميع البيانات المحلية متزامنة مع السحابة',
            hint: syncDiag.queueSize > 100 ? 'قد يكون هناك بطء في المزامنة بسبب حجم البيانات' : undefined
        });

        // 3. Local DB check
        try {
            const studentCount = await localDb.students.count();
            results.push({
                key: 'local-db',
                title: 'قاعدة البيانات المحلية',
                status: studentCount > 0 ? 'ok' : 'warning',
                count: studentCount,
                message: studentCount > 0 
                    ? `تم العثور على ${studentCount} طالب في التخزين المحلي` 
                    : 'قاعدة البيانات المحلية فارغة',
                hint: studentCount === 0 ? 'قم باستيراد الطلاب أو المزامنة من السحابة' : undefined
            });
        } catch (e) {
            results.push({
                key: 'local-db-error',
                title: 'خطأ في قاعدة البيانات المحلية',
                status: 'error',
                message: 'فشل الوصول إلى التخزين المحلي (IndexedDB)'
            });
        }

        // 4. Conflicts check
        results.push({
            key: 'sync-conflicts',
            title: 'تضارب البيانات',
            status: syncDiag.conflictCount > 0 ? 'warning' : 'ok',
            count: syncDiag.conflictCount,
            message: syncDiag.conflictCount > 0 
                ? `يوجد ${syncDiag.conflictCount} تضارب في البيانات يحتاج للمراجعة` 
                : 'لا توجد تضاربات معلقة',
            hint: syncDiag.conflictCount > 0 ? 'راجع لوحة حل التضاربات في الإعدادات المتقدمة' : undefined
        });

        return results;
    }
}

// Singleton instance
export const hybridProvider = new HybridProvider();
