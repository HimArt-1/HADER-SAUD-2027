import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const remote = vi.hoisted(() => ({ request: vi.fn(), queueChange: vi.fn() }));
vi.mock('../services/localDb', () => ({
  localDb: { sync_queue: { count: vi.fn(async () => 0) } },
  queueChange: remote.queueChange
}));

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
      from: (table: string) => {
        let from = 0, to = 999, write = false;
        const query: any = {
          select: () => query, eq: () => query, order: () => query, limit: () => query,
          maybeSingle: () => query, abortSignal: () => query,
          upsert: () => { write = true; return query; },
          range: (start: number, end: number) => { from = start; to = end; return query; },
          then: (resolve: any, reject: any) => remote.request({ table, from, to, write }).then(resolve, reject)
        };
        return query;
      },
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

import { CloudProvider, LocalKioskStorage } from '../services/cloudProvider';
import { KIOSK_CACHE_KEY, KIOSK_SETTINGS_KEY, KIOSK_QUEUE_KEY } from '../services/dbTypes';

const settings = { system_ready: true, school_active: true, work_days: [0, 1, 2, 3, 4, 5, 6], assembly_time: '06:45' };
const makeStudents = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(100000 + i), name: `طالب ${i}`, class_name: '1', section: 'A', is_active: true }));
const providers: CloudProvider[] = [];
const provider = () => { const p = new CloudProvider(); providers.push(p); return p; };
const seed = (count = 2500) => {
  localStorage.setItem(KIOSK_CACHE_KEY, JSON.stringify(makeStudents(count)));
  localStorage.setItem(KIOSK_SETTINGS_KEY, JSON.stringify(settings));
  localStorage.setItem('hader:kiosk:bootstrap:v1', JSON.stringify({ projectUrl: import.meta.env.VITE_SUPABASE_URL || '', settings, savedAt: new Date().toISOString() }));
};
beforeEach(() => {
  localStorage.clear();
  remote.request.mockReset();
  remote.queueChange.mockReset();
  remote.queueChange.mockResolvedValue(1);
  remote.request.mockImplementation(async () => new Promise(() => {}));
});
afterEach(() => { providers.splice(0).forEach(p => p.cleanup()); vi.restoreAllMocks(); vi.useRealTimers(); });
const deadline = <T,>(operation: Promise<T>) => Promise.race([operation, new Promise<string>(resolve => setTimeout(() => resolve('blocked-on-cloud'), 150))]);

