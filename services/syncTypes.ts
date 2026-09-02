// =============================================================================
// نظام حاضر (Hader) - Sync Types & Interfaces
// =============================================================================
// This file defines all types related to the synchronization system

import { syncCatalog, type SyncConflictStrategy } from '../modules/sync/catalog';

// ==========================================
// 1. Sync Direction & Status
// ==========================================

export type SyncDirection = 'up' | 'down' | 'bidirectional';

export type SyncStatus = 'idle' | 'syncing' | 'online' | 'offline' | 'error' | 'conflict';

export interface SyncState {
    status: SyncStatus;
    pending: number;
    conflicts: number;
    lastSync?: string;
    lastError?: string;
    isOnline: boolean;
    syncProgress?: {
        current: number;
        total: number;
        table?: string;
    };
}

// ==========================================
// 2. Syncable Record Interface
// ==========================================

export interface SyncableRecord {
    _synced?: boolean;      // Whether this record is synced with cloud
    _updated_at?: string;   // Last local update timestamp (ISO string)
    _deleted?: boolean;     // Soft delete flag for sync
    _conflict?: boolean;    // Has unresolved conflict
    _local_id?: string;     // Temporary local ID before cloud assignment
}

// ==========================================
// 3. Sync Queue Types
// ==========================================

export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';

export interface SyncQueueItem {
    id?: number;
    table: string;
    operation: SyncOperation;
    payload: any;
    created_at: string;
    retry_count: number;
    last_error?: string;
    blocked_at?: string;
    blocked_reason?: string;
    failure_category?: string;
    group_id?: string;
    synced_at?: string;
}

// ==========================================
// 4. Conflict Types
// ==========================================

export type ConflictResolution = 'local' | 'cloud' | 'merged' | 'manual';

export interface SyncConflict {
    id?: number;
    table: string;
    record_id: string;
    local_data: any;
    cloud_data: any;
    detected_at: string;
    resolved_at?: string;
    resolution?: ConflictResolution;
    resolved_by?: string;
    merge_result?: any;
}

// Conflict resolution strategy per table
export interface ConflictStrategy {
    table: string;
    strategy: SyncConflictStrategy;
    customResolver?: (local: any, cloud: any) => any;
}

// ==========================================
// 5. Sync Event Types
// ==========================================

export type SyncEventType =
    | 'sync:started'
    | 'sync:completed'
    | 'sync:failed'
    | 'sync:progress'
    | 'sync:conflict'
    | 'sync:conflict_resolved'
    | 'sync:online'
    | 'sync:offline'
    | 'sync:queue_change';

export interface SyncEvent {
    type: SyncEventType;
    timestamp: string;
    data?: any;
}

export type SyncEventListener = (event: SyncEvent) => void;

// ==========================================
// 6. Sync Configuration
// ==========================================

export interface SyncConfig {
    // Auto sync settings
    autoSyncEnabled: boolean;
    autoSyncInterval: number; // milliseconds

    // Retry settings
    maxRetries: number;
    retryDelay: number; // milliseconds
    exponentialBackoff: boolean;

    // Batch settings
    batchSize: number;

    // Conflict resolution
    conflictStrategies: ConflictStrategy[];
    defaultConflictStrategy: 'last_write_wins' | 'cloud_wins' | 'local_wins';

    // Tables to sync
    syncTables: string[];

    // Network settings
    syncOnReconnect: boolean;
    offlineQueueLimit: number;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    autoSyncEnabled: true,
    autoSyncInterval: 60_000, // 60 seconds — balanced freshness vs. performance

    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true,

    batchSize: 50,

    conflictStrategies: syncCatalog.all().map(policy => ({
        table: policy.name,
        strategy: policy.conflictStrategy
    })),
    defaultConflictStrategy: 'last_write_wins',

    syncTables: syncCatalog.all().map(policy => policy.name),

    syncOnReconnect: true,
    offlineQueueLimit: 1000
};

// ==========================================
// 7. Sync Result Types
// ==========================================

export interface SyncResult {
    success: boolean;
    direction: SyncDirection;
    startedAt: string;
    completedAt: string;
    duration: number; // milliseconds

    pushed: {
        total: number;
        success: number;
        failed: number;
        byTable: Record<string, number>;
    };

    pulled: {
        total: number;
        success: number;
        failed: number;
        byTable: Record<string, number>;
    };

    conflicts: {
        detected: number;
        resolved: number;
        pending: number;
    };

    errors: SyncError[];
}

export interface SyncError {
    table: string;
    operation: SyncOperation;
    recordId?: string;
    message: string;
    code?: string;
    timestamp: string;
}

// ==========================================
// 8. Table Sync State
// ==========================================

export interface TableSyncState {
    table: string;
    lastPull?: string;
    lastPush?: string;
    pendingCount: number;
    conflictCount: number;
}

// ==========================================
// 9. Network State
// ==========================================

export interface NetworkState {
    isOnline: boolean;
    lastOnline?: string;
    lastOffline?: string;
    connectionType?: string;
    effectiveType?: string; // 4g, 3g, 2g, slow-2g
}

// ==========================================
// 10. Diagnostic Types
// ==========================================

export interface SyncDiagnostics {
    dbVersion: number;
    dbName: string;
    tablesStatus: TableSyncState[];
    queueSize: number;
    conflictCount: number;
    lastFullSync?: string;
    networkState: NetworkState;
    storageUsed?: number;
    storageQuota?: number;
}
