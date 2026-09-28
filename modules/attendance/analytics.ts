import type { AttendanceRecord, DashboardStats, Student, SystemSettings } from '../../types';
import { formatDateKey, getDateRange, isDateHoliday, resolveReportingPeriod } from '../../services/academicCalendarService';
import { getAttendanceStatusCounts, uniqueAttendanceByStudentDate } from './index';

export const activeAnalyticsStudents = (students: Student[]) => Array.from(new Map(students
  .filter(s => s.id && s.is_active !== false && (s.is_active as unknown) !== 0).map(s => [s.id, s])).values());
export const percentage = (value: number, total: number): number | null => total > 0 ? Math.round(value / total * 1000) / 10 : null;

/** The denominator is the current active roster × eligible school days.
 * Missing records stay unrecorded. A missing measurement is null, never 0%.
 * Historical enrollment cannot be reconstructed from the current roster.
 */
export function buildAttendanceAnalytics({ students, attendance, settings, startDate, endDate, today = formatDateKey(new Date()) }: {
  students: Student[]; attendance: AttendanceRecord[]; settings?: SystemSettings | null;
  startDate: string; endDate: string; today?: string;
}) {
  const roster = activeAnalyticsStudents(students);
  const ids = new Set(roster.map(s => s.id));
  const period = resolveReportingPeriod(startDate, endDate, settings?.attendance_settings, today);
  const dates = (period.isEmpty ? [] : getDateRange(period.startDate, period.endDate)).filter(date =>
    !isDateHoliday(date, settings?.attendance_settings?.work_days ?? settings?.work_days, settings?.attendance_settings?.academic_holidays ?? []));
  const dateSet = new Set(dates);
  const records = uniqueAttendanceByStudentDate(attendance.filter(r => ids.has(r.student_id) && dateSet.has(r.date)));
  const expected = roster.length * dates.length;
  const counts = getAttendanceStatusCounts(records, expected);
  const days = dates.map(date => {
    const dayCounts = getAttendanceStatusCounts(records, roster.length, { date });
    return { date, ...dayCounts, rate: dayCounts.recorded ? percentage(dayCounts.attended, roster.length) : null,
      complete: roster.length > 0 && dayCounts.recorded === roster.length };
  });
  return { period, roster, records, dates, days, ...counts, expected,
    hasData: counts.recorded > 0,
    complete: expected > 0 && counts.recorded === expected,
    attendanceRate: counts.recorded ? percentage(counts.attended, expected) : null,
    completionRate: percentage(counts.recorded, expected) };
}

export function buildDashboardSnapshot(students: Student[], attendance: AttendanceRecord[], settings: SystemSettings | null | undefined, date: string, today = formatDateKey(new Date())): DashboardStats {
  const result = buildAttendanceAnalytics({ students, attendance, settings, startDate: date, endDate: date, today });
  return { total_students: result.roster.length, present_count: result.present, late_count: result.late,
    absent_count: result.absent, unrecorded_count: result.unrecorded, recorded_count: result.recorded,
    has_data: result.hasData, attendance_rate: result.attendanceRate ?? 0 };
}