describe('kiosk offline performance and durability', () => {
  it('persists the canonical student ID when the scanner sends normalized digits', async () => {
    seed();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const p = provider();
    await p.preloadForKiosk();
    expect(await p.markAttendanceFast('١٠٠٠٠٠')).toMatchObject({ ok: true, student: { id: '100000' } });
    expect(await new LocalKioskStorage().loadQueue()).toEqual([expect.objectContaining({ student_id: '100000' })]);
  });

  it('preserves simultaneous scans and identifies a simultaneous duplicate', async () => {
    seed();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const p = provider();
    await p.preloadForKiosk();
    const results = await Promise.all([
      ...Array.from({ length: 50 }, (_, i) => p.markAttendanceFast(String(100000 + i))),
      p.markAttendanceFast('100000')
    ]);
    expect(results.filter(result => result.code === 'duplicate')).toHaveLength(1);
    expect(await new LocalKioskStorage().loadQueue()).toHaveLength(50);
    expect(await new LocalKioskStorage().loadAttendanceCache()).toHaveLength(50);
  });

  it('resolves and persists 1000 offline scans from 10000 saved students, then survives reopening', async () => {
    seed(10000);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const p = provider();
    const start = performance.now();
    expect((await p.preloadForKiosk()).studentCount).toBe(10000);
    const startupMs = performance.now() - start;
    // Allow the independent background refresh to start before counting requests.
    await p.findKioskStudent('100000');
    remote.request.mockClear();
    const timings: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const started = performance.now();
      const student = await p.findKioskStudent(String(109000 + i));
      expect(student?.id).toBe(String(109000 + i));
      expect((await p.markAttendanceFast(student!.id)).ok).toBe(true);
      timings.push(performance.now() - started);
    }
    expect(await p.findKioskStudent('unknown-barcode')).toBeNull();
    expect(remote.request).not.toHaveBeenCalled();
    const persisted = await new LocalKioskStorage().loadQueue();
    expect(persisted).toHaveLength(1000);
    expect(new Set(persisted.map(row => row.student_id)).size).toBe(1000);
    timings.sort((a, b) => a - b);
    console.info('[KIOSK_BENCH]', JSON.stringify({ students: 10000, scans: 1000, startupMs,
      p50Ms: timings[500], p95Ms: timings[950], maxMs: timings[999], totalMs: timings.reduce((sum, ms) => sum + ms, 0) }));
    // Guards against an algorithmic regression (e.g. a linear rescan of all 10000 students per
    // lookup), not against machine speed. The budget is deliberately loose because this runs
    // alongside seven other workers locally and on shared 2-core CI runners; the real numbers
    // are in the [KIOSK_BENCH] line above.
    expect(timings[950]).toBeLessThan(250);
    p.cleanup();
    const reopened = provider();
    expect((await reopened.preloadForKiosk()).ok).toBe(true);
    expect(reopened.getPendingCount()).toBe(1000);
    expect(await reopened.markAttendanceFast('109999')).toMatchObject({ ok: true, code: 'duplicate' });
    expect(await new LocalKioskStorage().loadQueue()).toHaveLength(1000);
    // 1000 sequential scans take ~1s alone but ~20s when eight workers share the CPU, so this
    // case needs more than the 5s default; the latency guard above is what asserts speed.
  }, 60_000);

  it('does not reuse a roster from another Supabase project and bounds first-start waiting', async () => {
    vi.useFakeTimers();
    seed();
    localStorage.setItem('hader:kiosk:bootstrap:v1', JSON.stringify({ projectUrl: 'https://another-school.supabase.co', settings }));
    const pending = provider().preloadForKiosk();
    await vi.advanceTimersByTimeAsync(15001);
    expect(await pending).toMatchObject({ ok: false, usedLocalSnapshot: false });
  });

  it('keeps scans local after the settings memory cache is invalidated', async () => {
    seed();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const p = provider();
    await p.preloadForKiosk();
    p.invalidateKioskSettingsCache();
    expect(await deadline(p.markAttendanceFast('100000'))).toMatchObject({ ok: true });
  });

  it('keeps a scan arriving while the older queue is being drained', async () => {
    vi.useFakeTimers();
    seed();
    const p = provider();
    await p.preloadForKiosk();
    await p.markAttendanceFast('100000');
    let finishDrain!: () => void;
    remote.queueChange.mockImplementationOnce(() => new Promise<void>(resolve => { finishDrain = resolve; }));
    await vi.advanceTimersByTimeAsync(30000);
    expect(remote.queueChange).toHaveBeenCalledTimes(1);
    await p.markAttendanceFast('100001');
    finishDrain();
    await vi.advanceTimersByTimeAsync(1);
    expect((await new LocalKioskStorage().loadQueue()).map(row => row.student_id)).toEqual(['100001']);
  });

  it('bounds cloud writes during a burst while preserving every scan locally', async () => {
    seed();
    const p = provider();
    await p.preloadForKiosk();
    for (let i = 0; i < 20; i++) expect((await p.markAttendanceFast(String(100000 + i))).ok).toBe(true);
    expect(await new LocalKioskStorage().loadQueue()).toHaveLength(20);
    expect(remote.request.mock.calls.filter(([call]) => call.write).length).toBeLessThanOrEqual(3);
  });
  it('opens the saved roster and settings while the cloud never responds', async () => {
    seed();
    const p = provider();
    const result = await deadline(p.preloadForKiosk());
    expect(result).toMatchObject({ ok: true, usedLocalSnapshot: true, studentCount: 2500, settings });
  });

  it('loads more than the server default page of students on first startup', async () => {
    const students = makeStudents(2500);
    remote.request.mockImplementation(async ({ table, from, to }) => ({ data: table === 'students' ? students.slice(from, to + 1) : table === 'settings' ? settings : [], error: null }));
    const p = provider();
    const result = await p.preloadForKiosk();
    expect(result).toMatchObject({ ok: true, studentCount: 2500 });
    expect(JSON.parse(localStorage.getItem(KIOSK_CACHE_KEY)!)).toHaveLength(2500);
  });

  it('reports a storage failure instead of acknowledging an unpersisted queue', async () => {
    const storage = new LocalKioskStorage();
    // Spy on the live localStorage object, not Storage.prototype: the test setup installs a
    // memory-backed shim that does not inherit from Storage.prototype, so a prototype spy
    // never intercepts the write and the quota failure would go unnoticed.
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await expect(storage.saveQueue([{ id: 'scan' } as any])).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await storage.loadQueue()).toEqual([]);
  });
});
