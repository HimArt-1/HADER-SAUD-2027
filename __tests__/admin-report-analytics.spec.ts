import { describe, expect, it } from 'vitest';
import { Student } from '../types';
import {
  AttendanceReportDetail,
  buildAttendanceReportData,
  getQuickReportRange,
  validateReportDateRange
} from '../components/admin/reportAnalytics';

const students: Student[] = [
  { id: 's1', name: 'أحمد', class_name: 'أول ثانوي', section: 'أ', is_active: true },
  { id: 's2', name: 'ناصر', class_name: 'أول ثانوي', section: 'أ', is_active: true },
  { id: 's3', name: 'متوقف', class_name: 'أول ثانوي', section: 'أ', is_active: false }
];

const details: AttendanceReportDetail[] = [
  { student_id: 's1', studentName: 'أحمد', className: 'أول ثانوي', date: '2026-08-20', time: '2026-08-20T06:45:00', status: 'present' },
  { student_id: 's2', studentName: 'ناصر', className: 'أول ثانوي', date: '2026-08-20', time: '2026-08-20T09:00:00', status: 'absent' },
  { student_id: 's1', studentName: 'أحمد', className: 'أول ثانوي', date: '2026-08-21', time: '2026-08-21T07:05:00', status: 'late' },
  { student_id: 's1', studentName: 'أحمد', className: 'أول ثانوي', date: '2026-08-23', time: '2026-08-23T07:05:00', status: 'late' }
];

describe('admin attendance report analytics', () => {
  it('excludes weekly and academic holidays and never counts absence as attendance', () => {
    const report = buildAttendanceReportData({
      students,
      details,
      filter: {
        date_from: '2026-08-20',
        date_to: '2026-08-23',
        status: 'all'
      },
      workDays: [0, 1, 2, 3, 4],
      holidays: [{ date: '2026-08-23', label: 'عطلة', type: 'exceptional' }]
    });

    expect(report.summary.rosterCount).toBe(2);
    expect(report.summary.calendarDays).toBe(4);
    expect(report.summary.workingDays).toBe(1);
    expect(report.summary.expectedRecords).toBe(2);
    expect(report.summary.present).toBe(1);
    expect(report.summary.late).toBe(0);
    expect(report.summary.absent).toBe(1);
    expect(report.summary.attendanceRate).toBe(50);
    expect(report.summary.holidayRecords).toBe(2);
  });

  it('uses student search for the roster scope while status filters only the visible rows', () => {
    const report = buildAttendanceReportData({
      students,
      details,
      filter: {
        date_from: '2026-08-20',
        date_to: '2026-08-20',
        search_query: 'ناصر',
        status: 'absent'
      },
      workDays: [0, 1, 2, 3, 4]
    });

    expect(report.summary.rosterCount).toBe(1);
    expect(report.summary.expectedRecords).toBe(1);
    expect(report.summary.absent).toBe(1);
    expect(report.summary.attendanceRate).toBe(0);
    expect(report.details.map(row => row.student_id)).toEqual(['s2']);
    expect(report.details[0].section).toBe('أ');
  });

  it('validates date order and creates exact inclusive quick ranges', () => {
    expect(validateReportDateRange('2026-08-24', '2026-08-23', '2026-08-23')).toBeTruthy();
    expect(validateReportDateRange('2026-08-20', '2026-08-24', '2026-08-23')).toBeTruthy();
    expect(validateReportDateRange('2026-08-20', '2026-08-23', '2026-08-23')).toBeNull();
    expect(getQuickReportRange('week', '2026-08-23')).toEqual({ date_from: '2026-08-17', date_to: '2026-08-23' });
    expect(getQuickReportRange('month', '2026-08-23')).toEqual({ date_from: '2026-07-25', date_to: '2026-08-23' });
  });
});
