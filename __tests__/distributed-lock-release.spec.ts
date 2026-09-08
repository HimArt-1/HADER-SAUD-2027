import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => ({
  from: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), remove: vi.fn(),
  supabaseStatus: { isConfigured: true }
}));
vi.mock('../services/supabase', () => ({ supabase: { from: cloud.from }, supabaseStatus: cloud.supabaseStatus }));
import { acquireDistributedLock, releaseDistributedLock } from '../services/distributedLock';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  cloud.supabaseStatus.isConfigured = true;
  cloud.maybeSingle.mockResolvedValue({ data: null, error: null });
  cloud.insert.mockResolvedValue({ error: null });
  cloud.remove.mockResolvedValue({ error: null });
  cloud.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: cloud.maybeSingle }) }),
    insert: cloud.insert,
    delete: () => ({ eq: (column: string, id: string) => ({ eq: (actionColumn: string, action: string) => cloud.remove(column, id, actionColumn, action) }) })
  }));
});

describe('releasing unfinished distributed operations', () => {
  it('releases only its acquired cloud lock using the same row id and lock action', async () => {
    await acquireDistributedLock('audit:cloud-release');
    const row = cloud.insert.mock.calls[0][0];
    await releaseDistributedLock('audit:cloud-release');
    expect(cloud.remove).toHaveBeenCalledWith('id', row.id, 'action', 'distributed_lock');
  });

  it('never releases a lock held by another client', async () => {
    cloud.maybeSingle.mockResolvedValue({ data: { id: 'other' }, error: null });
    expect(await acquireDistributedLock('audit:other-client')).toBe(false);
    await releaseDistributedLock('audit:other-client');
    expect(cloud.remove).not.toHaveBeenCalled();
  });

  it('retries a failed cloud release before reacquiring on the next check', async () => {
    await acquireDistributedLock('audit:retry-release');
    cloud.remove.mockResolvedValueOnce({ error: { message: 'temporary network failure' } });
    await releaseDistributedLock('audit:retry-release');
    expect(await acquireDistributedLock('audit:retry-release')).toBe(true);
    expect(cloud.remove).toHaveBeenCalledTimes(2);
    expect(cloud.insert).toHaveBeenCalledTimes(2);
  });

  it('releases a local fallback locally even after the cloud becomes available', async () => {
    cloud.supabaseStatus.isConfigured = false;
    await acquireDistributedLock('audit:offline');
    cloud.supabaseStatus.isConfigured = true;
    await releaseDistributedLock('audit:offline');
    expect(localStorage.getItem('hader:distributed-lock:audit:offline')).toBeNull();
    expect(cloud.remove).not.toHaveBeenCalled();
  });
});
