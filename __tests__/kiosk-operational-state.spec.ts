import { describe, expect, it } from 'vitest';
import {
    buildKioskOperationalConfig,
    resolveKioskDayState
} from '../components/kiosk/kioskOperationalState';

describe('kiosk daily operational state', () => {
    it('builds one source of truth from system, kiosk, and attendance settings', () => {
        const config = buildKioskOperationalConfig({
            system_ready: true,
            school_active: true,
            assembly_time: '06:35',
            grace_period: 10,
            absence_time: '08:45',
            kiosk_settings: {
                assembly_time: '07:00',
                main_title: 'بوابة المدرسة'
            },
            attendance_settings: {
                work_days: [0, 1, 2, 3, 4],
                academic_holidays: [
                    { date: '2026-09-23', label: ' اليوم الوطني ', type: 'national' },
                    { date: '2026-02-30', label: 'تاريخ غير صالح', type: 'exceptional' }
                ]
            }
        });

        expect(config.kioskSettings).toMatchObject({
            main_title: 'بوابة المدرسة',
            assembly_time: '06:35',
            grace_period: 10,
            absence_time: '08:45'
        });
        expect(config.policy.workDays).toEqual([0, 1, 2, 3, 4]);
        expect(config.policy.holidays).toEqual([
            { date: '2026-09-23', label: 'اليوم الوطني', type: 'national' }
        ]);
    });

    it('opens school days and distinguishes weekly from academic holidays', () => {
        const policy = buildKioskOperationalConfig({
            attendance_settings: {
                work_days: [0, 1, 2, 3, 4],
                academic_holidays: [{ date: '2026-08-23', label: 'عطلة اختبار', type: 'exceptional' }]
            }
        }).policy;

        expect(resolveKioskDayState('2026-08-24', policy)).toMatchObject({
            allowsAttendance: true,
            kind: 'school-day'
        });
        expect(resolveKioskDayState('2026-08-28', policy)).toMatchObject({
            allowsAttendance: false,
            kind: 'weekly-off'
        });
        expect(resolveKioskDayState('2026-08-23', policy)).toMatchObject({
            allowsAttendance: false,
            kind: 'academic-holiday',
            title: 'عطلة اختبار'
        });
    });

    it('gives system readiness and school activation priority over the calendar', () => {
        const notReady = buildKioskOperationalConfig({ system_ready: false }).policy;
        const inactive = buildKioskOperationalConfig({ school_active: false }).policy;

        expect(resolveKioskDayState('2026-08-24', notReady).kind).toBe('system-not-ready');
        expect(resolveKioskDayState('2026-08-24', inactive).kind).toBe('school-inactive');
    });
});
