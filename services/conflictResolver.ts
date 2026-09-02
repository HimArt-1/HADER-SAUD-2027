// =============================================================================
// نظام حاضر (Hader) - Conflict Resolver
// =============================================================================
// Handles sync conflicts between local and cloud data

import { 
    SyncConflict, 
    ConflictResolution, 
    ConflictStrategy,
    DEFAULT_SYNC_CONFIG 
} from './syncTypes';
import { localDb, logConflict, resolveConflict as markConflictResolved } from './localDb';

// ==========================================
// 1. Conflict Resolver Class
// ==========================================

export class ConflictResolver {
    private strategies: Map<string, ConflictStrategy>;
    private defaultStrategy: ConflictStrategy['strategy'];

    constructor(strategies: ConflictStrategy[] = DEFAULT_SYNC_CONFIG.conflictStrategies) {
        this.strategies = new Map();
        strategies.forEach(s => this.strategies.set(s.table, s));
        this.defaultStrategy = DEFAULT_SYNC_CONFIG.defaultConflictStrategy;
    }

    // ==========================================
    // Get strategy for a table
    // ==========================================
    getStrategy(table: string): ConflictStrategy['strategy'] {
        return this.strategies.get(table)?.strategy || this.defaultStrategy;
    }

    // ==========================================
    // Detect if there's a conflict
    // ==========================================
    hasConflict(localRecord: any, cloudRecord: any): boolean {
        if (!localRecord || !cloudRecord) return false;
        
        // No conflict if local wasn't modified
        if (localRecord._synced === true) return false;
        
        // Compare updated_at timestamps
        const localTime = this.getRecordTimestamp(localRecord, true);
        const cloudTime = this.getRecordTimestamp(cloudRecord, false);
        
        // Conflict if both were modified after last sync
        // and they have different content
        if (localTime > 0 && cloudTime > 0) {
            return !this.areRecordsEqual(localRecord, cloudRecord);
        }
        
        return false;
    }

    // ==========================================
    // Check if two records are equal (ignoring sync fields)
    // ==========================================
    areRecordsEqual(local: any, cloud: any): boolean {
        const localClean = this.stripSyncFields(local);
        const cloudClean = this.stripSyncFields(cloud);
        return JSON.stringify(localClean) === JSON.stringify(cloudClean);
    }

    // ==========================================
    // Strip sync-related fields for comparison
    // ==========================================
    private stripSyncFields(record: any): any {
        if (!record) return record;
        const { _synced, _updated_at, _deleted, _conflict, _local_id, ...rest } = record;
        return rest;
    }

    // ==========================================
    // Resolve a conflict based on strategy
    // ==========================================
    async resolve(
        table: string,
        recordId: string,
        localData: any,
        cloudData: any,
        forceResolution?: ConflictResolution
    ): Promise<{ resolution: ConflictResolution; result: any }> {
        
        // Log the conflict first
        const conflictId = await logConflict(table, recordId, localData, cloudData);
        
        const strategy = forceResolution || this.getStrategyResolution(table, localData, cloudData);
        let result: any;

        switch (strategy) {
            case 'local':
                result = { ...localData, _synced: false, _conflict: false };
                break;
                
            case 'cloud':
                result = { ...cloudData, _synced: true, _conflict: false };
                break;
                
            case 'merged':
                result = this.mergeRecords(table, localData, cloudData);
                break;
                
            case 'manual':
                // Mark for manual resolution - don't auto-resolve
                result = { ...localData, _conflict: true };
                // Don't mark as resolved yet
                return { resolution: 'manual', result };
        }

        // Mark conflict as resolved
        await markConflictResolved(conflictId, strategy);

        return { resolution: strategy, result };
    }

    // ==========================================
    // Get resolution based on strategy type
    // ==========================================
    private getStrategyResolution(
        table: string,
        localData: any,
        cloudData: any
    ): ConflictResolution {
        const strategyType = this.getStrategy(table);

        switch (strategyType) {
            case 'cloud_wins':
                return 'cloud';
                
            case 'local_wins':
                return 'local';
                
            case 'last_write_wins':
                return this.getLastWriteWinner(localData, cloudData);
                
            case 'custom':
                const customStrategy = this.strategies.get(table);
                if (customStrategy?.customResolver) {
                    return 'merged';
                }
                return this.getLastWriteWinner(localData, cloudData);
                
            default:
                return 'cloud';
        }
    }

