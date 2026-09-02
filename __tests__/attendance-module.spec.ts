import { describe, expect, it } from 'vitest';
import { decideAttendanceTiming } from '../modules/attendance';

const schedule = {
  assembly_time: '06:45',
  grace_period: 15,
  absence_time: '09:00',
  work_days: [0, 1, 2, 3, 4]
};

describe('attendance module timing interface', () => {
  it('keeps an arrival at the grace cutoff present', () => {
    const decision = decideAttendanceTiming({
      occurredAt: new Date(2026, 4, 17, 7, 0, 0),
      settings: schedule
    });

    expect(decision).toMatchObject({
      allowed: true,
      date: '2026-05-17',
      status: 'present',
      minutes_late: 0
    });
  });

  it('calculates late minutes from assembly time plus grace period', () => {
    const decision = decideAttendanceTiming({
      occurredAt: new Date(2026, 4, 17, 7, 20, 0),
      settings: schedule
    });

    expect(decision).toMatchObject({
      allowed: true,
      status: 'late',
      minutes_late: 20
    });
  });

  it('can classify kiosk arrivals after the absence cutoff as absent', () => {
    const decision = decideAttendanceTiming({
      occurredAt: new Date(2026, 4, 17, 9, 1, 0),
      settings: schedule,
      markAfterAbsenceAsAbsent: true
    });

    expect(decision).toMatchObject({
      allowed: true,
      status: 'absent',
      minutes_late: 121
    });
  });

  it('treats a physical arrival after the absence cutoff as late by default', () => {
    const decision = decideAttendanceTiming({
      occurredAt: new Date(2026, 4, 17, 9, 1, 0),
      settings: schedule
    });

    expect(decision).toMatchObject({
      allowed: true,
      status: 'late',
      minutes_late: 121
    });
  });

  it('blocks weekly off-days and dated academic holidays', () => {
    const offDay = decideAttendanceTiming({
      occurredAt: new Date(2026, 4, 22, 7, 0, 0),
      settings: schedule
    });
    const academicHoliday = decideAttendanceTiming({
      occurredAt: new Date(2026, 4, 17, 7, 0, 0),
      settings: schedule,
      holidays: [{ date: '2026-05-17', label: 'اختبار عطلة', type: 'exceptional' }]
    });

    expect(offDay).toEqual({ allowed: false, reason: 'holiday' });
    expect(academicHoliday).toEqual({ allowed: false, reason: 'holiday' });
  });

  it('rejects invalid timestamps without leaking invalid dates to adapters', () => {
    const decision = decideAttendanceTiming({
      occurredAt: new Date(Number.NaN),
      settings: schedule
    });

    expect(decision).toEqual({ allowed: false, reason: 'invalid-time' });
  });
});
