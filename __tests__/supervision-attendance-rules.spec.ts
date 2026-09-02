import { describe, expect, it } from 'vitest';
import type { AttendanceRecord } from '../types';
import {
    buildSupervisorAttendanceIndex,
    getSupervisorAttendanceStatus,
    resolveSupervisorDayState,
    summarizeSupervisorAttendance
} from '../components/supervision/supervisionAttendanceRules';

const record = (
    studentId: string,
    date: string,
    status: AttendanceRecord['status'],
    timestamp: string
): AttendanceRecord => ({
    id: `${studentId}-${date}-${status}`,
    student_id: studentId,
    date,
    status,
    timestamp,
    minutes_late: status === 'late' ? 5 : 0
});

describe('supervision attendance rules', () => {
    it('indexes only the selected day and keeps the latest student record', () => {
        const index = buildSupervisorAttendanceIndex([
            record('s1', '2026-08-22', 'absent', '2026-08-22T07:00:00.000Z'),
            record('s1', '2026-08-23', 'present', '2026-08-23T07:00:00.000Z'),
            record('s1', '2026-08-23', 'late', '2026-08-23T07:30:00.000Z')
        ], '2026-08-23');

        expect(index.size).toBe(1);
        expect(index.get('s1')?.status).toBe('late');
    });

    it('distinguishes an explicit absence from an unrecorded student', () => {
        const index = buildSupervisorAttendanceIndex([
            record('s1', '2026-08-23', 'present', '2026-08-23T07:00:00.000Z'),
            record('s2', '2026-08-23', 'late', '2026-08-23T07:30:00.000Z'),
            record('s3', '2026-08-23', 'absent', '2026-08-23T08:00:00.000Z')
        ], '2026-08-23');

        expect(getSupervisorAttendanceStatus('s3', index)).toBe('absent');
        expect(getSupervisorAttendanceStatus('s4', index)).toBe('unrecorded');
        expect(summarizeSupervisorAttendance(['s1', 's2', 's3', 's4'], index)).toEqual({
            total: 4,
            recorded: 3,
            present: 1,
            late: 1,
            absent: 1,
            unrecorded: 1,
            attended: 2,
            attendanceRate: 50,
            completionRate: 75
        });
    });

    it('blocks future dates, holidays, and inactive schools', () => {
        const settings = {
            attendance_settings: {
                work_days: [0, 1, 2, 3, 4],
                academic_holidays: [
                    { date: '2026-08-24', label: 'إجازة اختبار', type: 'exceptional' as const }
                ]
            }
        };

        expect(resolveSupervisorDayState('2026-08-26', settings, '2026-08-25').kind).toBe('future-date');
        expect(resolveSupervisorDayState('2026-08-24', settings, '2026-08-25')).toMatchObject({
            allowsEdits: false,
            kind: 'academic-holiday',
            title: 'إجازة اختبار'
        });
        expect(resolveSupervisorDayState('2026-08-25', { school_active: false }, '2026-08-25').kind).toBe('school-inactive');
        expect(resolveSupervisorDayState('2026-08-25', settings, '2026-08-25').allowsEdits).toBe(true);
    });
});