    // ==========================================
    // Determine winner based on timestamps
    // ==========================================
    private getLastWriteWinner(localData: any, cloudData: any): ConflictResolution {
        const localTime = this.getRecordTimestamp(localData, true);
        const cloudTime = this.getRecordTimestamp(cloudData, false);
        
        return localTime > cloudTime ? 'local' : 'cloud';
    }

    private getRecordTimestamp(record: any, isLocalRecord: boolean): number {
        if (!record) return 0;
        const candidates = [
            isLocalRecord ? record._updated_at : undefined,
            record.updated_at,
            record.timestamp,
            record.created_at,
            record.request_time,
            record.dismissal_time,
            record.called_at,
            record.dismissed_at
        ];

        for (const value of candidates) {
            if (!value) continue;
            const ts = new Date(value).getTime();
            if (!Number.isNaN(ts) && ts > 0) {
                return ts;
            }
        }

        return 0;
    }

    // ==========================================
    // Merge two records (smart merge)
    // ==========================================
    private mergeRecords(table: string, localData: any, cloudData: any): any {
        const customStrategy = this.strategies.get(table);
        
        // Use custom resolver if available
        if (customStrategy?.customResolver) {
            return {
                ...customStrategy.customResolver(localData, cloudData),
                _synced: false,
                _conflict: false,
                _updated_at: new Date().toISOString()
            };
        }

        // Default merge: Cloud base with local non-null changes
        const merged: any = { ...cloudData };
        
        for (const key of Object.keys(localData)) {
            // Skip sync fields
            if (key.startsWith('_')) continue;
            
            // Keep local value if it's different and not null
            if (localData[key] !== null && 
                localData[key] !== undefined && 
                localData[key] !== cloudData[key]) {
                merged[key] = localData[key];
            }
        }

        merged._synced = false;
        merged._conflict = false;
        merged._updated_at = new Date().toISOString();

        return merged;
    }

    // ==========================================
    // Batch resolve conflicts for a table
    // ==========================================
    async resolveAll(table: string): Promise<number> {
        const conflicts = await localDb.conflict_log
            .where('table')
            .equals(table)
            .filter(c => !c.resolved_at)
            .toArray();

        let resolved = 0;

        for (const conflict of conflicts) {
            try {
                await this.resolve(
                    conflict.table,
                    conflict.record_id,
                    conflict.local_data,
                    conflict.cloud_data
                );
                resolved++;
            } catch (error) {
                console.error(`[ConflictResolver] Failed to resolve conflict ${conflict.id}:`, error);
            }
        }

        return resolved;
    }

    // ==========================================
    // Get all pending conflicts
    // ==========================================
    async getPendingConflicts(): Promise<SyncConflict[]> {
        return await localDb.conflict_log
            .filter(c => !c.resolved_at)
            .toArray();
    }

    // ==========================================
    // Get conflict count by table
    // ==========================================
    async getConflictCountByTable(): Promise<Record<string, number>> {
        const conflicts = await this.getPendingConflicts();
        const counts: Record<string, number> = {};
        
        for (const conflict of conflicts) {
            counts[conflict.table] = (counts[conflict.table] || 0) + 1;
        }
        
        return counts;
    }

    // ==========================================
    // Manual resolution helper
    // ==========================================
    async resolveManually(
        conflictId: number,
        resolution: 'local' | 'cloud' | 'merged',
        mergedData?: any,
        resolvedBy?: string
    ): Promise<void> {
        const conflict = await localDb.conflict_log.get(conflictId);
        if (!conflict) {
            throw new Error(`Conflict ${conflictId} not found`);
        }

        let finalData: any;
        
        switch (resolution) {
            case 'local':
                finalData = conflict.local_data;
                break;
            case 'cloud':
                finalData = conflict.cloud_data;
                break;
            case 'merged':
                if (!mergedData) {
                    throw new Error('Merged data required for merged resolution');
                }
                finalData = mergedData;
                break;
        }

        // Update the record in the database
        const table = localDb.table(conflict.table);
        await table.put({
            ...finalData,
            _synced: resolution === 'cloud',
            _conflict: false,
            _updated_at: new Date().toISOString()
        });

        // Mark conflict as resolved
        await markConflictResolved(conflictId, resolution, resolvedBy);
    }
}

// Singleton instance
export const conflictResolver = new ConflictResolver();
