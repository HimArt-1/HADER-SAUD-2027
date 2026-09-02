import { describe, expect, it } from 'vitest';
import {
  analyzeAttendanceRisk,
  buildWeeklyAttendanceScorecard
} from '../modules/attendanceIntelligence';
import type { AttendanceRecord, Student } from '../types';

const student: Student = {
  id: 'student-1',
  name: 'سلمان أحمد',
  class_name: 'الأول متوسط',
  section: 'أ',
  guardian_name: 'أحمد',
  guardian_phone: '0500000000'
};

const attendanceRecord = (
  date: string,
  status: AttendanceRecord['status'],
  minutesLate = 0
): AttendanceRecord => ({
  id: `${date}-${status}`,
  student_id: student.id,
  date,
  timestamp: `${date}T07:00:00.000Z`,
  status,
  minutes_late: minutesLate
});

describe('attendance intelligence public interface', () => {
  it('classifies three consecutive absences as high risk', () => {
    const result = analyzeAttendanceRisk({
      students: [student],
      attendanceRecords: [
        attendanceRecord('2026-05-17', 'absent'),
        attendanceRecord('2026-05-18', 'absent'),
        attendanceRecord('2026-05-19', 'absent'),
        attendanceRecord('2026-05-20', 'late', 20),
        attendanceRecord('2026-05-21', 'present')
      ],
      period: { startDate: '2026-05-17', endDate: '2026-05-21' }
    });

    expect(result.profiles[0]).toMatchObject({
      studentId: student.id,
      riskLevel: 'high',
      totalDaysEvaluated: 5,
      absentDaysCount: 3,
      lateDaysCount: 1,
      totalLostMinutes: 1100,
      attendanceRate: 40,
      consecutiveAbsentDays: 3
    });
    expect(result.profiles[0].detectedPatterns).toContainEqual(
      expect.objectContaining({ type: 'consecutive_absences', severity: 'high' })
    );
    expect(result.overview).toMatchObject({
      evaluatedStudentsCount: 1,
      highRiskCount: 1,
      totalLostEducationalHours: 18.3
    });
  });

  it('deduplicates attendance, excludes holidays, and detects chronic lateness', () => {
    const sundayPresent = attendanceRecord('2026-05-17', 'present');
    const sundayLate = {
      ...attendanceRecord('2026-05-17', 'late', 12),
      id: 'sunday-late-newer',
      timestamp: '2026-05-17T08:00:00.000Z'
    };

    const result = analyzeAttendanceRisk({
      students: [student],
      attendanceRecords: [
        sundayPresent,
        sundayLate,
        attendanceRecord('2026-05-18', 'absent'),
        attendanceRecord('2026-05-19', 'late', 8),
        attendanceRecord('2026-05-20', 'late', 10)
      ],
      period: { startDate: '2026-05-17', endDate: '2026-05-20' },
      holidays: [{ date: '2026-05-18', label: 'إجازة اختبارية', type: 'exceptional' }]
    });

    expect(result.profiles[0]).toMatchObject({
      riskLevel: 'medium',
      totalDaysEvaluated: 3,
      absentDaysCount: 0,
      lateDaysCount: 3,
      totalLostMinutes: 30,
      attendanceRate: 100
    });
    expect(result.profiles[0].detectedPatterns).toContainEqual(
      expect.objectContaining({ type: 'chronic_lateness', severity: 'medium' })
    );
  });

  it('builds a weekly scorecard without treating unrecorded days as absences', () => {
    const scorecard = buildWeeklyAttendanceScorecard({
      student,
      attendanceRecords: [
        attendanceRecord('2026-05-17', 'present'),
        attendanceRecord('2026-05-18', 'late', 15),
        attendanceRecord('2026-05-19', 'absent'),
        attendanceRecord('2026-05-20', 'absent')
      ],
      weekStartDate: '2026-05-17',
      holidays: [{ date: '2026-05-19', label: 'إجازة اختبارية', type: 'exceptional' }]
    });

    expect(scorecard).toMatchObject({
      studentId: student.id,
      period: { startDate: '2026-05-17', endDate: '2026-05-23' },
      scheduledDays: 4,
      recordedDays: 3,
      unrecordedDays: 1,
      presentDays: 1,
      lateDays: 1,
      absentDays: 1,
      attendanceRate: 66.7,
      recordingCompletionRate: 75
    });
    expect(scorecard.days.map(day => [day.date, day.status])).toEqual([
      ['2026-05-17', 'present'],
      ['2026-05-18', 'late'],
      ['2026-05-20', 'absent'],
      ['2026-05-21', 'unrecorded']
    ]);
  });

  it('detects absences adjacent to the configured weekly break', () => {
    const result = analyzeAttendanceRisk({
      students: [student],
      attendanceRecords: [
        attendanceRecord('2026-05-18', 'absent'),
        attendanceRecord('2026-05-19', 'present'),
        attendanceRecord('2026-05-20', 'present'),
        attendanceRecord('2026-05-21', 'present'),
        attendanceRecord('2026-05-22', 'absent')
      ],
      period: { startDate: '2026-05-18', endDate: '2026-05-22' },
      workDays: [1, 2, 3, 4, 5]
    });

    expect(result.profiles[0].detectedPatterns).toContainEqual(
      expect.objectContaining({ type: 'weekend_proximity', severity: 'medium' })
    );
  });

  it('keeps missing attendance data unknown instead of reporting perfect attendance', () => {
    const analysis = analyzeAttendanceRisk({
      students: [student],
      attendanceRecords: [],
      period: { startDate: '2026-05-17', endDate: '2026-05-21' }
    });
    const scorecard = buildWeeklyAttendanceScorecard({
      student,
      attendanceRecords: [],
      weekStartDate: '2026-05-17'
    });

    expect(analysis.profiles[0]).toMatchObject({
      riskLevel: 'unknown',
      attendanceRate: null,
      totalDaysEvaluated: 0
    });
    expect(analysis.overview).toMatchObject({
      evaluatedStudentsCount: 0,
      unknownCount: 1,
      averageSchoolAttendanceRate: null
    });
    expect(scorecard).toMatchObject({
      recordedDays: 0,
      unrecordedDays: 5,
      attendanceRate: null,
      recordingCompletionRate: 0,
      riskLevel: 'unknown'
    });
  });
});
