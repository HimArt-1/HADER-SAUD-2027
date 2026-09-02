import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const {
  getDiagnosticsMock,
  syncNowMock,
  getPendingSyncEntriesMock
} = vi.hoisted(() => ({
  getDiagnosticsMock: vi.fn(),
  syncNowMock: vi.fn(),
  getPendingSyncEntriesMock: vi.fn()
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    getDiagnostics: getDiagnosticsMock,
    syncNow: syncNowMock
  }
}));

vi.mock('../services/localDb', () => ({
  localDb: {
    sync_queue: {
      clear: vi.fn(async () => undefined)
    }
  },
  getPendingSyncEntries: getPendingSyncEntriesMock
}));

vi.mock('../services/db', () => ({
  db: {}
}));

import Diagnostics from '../pages/Diagnostics';

describe('Diagnostics telemetry UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingSyncEntriesMock.mockResolvedValue([]);
    syncNowMock.mockResolvedValue(undefined);
  });

  it('renders last sync telemetry metrics', async () => {
    getDiagnosticsMock.mockResolvedValue({
      isOnline: true,
      isSyncing: false,
      lastSync: '2026-05-05T09:00:00.000Z',
      queueSize: 0,
      queueByTable: {},
      conflictCount: 0,
      conflictsByTable: {},
      supabaseConfigured: true,
      lastSyncSummary: {
        duration_ms: 1420,
        queue_start: 7,
        queue_end: 1,
        errors_count: 0
      },
      lastSyncWatermark: {
        previous: '2026-05-05T08:00:00.000Z',
        next: '2026-05-05T09:00:00.000Z',
        advanced_ms: 3600000
      },
      lastPullTelemetry: {
        tables: [],
        stale_tables: []
      }
    });

    render(<Diagnostics />);

    expect(await screen.findByText('Last Sync Telemetry')).toBeTruthy();
    expect(screen.getByText('1420 ms')).toBeTruthy();
    expect(screen.getByText('Watermark advance:')).toBeTruthy();
    expect(screen.getByText('3600000 ms')).toBeTruthy();
  });

  it('renders stale pull warning when stale tables exist', async () => {
    getDiagnosticsMock.mockResolvedValue({
      isOnline: true,
      isSyncing: false,
      lastSync: '2026-05-05T09:00:00.000Z',
      queueSize: 0,
      queueByTable: {},
      conflictCount: 0,
      conflictsByTable: {},
      supabaseConfigured: true,
      lastSyncSummary: {
        duration_ms: 800,
        queue_start: 1,
        queue_end: 0,
        errors_count: 0
      },
      lastSyncWatermark: {
        previous: '2026-05-05T08:30:00.000Z',
        next: '2026-05-05T09:00:00.000Z',
        advanced_ms: 1800000
      },
      lastPullTelemetry: {
        tables: [{ table: 'students', rows: 12, pages: 1, timestampColumn: 'updated_at', maxTimestamp: '2026-05-05T08:59:00.000Z' }],
        stale_tables: ['students', 'attendance_logs']
      }
    });

    render(<Diagnostics />);

    expect(await screen.findByText('Stale Pull Warning')).toBeTruthy();
    expect(screen.getByText('students, attendance_logs')).toBeTruthy();
  });
});
