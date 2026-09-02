import { describe, expect, it } from 'vitest';
import type { AttendanceRecord } from '../types';
import {
  getAttendanceForDate,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate,
  upsertAttendanceRecord
} from '../modules/attendance';

const record = (overrides: Partial<AttendanceRecord>): AttendanceRecord => ({
  id: 'record-1',
  student_id: 'student-1',
  date: '2026-05-16',
  timestamp: '2026-05-16T06:50:00.000Z',
  status: 'late',
  minutes_late: 5,
  ...overrides
});

describe('attendance dedupe utilities', () => {
  it('keeps one latest attendance state per student and date', () => {
    const rows = [
      record({ id: 'old', timestamp: '2026-05-16T06:45:00.000Z', status: 'present', minutes_late: 0 }),
      record({ id: 'new', timestamp: '2026-05-16T07:05:00.000Z', status: 'late', minutes_late: 20 }),
      record({ id: 'other-student', student_id: 'student-2', status: 'late' })
    ];

    const unique = getAttendanceForDate(rows, '2026-05-16');

    expect(unique).toHaveLength(2);
    expect(unique.find(row => row.student_id === 'student-1')?.id).toBe('new');
  });

  it('counts duplicated late rows once in dashboard-style totals', () => {
    const rows = [
      record({ id: 'student-1-a', student_id: 'student-1', status: 'late' }),
      record({ id: 'student-1-b', student_id: 'student-1', status: 'late', timestamp: '2026-05-16T07:00:00.000Z' }),
      record({ id: 'student-2-a', student_id: 'student-2', status: 'late' }),
      record({ id: 'student-2-b', student_id: 'student-2', status: 'late', timestamp: '2026-05-16T07:01:00.000Z' })
    ];

    const counts = getAttendanceStatusCounts(rows, 10, { date: '2026-05-16' });

    expect(counts.late).toBe(2);
    expect(counts.attended).toBe(2);
    expect(counts.absent).toBe(8);
  });

  it('uses sync update metadata when a manual status edit is newer', () => {
    const rows = [
      record({ id: 'scan', status: 'late', _updated_at: '2026-05-16T07:00:00.000Z' }),
      record({ id: 'manual-edit', status: 'present', minutes_late: 0, _updated_at: '2026-05-16T07:05:00.000Z' })
    ];

    const unique = uniqueAttendanceByStudentDate(rows);

    expect(unique).toHaveLength(1);
    expect(unique[0].id).toBe('manual-edit');
    expect(unique[0].status).toBe('present');
  });

  it('upserts realtime records by student and date instead of appending duplicates', () => {
    const existing = [
      record({ id: 'old', status: 'present', timestamp: '2026-05-16T06:45:00.000Z' })
    ];
    const next = record({ id: 'new', status: 'late', timestamp: '2026-05-16T07:10:00.000Z' });

    const rows = upsertAttendanceRecord(existing, next);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('new');
    expect(rows[0].status).toBe('late');
  });
});
