import Dexie, { Table } from 'dexie';
import { Student, AttendanceRecord, SchoolClass, User, SystemSettings, ExitRecord, ViolationRecord, Notification, GuardianExcuseRecord } from '../types';
import { syncCatalog } from '../modules/sync/catalog';

// ==========================================
// 1. Interfaces for Local Data
// ==========================================

export interface SyncQueueEntry {
    id?: number; // Auto-increment
    table: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';
    payload: any;
    created_at: string;
    retry_count: number;
    last_error?: string;
    blocked_at?: string;
    blocked_reason?: string;
    failure_category?: string;
    group_id?: string; // To group related operations (e.g., batch insert)
    synced_at?: string; // When this entry was successfully synced
}

// Syncable record interface - adds sync tracking fields
export interface SyncableRecord {
    _synced?: boolean;      // Whether this record is synced with cloud
    _updated_at?: string;   // Last local update timestamp
    _deleted?: boolean;     // Soft delete flag for sync
    _conflict?: boolean;    // Has unresolved conflict
}

// Conflict log entry for tracking sync conflicts
export interface ConflictLogEntry {
    id?: number;
    table: string;
    record_id: string;
    local_data: any;
    cloud_data: any;
    detected_at: string;
    resolved_at?: string;
    resolution?: 'local' | 'cloud' | 'merged' | 'manual';
    resolved_by?: string;
}

// Sync metadata entry
export interface SyncMetadataEntry {
    key: string;
    value: any;
    updated_at?: string;
}

export interface SyncTombstoneEntry extends SyncableRecord {
    id: string;
    table_name: string;
    record_id: string;
    deleted_at: string;
    created_at?: string;
}

// Extended types with sync fields
export type SyncableStudent = Student & SyncableRecord;
export type SyncableAttendance = AttendanceRecord & SyncableRecord;
export type SyncableUser = User & SyncableRecord;
export type SyncableClass = SchoolClass & SyncableRecord;
export type SyncableSettings = SystemSettings & SyncableRecord;
export type SyncableExit = ExitRecord & SyncableRecord;
export type SyncableViolation = ViolationRecord & SyncableRecord;
export type SyncableNotification = Notification & SyncableRecord;
export type SyncableGuardianExcuse = GuardianExcuseRecord & SyncableRecord;
export type SyncableDismissalRecord = any & SyncableRecord;
export type SyncableDismissalCall = any & SyncableRecord;
export type SyncableDismissalSchedule = any & SyncableRecord;
export type SyncableActivityLog = any & SyncableRecord;
export type SyncableAuthAuditLog = any & SyncableRecord;
export type SyncableClientErrorLog = any & SyncableRecord;
export type SyncableEmergencyLog = any & SyncableRecord;
export type SyncableDailySummary = any & SyncableRecord;

export class HaderLocalDB extends Dexie {
    // Core Tables (with sync support)
    students!: Table<SyncableStudent, string>;
    attendance_logs!: Table<SyncableAttendance, string>;
    users!: Table<SyncableUser, string>;
    classes!: Table<SyncableClass, string>;
    settings!: Table<SyncableSettings, string>;
    exits!: Table<SyncableExit, string>;
    violations!: Table<SyncableViolation, string>;
    notifications!: Table<SyncableNotification, string>;
    guardian_excuses!: Table<SyncableGuardianExcuse, string>;
    dismissal_records!: Table<SyncableDismissalRecord, string>;
    dismissal_calls!: Table<SyncableDismissalCall, string>;
    dismissal_schedules!: Table<SyncableDismissalSchedule, string>;
    activity_logs!: Table<SyncableActivityLog, string>;
    auth_audit_logs!: Table<SyncableAuthAuditLog, string>;
    client_error_logs!: Table<SyncableClientErrorLog, string>;
    emergency_logs!: Table<SyncableEmergencyLog, string>;
    daily_summaries!: Table<SyncableDailySummary, string>;

