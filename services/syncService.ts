// =============================================================================
// نظام حاضر (Hader) - Sync Service
// =============================================================================
// Main synchronization service for bidirectional sync between IndexedDB and Supabase

import { supabase, supabaseStatus } from './supabase';
import { logger } from './logger';
import {
    localDb,
    queueChange,
    getPendingSyncEntries,
    getPendingSyncCount,
    removeSyncedEntries,
    markSyncEntryFailed,
    markSyncEntryBlocked,
    getLastSyncTime,
    getSyncMeta,
    setLastSyncTime,
    setSyncMeta,
    SyncQueueEntry,
    SyncTombstoneEntry,
    getUnsyncedTombstones,
    markTombstonesSynced,
    recordSyncTombstone,
    removePendingSyncEntriesForRecord
} from './localDb';
import {
    getSyncedDate,
    getSyncedISOString,
    normalizeAssignedClasses,
    normalizeAssignedSections
} from './dbHelpers';
import {
    applySettingsRowToCloud,
    rememberRemoteSettingsPk,
    resolveSettingsUpsertId
} from './settingsRemoteId';
import {
    SyncDirection,
    SyncState,
    SyncResult,
    SyncEvent,
    SyncEventListener,
    SyncConfig,
    DEFAULT_SYNC_CONFIG,
    NetworkState
} from './syncTypes';
import { conflictResolver } from './conflictResolver';
import { fetchAllFromSupabase } from './dbFetchAll';
import { syncCatalog } from '../modules/sync/catalog';

const TOMBSTONE_TABLE = 'sync_tombstones';
const TOMBSTONE_MISSING_RETRY_MS = 10 * 60 * 1000;
const TOMBSTONE_MISSING_UNTIL_KEY = 'hader:sync_tombstones:missing_until';

type PullTableTelemetry = {
    table: string;
    rows: number;
    pages: number;
    timestampColumn: string;
    maxTimestamp: string | null;
};

type PullTelemetry = {
    tables: PullTableTelemetry[];
    staleTables: string[];
};

type AttendanceCloudPayload = {
    student_id: string;
    date: string;
    timestamp: string;
    status: 'present' | 'late' | 'absent';
    minutes_late: number;
    recorded_by?: string | null;
    recorded_by_label?: string | null;
    device_id?: string | null;
    created_at?: string;
};

// ==========================================
// 1. Sync Service Class
// ==========================================

export class SyncService {
    private config: SyncConfig;

    private readonly ATTENDANCE_CLOUD_KEYS = new Set([
        'student_id',
        'date',
        'timestamp',
        'status',
        'minutes_late',
        'recorded_by',
        'recorded_by_label',
        'device_id',
        'created_at'
    ]);

    private readonly VALID_ATTENDANCE_STATUSES = new Set(['present', 'late', 'absent']);

    /** PostgREST duplicate / unique violation — may surface as 409 or code 23505. */
    private isPgDuplicateConflict(error: any): boolean {
        if (!error) return false;
        const code = String(error.code ?? '');
        const status = Number((error as any).status ?? (error as any).statusCode ?? (error as any).cause?.status ?? 0);
        const msg = `${error.message ?? ''}${error.details ?? ''}${error.hint ?? ''}`.toLowerCase();
        return (
            code === '23505' ||
            status === 409 ||
            msg.includes('duplicate key') ||
            msg.includes('unique constraint') ||
            msg.includes('already exists')
        );
    }
    private syncInterval: ReturnType<typeof setInterval> | null = null;
    private isSyncing: boolean = false;
    private listeners: Set<SyncEventListener> = new Set();
    private networkState: NetworkState;
    private currentState: SyncState;
    private unsupportedCloudColumns: Map<string, Set<string>> = new Map();
    // Track recently deleted records to prevent re-insertion during sync-down
    // Format: Map<`${table}:${id}`, timestamp>
    private recentlyDeletedRecords: Map<string, number> = new Map();
    private readonly DELETED_RECORD_TTL = 30000; // 30 seconds
    private tombstoneCloudUnavailableUntil = 0;
    private tombstoneCloudWarningLogged = false;

    constructor(config: Partial<SyncConfig> = {}) {
        this.config = { ...DEFAULT_SYNC_CONFIG, ...config };

        this.networkState = {
            isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true
        };

        this.currentState = {
            status: 'idle',
            pending: 0,
            conflicts: 0,
            isOnline: this.networkState.isOnline
        };

        this.setupNetworkListeners();
    }

    // ==========================================
    // 2. Network Monitoring
    // ==========================================

    // Handler references for cleanup
    private networkHandlers: { online?: () => void; offline?: () => void; queueChange?: () => void } = {};

    private setupNetworkListeners(): void {
        if (typeof window === 'undefined') return;

        // Remove any previous listeners to prevent stacking (e.g., during hot reload)
        this.cleanupNetworkListeners();

        this.networkHandlers.online = () => {
            this.networkState.isOnline = true;
            this.networkState.lastOnline = new Date().toISOString();
            this.updateState({ isOnline: true, status: 'online' });
            this.emit({ type: 'sync:online', timestamp: new Date().toISOString() });

            // Auto sync on reconnect
            if (this.config.syncOnReconnect) {
                this.syncNow('bidirectional').catch(console.error);
            }
        };

        this.networkHandlers.offline = () => {
            this.networkState.isOnline = false;
            this.networkState.lastOffline = new Date().toISOString();
            this.updateState({ isOnline: false, status: 'offline' });
            this.emit({ type: 'sync:offline', timestamp: new Date().toISOString() });
        };

        this.networkHandlers.queueChange = () => {
            this.updatePendingCount();
        };

        window.addEventListener('online', this.networkHandlers.online);
        window.addEventListener('offline', this.networkHandlers.offline);
        window.addEventListener('hader:sync-queue-change', this.networkHandlers.queueChange);
    }

    private cleanupNetworkListeners(): void {
        if (typeof window === 'undefined') return;

        if (this.networkHandlers.online) {
            window.removeEventListener('online', this.networkHandlers.online);
        }
        if (this.networkHandlers.offline) {
            window.removeEventListener('offline', this.networkHandlers.offline);
        }
        if (this.networkHandlers.queueChange) {
            window.removeEventListener('hader:sync-queue-change', this.networkHandlers.queueChange);
        }
    }


    // ==========================================
    // 3. Event System
    // ==========================================

