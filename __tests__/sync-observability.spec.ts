import { beforeEach, describe, expect, it } from 'vitest';
import { fetchAllFromSupabase } from '../services/dbFetchAll';
import { acquireDistributedLock } from '../services/distributedLock';
import { supabaseStatus } from '../services/supabase';

type OrderCall = { column: string; options: any };

class QueryBuilderStub {
  private readonly pages: Record<number, any[]>;
  public readonly orderCalls: OrderCall[] = [];
  public readonly rangeCalls: Array<{ from: number; to: number }> = [];

  constructor(pages: Record<number, any[]>) {
    this.pages = pages;
  }

  order(column: string, options: any) {
    this.orderCalls.push({ column, options });
    return this;
  }

  async range(from: number, to: number) {
    this.rangeCalls.push({ from, to });
    return { data: this.pages[from] || [], error: null as any };
  }
}

describe('Sync observability guards', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses deterministic ordering and exposes page telemetry', async () => {
    // Pagination only continues while a full page of `limit` rows is returned,
    // so the first simulated page must be 1000 rows to force a second request.
    const page0 = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` }));
    const pages = {
      0: page0,
      1000: [{ id: 'b1' }]
    };
    const pageEvents: Array<{ offset: number; rows: number }> = [];
    const stubInstances: QueryBuilderStub[] = [];

    const result = await fetchAllFromSupabase(
      'students',
      () => {
        const qb = new QueryBuilderStub(pages);
        stubInstances.push(qb);
        return qb as any;
      },
      { primary: 'updated_at', ascending: true },
      (page) => {
        pageEvents.push({ offset: page.offset, rows: page.rows });
      }
    );

    expect(result).toHaveLength(1001);
    expect(result[1000]).toEqual({ id: 'b1' });
    expect(stubInstances).toHaveLength(2);
    expect(stubInstances[0].rangeCalls).toEqual([{ from: 0, to: 999 }]);
    expect(stubInstances[1].rangeCalls).toEqual([{ from: 1000, to: 1999 }]);
    for (const qb of stubInstances) {
      expect(qb.orderCalls).toEqual([
        { column: 'updated_at', options: { ascending: true, nullsFirst: false } },
        { column: 'id', options: { ascending: true, nullsFirst: false } },
      ]);
    }
    expect(pageEvents).toEqual([
      { offset: 0, rows: 1000 },
      { offset: 1000, rows: 1 }
    ]);
  });

  it('prevents duplicate distributed lock acquisition in fallback mode', async () => {
    const originalConfigured = supabaseStatus.isConfigured;
    supabaseStatus.isConfigured = false;

    try {
      const first = await acquireDistributedLock('attendance:late:student-1:2026-05-05');
      const second = await acquireDistributedLock('attendance:late:student-1:2026-05-05');
      const otherKey = await acquireDistributedLock('attendance:late:student-2:2026-05-05');

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(otherKey).toBe(true);
    } finally {
      supabaseStatus.isConfigured = originalConfigured;
    }
  });
});