    // Sync Management Tables
    sync_queue!: Table<SyncQueueEntry, number>;
    sync_metadata!: Table<SyncMetadataEntry, string>;
    conflict_log!: Table<ConflictLogEntry, number>;
    sync_tombstones!: Table<SyncTombstoneEntry, string>;

    constructor() {
        super('HaderDB');

        // ==========================================
        // Version 1: Original schema
        // ==========================================
        this.version(1).stores({
            students: '&id, name, class_name, section, guardian_phone, guardian_name, is_active',
            attendance_logs: '&id, student_id, date, status, [date+student_id]',
            users: '&id, username, role',
            classes: '&id, name',
            sync_queue: '++id, table, created_at, [table+operation]',
            settings: 'id',
            metadata: '&key'
        });

        // ==========================================
        // Version 2: Enhanced schema with sync support
        // ==========================================
        this.version(2).stores({
            // Core tables with sync tracking indexes
            students: '&id, name, class_name, section, guardian_phone, guardian_name, is_active, _synced, _updated_at',
            attendance_logs: '&id, student_id, date, status, [date+student_id], _synced, _updated_at',
            users: '&id, username, role, _synced, _updated_at',
            classes: '&id, name, _synced, _updated_at',
            settings: 'id, _synced, _updated_at',
            
            // New tables for exits, violations, notifications
            exits: '&id, student_id, exit_time, _synced, _updated_at',
            violations: '&id, student_id, created_at, _synced, _updated_at',
            notifications: '&id, target_audience, created_at, _synced, _updated_at',
            
            // Enhanced sync management
            sync_queue: '++id, table, operation, created_at, retry_count, [table+operation]',
            sync_metadata: '&key, updated_at',
            conflict_log: '++id, table, record_id, detected_at, resolved_at'
        });

        // ==========================================
        // Version 4: Hardened exits/violations with date
        // ==========================================
        this.version(4).stores({
            students: '&id, name, class_name, section, guardian_phone, guardian_name, is_active, _synced, _updated_at',
            attendance_logs: '&id, student_id, date, status, [date+student_id], _synced, _updated_at',
            users: '&id, username, role, _synced, _updated_at',
            classes: '&id, name, _synced, _updated_at',
            settings: 'id, _synced, _updated_at',
            exits: '&id, student_id, exit_time, date, [date+student_id], _synced, _updated_at',
            violations: '&id, student_id, created_at, date, type, [date+student_id+type], _synced, _updated_at',
            notifications: '&id, target_audience, created_at, _synced, _updated_at',
            
            dismissal_records: '&id, student_id, exit_time, date, _synced, _updated_at',
            dismissal_calls: '&id, student_id, status, request_time, _synced, _updated_at',
            dismissal_schedules: '&id, day_of_week, _synced, _updated_at',
            
            activity_logs: '&id, user_id, action, created_at, [user_id+action], _synced, _updated_at',
            auth_audit_logs: '&id, username, action, created_at, _synced, _updated_at',
            client_error_logs: '&id, severity, source, created_at, _synced, _updated_at',
            emergency_logs: '&id, date, created_at, _synced, _updated_at',
            daily_summaries: '&date, _synced, _updated_at',

            sync_queue: '++id, table, operation, created_at, retry_count, [table+operation]',
            sync_metadata: '&key, updated_at',
            conflict_log: '++id, table, record_id, detected_at, resolved_at'
        });

        // ==========================================
        // Version 5: Guardian absence excuses workflow
        // ==========================================
        this.version(5).stores({
            students: '&id, name, class_name, section, guardian_phone, guardian_name, is_active, _synced, _updated_at',
            attendance_logs: '&id, student_id, date, status, [date+student_id], _synced, _updated_at',
            users: '&id, username, role, _synced, _updated_at',
            classes: '&id, name, _synced, _updated_at',
            settings: 'id, _synced, _updated_at',
            exits: '&id, student_id, exit_time, date, [date+student_id], _synced, _updated_at',
            violations: '&id, student_id, created_at, date, type, [date+student_id+type], _synced, _updated_at',
            notifications: '&id, target_audience, created_at, _synced, _updated_at',
            guardian_excuses: '&id, student_id, absence_date, status, created_at, updated_at, _synced, _updated_at',

            dismissal_records: '&id, student_id, exit_time, date, _synced, _updated_at',
            dismissal_calls: '&id, student_id, status, request_time, _synced, _updated_at',
            dismissal_schedules: '&id, day_of_week, _synced, _updated_at',

            activity_logs: '&id, user_id, action, created_at, [user_id+action], _synced, _updated_at',
            auth_audit_logs: '&id, username, action, created_at, _synced, _updated_at',
            client_error_logs: '&id, severity, source, created_at, _synced, _updated_at',
            emergency_logs: '&id, date, created_at, _synced, _updated_at',
            daily_summaries: '&date, _synced, _updated_at',

            sync_queue: '++id, table, operation, created_at, retry_count, [table+operation]',
            sync_metadata: '&key, updated_at',
            conflict_log: '++id, table, record_id, detected_at, resolved_at'
        });

        // ==========================================
        // Version 6: Durable delete tombstones for cross-device sync
        // ==========================================
        this.version(6).stores({
            students: '&id, name, class_name, section, guardian_phone, guardian_name, is_active, _synced, _updated_at',
            attendance_logs: '&id, student_id, date, status, [date+student_id], _synced, _updated_at',
            users: '&id, username, role, _synced, _updated_at',
            classes: '&id, name, _synced, _updated_at',
            settings: 'id, _synced, _updated_at',
            exits: '&id, student_id, exit_time, date, [date+student_id], _synced, _updated_at',
            violations: '&id, student_id, created_at, date, type, [date+student_id+type], _synced, _updated_at',
            notifications: '&id, target_audience, created_at, _synced, _updated_at',
            guardian_excuses: '&id, student_id, absence_date, status, created_at, updated_at, _synced, _updated_at',

            dismissal_records: '&id, student_id, exit_time, date, _synced, _updated_at',
            dismissal_calls: '&id, student_id, status, request_time, _synced, _updated_at',
            dismissal_schedules: '&id, day_of_week, _synced, _updated_at',

            activity_logs: '&id, user_id, action, created_at, [user_id+action], _synced, _updated_at',
            auth_audit_logs: '&id, username, action, created_at, _synced, _updated_at',
            client_error_logs: '&id, severity, source, created_at, _synced, _updated_at',
            emergency_logs: '&id, date, created_at, _synced, _updated_at',
            daily_summaries: '&date, _synced, _updated_at',

            sync_queue: '++id, table, operation, created_at, retry_count, [table+operation]',
            sync_metadata: '&key, updated_at',
            conflict_log: '++id, table, record_id, detected_at, resolved_at',
            sync_tombstones: '&id, table_name, record_id, deleted_at, _synced, _updated_at, [table_name+record_id]'
        });
    }

