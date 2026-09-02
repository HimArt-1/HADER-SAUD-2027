import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock transitive dependencies that db.ts (loaded via dbHelpers) requires at module level
vi.mock('../services/settingsBroadcast', () => ({
  broadcastSettingsUpdate: vi.fn(),
  subscribeToSettingsUpdates: vi.fn(() => () => undefined)
}));

vi.mock('../services/supabase', () => {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
    send: vi.fn(async () => undefined)
  };
  return {
    supabaseStatus: { isConfigured: false },
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => undefined),
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) }
    }
  };
});

vi.mock('../services/syncService', () => ({
  syncService: {
    startAutoSync: vi.fn(),
    on: vi.fn(() => () => undefined),
    syncNow: vi.fn(async () => undefined)
  }
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Mock db.ts singleton to prevent Database constructor from running
vi.mock('../services/db', () => ({
  db: {
    getUsers: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({}))
  }
}));

// Mock auth since dbHelpers imports it
vi.mock('../services/auth', () => ({
  auth: {
    getSession: vi.fn(() => null),
    getUser: vi.fn(() => null)
  }
}));

import { LocalProvider } from '../services/localProvider';
import { getLocalISODate } from '../services/dbHelpers';
import { STORAGE_KEYS, type DismissalCallRequest, type DismissalRecord } from '../types';

const call: DismissalCallRequest = {
  id: 'call-1',
  student_id: 's1',
  student_name: 'Student 1',
  class_name: 'الأول',
  section: 'A',
  requested_by: 'guardian',
  requested_by_name: 'ولي الأمر',
  status: 'pending',
  request_time: '2026-05-16T12:00:00.000Z'
};

describe('LocalProvider dismissal data', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists active dismissal calls and removes them from active list after dismissal', async () => {
    const provider = new LocalProvider();

    await provider.addDismissalCall(call);

    expect((await provider.getActiveDismissalCalls()).map(row => row.id)).toEqual(['call-1']);

    await provider.updateDismissalCallStatus('call-1', 'dismissed');

    expect(await provider.getActiveDismissalCalls()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.DISMISSAL_CALLS) || '[]')).toMatchObject([
      { id: 'call-1', status: 'dismissed', dismissed_at: expect.any(String) }
    ]);
  });

  it('persists today dismissal records for local call-board counts', async () => {
    const provider = new LocalProvider();
    const record: DismissalRecord = {
      id: 'dismissal-1',
      student_id: 's1',
      date: getLocalISODate(),
      exit_time: new Date().toISOString(),
      method: 'kiosk'
    };

    await provider.addDismissal(record);

    expect((await provider.getTodayDismissals()).map(row => row.id)).toEqual(['dismissal-1']);
    expect(await provider.isStudentDismissedToday('s1')).toBe(true);
  });
});
