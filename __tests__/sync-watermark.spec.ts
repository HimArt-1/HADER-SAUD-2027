import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  setSyncMetaMock,
  setLastSyncTimeMock,
  getPendingSyncCountMock,
  getLastSyncTimeMock,
  getUnsyncedTombstonesMock,
  getSyncedISOStringMock,
  loggerWarnMock
} = vi.hoisted(() => ({
  setSyncMetaMock: vi.fn(async () => undefined),
  setLastSyncTimeMock: vi.fn(async () => undefined),
  getPendingSyncCountMock: vi.fn(async () => 0),
  getLastSyncTimeMock: vi.fn(async () => null as string | null),
  getUnsyncedTombstonesMock: vi.fn(async () => []),
  getSyncedISOStringMock: vi.fn(() => '2026-05-05T09:00:00.000Z'),
  loggerWarnMock: vi.fn()
}));

vi.mock('../services/supabase', () => ({
  supabase: {},
  supabaseStatus: { isConfigured: true }
}));

vi.mock('../services/localDb', () => ({
  localDb: { table: () => ({ update: vi.fn(), get: vi.fn(), put: vi.fn() }) },
  queueChange: vi.fn(),
  getPendingSyncEntries: vi.fn(async () => []),
  getPendingSyncCount: getPendingSyncCountMock,
  removeSyncedEntries: vi.fn(async () => undefined),
  markSyncEntryFailed: vi.fn(async () => undefined),
  markSyncEntryBlocked: vi.fn(async () => undefined),
  getUnsyncedTombstones: getUnsyncedTombstonesMock,
  markTombstonesSynced: vi.fn(async () => undefined),
  recordSyncTombstone: vi.fn(async () => undefined),
  removePendingSyncEntriesForRecord: vi.fn(async () => undefined),
  getLastSyncTime: getLastSyncTimeMock,
  setLastSyncTime: setLastSyncTimeMock,
  setSyncMeta: setSyncMetaMock,
  getSyncMeta: vi.fn(async () => null)
}));

vi.mock('../services/dbHelpers', () => ({
  getSyncedDate: () => new Date('2026-05-05T09:00:00.000Z'),
  getSyncedISOString: getSyncedISOStringMock
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
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
  fetchAllFromSupabase: vi.fn(async () => [])
}));

import { SyncService } from '../services/syncService';

describe('SyncService watermark safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingSyncCountMock.mockResolvedValue(0);
  });

  it('persists watermark and sync summary metadata after successful sync', async () => {
    getLastSyncTimeMock.mockResolvedValue('2026-05-05T08:00:00.000Z');
    getSyncedISOStringMock.mockReturnValue('2026-05-05T09:00:00.000Z');

    const service = new SyncService();
    const svc = service as any;
    svc.pushToCloud = vi.fn(async () => undefined);
    svc.pushTombstonesToCloud = vi.fn(async () => undefined);
    svc.pullTombstonesFromCloud = vi.fn(async () => true);
    svc.pullFromCloud = vi.fn(async () => ({ tables: [], staleTables: [] }));

    const result = await service.syncNow('bidirectional');

    expect(result.success).toBe(true);
    expect(setLastSyncTimeMock).toHaveBeenCalledWith('2026-05-05T09:00:00.000Z');

    expect(setSyncMetaMock).toHaveBeenCalledWith(
      'last_sync_watermark',
      expect.objectContaining({
        previous: '2026-05-05T08:00:00.000Z',
        next: '2026-05-05T09:00:00.000Z',
        advanced_ms: 3600000
      })
    );

    expect(setSyncMetaMock).toHaveBeenCalledWith(
      'last_sync_summary',
      expect.objectContaining({
        direction: 'bidirectional',
        queue_start: 0,
        queue_end: 0
      })
    );
  });

  it('logs a warning when watermark moves backwards', async () => {
    getLastSyncTimeMock.mockResolvedValue('2026-05-05T10:00:00.000Z');
    getSyncedISOStringMock.mockReturnValue('2026-05-05T09:00:00.000Z');

    const service = new SyncService();
    const svc = service as any;
    svc.pushToCloud = vi.fn(async () => undefined);
    svc.pushTombstonesToCloud = vi.fn(async () => undefined);
    svc.pullTombstonesFromCloud = vi.fn(async () => true);
    svc.pullFromCloud = vi.fn(async () => ({ tables: [], staleTables: [] }));

    await service.syncNow('bidirectional');

    expect(setSyncMetaMock).toHaveBeenCalledWith(
      'last_sync_watermark',
      expect.objectContaining({
        previous: '2026-05-05T10:00:00.000Z',
        next: '2026-05-05T09:00:00.000Z',
        advanced_ms: -3600000
      })
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Sync',
      'Sync watermark moved backward. Check device/server clock alignment.',
      expect.objectContaining({
        previousLastSync: '2026-05-05T10:00:00.000Z',
        nextLastSync: '2026-05-05T09:00:00.000Z',
        watermarkAdvanceMs: -3600000
      })
    );
  });

  it('preserves previous watermark when pull has errors', async () => {
    getLastSyncTimeMock.mockResolvedValue('2026-05-05T08:00:00.000Z');
    getSyncedISOStringMock.mockReturnValue('2026-05-05T09:00:00.000Z');

    const service = new SyncService();
    const svc = service as any;
    svc.pushToCloud = vi.fn(async () => undefined);
    svc.pushTombstonesToCloud = vi.fn(async () => undefined);
    svc.pullTombstonesFromCloud = vi.fn(async () => true);
    svc.pullFromCloud = vi.fn(async (result: any) => {
      result.pulled.failed += 1;
      result.errors.push({
        table: 'students',
        operation: 'UPSERT',
        message: 'pull failed',
        timestamp: '2026-05-05T09:00:00.000Z'
      });
      return { tables: [], staleTables: [] };
    });

    await service.syncNow('bidirectional');

    expect(setLastSyncTimeMock).not.toHaveBeenCalled();
    expect(setSyncMetaMock).toHaveBeenCalledWith(
      'last_sync_watermark',
      expect.objectContaining({
        previous: '2026-05-05T08:00:00.000Z',
        next: '2026-05-05T08:00:00.000Z',
        attempted_next: '2026-05-05T09:00:00.000Z',
        advanced: false,
        blocked_reason: 'pull_errors'
      })
    );
  });

  it('does not advance pull watermark during push-only sync', async () => {
    getLastSyncTimeMock.mockResolvedValue('2026-05-05T08:00:00.000Z');
    getSyncedISOStringMock.mockReturnValue('2026-05-05T09:00:00.000Z');

    const service = new SyncService();
    const svc = service as any;
    svc.pushToCloud = vi.fn(async () => undefined);
    svc.pushTombstonesToCloud = vi.fn(async () => undefined);

    await service.syncNow('up');

    expect(setLastSyncTimeMock).not.toHaveBeenCalled();
    expect(setSyncMetaMock).toHaveBeenCalledWith(
      'last_sync_watermark',
      expect.objectContaining({
        previous: '2026-05-05T08:00:00.000Z',
        next: '2026-05-05T08:00:00.000Z',
        attempted_next: '2026-05-05T09:00:00.000Z',
        advanced: false,
        blocked_reason: 'push_only_sync'
      })
    );
  });
});