    // ==========================================
    // Helper: Get all unsynced records from a table
    // ==========================================
    async getUnsyncedRecords<T>(tableName: string): Promise<T[]> {
        const table = this.table(tableName);
        // IndexedDB stores booleans as 0/1, so we filter for _synced === false
        return await table.filter(record => record._synced === false).toArray() as T[];
    }

    // ==========================================
    // Helper: Mark records as synced
    // ==========================================
    async markAsSynced(tableName: string, ids: string[]): Promise<void> {
        const table = this.table(tableName);
        await table.where('id').anyOf(ids).modify({ _synced: true });
    }

    // ==========================================
    // Helper: Get records updated after a timestamp
    // ==========================================
    async getRecordsUpdatedAfter<T>(tableName: string, timestamp: string): Promise<T[]> {
        const table = this.table(tableName);
        return await table.where('_updated_at').above(timestamp).toArray() as T[];
    }

    // ==========================================
    // Helper: Clear all data (for testing/reset)
    // ==========================================
    async clearAllData(): Promise<void> {
        const dataTables = syncCatalog.all().map(policy => this.table(policy.name));
        const managementTables = [
            this.sync_queue,
            this.sync_metadata,
            this.conflict_log,
            this.sync_tombstones
        ];

        await this.transaction('rw',
            [...dataTables, ...managementTables],
            async () => {
                await Promise.all(
                    [...dataTables, ...managementTables].map(table => table.clear())
                );
            }
        );
    }

