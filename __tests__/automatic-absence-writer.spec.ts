import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../services/supabase', () => ({ supabase: { rpc } }));
import { markCloudAutomaticAbsence } from '../services/automaticAbsenceWriter';

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('cloud automatic absence writer', () => {
  it('defers offline decisions without submitting a stale roster', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await markCloudAutomaticAbsence()).toMatchObject({ success: false, reason: 'offline' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('leaves date, cutoff and roster decisions to the server', async () => {
    const data = { success: true, completed: true, date: '2026-09-08', count: 1,
      records: [{ id: 'a1', student_id: 's1', date: '2026-09-08', status: 'absent' }] };
    rpc.mockResolvedValue({ data, error: null });
    expect(await markCloudAutomaticAbsence()).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('mark_hader_automatic_absence');
  });

  it('fails closed when the migration is missing', async () => {
    const error = new Error('function does not exist');
    rpc.mockResolvedValue({ data: null, error });
    await expect(markCloudAutomaticAbsence()).rejects.toBe(error);
  });

  it.each([null, {}, { success: true, completed: true, date: 'bad', count: 0 },
    { success: true, completed: true, date: '2026-09-08', count: -1 },
    { success: true, completed: true, date: '2026-09-08', count: 1, records: [] }
  ])('rejects malformed results: %j', async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(markCloudAutomaticAbsence()).rejects.toThrow('Invalid automatic absence response');
  });
});
