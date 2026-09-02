import { describe, expect, it } from 'vitest';
import { syncCatalog } from '../modules/sync/catalog';
import { DEFAULT_SYNC_CONFIG } from '../services/syncTypes';

describe('sync catalog interface', () => {
  it('defines the complete ordered set of locally supported cloud tables', () => {
    expect(syncCatalog.all().map(policy => policy.name)).toEqual([
      'students',
      'attendance_logs',
      'users',
      'classes',
      'settings',
      'exits',
      'violations',
      'notifications',
      'guardian_excuses',
      'dismissal_records',
      'dismissal_calls',
      'dismissal_schedules',
      'activity_logs',
      'auth_audit_logs',
      'client_error_logs',
      'emergency_logs',
      'daily_summaries'
    ]);
  });

  it('keeps table-specific pull, upsert and conflict rules together', () => {
    expect(syncCatalog.for('attendance_logs')).toMatchObject({
      timestampColumn: 'timestamp',
      upsertConflict: 'student_id,date',
      conflictStrategy: 'cloud_wins',
      realtime: true
    });
    expect(syncCatalog.for('settings')).toMatchObject({
      timestampColumn: 'updated_at',
      upsertConflict: 'id',
      conflictStrategy: 'local_wins',
      realtime: true
    });
    expect(syncCatalog.for('dismissal_records')).toMatchObject({
      timestampColumn: 'dismissal_time',
      upsertConflict: 'id',
      conflictStrategy: 'last_write_wins',
      realtime: true
    });
  });

  it('derives realtime subscriptions from the same policies', () => {
    expect(syncCatalog.realtime()).toEqual([
      'students',
      'attendance_logs',
      'users',
      'classes',
      'settings',
      'exits',
      'violations',
      'notifications',
      'dismissal_records',
      'dismissal_schedules'
    ]);
  });

  it('derives the default pull and conflict configuration from the catalog', () => {
    expect(DEFAULT_SYNC_CONFIG.syncTables).toEqual(
      syncCatalog.all().map(policy => policy.name)
    );
    expect(DEFAULT_SYNC_CONFIG.conflictStrategies).toEqual(
      syncCatalog.all().map(policy => ({
        table: policy.name,
        strategy: policy.conflictStrategy
      }))
    );
  });

  it('provides safe defaults for an explicitly configured future table', () => {
    expect(syncCatalog.has('future_table')).toBe(false);
    expect(syncCatalog.for('future_table')).toEqual({
      name: 'future_table',
      timestampColumn: 'created_at',
      conflictStrategy: 'last_write_wins',
      realtime: false
    });
  });
});