    // ==========================================
    // Helper: Export all data for backup
    // ==========================================
    async exportAllData(): Promise<Record<string, any[]>> {
        const dataEntries = await Promise.all(
            syncCatalog.all().map(async policy => [
                policy.name,
                await this.table(policy.name).toArray()
            ] as const)
        );
        const managementEntries = await Promise.all([
            ['sync_tombstones', this.sync_tombstones] as const,
            ['sync_queue', this.sync_queue] as const,
            ['sync_metadata', this.sync_metadata] as const,
            ['conflict_log', this.conflict_log] as const
        ].map(async ([name, table]) => [name, await table.toArray()] as const));

        return Object.fromEntries([...dataEntries, ...managementEntries]);
    }
}

// Singleton Instance
export const localDb = new HaderLocalDB();

// ==========================================
// 2. Helper Functions
// ==========================================

const getDeleteRecordId = (payload: any): string | null => {
    if (typeof payload === 'string' || typeof payload === 'number') return String(payload);
    if (payload?.id != null) return String(payload.id);
    return null;
};

export async function recordSyncTombstone(
    tableName: string,
    recordId: string,
    deletedAt = new Date().toISOString(),
    synced = false
): Promise<void> {
    if (!tableName || !recordId || !syncCatalog.has(tableName)) return;

    await localDb.sync_tombstones.put({
        id: `${tableName}:${recordId}`,
        table_name: tableName,
        record_id: recordId,
        deleted_at: deletedAt,
        created_at: deletedAt,
        _synced: synced,
        _updated_at: deletedAt
    });
}

export async function getUnsyncedTombstones(): Promise<SyncTombstoneEntry[]> {
    return localDb.sync_tombstones
        .filter(row => row._synced === false)
        .toArray();
}

export async function markTombstonesSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await localDb.sync_tombstones
        .where('id')
        .anyOf(ids)
        .modify({ _synced: true });
}

export async function removePendingSyncEntriesForRecord(tableName: string, recordId: string): Promise<void> {
    const entries = await localDb.sync_queue
        .where('table')
        .equals(tableName)
        .toArray();
    const ids = entries
        .filter(entry => entry.operation !== 'DELETE' && getDeleteRecordId(entry.payload) === recordId)
        .map(entry => entry.id)
        .filter((id): id is number => typeof id === 'number');

    if (ids.length > 0) {
        await localDb.sync_queue.bulkDelete(ids);
    }
}

/**
 * Queue a change for synchronization
 */
export async function queueChange(
    table: string,
    operation: SyncQueueEntry['operation'],
    payload: any,
    groupId?: string
): Promise<number> {
    if (!syncCatalog.has(table)) {
        throw new Error(`Unsupported sync table: ${table}`);
    }

    const createdAt = new Date().toISOString();
    const id = await localDb.sync_queue.add({
        table,
        operation,
        payload,
        created_at: createdAt,
        retry_count: 0,
        group_id: groupId
    });

    if (operation === 'DELETE') {
        const recordId = getDeleteRecordId(payload);
        if (recordId) {
            await recordSyncTombstone(table, recordId, createdAt, false);
        }
    }
    
    // Dispatch event for real-time UI updates
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hader:sync-queue-change', { 
            detail: { table, operation, queueId: id } 
        }));
    }
    
    return id;
}

