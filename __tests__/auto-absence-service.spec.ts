import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  getSettings: vi.fn(), getStudents: vi.fn(), getAttendance: vi.fn(), bulkMarkAbsent: vi.fn(), notifyAutomaticAbsences: vi.fn()
}));
vi.mock('../services/db', () => ({ db, getLocalISODate: () => '2026-09-07' }));
const cloud = vi.hoisted(() => ({ isConfigured: false, write: vi.fn() }));
vi.mock('../services/supabase', () => ({ supabase: {}, supabaseStatus: cloud }));
vi.mock('../services/automaticAbsenceWriter', () => ({ markCloudAutomaticAbsence: cloud.write }));
import { autoAbsenceService } from '../services/autoAbsenceService';

const lastRunKey = 'hader:auto_absence:last_run';
const lockKey = 'hader:distributed-lock:auto-absence:2026-09-07';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T10:00:00'));
  localStorage.clear();
  vi.resetAllMocks();
  cloud.isConfigured = false;
  db.notifyAutomaticAbsences.mockResolvedValue(undefined);
  db.getSettings.mockResolvedValue({ absence_time: '09:00', work_days: [0, 1, 2, 3, 4] });
  db.getStudents.mockResolvedValue([{ id: 'active', is_active: true }]);
  db.getAttendance.mockResolvedValue([]);
  db.bulkMarkAbsent.mockResolvedValue({ success: true, count: 1 });
});

afterEach(() => {
  autoAbsenceService.stop();
  vi.useRealTimers();
});

describe('automatic absence processing', () => {
  it('recovers after a prior browser crashed while holding the old persistent lock', async () => {
    localStorage.setItem(lockKey, '1');
    await autoAbsenceService.forceRun();
    expect(db.bulkMarkAbsent).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(lastRunKey)).toBe('2026-09-07');
  });

  it('marks only active students without attendance', async () => {
    db.getStudents.mockResolvedValue([
      { id: 'active', is_active: true }, { id: 'legacy' },
      { id: 'disabled', is_active: false }, { id: 'sqlite-disabled', is_active: 0 },
      { id: 'present', is_active: true }
    ]);
    db.getAttendance.mockResolvedValue([{ student_id: 'present' }]);
    await autoAbsenceService.forceRun();
    expect(db.bulkMarkAbsent).toHaveBeenCalledWith({ student_ids: ['active', 'legacy'], date: '2026-09-07', only_unmarked: true });
  });

  it.each(['failure', 'exception', 'empty roster'])('retries after %s without locking out the rest of the day', async failure => {
    if (failure === 'failure') db.bulkMarkAbsent.mockResolvedValueOnce({ success: false, count: 0 });
    if (failure === 'exception') db.bulkMarkAbsent.mockRejectedValueOnce(new Error('offline'));
    if (failure === 'empty roster') db.getStudents.mockResolvedValueOnce([]);
    autoAbsenceService.init();
    await vi.advanceTimersByTimeAsync(5000);
    expect(localStorage.getItem(lastRunKey)).toBeNull();
    expect(localStorage.getItem(lockKey)).toBeNull();
    await vi.advanceTimersByTimeAsync(60000);
    expect(db.bulkMarkAbsent).toHaveBeenLastCalledWith({ student_ids: ['active'], date: '2026-09-07', only_unmarked: true });
    expect(localStorage.getItem(lastRunKey)).toBe('2026-09-07');
  });

  it('does not repeat a completed local run on the next timer tick', async () => {
    autoAbsenceService.init();
    await vi.advanceTimersByTimeAsync(65000);
    expect(db.bulkMarkAbsent).toHaveBeenCalledTimes(1);
  });

  it.each(['school_active', 'system_ready'])('does not run locally when %s is false', async setting => {
    db.getSettings.mockResolvedValue({ absence_time: '00:00', [setting]: false });
    await autoAbsenceService.forceRun();
    expect(db.bulkMarkAbsent).not.toHaveBeenCalled();
    expect(localStorage.getItem(lastRunKey)).toBeNull();
  });

  it.each(['busy', 'offline', 'error'])('retries cloud %s without a local write or completion marker', async reason => {
    cloud.isConfigured = true;
    if (reason === 'error') cloud.write.mockRejectedValueOnce(new Error('RPC unavailable'));
    else cloud.write.mockResolvedValueOnce({ success: false, completed: false, count: 0, reason });
    cloud.write.mockResolvedValue({ success: true, completed: true, count: 0, date: '2026-09-08' });
    autoAbsenceService.init();
    await vi.advanceTimersByTimeAsync(5000);
    expect(localStorage.getItem(lastRunKey)).toBeNull();
    expect(db.bulkMarkAbsent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(cloud.write).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(lastRunKey)).toBe('2026-09-08');
    expect(db.getStudents).not.toHaveBeenCalled();
    expect(db.getSettings).not.toHaveBeenCalled();
  });

  it('uses server results despite stale browser locks and notifies only newly inserted records', async () => {
    cloud.isConfigured = true;
    localStorage.setItem(lockKey, '1');
    localStorage.setItem(lastRunKey, '2026-09-07');
    const records = [{ id: 'a1', student_id: 'active', date: '2026-09-08', status: 'absent' }];
    cloud.write.mockResolvedValueOnce({ success: true, completed: true, count: 1, date: '2026-09-08', records });
    cloud.write.mockResolvedValue({ success: true, completed: true, count: 0, date: '2026-09-08', records: [] });
    autoAbsenceService.init();
    await vi.advanceTimersByTimeAsync(65000);
    expect(cloud.write).toHaveBeenCalledTimes(2);
    expect(db.bulkMarkAbsent).not.toHaveBeenCalled();
    expect(db.notifyAutomaticAbsences).toHaveBeenCalledExactlyOnceWith(records);
    expect(localStorage.getItem(lastRunKey)).toBe('2026-09-08');
  });

  it('does not overlap checks while settings are still loading', async () => {
    let resolveSettings!: (settings: object) => void;
    db.getSettings.mockImplementationOnce(() => new Promise(resolve => { resolveSettings = resolve; }));
    const first = autoAbsenceService.forceRun();
    const second = autoAbsenceService.forceRun();
    resolveSettings({ absence_time: '09:00', work_days: [1] });
    await Promise.all([first, second]);
    expect(db.getSettings).toHaveBeenCalledTimes(1);
    expect(db.bulkMarkAbsent).toHaveBeenCalledTimes(1);
  });
});
