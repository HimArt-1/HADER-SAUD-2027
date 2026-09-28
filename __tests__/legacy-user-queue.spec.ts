import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  localDb, getPendingSyncEntries, getPendingSyncCount, getUnsyncedTombstones,
  recordSyncTombstone, type SyncQueueEntry
} from '../services/localDb';
import { LEGACY_USER_QUEUE_CATEGORY } from '../modules/sync/userQueuePolicy';

afterEach(() => vi.restoreAllMocks());

// Exercise the real queue reader/quarantine against a mutable collection. Only
// storage I/O is substituted, so payload preservation and queue selection run normally.
const useQueue = (entries: SyncQueueEntry[]) => {
  vi.spyOn(localDb.sync_queue, 'where').mockImplementation((column: any) => ({
    equals: (value: unknown) => ({
      filter: (matches: (entry: SyncQueueEntry) => boolean) => ({
        modify: async (change: (entry: SyncQueueEntry) => void) => {
          const selected = entries.filter(entry => entry[column as keyof SyncQueueEntry] === value && matches(entry));
          selected.forEach(change);
          return selected.length;
        }
      })
    })
  }) as any);
  vi.spyOn(localDb.sync_queue, 'orderBy').mockReturnValue({ toArray: async () => structuredClone(entries) } as any);
};

describe('legacy account queue recovery', () => {
  it('retains all old account operations and original failures while other data can still sync', async () => {
    const entries: SyncQueueEntry[] = (['INSERT', 'UPDATE', 'UPSERT', 'DELETE'] as const).map((operation, index) => ({
      id: index + 1, table: 'users', operation,
      payload: operation === 'DELETE' ? 'user-old' : { id: 'user-old', username: 'old', password: 'old-hash', role: 'watcher' },
      created_at: '2026-09-01T08:00:00Z', retry_count: index,
      ...(index === 1 ? { blocked_at: '2026-09-02T08:00:00Z', last_error: 'original error', failure_category: 'max_retries' } : {})
    }));
    entries.push({ id: 5, table: 'students', operation: 'UPDATE', payload: { id: 's1' }, created_at: '2026-09-03T08:00:00Z', retry_count: 0 });
    const originals = structuredClone(entries);
    useQueue(entries);

    expect((await getPendingSyncEntries()).map(entry => entry.id)).toEqual([5]);
    expect(await getPendingSyncCount()).toBe(1);
    const review = await getPendingSyncEntries({ includeBlocked: true });
    expect(review).toHaveLength(5);
    review.slice(0, 4).forEach((entry, index) => {
      expect(entry.payload).toEqual(originals[index].payload);
      expect(entry.retry_count).toBe(originals[index].retry_count);
      expect(entry.failure_category).toBe(LEGACY_USER_QUEUE_CATEGORY);
      expect(entry.blocked_at).toBeTruthy();
      expect(entry.blocked_reason).toContain('لا تمنع');
    });
    expect(review[1]).toMatchObject({ last_error: 'original error', blocked_at: originals[1].blocked_at });
    expect(review[4]).toEqual(originals[4]);
  });

  it('excludes unconfirmed account tombstones but keeps ordinary deletions and confirmed accounts', async () => {
    const rows = [
      { table_name: 'users', record_id: 'legacy', _synced: false },
      { table_name: 'users', record_id: 'confirmed', _synced: false, _cloud_delete_confirmed: true },
      { table_name: 'students', record_id: 'student', _synced: false },
      { table_name: 'users', record_id: 'synced', _synced: true, _cloud_delete_confirmed: true }
    ];
    vi.spyOn(localDb.sync_tombstones, 'filter').mockImplementation(predicate => ({ toArray: async () => rows.filter(predicate as any) }) as any);
    expect((await getUnsyncedTombstones()).map(row => row.record_id)).toEqual(['confirmed', 'student']);
    expect(rows).toHaveLength(4);
  });

  it('records explicit confirmation separately from an offline deletion request', async () => {
    const put = vi.spyOn(localDb.sync_tombstones, 'put').mockResolvedValue('test');
    await recordSyncTombstone('users', 'old');
    expect(put).toHaveBeenLastCalledWith(expect.objectContaining({ _cloud_delete_confirmed: false }));
    await recordSyncTombstone('users', 'confirmed', '2026-09-28T00:00:00Z', false, true);
    expect(put).toHaveBeenLastCalledWith(expect.objectContaining({ _cloud_delete_confirmed: true }));
  });
});
