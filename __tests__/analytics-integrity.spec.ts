import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceRecord, Student, SystemSettings } from '../types';
import { buildAttendanceAnalytics, buildDashboardSnapshot } from '../modules/attendance/analytics';
import { buildAttendanceReportData, validateReportDateRange } from '../modules/attendance/report';
import { loadAttendanceReport, loadClassProfileStats, loadWeeklyAttendanceStats } from '../modules/attendance/statisticsPort';
import { analyzeAttendanceRisk } from '../modules/attendanceIntelligence';
import { readAllPages } from '../services/paginatedRead';
import { summarizeRateSeries } from '../components/admin/dashboardAnalytics';

const today = '2026-09-28'; // Monday; Sep 25/26 are the weekend.
const settings: SystemSettings = { attendance_settings: {
  academic_year_start_date: '2026-08-23', tracking_start_date: '2026-09-23', work_days: [0, 1, 2, 3, 4],
  academic_holidays: [{ date: '2026-09-23', label: 'عطلة', type: 'national' }]
} };
const students: Student[] = [
  { id: 'a', name: 'أحمد', class_name: 'الأول', section: 'أ' },
  { id: 'b', name: 'بدر', class_name: 'الأول', section: 'أ' },
  { id: 'inactive', name: 'غير نشط', class_name: 'الأول', section: 'أ', is_active: false },
  { id: 'inactive-zero', name: 'غير نشط قديم', class_name: 'الأول', section: 'أ', is_active: 0 as unknown as boolean }
];
const record = (id: string, date: string, status: AttendanceRecord['status'], time = '07:00'): AttendanceRecord => ({
  id: `${id}-${date}-${time}`, student_id: id, date, status, timestamp: `${date}T${time}:00`, minutes_late: 0, created_at: `${date}T${time}:00`
});
const attendance = [
  record('a', '2026-09-22', 'absent'), // before operation
  record('a', '2026-09-23', 'absent'), // academic holiday
  record('a', '2026-09-24', 'present'), record('b', '2026-09-24', 'absent'),
  record('a', '2026-09-25', 'absent'), // weekend
  record('a', '2026-09-27', 'absent'), record('a', '2026-09-27', 'late', '08:00'),
  record('b', '2026-09-27', 'present'),
  record('a', today, 'present'), // b is unrecorded, NOT absent
  record('a', '2026-09-29', 'absent'), // future
  record('inactive', today, 'present'), record('inactive-zero', today, 'present'), record('deleted', today, 'present')
];
const input = { students, attendance, settings, startDate: '2026-09-01', endDate: '2026-09-30', today };
afterEach(() => vi.useRealTimers());

