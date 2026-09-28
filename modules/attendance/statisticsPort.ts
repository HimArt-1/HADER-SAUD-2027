import type { AttendanceRecord, ExitRecord, ReportFilter, Student, SystemSettings, ViolationRecord } from '../../types';
import { formatDateKey, resolveReportingPeriod } from '../../services/academicCalendarService';
import { buildAttendanceAnalytics } from './analytics';
import { buildAttendanceReportData } from './report';

type StatisticsPort = {
  getStudents(): Promise<Student[]>;
  getAttendanceRange(start: string, end: string): Promise<AttendanceRecord[]>;
  getSettings(): Promise<SystemSettings>;
};
async function loadPeriod(port: StatisticsPort, startDate: string, endDate: string) {
  const settings = await port.getSettings();
  const period = resolveReportingPeriod(startDate, endDate, settings.attendance_settings);
  const [students, attendance] = await Promise.all([port.getStudents(), period.isEmpty ? Promise.resolve([]) : port.getAttendanceRange(period.startDate, period.endDate)]);
  return { settings, students, attendance, period };
}
export async function loadWeeklyAttendanceStats(port: StatisticsPort) {
  const today = formatDateKey(new Date());
  const start = new Date(`${today}T12:00:00`); start.setDate(start.getDate() - 6);
  const startDate = formatDateKey(start);
  const data = await loadPeriod(port, startDate, today);
  return buildAttendanceAnalytics({ ...data, startDate, endDate: today, today }).days.map(day => ({ ...day,
    day: new Date(`${day.date}T12:00:00`).toLocaleDateString('ar-SA', { weekday: 'long' }), presence: day.rate }));
}
export async function loadClassAttendanceStats(port: StatisticsPort) {
  const today = formatDateKey(new Date());
  const data = await loadPeriod(port, today, today);
  return [...new Set(data.students.map(s => s.class_name))].map(name => {
    const result = buildAttendanceAnalytics({ ...data, students: data.students.filter(s => s.class_name === name), startDate: today, endDate: today, today });
    return { name, absent: result.absent, unrecorded: result.unrecorded, rate: result.attendanceRate };
  });
}
export async function loadAttendanceReport(port: StatisticsPort, filter: ReportFilter) {
  const { students, attendance, settings } = await loadPeriod(port, filter.date_from, filter.date_to);
  const byId = new Map(students.map(s => [s.id, s]));
  return buildAttendanceReportData({ students, filter, trackingDates: settings.attendance_settings,
    workDays: settings.attendance_settings?.work_days ?? settings.work_days, holidays: settings.attendance_settings?.academic_holidays,
    details: attendance.map(record => ({ ...record, time: record.timestamp, studentName: byId.get(record.student_id)?.name ?? '', className: byId.get(record.student_id)?.class_name ?? '', section: byId.get(record.student_id)?.section })) });
}
export async function loadClassProfileStats(port: StatisticsPort & {
  getExits(date?: string): Promise<ExitRecord[]>; getViolations(studentId?: string): Promise<ViolationRecord[]>;
}, className: string, section: string, startDate: string, endDate: string) {
  const data = await loadPeriod(port, startDate, endDate);
  const students = data.students.filter(s => s.class_name === className && (!section || s.section === section));
  const result = buildAttendanceAnalytics({ ...data, students, startDate, endDate });
  const [exits, violations] = result.dates.length ? await Promise.all([port.getExits(), port.getViolations()]) : [[], []];
  const ids = new Set(result.roster.map(s => s.id));
  const dates = new Set(result.dates);
  return { present: result.present, late: result.late, absent: result.absent, unrecorded: result.unrecorded,
    exits: exits.filter(e => ids.has(e.student_id) && dates.has(formatDateKey(new Date(e.exit_time)))).length,
    violations: violations.filter(v => ids.has(v.student_id) && dates.has(formatDateKey(new Date(v.created_at)))).length,
    totalStudents: result.roster.length, days: result.dates.length };
}
