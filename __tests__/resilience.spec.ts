import { describe, it, expect, beforeEach, vi } from 'vitest';
import { secureSessionStorage } from '../services/secureStorage';
import { Role, STORAGE_KEYS, User } from '../types';
import { supabase, supabaseStatus } from '../services/supabase';

const baseSettings = {
  system_ready: true,
  school_active: true,
  assembly_time: '07:00',
  grace_period: 10,
  logo_url: ''
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(baseSettings));
  secureSessionStorage.clear();
});

describe('Resilience fallbacks', () => {
  it('stores session in memory when localStorage is unavailable', () => {
    const session = {
      user: { id: 'memory-user', username: 'memory', name: 'ذاكرة', role: Role.WATCHER } as User,
      token: 'token',
      expiresAt: Date.now() + 1000,
      createdAt: Date.now()
    };

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('no storage');
    });

    secureSessionStorage.save(session);
    expect(secureSessionStorage.get()).toEqual(session);

    setItemSpy.mockRestore();
  });

  it('returns helpful error responses when Supabase env vars are missing', async () => {
    const result: any = await supabase.from('users').select('*');
    if (!supabaseStatus.isConfigured) {
      expect(result?.error?.message).toContain('not configured');
    } else {
      expect(supabaseStatus.isConfigured).toBe(true);
    }
  });
});