describe('analytics integrity against hand-calculated totals', () => {
  it('uses three eligible days, two active students and five unique records', () => {
    const result = buildAttendanceAnalytics(input);
    expect(result.dates).toEqual(['2026-09-24', '2026-09-27', '2026-09-28']);
    expect(result).toMatchObject({ expected: 6, present: 3, late: 1, absent: 1, attended: 4, recorded: 5, unrecorded: 1,
      attendanceRate: 66.7, completionRate: 83.3, complete: false });
    expect(result.days.map(day => [day.date, day.rate, day.unrecorded])).toEqual([
      ['2026-09-24', 50, 0], ['2026-09-27', 100, 0], ['2026-09-28', 50, 1]
    ]);
  });
  it('deduplicates the roster so repeated students cannot inflate denominators', () => {
    expect(buildAttendanceAnalytics({ ...input, students: [...students, students[0]] })).toMatchObject({ expected: 6, attendanceRate: 66.7 });
  });
  it('produces identical totals regardless of row order', () => {
    expect(buildAttendanceAnalytics({ ...input, attendance: [...attendance].reverse() })).toMatchObject({ present: 3, late: 1, absent: 1, recorded: 5 });
  });
  it('does not count the days before midyear adoption, or after today', () => {
    const result = buildAttendanceAnalytics({ ...input, settings: { attendance_settings: { ...settings.attendance_settings, tracking_start_date: today } } });
    expect(result).toMatchObject({ expected: 2, recorded: 1, unrecorded: 1, absent: 0, attendanceRate: 50 });
    expect(result.dates).toEqual([today]);
  });
  it('uses the later academic year boundary when Hader was operating earlier', () => {
    const result = buildAttendanceAnalytics({ ...input, settings: { attendance_settings: { ...settings.attendance_settings, academic_year_start_date: today } } });
    expect(result.dates).toEqual([today]);
  });
  it.each([{}, { tracking_start_date: '2026-02-30' }, { academic_year_start_date: '2026-08-23' }, { tracking_start_date: '2026-10-01' }])('withholds measurements without a valid elapsed operating period: %j', dates => {
    const result = buildAttendanceAnalytics({ ...input, settings: { attendance_settings: dates } });
    expect(result).toMatchObject({ expected: 0, recorded: 0, unrecorded: 0, absent: 0, attendanceRate: null, hasData: false });
  });
  it('distinguishes no records from explicitly recorded zero attendance', () => {
    expect(buildAttendanceAnalytics({ ...input, attendance: [] })).toMatchObject({ absent: 0, unrecorded: 6, attendanceRate: null });
    const result = buildAttendanceAnalytics({ ...input, startDate: today, attendance: [record('a', today, 'absent'), record('b', today, 'absent')] });
    expect(result).toMatchObject({ absent: 2, unrecorded: 0, attendanceRate: 0, complete: true });
  });
  it('keeps an unrecorded day as a chart gap', () => {
    const result = buildAttendanceAnalytics({ ...input, attendance: attendance.filter(r => r.date !== today) });
    expect(result.days.at(-1)).toMatchObject({ date: today, rate: null, absent: 0, unrecorded: 2 });
  });
  it('applies the same policy to daily provider statistics and holiday counts', () => {
    expect(buildDashboardSnapshot(students, attendance, settings, today, today)).toMatchObject({ total_students: 2, present_count: 1, absent_count: 0, unrecorded_count: 1, attendance_rate: 50 });
    expect(buildDashboardSnapshot(students, attendance, settings, '2026-09-23', today)).toMatchObject({ present_count: 0, absent_count: 0, unrecorded_count: 0, has_data: false });
  });
  it('keeps report summaries and charts in agreement, including reversed duplicate rows', () => {
    const result = buildAttendanceReportData({ students, details: [...attendance].reverse().map(r => ({ ...r, time: r.timestamp, studentName: '', className: '' })),
      filter: { date_from: input.startDate, date_to: input.endDate, status: 'absent' }, trackingDates: settings.attendance_settings,
      holidays: settings.attendance_settings?.academic_holidays, today });
    expect(result.summary).toMatchObject({ present: 3, late: 1, absent: 1, expectedRecords: 6, recordedRecords: 5, unrecorded: 1, attendanceRate: 66.7 });
    expect(result.details.filter(row => !row.isHoliday)).toHaveLength(1);
  });
  it('rejects impossible dates instead of silently rolling them into March', () => {
    expect(validateReportDateRange('2026-02-30', '2026-03-02', today)).toBeTruthy();
  });
  it('does not invent a change from one measurement or zero measurements', () => {
    expect(summarizeRateSeries([], (point: { rate: number }) => point.rate)).toMatchObject({ average: null, change: null });
    expect(summarizeRateSeries([{ rate: 50 }], point => point.rate)).toMatchObject({ average: 50, change: null });
  });
  it('withholds risk classification for missing dates and never evaluates before operation', () => {
    const partial = analyzeAttendanceRisk({ students: [students[1]], attendanceRecords: attendance, period: { startDate: input.startDate, endDate: today }, trackingDates: settings.attendance_settings, holidays: settings.attendance_settings?.academic_holidays, today });
    expect(partial.profiles[0]).toMatchObject({ riskLevel: 'unknown', totalDaysEvaluated: 2, absentDaysCount: 1 });
    expect(analyzeAttendanceRisk({ students, attendanceRecords: attendance, period: { startDate: input.startDate, endDate: today }, today }).profiles.every(p => p.totalDaysEvaluated === 0)).toBe(true);
  });
});

describe('shared provider statistics', () => {
  const port = () => ({ getStudents: vi.fn(async () => students), getSettings: vi.fn(async () => settings), getAttendanceRange: vi.fn(async () => attendance),
    getExits: vi.fn(async () => [{ id: 'exit-old', student_id: 'a', exit_time: '2026-09-22T10:00:00' }, { id: 'exit', student_id: 'b', exit_time: `${today}T10:00:00` }]),
    getViolations: vi.fn(async () => [{ id: 'violation', student_id: 'a', created_at: '2026-09-24T10:00:00', level: 5 }]) });
  it('clamps queries and supplies factual class incident totals', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${today}T12:00:00`));
    const source = port();
    const report = await loadAttendanceReport(source, { date_from: input.startDate, date_to: input.endDate });
    expect(source.getAttendanceRange).toHaveBeenCalledWith('2026-09-23', today);
    expect(report.summary).toMatchObject({ absent: 1, present: 3, late: 1, unrecorded: 1 });
    expect(await loadClassProfileStats(source, 'الأول', 'أ', input.startDate, input.endDate)).toMatchObject({ days: 3, totalStudents: 2, exits: 1, violations: 1, unrecorded: 1, absent: 1 });
    expect((await loadWeeklyAttendanceStats(source)).map(day => day.date)).toEqual(['2026-09-24', '2026-09-27', today]);
  });
  it('does not query attendance outside the operating period', async () => {
    const source = port();
    await loadAttendanceReport(source, { date_from: '2026-08-01', date_to: '2026-08-31' });
    expect(source.getAttendanceRange).not.toHaveBeenCalled();
  });
});

describe('complete paginated reads', () => {
  it('includes records beyond the server page limit', async () => {
    const source = Array.from({ length: 2301 }, (_, id) => ({ id }));
    const fetch = vi.fn(async (from: number, to: number) => ({ data: source.slice(from, to + 1), error: null }));
    expect(await readAllPages(fetch)).toHaveLength(2301);
    expect(fetch.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('rejects a failed later page instead of returning misleading partial totals', async () => {
    const error = new Error('connection lost');
    await expect(readAllPages(async from => from ? { data: null, error } : { data: [{ id: 1 }], error: null }, 1)).rejects.toBe(error);
  });
});
