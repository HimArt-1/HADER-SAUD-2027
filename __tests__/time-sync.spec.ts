import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The clock probe must never hit the PostgREST root: it answers 401 to the anon key and
// sends no Access-Control-Expose-Headers, so the browser hides its Date header and the
// offset silently stays 0 — the app then trusts the (tamperable) device clock.

const credentials = { url: 'https://project.supabase.co', anonKey: 'anon-key' };

vi.mock('../services/supabase', () => ({ supabaseCredentials: credentials }));

const dateHeader = 'Wed, 09 Sep 2026 00:00:10 GMT';
const serverNow = new Date(dateHeader).getTime();

/** Load a fresh copy of the module — it keeps singleton sync state. */
const loadTimeSync = async () => {
  vi.resetModules();
  return import('../services/timeSync');
};

const respondWith = (init: { status?: number; date?: string | null }) => {
  const headers = new Headers();
  if (init.date !== null) headers.set('date', init.date ?? dateHeader);
  return new Response('[]', { status: init.status ?? 200, headers });
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  credentials.url = 'https://project.supabase.co';
  credentials.anonKey = 'anon-key';
  fetchMock = vi.fn(async () => respondWith({}));
  vi.stubGlobal('fetch', fetchMock);
  // Device clock reads 10s behind the server date above.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(serverNow - 10_000));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('time synchronization', () => {
  it('probes a table route that exposes the Date header, never the PostgREST root', async () => {
    const { initializeTimeSync } = await loadTimeSync();
    await initializeTimeSync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested.startsWith('https://project.supabase.co/rest/v1/')).toBe(true);
    expect(requested).not.toBe('https://project.supabase.co/rest/v1/');
    expect(requested).toContain('limit=0');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' });
  });

  it('adopts the server clock when the probe succeeds', async () => {
    const { initializeTimeSync, getSyncedNow, getSyncedDate } = await loadTimeSync();
    expect(getSyncedNow()).toBe(Date.now());

    await initializeTimeSync();

    expect(getSyncedNow() - Date.now()).toBeCloseTo(10_000, -2);
    expect(getSyncedDate().toISOString()).toBe(new Date(serverNow).toISOString());
  });

  it('keeps the device clock when the probe is rejected', async () => {
    fetchMock.mockResolvedValueOnce(respondWith({ status: 401 }));
    const { initializeTimeSync, getSyncedNow } = await loadTimeSync();

    await initializeTimeSync();

    expect(getSyncedNow()).toBe(Date.now());
  });

  it('keeps the device clock when the Date header is not readable', async () => {
    fetchMock.mockResolvedValueOnce(respondWith({ date: null }));
    const { initializeTimeSync, getSyncedNow } = await loadTimeSync();

    await initializeTimeSync();

    expect(getSyncedNow()).toBe(Date.now());
  });

  it('keeps the device clock when the network call throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { initializeTimeSync, getSyncedNow } = await loadTimeSync();

    await initializeTimeSync();

    expect(getSyncedNow()).toBe(Date.now());
  });

  it('does not call out when Supabase is unconfigured', async () => {
    credentials.url = undefined as unknown as string;
    credentials.anonKey = undefined as unknown as string;
    const { initializeTimeSync, getSyncedNow } = await loadTimeSync();

    await initializeTimeSync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSyncedNow()).toBe(Date.now());
  });

  it('syncs once and reuses the offset on later calls', async () => {
    const { initializeTimeSync } = await loadTimeSync();

    await initializeTimeSync();
    await initializeTimeSync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('derives the ISO date from the synchronized clock', async () => {
    const { initializeTimeSync, getSyncedISODate } = await loadTimeSync();
    await initializeTimeSync();

    const synced = new Date(serverNow);
    const expected = new Date(synced.getTime() - synced.getTimezoneOffset() * 60000)
      .toISOString()
      .split('T')[0];
    expect(getSyncedISODate()).toBe(expected);
  });
});
