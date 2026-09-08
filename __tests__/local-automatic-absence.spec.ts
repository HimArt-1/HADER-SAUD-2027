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
import { STORAGE_KEYS, type SystemSettings } from '../types';

const date = '2026-09-07';
const settings = { work_days: [0, 1, 2, 3, 4, 5, 6], attendance_settings: { academic_holidays: [] } } as SystemSettings;
const read = () => JSON.parse(localStorage.getItem(STORAGE_KEYS.ATTENDANCE) || '[]');

beforeEach(() => localStorage.clear());

describe('local kiosk attendance eligibility', () => {
  it.each([false, 0])('rejects an inactive student (%s) without writing attendance', async isActive => {
    const provider = new LocalProvider();
    vi.spyOn(provider, 'getSettings').mockResolvedValue(settings);
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify([{ id: 'disabled', is_active: isActive }]));
    const result = await provider.markAttendance('disabled');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/الطالب غير مفعّل/);
    expect(read()).toEqual([]);
  });
});

describe('local automatic absence write boundary', () => {
  it('preserves a scanner result arriving while absence settings are loading', async () => {
    const provider = new LocalProvider();
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify([{ id: 's1', is_active: true }]));
    let resume!: (value: SystemSettings) => void;
    vi.spyOn(provider, 'getSettings').mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const pending = provider.bulkMarkAbsent({ student_ids: ['s1'], date, only_unmarked: true });
    const presence = { id: 'scan', student_id: 's1', date, status: 'present', timestamp: '2026-09-07T06:01:00Z' };
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify([presence]));
    resume(settings);
    expect(await pending).toMatchObject({ success: true, count: 0 });
    expect(read()).toEqual([presence]);
  });

  it('ignores inactive/deleted IDs, duplicate IDs and all existing statuses on replay', async () => {
    const provider = new LocalProvider();
    vi.spyOn(provider, 'getSettings').mockResolvedValue(settings);
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify([
      { id: 's1', is_active: true }, { id: 'disabled', is_active: false }, { id: 'late', is_active: true }, { id: 'excused', is_active: true }
    ]));
    const existing = ['late', 'excused'].map(status => ({ id: status, student_id: status, date, status }));
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(existing));
    const params = { student_ids: ['s1', 's1', 'disabled', 'deleted', 'late', 'excused'], date, only_unmarked: true };
    expect(await provider.bulkMarkAbsent(params)).toMatchObject({ success: true, count: 1 });
    expect(await provider.bulkMarkAbsent(params)).toMatchObject({ success: true, count: 0 });
    expect(read()).toEqual([...existing, expect.objectContaining({ student_id: 's1', status: 'absent' })]);
  });

  it('keeps explicit manual absence corrections available', async () => {
    const provider = new LocalProvider();
    vi.spyOn(provider, 'getSettings').mockResolvedValue(settings);
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify([{ id: 'scan', student_id: 's1', date, status: 'present' }]));
    expect(await provider.bulkMarkAbsent({ student_ids: ['s1'], date })).toMatchObject({ success: true, count: 1 });
    expect(read()).toEqual([expect.objectContaining({ student_id: 's1', status: 'absent' })]);
  });
});
