import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, Student } from '../types';
import { getEffectiveTrackingStart, isWithinTrackingPeriod, resolveReportingPeriod } from '../services/academicCalendarService';
import { normalizeAttendanceSettings } from '../components/admin/attendanceSettingsRules';
import { buildAttendanceReportData } from '../components/admin/reportAnalytics';
import { buildDisciplineAnalytics } from '../components/dashboard/disciplineAnalytics';
import { analyzeAttendanceRisk, buildWeeklyAttendanceScorecard } from '../modules/attendanceIntelligence';
import { createInMemorySettingsPort, createSettingsModule } from '../modules/settings';

const dates = { academic_year_start_date: '2026-08-23', tracking_start_date: '2026-08-25' };
const student: Student = { id: 's1', name: 'أحمد', class_name: 'الأول', section: 'أ' };
const record = (date: string, status: AttendanceRecord['status']): AttendanceRecord => ({
    id: date, student_id: 's1', date, status, timestamp: `${date}T07:00:00`
});

describe('academic tracking period', () => {
    it('starts at the later date, including when Hader predates the current academic year', () => {
        expect(getEffectiveTrackingStart(dates)).toBe('2026-08-25');
        expect(getEffectiveTrackingStart({ ...dates, tracking_start_date: '2025-09-01' })).toBe('2026-08-23');
        expect(getEffectiveTrackingStart({ tracking_start_date: '2026-08-25' })).toBe('2026-08-25');
        expect(getEffectiveTrackingStart({})).toBeNull();
        expect(getEffectiveTrackingStart({ academic_year_start_date: '2026-02-30' })).toBeNull();
    });

    it('intersects ranges inclusively and rejects periods before tracking or in the future', () => {
        expect(resolveReportingPeriod('2026-08-01', '2026-08-31', dates, '2026-08-26')).toEqual({
            startDate: '2026-08-25', endDate: '2026-08-26', isEmpty: false, wasClamped: true
        });
        expect(resolveReportingPeriod('2026-08-01', '2026-08-24', dates, '2026-08-26').isEmpty).toBe(true);
        expect(resolveReportingPeriod('2026-09-01', '2026-09-03', dates, '2026-08-26').isEmpty).toBe(true);
        expect(isWithinTrackingPeriod('2026-08-24', dates, '2026-08-26')).toBe(false);
        expect(isWithinTrackingPeriod('2026-08-25', dates, '2026-08-26')).toBe(true);
        expect(isWithinTrackingPeriod('2026-08-27', dates, '2026-08-26')).toBe(false);
    });

    it('keeps an existing range when dates have not been configured instead of guessing a start', () => {
        expect(resolveReportingPeriod('2025-12-28', '2026-01-04', {}, '2026-01-04')).toMatchObject({
            startDate: '2025-12-28', endDate: '2026-01-04', isEmpty: false, wasClamped: false
        });
    });

    it('persists dates alongside holidays and work settings across subsequent settings saves', async () => {
        const holidays = [{ date: '2026-09-23', label: 'اليوم الوطني', type: 'national' as const }];
        const port = createInMemorySettingsPort({ attendance_settings: { academic_holidays: holidays, work_days: [0, 1, 2, 3, 4] } });
        const module = createSettingsModule(port);
        await module.execute({ type: 'patch', changes: { attendance_settings: dates } });
        await module.execute({ type: 'patch', changes: { attendance_settings: { auto_mark_time: '09:00' } } });
        const reloaded = await createSettingsModule(port).load();
        expect(reloaded.attendance_settings).toMatchObject({ ...dates, academic_holidays: holidays, auto_mark_time: '09:00', work_days: [0, 1, 2, 3, 4] });
        expect(normalizeAttendanceSettings(reloaded.attendance_settings)).toMatchObject(dates);
    });

    it('uses only eligible days in report denominators and keeps missing days distinct from absences', () => {
        const attendance = [record('2026-08-24', 'absent'), record('2026-08-25', 'present'), record('2026-08-26', 'absent'), record('2026-08-30', 'absent')];
        const report = buildAttendanceReportData({
            students: [student],
            details: attendance.map(row => ({ student_id: row.student_id, studentName: student.name, className: student.class_name, date: row.date, time: row.timestamp!, status: row.status })),
            filter: { date_from: '2026-08-01', date_to: '2026-08-31' },
            trackingDates: dates,
            holidays: [{ date: '2026-08-26', label: 'عطلة', type: 'exceptional' }],
            today: '2026-08-27'
        });
        expect(report.summary).toMatchObject({ calendarDays: 3, workingDays: 2, expectedRecords: 2, recordedRecords: 1, present: 1, absent: 0, unrecorded: 1, attendanceRate: 50, holidayRecords: 1 });
        expect(report.details.map(row => row.date)).toEqual(['2026-08-26', '2026-08-25']);
    });

    it('does not penalize a school for the 29 days before it started using Hader', () => {
        const result = buildDisciplineAnalytics({
            students: [student], attendance: [record('2026-08-24', 'absent'), record('2026-08-25', 'present')],
            violations: [], exits: [], settings: { attendance_settings: dates }, today: '2026-08-25'
        });
        expect(result).toMatchObject({ hasData: true, totalDays: 1, expectedRecords: 1, recordedRecords: 1, attendanceRate: 100, absenceRate: 0, disciplineIndex: 100 });
    });

    it('returns no evaluated days for a future start instead of substituting a 30-day denominator', () => {
        const result = buildDisciplineAnalytics({
            students: [student], attendance: [record('2026-08-24', 'absent')], violations: [], exits: [],
            settings: { attendance_settings: dates }, today: '2026-08-24'
        });
        expect(result).toMatchObject({ hasData: false, totalDays: 0, expectedRecords: 0, recordedRecords: 0 });
    });

    it('applies tracking boundaries to risk analysis and incomplete current-week scorecards', () => {
        const records = [record('2026-08-23', 'absent'), record('2026-08-24', 'absent'), record('2026-08-25', 'present'), record('2026-08-27', 'absent')];
        const analysis = analyzeAttendanceRisk({ students: [student], attendanceRecords: records,
            period: { startDate: '2026-08-23', endDate: '2026-08-29' }, trackingDates: dates, today: '2026-08-26' });
        expect(analysis.profiles[0]).toMatchObject({ absentDaysCount: 0, totalDaysEvaluated: 1, attendanceRate: 100 });
        const scorecard = buildWeeklyAttendanceScorecard({ student, attendanceRecords: records, weekStartDate: '2026-08-23', trackingDates: dates, today: '2026-08-26' });
        expect(scorecard).toMatchObject({ scheduledDays: 2, recordedDays: 1, unrecordedDays: 1, absentDays: 0, recordingCompletionRate: 50 });
        expect(scorecard.days.map(day => day.date)).toEqual(['2026-08-25', '2026-08-26']);
    });
});
