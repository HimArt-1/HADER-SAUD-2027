import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteFromLocalTableMock,
  fetchAllFromSupabaseMock,
  getUnsyncedTombstonesMock,
  markTombstonesSyncedMock,
  recordSyncTombstoneMock,
  removePendingSyncEntriesForRecordMock,
  supabaseFromMock
} = vi.hoisted(() => {
  const upsertMock = vi.fn(async () => ({ error: null }));
  const fromMock = vi.fn(() => ({
    upsert: upsertMock,
    select: vi.fn(() => ({
      gt: vi.fn()
    }))
  }));

  return {
    deleteFromLocalTableMock: vi.fn(async () => undefined),
    fetchAllFromSupabaseMock: vi.fn(async () => []),
    getUnsyncedTombstonesMock: vi.fn(async () => []),
    markTombstonesSyncedMock: vi.fn(async () => undefined),
    recordSyncTombstoneMock: vi.fn(async () => undefined),
    removePendingSyncEntriesForRecordMock: vi.fn(async () => undefined),
    supabaseFromMock: fromMock
  };
});

vi.mock('../services/supabase', () => ({
  supabaseStatus: { isConfigured: true },
  supabase: {
    from: supabaseFromMock
  }
}));

vi.mock('../services/localDb', () => ({
  localDb: {
    table: vi.fn(() => ({
      delete: deleteFromLocalTableMock
    }))
  },
  queueChange: vi.fn(),
  getPendingSyncEntries: vi.fn(async () => []),
  getPendingSyncCount: vi.fn(async () => 0),
  removeSyncedEntries: vi.fn(async () => undefined),
  markSyncEntryFailed: vi.fn(async () => undefined),
  markSyncEntryBlocked: vi.fn(async () => undefined),
  getLastSyncTime: vi.fn(async () => null),
  setLastSyncTime: vi.fn(async () => undefined),
  getSyncMeta: vi.fn(async () => null),
  setSyncMeta: vi.fn(async () => undefined),
  getUnsyncedTombstones: getUnsyncedTombstonesMock,
  markTombstonesSynced: markTombstonesSyncedMock,
  recordSyncTombstone: recordSyncTombstoneMock,
  removePendingSyncEntriesForRecord: removePendingSyncEntriesForRecordMock
}));

vi.mock('../services/dbHelpers', () => ({
  getSyncedDate: () => new Date('2026-05-05T09:00:00.000Z'),
  getSyncedISOString: () => '2026-05-05T09:00:00.000Z'
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../services/settingsRemoteId', () => ({
  applySettingsRowToCloud: vi.fn(async () => ({ error: null })),
  rememberRemoteSettingsPk: vi.fn(),
  resolveSettingsUpsertId: vi.fn(async () => '1')
}));

vi.mock('../services/conflictResolver', () => ({
  conflictResolver: {
    getPendingConflicts: vi.fn(async () => []),
    getConflictCountByTable: vi.fn(async () => ({})),
    hasConflict: vi.fn(() => false),
    resolve: vi.fn(async () => ({ resolution: 'cloud', result: {} }))
  }
}));

vi.mock('../services/dbFetchAll', () => ({
  fetchAllFromSupabase: fetchAllFromSupabaseMock
}));

import { SyncService } from '../services/syncService';

const createSyncResult = () => ({
  success: true,
  direction: 'bidirectional',
  startedAt: '2026-05-05T09:00:00.000Z',
  completedAt: '',
  duration: 0,
  pushed: { total: 0, success: 0, failed: 0, byTable: {} as Record<string, number> },
  pulled: { total: 0, success: 0, failed: 0, byTable: {} as Record<string, number> },
  conflicts: { detected: 0, resolved: 0, pending: 0 },
  errors: []
});

describe('SyncService tombstones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUnsyncedTombstonesMock.mockResolvedValue([]);
    fetchAllFromSupabaseMock.mockResolvedValue([]);
  });

  it('pushes unsynced tombstones to cloud and marks them synced', async () => {
    getUnsyncedTombstonesMock.mockResolvedValue([
      {
        id: 'attendance_logs:attendance-1',
        table_name: 'attendance_logs',
        record_id: 'attendance-1',
        deleted_at: '2026-05-05T08:00:00.000Z',
        created_at: '2026-05-05T08:00:00.000Z',
        _synced: false
      }
    ]);
    const service = new SyncService();
    const result = createSyncResult();

    await (service as any).pushTombstonesToCloud(result);

    expect(supabaseFromMock).toHaveBeenCalledWith('sync_tombstones');
    expect(markTombstonesSyncedMock).toHaveBeenCalledWith(['attendance_logs:attendance-1']);
    expect(result.pushed.byTable.sync_tombstones).toBe(1);
  });

  it('applies pulled tombstones by deleting stale local records', async () => {
    fetchAllFromSupabaseMock.mockResolvedValue([
      {
        id: 'exits:exit-1',
        table_name: 'exits',
        record_id: 'exit-1',
        deleted_at: '2026-05-05T08:00:00.000Z',
        created_at: '2026-05-05T08:00:00.000Z'
      }
    ]);
    const service = new SyncService();
    const result = createSyncResult();

    await (service as any).pullTombstonesFromCloud(result, '2026-05-05T07:00:00.000Z');

    expect(removePendingSyncEntriesForRecordMock).toHaveBeenCalledWith('exits', 'exit-1');
    expect(deleteFromLocalTableMock).toHaveBeenCalledWith('exit-1');
    expect(recordSyncTombstoneMock).toHaveBeenCalledWith(
      'exits',
      'exit-1',
      '2026-05-05T08:00:00.000Z',
      true
    );
    expect(result.pulled.byTable.sync_tombstones).toBe(1);
  });

  it('ignores tombstones that target sync-management tables', async () => {
    fetchAllFromSupabaseMock.mockResolvedValue([
      {
        id: 'sync_queue:1',
        table_name: 'sync_queue',
        record_id: '1',
        deleted_at: '2026-05-05T08:00:00.000Z'
      }
    ]);
    const service = new SyncService();
    const result = createSyncResult();

    await (service as any).pullTombstonesFromCloud(result, '2026-05-05T07:00:00.000Z');

    expect(removePendingSyncEntriesForRecordMock).not.toHaveBeenCalled();
    expect(deleteFromLocalTableMock).not.toHaveBeenCalled();
    expect(recordSyncTombstoneMock).not.toHaveBeenCalled();
  });

  it('backs off after missing cloud tombstone table to avoid repeated 404 requests', async () => {
    fetchAllFromSupabaseMock.mockRejectedValue({
      code: 'PGRST205',
      status: 404,
      message: 'Could not find the table public.sync_tombstones'
    });
    const service = new SyncService();
    const result = createSyncResult();

    await (service as any).pullTombstonesFromCloud(result, '2026-05-05T07:00:00.000Z');
    await (service as any).pullTombstonesFromCloud(result, '2026-05-05T07:00:00.000Z');

    expect(fetchAllFromSupabaseMock).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(0);
  });
});