/**
 * Get pending sync queue entries
 */
export async function getPendingSyncEntries(options: { includeBlocked?: boolean } = {}): Promise<SyncQueueEntry[]> {
    const entries = await localDb.sync_queue.orderBy('created_at').toArray();
    if (options.includeBlocked) return entries;
    return entries.filter(entry => !entry.blocked_at);
}

/**
 * Get pending sync count
 */
export async function getPendingSyncCount(): Promise<number> {
    return (await getPendingSyncEntries()).length;
}

/**
 * Remove synced entries from queue
 */
export async function removeSyncedEntries(ids: number[]): Promise<void> {
    await localDb.sync_queue.bulkDelete(ids);
}

/**
 * Mark sync entry as failed with error
 */
export async function markSyncEntryFailed(id: number, error: string): Promise<void> {
    const current = await localDb.sync_queue.get(id);
    const nextRetryCount = (current?.retry_count ?? 0) + 1;
    await localDb.sync_queue.update(id, {
        retry_count: nextRetryCount,
        last_error: error
    });
}

/**
 * Keep a failed sync entry for diagnostics/manual review, but stop retrying it
 * automatically. This prevents silent data loss without creating endless retry loops.
 */
export async function markSyncEntryBlocked(
    id: number,
    error: string,
    failureCategory = 'max_retries'
): Promise<void> {
    const current = await localDb.sync_queue.get(id);
    const nextRetryCount = (current?.retry_count ?? 0) + 1;
    const blockedAt = new Date().toISOString();
    await localDb.sync_queue.update(id, {
        retry_count: nextRetryCount,
        last_error: error,
        blocked_at: blockedAt,
        blocked_reason: error,
        failure_category: failureCategory
    });
}

/**
 * Get Last Sync Timestamp
 */
export async function getLastSyncTime(): Promise<string | null> {
    const meta = await localDb.sync_metadata.get('last_sync_time');
    return meta?.value || null;
}

/**
 * Set Last Sync Timestamp
 */
export async function setLastSyncTime(isoDate: string): Promise<void> {
    await localDb.sync_metadata.put({ 
        key: 'last_sync_time', 
        value: isoDate,
        updated_at: new Date().toISOString()
    });
}

/**
 * Get sync metadata value
 */
export async function getSyncMeta(key: string): Promise<any> {
    const meta = await localDb.sync_metadata.get(key);
    return meta?.value ?? null;
}

/**
 * Set sync metadata value
 */
export async function setSyncMeta(key: string, value: any): Promise<void> {
    await localDb.sync_metadata.put({
        key,
        value,
        updated_at: new Date().toISOString()
    });
}

/**
 * Log a sync conflict
 */
export async function logConflict(
    table: string,
    recordId: string,
    localData: any,
    cloudData: any
): Promise<number> {
    return await localDb.conflict_log.add({
        table,
        record_id: recordId,
        local_data: localData,
        cloud_data: cloudData,
        detected_at: new Date().toISOString()
    });
}

/**
 * Resolve a conflict
 */
export async function resolveConflict(
    conflictId: number,
    resolution: 'local' | 'cloud' | 'merged' | 'manual',
    resolvedBy?: string
): Promise<void> {
    await localDb.conflict_log.update(conflictId, {
        resolved_at: new Date().toISOString(),
        resolution,
        resolved_by: resolvedBy
    });
}

/**
 * Get unresolved conflicts
 */
export async function getUnresolvedConflicts(): Promise<ConflictLogEntry[]> {
    return await localDb.conflict_log
        .filter(c => !c.resolved_at)
        .toArray();
}

/**
 * Get device ID (generate if not exists)
 */
export async function getDeviceId(): Promise<string> {
    let deviceId = await getSyncMeta('device_id');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        await setSyncMeta('device_id', deviceId);
    }
    return deviceId;
}
