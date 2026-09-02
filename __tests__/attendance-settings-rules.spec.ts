import { describe, expect, it } from 'vitest';
import {
    normalizeAttendanceSettings,
    normalizeWorkDays,
    validateAttendanceTiming,
    validateWorkDays
} from '../components/admin/attendanceSettingsRules';

describe('attendance settings operational rules', () => {
    it('calculates the late cutoff and requires absence after the grace window', () => {
        expect(validateAttendanceTiming({
            assembly_time: '06:45',
            grace_period: 15,
            absence_time: '09:00'
        })).toEqual({ error: null, lateCutoffTime: '07:00' });

        expect(validateAttendanceTiming({
            assembly_time: '08:45',
            grace_period: 15,
            absence_time: '09:00'
        }).error).toContain('بعد نهاية مدة السماح');
    });

    it('rejects invalid times, non-integer grace periods, and midnight crossover', () => {
        expect(validateAttendanceTiming({ assembly_time: '25:00', grace_period: 15, absence_time: '09:00' }).error).toBeTruthy();
        expect(validateAttendanceTiming({ assembly_time: '06:45', grace_period: 2.5, absence_time: '09:00' }).error).toBeTruthy();
        expect(validateAttendanceTiming({ assembly_time: '23:30', grace_period: 45, absence_time: '23:59' }).error).toContain('اليوم نفسه');
    });

    it('normalizes work days and never accepts an empty operational week', () => {
        expect(normalizeWorkDays([4, 1, 1, 9, -1, 0])).toEqual([0, 1, 4]);
        expect(validateWorkDays([])).toBeTruthy();
        expect(validateWorkDays([0, 1, 2, 3, 4])).toBeNull();
    });

    it('loads the complete cloud attendance configuration with safe fallbacks', () => {
        expect(normalizeAttendanceSettings({
            mode: 'hybrid',
            auto_mark_time: '08:30',
            unmarked_default: 'absent',
            work_days: [1, 2, 3, 4, 5]
        })).toEqual({
            mode: 'hybrid',
            auto_mark_time: '08:30',
            unmarked_default: 'absent',
            work_days: [1, 2, 3, 4, 5]
        });

        expect(normalizeAttendanceSettings({ mode: 'unknown', work_days: [] }).mode).toBe('traditional');
        expect(normalizeAttendanceSettings({ mode: 'unknown', work_days: [] }).work_days).toEqual([0, 1, 2, 3, 4]);
    });
});
