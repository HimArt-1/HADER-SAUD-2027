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

import { CloudProvider } from '../services/cloudProvider';
import { KIOSK_CACHE_KEY, KIOSK_QUEUE_KEY, KIOSK_SETTINGS_KEY } from '../services/dbTypes';

beforeEach(() => localStorage.clear());

describe('cloud kiosk attendance eligibility', () => {
  it.each([false, 0])('rejects an inactive cached student (%s) without queueing attendance', async isActive => {
    localStorage.setItem(KIOSK_CACHE_KEY, JSON.stringify([{ id: 'disabled', is_active: isActive }]));
    localStorage.setItem(KIOSK_SETTINGS_KEY, JSON.stringify({ work_days: [0, 1, 2, 3, 4, 5, 6] }));
    const provider = new CloudProvider();
    try {
      const result = await provider.markAttendanceFast('disabled');
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/الطالب غير مفعّل/);
      expect(localStorage.getItem(KIOSK_QUEUE_KEY)).toBeNull();
    } finally {
      provider.cleanup();
    }
  });
});