    on(listener: SyncEventListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(event: SyncEvent): void {
        this.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error('[SyncService] Event listener error:', error);
            }
        });
    }

    // ==========================================
    // 4. State Management
    // ==========================================

    getState(): SyncState {
        return { ...this.currentState };
    }

    private updateState(partial: Partial<SyncState>): void {
        this.currentState = { ...this.currentState, ...partial };
        this.emit({
            type: 'sync:progress',
            timestamp: new Date().toISOString(),
            data: this.currentState
        });
    }

    private async updatePendingCount(): Promise<void> {
        const pending = await getPendingSyncCount();
        const conflicts = (await conflictResolver.getPendingConflicts()).length;
        this.updateState({ pending, conflicts });
    }

    // ==========================================
    // 5. Auto Sync Control
    // ==========================================

    startAutoSync(intervalMs?: number): void {
        if (this.syncInterval) {
            this.stopAutoSync();
        }

        const interval = intervalMs || this.config.autoSyncInterval;

        // Immediate first sync on startup — critical for cross-device consistency
        if (this.networkState.isOnline && !this.isSyncing) {
            this.syncNow('bidirectional').catch(console.error);
        }

        this.syncInterval = setInterval(() => {
            // Skip periodic sync while the tab is hidden — it wastes network/CPU
            // on background tabs. HybridProvider re-triggers a sync on
            // `visibilitychange` the moment the tab becomes visible again, so
            // freshness is preserved without polling in the background.
            const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
            if (!isHidden && this.networkState.isOnline && !this.isSyncing) {
                this.syncNow('bidirectional').catch(console.error);
            }
        }, interval);

        // Run Local DB Cleanup once on initialization
        this.cleanupLocalDatabase().catch(console.error);

        logger.debug('Sync', `Auto sync started (interval: ${interval}ms, immediate: true)`);
    }

    stopAutoSync(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            logger.debug('Sync', 'Auto sync stopped');
        }
    }

    // ==========================================
    // 5.5 Maintenance
    // ==========================================

    public async cleanupLocalDatabase(): Promise<void> {
        const retentionDays = 45;
        const cutoffDate = getSyncedDate();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffStr = cutoffDate.toISOString();

        let removedAtt = 0;
        let removedEx = 0;
        try {
            removedAtt = await localDb.attendance_logs.where('_updated_at').below(cutoffStr).delete();
        } catch (e) {
            logger.warn('Sync', `Local attendance retention cleanup skipped: ${String(e)}`);
        }
        try {
            removedEx = await localDb.exits.where('_updated_at').below(cutoffStr).delete();
        } catch (e) {
            logger.warn('Sync', `Local exits retention cleanup skipped: ${String(e)}`);
        }
        logger.debug(
            'Sync',
            `Cleaned up local DB. Removed ${removedAtt} attendance records and ${removedEx} exits with _updated_at before cutoff (${retentionDays}d).`
        );
    }

    // ==========================================
    // 6. Generic Push
    // ==========================================

    async pushGeneric<T>(payload: T, table: string): Promise<void> {
        try {
            await queueChange(table, 'INSERT', payload);
            if (this.networkState.isOnline) {
                // Trigger background sync but don't wait for it
                this.syncNow('up').catch(err => {
                    console.error('[SyncService] Background sync failed after push:', err);
                });
            }
        } catch (error) {
            console.error('[SyncService] Failed to queue generic push:', error);
            throw error;
        }
    }

    // ==========================================
    // 7. Main Sync Methods
    // ==========================================

    async syncNow(direction: SyncDirection = 'bidirectional'): Promise<SyncResult> {
        if (this.isSyncing) {
            logger.debug('Sync', 'Sync already in progress, skipping');
            return this.createEmptyResult(direction, 'Sync already in progress');
        }

        if (!this.networkState.isOnline) {
            logger.debug('Sync', 'Offline, cannot sync');
            return this.createEmptyResult(direction, 'Offline');
        }

        if (!supabaseStatus.isConfigured) {
            logger.debug('Sync', 'Supabase not configured, skipping cloud sync');
            return this.createEmptyResult(direction, 'Supabase not configured');
        }

        this.isSyncing = true;
        const startTime = Date.now();
        const previousLastSync = await getLastSyncTime();
        const queueSizeAtStart = await getPendingSyncCount();
        const result: SyncResult = {
            success: true,
            direction,
            startedAt: new Date().toISOString(),
            completedAt: '',
            duration: 0,
            pushed: { total: 0, success: 0, failed: 0, byTable: {} },
            pulled: { total: 0, success: 0, failed: 0, byTable: {} },
            conflicts: { detected: 0, resolved: 0, pending: 0 },
            errors: []
        };

        this.updateState({ status: 'syncing' });
        this.emit({ type: 'sync:started', timestamp: new Date().toISOString(), data: { direction } });

        try {
            let pullTelemetry: PullTelemetry = { tables: [], staleTables: [] };
            let pullAttempted = false;
            let pullErrorCountBefore = 0;
            let pullFailedCountBefore = 0;
            // Push local changes first
            if (direction === 'up' || direction === 'bidirectional') {
                await this.pushToCloud(result);
                await this.pushTombstonesToCloud(result);
            }

            // Then pull remote changes
            if (direction === 'down' || direction === 'bidirectional') {
                pullAttempted = true;
                pullErrorCountBefore = result.errors.length;
                pullFailedCountBefore = result.pulled.failed;
                const tombstonePullSafe = await this.pullTombstonesFromCloud(result, previousLastSync);
                pullTelemetry = await this.pullFromCloud(result, previousLastSync);
                if (!tombstonePullSafe) {
                    result.errors.push({
                        table: TOMBSTONE_TABLE,
                        operation: 'UPSERT',
                        message: 'Remote delete tombstones were not pulled; preserving sync watermark for retry.',
                        timestamp: new Date().toISOString()
                    });
                }
            }

            // Only advance the pull watermark after a clean pull. Advancing it on
            // push-only syncs or partial pulls can permanently skip remote changes.
            const nextLastSync = getSyncedISOString();
            const pullHadErrors =
                pullAttempted &&
                (result.errors.length > pullErrorCountBefore || result.pulled.failed > pullFailedCountBefore);
            const shouldAdvancePullWatermark = pullAttempted && !pullHadErrors;
            const effectiveLastSync = shouldAdvancePullWatermark ? nextLastSync : previousLastSync;

            if (shouldAdvancePullWatermark) {
                await setLastSyncTime(nextLastSync);
            } else if (pullHadErrors) {
                logger.warn('Sync', 'Pull completed with errors; preserving previous sync watermark so missed cloud rows are retried.', {
                    previousLastSync,
                    attemptedNextLastSync: nextLastSync,
                    errors: result.errors.length - pullErrorCountBefore,
                    failedRows: result.pulled.failed - pullFailedCountBefore
                });
            }

            result.completedAt = new Date().toISOString();
            result.duration = Date.now() - startTime;
            const queueSizeAtEnd = await getPendingSyncCount();

            // Update conflict count
            result.conflicts.pending = (await conflictResolver.getPendingConflicts()).length;

            const watermarkAdvanceMs = previousLastSync && effectiveLastSync
                ? new Date(effectiveLastSync).getTime() - new Date(previousLastSync).getTime()
                : null;
            await setSyncMeta('last_sync_watermark', {
                previous: previousLastSync,
                next: effectiveLastSync,
                attempted_next: nextLastSync,
                advanced: shouldAdvancePullWatermark,
                blocked_reason: pullHadErrors ? 'pull_errors' : (pullAttempted ? null : 'push_only_sync'),
                advanced_ms: Number.isFinite(watermarkAdvanceMs as number) ? watermarkAdvanceMs : null
            });

            await setSyncMeta('last_sync_summary', {
                at: result.completedAt,
                direction,
                duration_ms: result.duration,
                queue_start: queueSizeAtStart,
                queue_end: queueSizeAtEnd,
                pushed: result.pushed,
                pulled: result.pulled,
                conflicts: result.conflicts,
                errors_count: result.errors.length,
                watermark_advanced: shouldAdvancePullWatermark
            });

            if (pullTelemetry.tables.length > 0) {
                await setSyncMeta('last_pull_telemetry', {
                    at: result.completedAt,
                    tables: pullTelemetry.tables,
                    stale_tables: pullTelemetry.staleTables
                });
            }

            if (shouldAdvancePullWatermark && watermarkAdvanceMs !== null && watermarkAdvanceMs < 0) {
                logger.warn('Sync', 'Sync watermark moved backward. Check device/server clock alignment.', {
                    previousLastSync,
                    nextLastSync: effectiveLastSync,
                    watermarkAdvanceMs
                });
            }

            this.updateState({
                status: result.errors.length > 0 ? 'error' : 'online',
                lastSync: result.completedAt,
                lastError: result.errors.length > 0 ? result.errors[0].message : undefined
            });

            this.emit({ type: 'sync:completed', timestamp: new Date().toISOString(), data: result });

            logger.debug('Sync', `Completed in ${result.duration}ms`, {
                pushed: result.pushed.success,
                pulled: result.pulled.success,
                conflicts: result.conflicts.pending
            });

        } catch (error: any) {
            result.success = false;
            result.errors.push({
                table: 'unknown',
                operation: 'UPSERT',
                message: error.message || 'Unknown sync error',
                timestamp: new Date().toISOString()
            });

            this.updateState({ status: 'error', lastError: error.message });
            this.emit({ type: 'sync:failed', timestamp: new Date().toISOString(), data: { error } });

            console.error('[SyncService] Sync failed:', error);
        } finally {
            this.isSyncing = false;
            await this.updatePendingCount();
        }

        return result;
    }

    /** Merge multiple settings queue payloads (last wins; deep-merge kiosk_settings JSONB). */
    private mergeQueuedSettingsPayloads(parts: any[]): Record<string, unknown> {
        return parts.reduce((acc: Record<string, unknown>, p) => {
            if (!p || typeof p !== 'object' || Array.isArray(p)) return acc;
            const nextKs =
                typeof p.kiosk_settings === 'object' && p.kiosk_settings !== null
                    ? (p.kiosk_settings as Record<string, unknown>)
                    : {};
            const prevKs =
                typeof acc.kiosk_settings === 'object' && acc.kiosk_settings !== null
                    ? (acc.kiosk_settings as Record<string, unknown>)
                    : {};
            return {
                ...acc,
                ...p,
                kiosk_settings: { ...prevKs, ...nextKs },
            };
        }, {} as Record<string, unknown>);
    }

    // ==========================================
    // 7. Push to Cloud
    // ==========================================

    private async pushToCloud(result: SyncResult): Promise<void> {
        await this.requeueUnsyncedAttendanceWithoutQueue();

        const entries = await getPendingSyncEntries();

        if (entries.length === 0) {
            logger.debug('Sync', 'No pending entries to push');
            return;
        }

        result.pushed.total = entries.length;
        const successIds: number[] = [];

        // Group entries by table and operation for true batch processing
        const byTableAndOp = new Map<string, SyncQueueEntry[]>();
        for (const entry of entries) {
            // Treat isolated UPSERTs as separate from INSERTs
            const key = `${entry.table}:${entry.operation}`;
            const list = byTableAndOp.get(key) || [];
            list.push(entry);
            byTableAndOp.set(key, list);
        }

        const handlePushError = async (error: any, entry: SyncQueueEntry, successIds: number[], result: SyncResult) => {
            const errMsg = (error.message || '').toLowerCase();
            const isConflict = error.code === '23505' || error.code === '409' || errMsg.includes('duplicate') || errMsg.includes('conflict');
            const currentRetryCount = entry.retry_count || 0;
            const isMissingTable =
                error.code === 'PGRST205' ||
                error.code === '42P01' ||
                /could not find the table/i.test(errMsg) ||
                /relation .+ does not exist/i.test(errMsg);

            const addSyncError = (message = error.message) => {
                result.errors.push({
                    table: entry.table,
                    operation: entry.operation,
                    recordId: entry.payload?.id,
                    message,
                    code: error.code,
                    timestamp: new Date().toISOString()
                });
            };

            const blockEntryForReview = async (message: string, failureCategory: string) => {
                result.pushed.failed++;
                addSyncError(message);
                if (entry.id) {
                    await markSyncEntryBlocked(entry.id, message, failureCategory);
                }
            };

            if (isConflict) {
                console.warn(`[SyncService] 409 Conflict on ${entry.table} — record exists, marking as synced`);
                successIds.push(entry.id!);
                result.pushed.success++;
                result.pushed.byTable[entry.table] = (result.pushed.byTable[entry.table] || 0) + 1;
                if (entry.payload?.id) await localDb.table(entry.table).update(entry.payload.id, { _synced: true });
                return;
            }

            const isDependencyWait = errMsg.includes('still pending cloud sync');
            if (isDependencyWait) {
                console.warn(`[SyncService] ${entry.table} waiting on dependencies. Resetting retry count.`);
                if (entry.id) {
                    await localDb.sync_queue.update(entry.id, { retry_count: 0 });
                }
                result.pushed.failed++;
                return;
            }

            if (entry.table === 'guardian_excuses' && isMissingTable) {
                result.pushed.failed++;
                addSyncError('guardian_excuses table is not available yet. Apply the latest Supabase migration; the excuse remains queued locally.');
                if (entry.id) await markSyncEntryFailed(entry.id, error.message);
                return;
            }

            const isForeignKeyViolation = error.code === '23503' || errMsg.includes('foreign key constraint');
            if (isForeignKeyViolation) {
                console.warn(`[SyncService] FK violation on ${entry.table}:${entry.payload?.id} — blocking entry for review.`);
                await blockEntryForReview(error.message, 'foreign_key_violation');
                return;
            }

            if (currentRetryCount >= this.config.maxRetries) {
                const message = `Blocked after ${currentRetryCount} retries: ${error.message}`;
                console.error(`[SyncService] MAX RETRIES (${this.config.maxRetries}) reached for ${entry.table} operation ${entry.operation}. Blocking entry for review. Error:`, error.message);
                await blockEntryForReview(message, 'max_retries');
                return;
            }

            const isBadRequest = error.code === '400' || error.code === '23502' || error.code === '23514' || error.code === '22P02' || error.code === '22007' || error.code === '42703';
            if (isBadRequest || errMsg.includes('400') || errMsg.includes('bad request')) {
                console.warn(`[SyncService] Bad Request on ${entry.table}:${entry.payload?.id} — blocking entry for review:`, error.message);
                await blockEntryForReview(error.message, 'bad_request');
                return;
            }

            result.pushed.failed++;
            addSyncError(error.message);

            if (entry.id) {
                await markSyncEntryFailed(entry.id, error.message);
            }
        };

        for (const [key, batchEntries] of byTableAndOp) {
            const [table, operation] = key.split(':');
            
            this.updateState({
                syncProgress: {
                    current: result.pushed.success,
                    total: result.pushed.total,
                    table
                }
            });

            // Fast Path: Batch operations for INSERT and UPSERT
            if ((operation === 'INSERT' || operation === 'UPSERT') && table !== 'users') {
                try {
                    if (table === 'settings' && operation === 'UPSERT') {
                        const parts = batchEntries.map((e) => this.cleanPayloadForCloud(e.payload, table));
                        const rid = await resolveSettingsUpsertId();
                        const merged = this.mergeQueuedSettingsPayloads(
                            parts.map((p) =>
                                p && typeof p === 'object' && !Array.isArray(p) ? { ...p, id: rid } : p
                            )
                        );
                        const { error: settingsErr } = await applySettingsRowToCloud(merged);
                        if (settingsErr) throw settingsErr;

                        for (const entry of batchEntries) {
                            successIds.push(entry.id!);
                            result.pushed.success++;
                            result.pushed.byTable[table] = (result.pushed.byTable[table] || 0) + 1;
                            if (entry.payload?.id) {
                                await localDb.table(table).update(entry.payload.id, { _synced: true });
                            }
                        }
                        continue;
                    }

                    let payloads = batchEntries.map(e => this.cleanPayloadForCloud(e.payload, table));

                    if (operation === 'INSERT') {
                        if (table === 'attendance_logs') {
                            await this.upsertAttendanceLogs(payloads);
                        } else {
                            const insertConflict = syncCatalog.for(table).upsertConflict;
                            if (insertConflict) {
                                const { error } = await supabase.from(table).upsert(payloads, { onConflict: insertConflict, ignoreDuplicates: true });
                                if (error) throw error;
                            } else {
                                const { error } = await supabase.from(table).insert(payloads);
                                if (error && error.code !== '23505') throw error;
                            }
                        }
                    } else {
                        if (table === 'attendance_logs') {
                            await this.upsertAttendanceLogs(payloads);
                        } else {
                            const conflictColumn = syncCatalog.for(table).upsertConflict;
                            let query = conflictColumn 
                                ? supabase.from(table).upsert(payloads, { onConflict: conflictColumn, ignoreDuplicates: false })
                                : supabase.from(table).upsert(payloads);
                            const { error } = await query;
                            if (error && error.code !== '23505') throw error;
                        }
                    }

                    // Bulk Success
                    for (const entry of batchEntries) {
                        successIds.push(entry.id!);
                        result.pushed.success++;
                        result.pushed.byTable[table] = (result.pushed.byTable[table] || 0) + 1;
                        if (entry.payload?.id) {
                            await localDb.table(table).update(entry.payload.id, { _synced: true });
                        }
                    }
                } catch (batchError) {
                    console.warn(`[SyncService] Bulk ${operation} failed for ${table}, gracefully falling back to individual processing...`);
                    // Fallback Path: Process individually so problematic entries don't block valid ones
                    for (const entry of batchEntries) {
                        try {
                            await this.processSyncEntry(entry);
                            successIds.push(entry.id!);
                            result.pushed.success++;
                            result.pushed.byTable[table] = (result.pushed.byTable[table] || 0) + 1;
                        } catch (err: any) {
                            await handlePushError(err, entry, successIds, result);
                        }
                    }
                }
            } else {
                // Strict Slow Path: UPDATE, DELETE, and sensitive tables like 'users'
                for (const entry of batchEntries) {
                    try {
                        await this.processSyncEntry(entry);
                        successIds.push(entry.id!);
                        result.pushed.success++;
                        result.pushed.byTable[table] = (result.pushed.byTable[table] || 0) + 1;
                    } catch (err: any) {
                        await handlePushError(err, entry, successIds, result);
                    }
                }
            }
        }

        // Remove successful entries from queue
        if (successIds.length > 0) {
            await removeSyncedEntries(successIds);
        }
    }

    private isMissingTombstoneTable(error: any): boolean {
        const msg = String(error?.message ?? error ?? '');
        const code = error?.code;
        const status = Number(error?.status ?? error?.statusCode ?? error?.cause?.status ?? 0);
        return (
            code === 'PGRST205' ||
            code === '42P01' ||
            status === 404 ||
            /could not find the table/i.test(msg) ||
            /relation .+ does not exist/i.test(msg) ||
            /\b404\b/.test(msg)
        );
    }

    private isTombstoneCloudUnavailable(): boolean {
        if (typeof localStorage !== 'undefined') {
            const persistedUntil = Number(localStorage.getItem(TOMBSTONE_MISSING_UNTIL_KEY) || 0);
            if (persistedUntil > Date.now()) {
                this.tombstoneCloudUnavailableUntil = Math.max(this.tombstoneCloudUnavailableUntil, persistedUntil);
            } else if (persistedUntil) {
                localStorage.removeItem(TOMBSTONE_MISSING_UNTIL_KEY);
            }
        }

        if (this.tombstoneCloudUnavailableUntil <= Date.now()) {
            this.tombstoneCloudUnavailableUntil = 0;
            this.tombstoneCloudWarningLogged = false;
            return false;
        }
        return true;
    }

    private markTombstoneCloudUnavailable(): void {
        this.tombstoneCloudUnavailableUntil = Date.now() + TOMBSTONE_MISSING_RETRY_MS;
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(TOMBSTONE_MISSING_UNTIL_KEY, String(this.tombstoneCloudUnavailableUntil));
            }
        } catch {
            // Ignore storage failures; in-memory backoff still prevents immediate retries.
        }
        if (this.tombstoneCloudWarningLogged) return;
        this.tombstoneCloudWarningLogged = true;
        logger.warn(
            'Sync',
            'sync_tombstones table is not available on server. Tombstone sync is paused for 10 minutes; apply supabase/migrations/20260514100000_add_sync_tombstones.sql so remote deletes reach offline devices.'
        );
    }

    private cleanTombstoneForCloud(row: SyncTombstoneEntry) {
        return {
            id: row.id,
            table_name: row.table_name,
            record_id: row.record_id,
            deleted_at: row.deleted_at,
            created_at: row.created_at || row.deleted_at
        };
    }

    private async pushTombstonesToCloud(result: SyncResult): Promise<void> {
        if (this.isTombstoneCloudUnavailable()) return;

        const rows = await getUnsyncedTombstones();
        if (rows.length === 0) return;

        try {
            const { error } = await supabase
                .from(TOMBSTONE_TABLE)
                .upsert(rows.map(row => this.cleanTombstoneForCloud(row)), {
                    onConflict: 'id',
                    ignoreDuplicates: false
                });
            if (error) throw error;

            await markTombstonesSynced(rows.map(row => row.id));
            result.pushed.total += rows.length;
            result.pushed.success += rows.length;
            result.pushed.byTable[TOMBSTONE_TABLE] = (result.pushed.byTable[TOMBSTONE_TABLE] || 0) + rows.length;
        } catch (error: any) {
            if (this.isMissingTombstoneTable(error)) {
                this.markTombstoneCloudUnavailable();
                return;
            }

            result.pushed.total += rows.length;
            result.pushed.failed += rows.length;
            result.errors.push({
                table: TOMBSTONE_TABLE,
                operation: 'UPSERT',
                message: error?.message || 'Failed to push sync tombstones',
                code: error?.code,
                timestamp: new Date().toISOString()
            });
        }
    }

    private async pullTombstonesFromCloud(result: SyncResult, lastSync: string | null): Promise<boolean> {
        if (this.isTombstoneCloudUnavailable()) return false;

        try {
            let pages = 0;
            const buildPullQuery = () => {
                let q: any = supabase.from(TOMBSTONE_TABLE).select('*');
                if (lastSync) {
                    q = q.gt('deleted_at', lastSync);
                }
                return q;
            };

            const rows = await fetchAllFromSupabase(
                TOMBSTONE_TABLE,
                buildPullQuery,
                { primary: 'deleted_at', ascending: true },
                () => { pages += 1; }
            );

            if (!rows || rows.length === 0) return true;

            for (const row of rows) {
                await this.applyCloudTombstone(row as SyncTombstoneEntry);
            }

            result.pulled.total += rows.length;
            result.pulled.success += rows.length;
            result.pulled.byTable[TOMBSTONE_TABLE] = (result.pulled.byTable[TOMBSTONE_TABLE] || 0) + rows.length;
            logger.debug('Sync', `Applied ${rows.length} tombstones from cloud across ${pages} page(s)`);
            return true;
        } catch (error: any) {
            if (this.isMissingTombstoneTable(error)) {
                this.markTombstoneCloudUnavailable();
                return false;
            }

            result.errors.push({
                table: TOMBSTONE_TABLE,
                operation: 'UPSERT',
                message: error?.message || 'Failed to pull sync tombstones',
                code: error?.code,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    private async applyCloudTombstone(row: SyncTombstoneEntry): Promise<void> {
        const tableName = String(row?.table_name || '').trim();
        const recordId = String(row?.record_id || '').trim();
        const deletedAt = row?.deleted_at || new Date().toISOString();
        if (!tableName || !recordId || !syncCatalog.has(tableName)) return;

        try {
            await removePendingSyncEntriesForRecord(tableName, recordId);
            await localDb.table(tableName).delete(recordId);
            await recordSyncTombstone(tableName, recordId, deletedAt, true);
            this.recentlyDeletedRecords.set(`${tableName}:${recordId}`, Date.now());
        } catch (error) {
            logger.warn('Sync', `Failed to apply tombstone for ${tableName}:${recordId}`, error);
        }
    }

    // ==========================================
    // 8. Process Single Sync Entry
    // ==========================================

    private async processSyncEntry(entry: SyncQueueEntry): Promise<void> {
        const { table, operation, payload } = entry;

        let cleanPayload: any;
        const runCloudWrite = async () => {
            // Clean payload - remove local sync fields and columns rejected by
            // the active Supabase schema cache.
            cleanPayload = this.cleanPayloadForCloud(payload, table);
            if (table === 'settings' && cleanPayload && typeof cleanPayload === 'object' && !Array.isArray(cleanPayload)) {
                cleanPayload = { ...cleanPayload, id: await resolveSettingsUpsertId() };
            }

            switch (operation) {
                case 'INSERT':
                    const insertData = Array.isArray(cleanPayload) ? cleanPayload : [cleanPayload];
                    if (table === 'attendance_logs') {
                        await this.upsertAttendanceLogs(insertData);
                        break;
                    }
                    const insertConflict = syncCatalog.for(table).upsertConflict;

                    if (insertConflict) {
                        // For tables with known unique constraints, use UPSERT with ignoreDuplicates
                        // This silently skips records that already exist (e.g., synced from another device)
                        const { error: upsertInsertError } = await supabase
                            .from(table)
                            .upsert(insertData, { onConflict: insertConflict, ignoreDuplicates: true });
                        if (upsertInsertError) throw upsertInsertError;
                    } else {
                        // For tables without known constraints, use regular INSERT
                        const { error: insertError } = await supabase
                            .from(table)
                            .insert(insertData);
                        // Treat duplicate key / PostgREST conflict as success — replayed queue or cross-tab
                        if (insertError && !this.isPgDuplicateConflict(insertError)) throw insertError;
                        if (insertError && this.isPgDuplicateConflict(insertError)) {
                            logger.debug('Sync', `INSERT duplicate/conflict on ${table}, treating as success`);
                        }
                    }
                    break;

                case 'UPDATE':
                    if (table === 'attendance_logs') {
                        await this.upsertAttendanceLogs(cleanPayload);
                        break;
                    }
                    if (!cleanPayload.id) throw new Error('Update requires id');
                    const { error: updateError } = await supabase
                        .from(table)
                        .update(cleanPayload)
                        .eq('id', cleanPayload.id);
                    if (updateError) throw updateError;
                    break;

                case 'DELETE':
                    const deleteId = typeof payload === 'string' ? payload : payload?.id;
                    if (!deleteId) throw new Error('Delete requires id');
                    const { error: deleteError } = await supabase
                        .from(table)
                        .delete()
                        .eq('id', deleteId);
                    if (deleteError) throw deleteError;
                    // Track this deletion to prevent re-insertion during sync-down
                    this.recentlyDeletedRecords.set(`${table}:${deleteId}`, Date.now());
                    await recordSyncTombstone(table, deleteId, new Date().toISOString(), false);
                    logger.debug('Sync', `DELETE successful for ${table}:${deleteId}`);
                    break;

                case 'UPSERT':
                    // Special handling for users table - use UPDATE instead of UPSERT
                    // because password field is required (NOT NULL) and we don't send it
                    if (table === 'users') {
                        const userData = Array.isArray(cleanPayload) ? cleanPayload[0] : cleanPayload;
                        if (userData?.id) {
                            const { error: userUpdateError } = await supabase
                                .from('users')
                                .update(userData)
                                .eq('id', userData.id);
                            if (userUpdateError) {
                                throw userUpdateError;
                            }
                        }
                        break;
                    }

                    if (table === 'settings') {
                        const { error: settingsApplyErr } = await applySettingsRowToCloud(
                            cleanPayload as Record<string, unknown>
                        );
                        if (settingsApplyErr) throw settingsApplyErr;
                        break;
                    }

                    if (table === 'attendance_logs') {
                        await this.upsertAttendanceLogs(cleanPayload);
                        break;
                    }

                    // Use the correct onConflict column for tables with unique constraints
                    const conflictColumn = syncCatalog.for(table).upsertConflict;
                    const upsertData = Array.isArray(cleanPayload) ? cleanPayload : [cleanPayload];

                    const { error: upsertError } = await (conflictColumn
                        ? supabase.from(table).upsert(upsertData, { onConflict: conflictColumn, ignoreDuplicates: false })
                        : supabase.from(table).upsert(upsertData));
                    // Treat duplicate key (23505) as success for UPSERT too
                    if (upsertError && upsertError.code !== '23505') throw upsertError;
                    if (upsertError?.code === '23505') {
                        logger.debug('Sync', `UPSERT duplicate on ${table}, treating as success`);
                    }
                    break;
            }
        };

        try {
            await runCloudWrite();
        } catch (error: any) {
            if (this.rememberMissingCloudColumn(error, table)) {
                await runCloudWrite();
            } else {
                throw error;
            }
        }

        // Mark local record as synced
        if (payload?.id) {
            await localDb.table(table).update(payload.id, { _synced: true });
        }
    }

    // ==========================================
    // 9. Pull from Cloud
    // ==========================================

    private async pullFromCloud(result: SyncResult, lastSync: string | null): Promise<PullTelemetry> {
        // Pre-load pending sync entries ONCE to avoid N+1 queries inside mergeCloudRecord
        const pendingEntries = await getPendingSyncEntries();
        const telemetry: PullTelemetry = { tables: [], staleTables: [] };

        for (const table of this.config.syncTables) {
            try {
                this.updateState({
                    syncProgress: {
                        current: result.pulled.success,
                        total: this.config.syncTables.length,
                        table
                    }
                });

                // Query for records updated since last sync
                // Use the correct timestamp column for each table
                const timestampColumn = syncCatalog.for(table).timestampColumn;
                let pages = 0;

                // Fresh builder each page — see dbFetchAll `fetchAllFromSupabase` (mutable order stack bug).
                const buildPullQuery = () => {
                    let q: any = supabase.from(table).select('*');
                    if (lastSync) {
                        q = q.gt(timestampColumn, lastSync);
                    }
                    return q;
                };

                const data = await fetchAllFromSupabase(
                    table,
                    buildPullQuery,
                    { primary: timestampColumn, ascending: true },
                    () => { pages += 1; }
                );

                const maxTimestamp = this.getMaxTimestampFromRows(data, timestampColumn);
                telemetry.tables.push({
                    table,
                    rows: data.length,
                    pages,
                    timestampColumn,
                    maxTimestamp
                });

                if (lastSync && maxTimestamp) {
                    const lastSyncMs = new Date(lastSync).getTime();
                    const maxTimestampMs = new Date(maxTimestamp).getTime();
                    if (!Number.isNaN(lastSyncMs) && !Number.isNaN(maxTimestampMs) && maxTimestampMs <= lastSyncMs) {
                        telemetry.staleTables.push(table);
                        logger.warn('Sync', `Pull returned stale window for ${table}`, {
                            lastSync,
                            maxTimestamp,
                            timestampColumn
                        });
                    }
                }

                if (!data || data.length === 0) {
                    continue;
                }

                result.pulled.total += data.length;

                // Process each record
                for (const cloudRecord of data) {
                    try {
                        await this.mergeCloudRecord(table, cloudRecord, result, pendingEntries);
                        result.pulled.success++;
                        result.pulled.byTable[table] = (result.pulled.byTable[table] || 0) + 1;
                    } catch (error: any) {
                        result.pulled.failed++;
                        result.errors.push({
                            table,
                            operation: 'UPSERT',
                            recordId: cloudRecord.id,
                            message: error.message,
                            timestamp: new Date().toISOString()
                        });
                    }
                }

            } catch (error: any) {
                const msg = String(error?.message ?? error ?? '');
                const code = error?.code;
                // PostgREST: missing table / not in schema cache — skip without spamming errors
                const missingTable =
                    code === 'PGRST205' ||
                    code === '42P01' ||
                    /could not find the table/i.test(msg) ||
                    /relation .+ does not exist/i.test(msg) ||
                    /\b404\b/.test(msg);
                if (missingTable) {
                    logger.warn('Sync', `Skipping pull: table not available on server (${table})`);
                    continue;
                }
                console.error(`[SyncService] Failed to pull from ${table}:`, error);
                result.errors.push({
                    table,
                    operation: 'UPSERT',
                    message: `Failed to pull ${table}: ${msg}`,
                    timestamp: new Date().toISOString()
                });
            }
        }
        return telemetry;
    }

    // ==========================================
    // 10. Merge Cloud Record with Local
    // ==========================================

    private async mergeCloudRecord(
        table: string,
        cloudRecord: any,
        result: SyncResult,
        pendingEntries?: any[]
    ): Promise<void> {
        if (table === 'users' && cloudRecord) {
            cloudRecord = {
                ...cloudRecord,
                assigned_classes: normalizeAssignedClasses(cloudRecord.assigned_classes),
                assigned_sections: normalizeAssignedSections(cloudRecord.assigned_sections)
            };
        }
        if (table === 'dismissal_records' && cloudRecord) {
            cloudRecord = {
                ...cloudRecord,
                exit_time: cloudRecord.exit_time ?? cloudRecord.dismissal_time
            };
        }
        const localTable = localDb.table(table);
        let localRecord = await localTable.get(cloudRecord.id);
        let localIdToReplace: string | null = null;

        if (!localRecord && table === 'attendance_logs' && cloudRecord?.student_id && cloudRecord?.date) {
            const sameAttendanceState = await localDb.attendance_logs
                .where({ student_id: String(cloudRecord.student_id), date: cloudRecord.date })
                .first();

            if (sameAttendanceState) {
                localRecord = sameAttendanceState;
                if (sameAttendanceState.id !== cloudRecord.id) {
                    localIdToReplace = sameAttendanceState.id;
                }
            }
        }

        // No local record - check if there's a pending DELETE before inserting
        if (!localRecord) {
            const recordKey = `${table}:${cloudRecord.id}`;

            // Check 1: Was this record recently deleted? (within TTL)
            const deletedAt = this.recentlyDeletedRecords.get(recordKey);
            if (deletedAt && (Date.now() - deletedAt) < this.DELETED_RECORD_TTL) {
                logger.debug('Sync', `Skipping cloud record ${cloudRecord.id} - recently deleted`);
                return; // Don't re-insert a recently deleted record
            }

            // Check 2: Is there a pending DELETE operation in the queue?
            // Use pre-loaded entries if available, otherwise fetch (fallback)
            const entries = pendingEntries ?? await getPendingSyncEntries();
            const hasPendingDelete = entries.some(entry =>
                entry.table === table &&
                entry.operation === 'DELETE' &&
                (entry.payload === cloudRecord.id || entry.payload?.id === cloudRecord.id)
            );

            if (hasPendingDelete) {
                logger.debug('Sync', `Skipping cloud record ${cloudRecord.id} - pending DELETE in queue`);
                return; // Don't re-insert a record that's pending deletion
            }

            // Clean up old entries from recentlyDeletedRecords periodically
            this.cleanupDeletedRecordsCache();

            const cloudTimestamp = this.resolveCloudRecordTimestamp(cloudRecord, table);
            await localTable.put({
                ...cloudRecord,
                _synced: true,
                _updated_at: cloudTimestamp
            });
            return;
        }

        // Check for conflict
        if (conflictResolver.hasConflict(localRecord, cloudRecord)) {
            result.conflicts.detected++;

            const { resolution, result: resolvedData } = await conflictResolver.resolve(
                table,
                cloudRecord.id,
                localRecord,
                cloudRecord
            );

            if (resolution !== 'manual') {
                if (localIdToReplace && localIdToReplace !== resolvedData.id) {
                    await localTable.delete(localIdToReplace);
                }
                await localTable.put(resolvedData);
                result.conflicts.resolved++;
            }

            this.emit({
                type: 'sync:conflict',
                timestamp: new Date().toISOString(),
                data: { table, recordId: cloudRecord.id, resolution }
            });

            return;
        }

        // No conflict - update with cloud data
        const cloudTimestamp = this.resolveCloudRecordTimestamp(cloudRecord, table);
        if (localIdToReplace && localIdToReplace !== cloudRecord.id) {
            await localTable.delete(localIdToReplace);
        }
        await localTable.put({
            ...cloudRecord,
            _synced: true,
            _updated_at: cloudTimestamp
        });

        // Special: If settings table was updated, notify other components to invalidate local caches
        if (table === 'settings' && typeof window !== 'undefined') {
            if (cloudRecord?.id != null) {
                rememberRemoteSettingsPk(cloudRecord.id as string | number);
            }
            window.dispatchEvent(new CustomEvent('hader:settings-synced', { detail: cloudRecord }));
        }
    }

    // ==========================================
    // 11. Helper Methods
    // ==========================================

    private rememberMissingCloudColumn(error: any, expectedTable?: string): boolean {
        const message = String(error?.message ?? error ?? '');
        const match = message.match(/Could not find the '([^']+)' column of '([^']+)' in the schema cache/i);
        if (!match) return false;

        const [, column, table] = match;
        if (!column || !table || (expectedTable && table !== expectedTable)) return false;

        const cols = this.unsupportedCloudColumns.get(table) || new Set<string>();
        const alreadyKnown = cols.has(column);
        cols.add(column);
        this.unsupportedCloudColumns.set(table, cols);

        const warning = `Supabase schema is missing ${table}.${column}; retrying sync without this column. Apply the latest database migration.`;
        if (!alreadyKnown) {
            logger.warn('Sync', warning);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('hader:schema-warning', {
                    detail: { table, column, message: warning }
                }));
            }
        }

        return true;
    }

    private stripUnsupportedCloudColumns(table: string | undefined, payload: Record<string, unknown>) {
        if (!table) return payload;
        const cols = this.unsupportedCloudColumns.get(table);
        if (!cols?.size) return payload;

        const next = { ...payload };
        for (const col of cols) {
            delete next[col];
        }
        return next;
    }

    private cleanPayloadForCloud(payload: any, table?: string): any {
        if (!payload) return payload;

        if (Array.isArray(payload)) {
            return payload.map(p => this.cleanPayloadForCloud(p, table));
        }

        const { _synced, _updated_at, _deleted, _conflict, _local_id, ...clean } = payload;

        if (table === 'attendance_logs') {
            const out: Record<string, unknown> = {};
            for (const key of this.ATTENDANCE_CLOUD_KEYS) {
                if (Object.prototype.hasOwnProperty.call(clean, key) && clean[key] !== undefined) {
                    out[key] = clean[key];
                }
            }
            return this.stripUnsupportedCloudColumns(table, out);
        }

        // Special handling for notifications table: strip columns that may not exist in older schemas
        if (table === 'notifications') {
            delete clean.isPopup;
            delete clean.is_read;
            delete clean.expires_at;
            delete clean.created_by;
        }

        if (table === 'exits') {
            const allow = new Set([
                'id', 'student_id', 'reason', 'exit_time', 'date',
                'requester_relation', 'requester_relation_other',
                'supervisor_name', 'created_by', 'notes', 'status', 'created_at'
            ]);
            const out: Record<string, unknown> = {};
            for (const key of allow) {
                if (Object.prototype.hasOwnProperty.call(clean, key) && clean[key] !== undefined) {
                    out[key] = clean[key];
                }
            }
            return this.stripUnsupportedCloudColumns(table, out);
        }

        if (table === 'guardian_excuses') {
            const allow = new Set([
                'id', 'student_id', 'student_name', 'class_name', 'section',
                'guardian_id', 'guardian_name', 'guardian_phone',
                'absence_date', 'reason',
                'attachment_url', 'attachment_path', 'attachment_name',
                'attachment_type', 'attachment_size',
                'status', 'admin_notes', 'reviewed_by', 'reviewed_by_label',
                'reviewed_at', 'created_at', 'updated_at'
            ]);
            const out: Record<string, unknown> = {};
            for (const key of allow) {
                if (Object.prototype.hasOwnProperty.call(clean, key) && clean[key] !== undefined) {
                    out[key] = clean[key];
                }
            }
            return this.stripUnsupportedCloudColumns(table, out);
        }

        if (table === 'violations') {
            delete clean.created_by_label;
        }

        if (table === 'dismissal_schedules') {
            const allow = new Set([
                'id', 'class_name', 'dismissal_time', 'days', 'label', 'created_at', 'updated_at'
            ]);
            const out: Record<string, unknown> = {};
            for (const key of allow) {
                if (Object.prototype.hasOwnProperty.call(clean, key) && clean[key] !== undefined) {
                    out[key] = clean[key];
                }
            }
            return this.stripUnsupportedCloudColumns(table, out);
        }

        if (table === 'users') {
            const assignedClasses = normalizeAssignedClasses(
                (clean as any).assigned_classes ?? (clean as any).assignedClasses
            );
            const assignedSections = normalizeAssignedSections(
                (clean as any).assigned_sections ?? (clean as any).assignedSections
            );

            if ('assigned_classes' in clean || 'assignedClasses' in clean || clean.role === 'supervisor_class') {
                (clean as any).assigned_classes = clean.role === 'supervisor_class' ? (assignedClasses ?? []) : null;
            }
            if ('assigned_sections' in clean || 'assignedSections' in clean) {
                (clean as any).assigned_sections = assignedSections ?? null;
            }
            delete (clean as any).assignedClasses;
            delete (clean as any).assignedSections;

            const allow = new Set([
                'id', 'username', 'password', 'name', 'role', 'is_active',
                'email', 'phone', 'assigned_classes', 'assigned_sections',
                'can_use_whatsapp', 'password_hash_version'
            ]);
            const out: Record<string, unknown> = {};
            for (const key of allow) {
                if (Object.prototype.hasOwnProperty.call(clean, key) && (clean as any)[key] !== undefined) {
                    out[key] = (clean as any)[key];
                }
            }
            return this.stripUnsupportedCloudColumns(table, out);
        }

        // Note: recorded_by_label is now supported in Supabase via migration
        // 20260128100000_attendance_logs_recorded_by_label.sql

        // Special cleaning for settings table - strip columns that don't exist in Supabase
        // Many projects only have JSONB + core columns; absence_time / UI-only fields must not be sent as top-level.
        if (table === 'settings') {
            const {
                assembly_time,
                grace_period,
                telemetry_retention_days,
                absence_time,
                late_message,
                early_message,
                late_messages,
                early_messages,
                work_days,
                whatsapp_triggers,
                whatsapp_autopilot,
                whatsapp_autopilot_time,
                admin_theme,
                theme,
                social_links,
                notification_templates,
                whatsapp_templates,
                security_settings,
                attendance_settings,
                ...settingsClean
            } = clean;

            const baseKs =
                typeof settingsClean.kiosk_settings === 'object' && settingsClean.kiosk_settings !== null
                    ? (settingsClean.kiosk_settings as Record<string, unknown>)
                    : {};
            const baseAtt =
                typeof attendance_settings === 'object' && attendance_settings !== null
                    ? (attendance_settings as Record<string, unknown>)
                    : typeof settingsClean.attendance_settings === 'object' &&
                        settingsClean.attendance_settings !== null
                      ? (settingsClean.attendance_settings as Record<string, unknown>)
                      : {};

            const mergedAtt =
                work_days !== undefined ? { ...baseAtt, work_days } : Object.keys(baseAtt).length ? baseAtt : undefined;

            settingsClean.kiosk_settings = {
                ...baseKs,
                ...(assembly_time !== undefined && { assembly_time }),
                ...(grace_period !== undefined && { grace_period }),
                ...(telemetry_retention_days !== undefined && { telemetry_retention_days }),
                ...(absence_time !== undefined && { absence_time }),
                ...(late_message !== undefined && { late_message }),
                ...(early_message !== undefined && { early_message }),
                ...(late_messages !== undefined && { late_messages }),
                ...(early_messages !== undefined && { early_messages }),
                ...(whatsapp_triggers !== undefined && { whatsapp_triggers }),
                ...(whatsapp_autopilot !== undefined && { whatsapp_autopilot }),
                ...(whatsapp_autopilot_time !== undefined && { whatsapp_autopilot_time }),
                ...(admin_theme !== undefined && { admin_theme }),
                ...(theme !== undefined && { admin_theme_values: theme }),
                ...(social_links !== undefined && { social_links }),
                ...(notification_templates !== undefined && { notification_templates }),
                ...(whatsapp_templates !== undefined && { whatsapp_templates }),
                ...(security_settings !== undefined && { security_settings }),
                ...(mergedAtt !== undefined && { attendance_settings: mergedAtt }),
            };

            delete (settingsClean as Record<string, unknown>).attendance_settings;
            delete (settingsClean as Record<string, unknown>).security_settings;
            delete (settingsClean as Record<string, unknown>).theme;
            delete (settingsClean as Record<string, unknown>).social_links;
            delete (settingsClean as Record<string, unknown>).notification_templates;
            delete (settingsClean as Record<string, unknown>).whatsapp_templates;

            // Minimal top-level columns — optional JSONB columns often missing on legacy DBs (→ 400)
            const SETTINGS_SUPABASE_KEYS = new Set([
                'id',
                'system_ready',
                'school_active',
                'school_name',
                'principal_name',
                'logo_url',
                'dark_mode',
                'kiosk_settings',
                'updated_at'
            ]);
            const filtered: Record<string, unknown> = {};
            for (const key of SETTINGS_SUPABASE_KEYS) {
                if (
                    Object.prototype.hasOwnProperty.call(settingsClean, key) &&
                    (settingsClean as Record<string, unknown>)[key] !== undefined
                ) {
                    filtered[key] = (settingsClean as Record<string, unknown>)[key];
                }
            }
            return this.stripUnsupportedCloudColumns(table, filtered);
        }

        return this.stripUnsupportedCloudColumns(table, clean);
    }

    private async upsertAttendanceLogs(payload: any): Promise<void> {
        const rows = Array.isArray(payload) ? payload : [payload];
        const validRows = rows
            .map((row) => this.normalizeAttendanceCloudPayload(row))
            .filter((row): row is AttendanceCloudPayload => Boolean(row));

        if (validRows.length === 0) {
            logger.warn('Sync', 'Skipping attendance sync: no valid rows after local payload normalization');
            return;
        }

        if (validRows.length !== rows.length) {
            logger.warn('Sync', `Skipped ${rows.length - validRows.length} malformed attendance row(s) before cloud sync`);
        }

        const rowsWithCloudStudents = await this.filterAttendanceRowsWithCloudStudents(validRows);
        if (rowsWithCloudStudents.length === 0) {
            logger.warn('Sync', 'Skipping attendance sync: no rows reference existing cloud students');
            return;
        }

        for (let i = 0; i < rowsWithCloudStudents.length; i += this.config.batchSize) {
            const chunk = rowsWithCloudStudents.slice(i, i + this.config.batchSize);
            const { error } = await supabase
                .from('attendance_logs')
                .upsert(chunk, {
                    onConflict: syncCatalog.for('attendance_logs').upsertConflict!,
                    ignoreDuplicates: false
                });
            if (error && error.code !== '23505') throw error;
        }
    }

    private normalizeAttendanceCloudPayload(row: any): AttendanceCloudPayload | null {
        if (!row || typeof row !== 'object') return null;

        const studentId = String(row.student_id ?? '').trim();
        if (!studentId || studentId.length > 50) return null;

        const status = this.normalizeAttendanceStatus(row.status, row.type);
        if (!status) return null;

        const timestamp = this.normalizeTimestamp(row.timestamp ?? row.created_at);
        const date = this.normalizeDate(row.date) ?? this.dateFromTimestamp(timestamp);
        if (!date || !timestamp) return null;

        const minutesLateValue = Number(row.minutes_late ?? 0);
        const minutes_late = Number.isFinite(minutesLateValue)
            ? Math.max(0, Math.round(minutesLateValue))
            : 0;

        const out: AttendanceCloudPayload = {
            student_id: studentId,
            date,
            timestamp,
            status,
            minutes_late
        };

        if (this.isUuid(row.recorded_by)) {
            out.recorded_by = row.recorded_by;
        }
        if (row.recorded_by_label !== undefined && row.recorded_by_label !== null) {
            out.recorded_by_label = String(row.recorded_by_label).slice(0, 50);
        }
        if (row.device_id !== undefined && row.device_id !== null) {
            out.device_id = String(row.device_id).slice(0, 100);
        }
        const createdAt = this.normalizeTimestamp(row.created_at);
        if (createdAt) {
            out.created_at = createdAt;
        }

        return out;
    }

    private normalizeAttendanceStatus(status: unknown, fallbackType?: unknown): AttendanceCloudPayload['status'] | null {
        const raw = String(status ?? fallbackType ?? '').trim().toLowerCase();
        if (this.VALID_ATTENDANCE_STATUSES.has(raw)) return raw as AttendanceCloudPayload['status'];

        if (raw === 'recorded') {
            const fallback = String(fallbackType ?? '').trim().toLowerCase();
            if (this.VALID_ATTENDANCE_STATUSES.has(fallback)) return fallback as AttendanceCloudPayload['status'];
            return 'present';
        }

        if (['حاضر', 'حضور', 'presented'].includes(raw)) return 'present';
        if (['متأخر', 'متاخر', 'late_arrival'].includes(raw)) return 'late';
        if (['غائب', 'غياب', 'absense', 'absence'].includes(raw)) return 'absent';

        return null;
    }

    private normalizeDate(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

        const parsed = new Date(trimmed);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 10);
    }

    private normalizeTimestamp(value: unknown): string | null {
        if (value === null || value === undefined || value === '') return null;
        const parsed = new Date(String(value));
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString();
    }

    private dateFromTimestamp(timestamp: string | null): string | null {
        if (!timestamp) return null;
        return timestamp.slice(0, 10);
    }

    private isUuid(value: unknown): value is string {
        return typeof value === 'string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    }

    private async filterAttendanceRowsWithCloudStudents(rows: AttendanceCloudPayload[]): Promise<AttendanceCloudPayload[]> {
        const ids = Array.from(new Set(rows.map((row) => row.student_id)));
        const existing = new Set<string>();

        for (let i = 0; i < ids.length; i += 100) {
            const chunk = ids.slice(i, i + 100);
            const { data, error } = await supabase
                .from('students')
                .select('id')
                .in('id', chunk);
            if (error) throw error;
            for (const row of data ?? []) {
                if (row?.id != null) existing.add(String(row.id));
            }
        }

        const missing = ids.filter((id) => !existing.has(id));
        if (missing.length === 0) return rows;

        const missingLocalStudents = await Promise.all(
            missing.map(async (id) => localDb.students.get(id).catch(() => undefined))
        );
        const unsyncedStudents = missingLocalStudents.filter((student) => student && student._synced === false);
        if (unsyncedStudents.length > 0) {
            for (const student of unsyncedStudents) {
                if (!student) continue;
                const existingQueue = await localDb.sync_queue
                    .where('table').equals('students')
                    .filter(e => e.payload?.id === student.id)
                    .first();
                
                if (!existingQueue) {
                    logger.info('Sync', `Re-queueing student ${student.id} because attendance depends on it`);
                    await localDb.sync_queue.add({
                        table: 'students',
                        operation: 'UPSERT',
                        payload: student,
                        created_at: new Date().toISOString(),
                        retry_count: 0
                    });
                }
            }
            throw new Error('Attendance references students that are still pending cloud sync');
        }

        logger.warn('Sync', `Skipped ${missing.length} orphan attendance student id(s) before cloud sync`);
        return rows.filter((row) => existing.has(row.student_id));
    }

    private async requeueUnsyncedAttendanceWithoutQueue(): Promise<void> {
        const unsynced = await localDb.attendance_logs
            .filter((record) => record._synced === false)
            .toArray();
        if (unsynced.length === 0) return;

        const pending = await getPendingSyncEntries();
        const pendingAttendanceKeys = new Set<string>();
        for (const entry of pending) {
            if (entry.table !== 'attendance_logs') continue;
            const payload = entry.payload;
            if (typeof payload === 'string') {
                pendingAttendanceKeys.add(`id:${payload}`);
                continue;
            }
            if (payload?.id) pendingAttendanceKeys.add(`id:${payload.id}`);
            if (payload?.student_id && payload?.date) {
                pendingAttendanceKeys.add(`state:${payload.student_id}:${payload.date}`);
            }
        }

        for (const record of unsynced) {
            const idKey = `id:${record.id}`;
            const stateKey = `state:${record.student_id}:${record.date}`;
            if (pendingAttendanceKeys.has(idKey) || pendingAttendanceKeys.has(stateKey)) continue;
            await queueChange('attendance_logs', 'UPSERT', record);
            pendingAttendanceKeys.add(idKey);
            pendingAttendanceKeys.add(stateKey);
        }
    }

    private getMaxTimestampFromRows(rows: any[], timestampColumn: string): string | null {
        if (!rows || rows.length === 0) return null;
        let maxMs = -1;
        for (const row of rows) {
            const value =
                row?.[timestampColumn] ||
                row?.updated_at ||
                row?.timestamp ||
                row?.created_at ||
                row?.request_time ||
                row?.dismissal_time;
            if (!value) continue;
            const parsedMs = new Date(value).getTime();
            if (!Number.isNaN(parsedMs) && parsedMs > maxMs) {
                maxMs = parsedMs;
            }
        }
        return maxMs >= 0 ? new Date(maxMs).toISOString() : null;
    }

    private resolveCloudRecordTimestamp(record: any, table: string): string {
        const primaryColumn = syncCatalog.for(table).timestampColumn;
        const preferredValue =
            (primaryColumn && record?.[primaryColumn]) ||
            record?.updated_at ||
            record?.timestamp ||
            record?.created_at ||
            record?.request_time ||
            record?.dismissal_time;

        if (preferredValue) {
            const parsed = new Date(preferredValue).getTime();
            if (!Number.isNaN(parsed)) {
                return new Date(parsed).toISOString();
            }
        }

        return getSyncedISOString();
    }

    private createEmptyResult(direction: SyncDirection, reason: string): SyncResult {
        const now = new Date().toISOString();
        return {
            success: false,
            direction,
            startedAt: now,
            completedAt: now,
            duration: 0,
            pushed: { total: 0, success: 0, failed: 0, byTable: {} },
            pulled: { total: 0, success: 0, failed: 0, byTable: {} },
            conflicts: { detected: 0, resolved: 0, pending: 0 },
            errors: [{
                table: 'system',
                operation: 'UPSERT',
                message: reason,
                timestamp: now
            }]
        };
    }

    /**
     * Clean up old entries from the recently deleted records cache
     */
    private cleanupDeletedRecordsCache(): void {
        const now = Date.now();
        for (const [key, timestamp] of this.recentlyDeletedRecords.entries()) {
            if (now - timestamp > this.DELETED_RECORD_TTL) {
                this.recentlyDeletedRecords.delete(key);
            }
        }
    }

    // ==========================================
    // 12. Force Full Sync
    // ==========================================

    async forceFullSync(): Promise<SyncResult> {
        // Clear last sync time to pull all data
        await setSyncMeta('last_sync_time', null);
        return this.syncNow('bidirectional');
    }

    // ==========================================
    // 13. Diagnostics
    // ==========================================

    async getDiagnostics() {
        const allQueueEntries = await getPendingSyncEntries({ includeBlocked: true });
        const queueEntries = allQueueEntries.filter(entry => !entry.blocked_at);
        const blockedQueueEntries = allQueueEntries.filter(entry => entry.blocked_at);
        const conflicts = await conflictResolver.getPendingConflicts();
        const lastSync = await getLastSyncTime();
        const [lastSyncSummary, lastPullTelemetry, lastSyncWatermark] = await Promise.all([
            getSyncMeta('last_sync_summary'),
            getSyncMeta('last_pull_telemetry'),
            getSyncMeta('last_sync_watermark')
        ]);

        return {
            isOnline: this.networkState.isOnline,
            isSyncing: this.isSyncing,
            lastSync,
            queueSize: queueEntries.length,
            queueByTable: this.groupByTable(queueEntries),
            blockedQueueSize: blockedQueueEntries.length,
            blockedQueueByTable: this.groupByTable(blockedQueueEntries),
            conflictCount: conflicts.length,
            conflictsByTable: await conflictResolver.getConflictCountByTable(),
            supabaseConfigured: supabaseStatus.isConfigured,
            lastSyncSummary,
            lastPullTelemetry,
            lastSyncWatermark
        };
    }

    private groupByTable(entries: SyncQueueEntry[]): Record<string, number> {
        const result: Record<string, number> = {};
        for (const entry of entries) {
            result[entry.table] = (result[entry.table] || 0) + 1;
        }
        return result;
    }
}

// ==========================================
// 14. Singleton Instance
// ==========================================

export const syncService = new SyncService();
