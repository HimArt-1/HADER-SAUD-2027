import type { AcademicHoliday, AttendanceRecord } from '../../types';
import { ATTENDANCE_DEFAULTS } from '../../types';
import { formatDateKey, isDateHoliday } from '../../services/academicCalendarService';

export type AttendanceSchedule = {
  assembly_time?: string;
  grace_period?: number;
  absence_time?: string;
  work_days?: number[];
};

export type AttendanceTimingDecision =
  | { allowed: false; reason: 'invalid-time' | 'holiday' }
  | {
      allowed: true;
      date: string;
      timestamp: string;
      status: AttendanceRecord['status'];
      minutes_late: number;
    };

type AttendanceTimingInput = {
  occurredAt: Date;
  settings?: AttendanceSchedule;
  holidays?: readonly AcademicHoliday[];
  markAfterAbsenceAsAbsent?: boolean;
};

type AttendanceRecordWithMeta = AttendanceRecord & {
  _updated_at?: string | null;
  updated_at?: string | null;
  synced_at?: string | null;
};

type AttendanceCounts = {
  present: number;
  late: number;
  absent: number;
  attended: number;
  total: number;
};

const STATUS_RANK: Record<AttendanceRecord['status'], number> = {
  absent: 0,
  present: 1,
  late: 2
};

const parseClock = (value: string | undefined, fallback: string): [number, number] => {
  const [rawHours, rawMinutes] = String(value || fallback).split(':').map(Number);
  const hours = Number.isInteger(rawHours) && rawHours >= 0 && rawHours <= 23
    ? rawHours
    : Number(fallback.split(':')[0]);
  const minutes = Number.isInteger(rawMinutes) && rawMinutes >= 0 && rawMinutes <= 59
    ? rawMinutes
    : Number(fallback.split(':')[1]);
  return [hours, minutes];
};

const buildCutoff = (occurredAt: Date, clock: string | undefined, fallback: string): Date => {
  const [hours, minutes] = parseClock(clock, fallback);
  const cutoff = new Date(occurredAt);
  cutoff.setHours(hours, minutes, 0, 0);
  return cutoff;
};

/**
 * The attendance timing interface. It owns schedule validation, holiday rules,
 * late calculation and the optional kiosk absence cutoff.
 */
export const decideAttendanceTiming = ({
  occurredAt,
  settings,
  holidays = [],
  markAfterAbsenceAsAbsent = false
}: AttendanceTimingInput): AttendanceTimingDecision => {
  if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) {
    return { allowed: false, reason: 'invalid-time' };
  }

  const date = formatDateKey(occurredAt);
  const workDays = settings?.work_days ?? [...ATTENDANCE_DEFAULTS.WORK_DAYS];
  if (isDateHoliday(date, workDays, [...holidays])) {
    return { allowed: false, reason: 'holiday' };
  }

  const arrivalCutoff = buildCutoff(
    occurredAt,
    settings?.assembly_time,
    ATTENDANCE_DEFAULTS.ASSEMBLY_TIME
  );
  const configuredGrace = Number(settings?.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD);
  const gracePeriod = Number.isFinite(configuredGrace) ? Math.max(0, configuredGrace) : ATTENDANCE_DEFAULTS.GRACE_PERIOD;
  arrivalCutoff.setMinutes(arrivalCutoff.getMinutes() + gracePeriod);

  const isLate = occurredAt.getTime() > arrivalCutoff.getTime();
  const minutesLate = isLate
    ? Math.floor((occurredAt.getTime() - arrivalCutoff.getTime()) / 60_000)
    : 0;

  let status: AttendanceRecord['status'] = isLate ? 'late' : 'present';
  if (markAfterAbsenceAsAbsent) {
    const absenceCutoff = buildCutoff(
      occurredAt,
      settings?.absence_time,
      ATTENDANCE_DEFAULTS.ABSENCE_TIME
    );
    if (occurredAt.getTime() > absenceCutoff.getTime()) {
      status = 'absent';
    }
  }

  return {
    allowed: true,
    date,
    timestamp: occurredAt.toISOString(),
    status,
    minutes_late: minutesLate
  };
};

const toTime = (value?: string | null): number => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

export const getAttendanceRecordTime = (record: AttendanceRecord): number => {
  const withMeta = record as AttendanceRecordWithMeta;
  return Math.max(
    toTime(withMeta._updated_at),
    toTime(withMeta.updated_at),
    toTime(record.timestamp),
    toTime(record.created_at),
    toTime(record.date)
  );
};

export const isNewerAttendanceRecord = (
  candidate: AttendanceRecord,
  current: AttendanceRecord
): boolean => {
  const candidateTime = getAttendanceRecordTime(candidate);
  const currentTime = getAttendanceRecordTime(current);

  if (candidateTime !== currentTime) return candidateTime > currentTime;

  const candidateRank = STATUS_RANK[candidate.status] ?? 0;
  const currentRank = STATUS_RANK[current.status] ?? 0;
  if (candidateRank !== currentRank) return candidateRank > currentRank;

  return String(candidate.id || '') > String(current.id || '');
};

export const attendanceStateKey = (record: Pick<AttendanceRecord, 'student_id' | 'date'>): string =>
  `${record.student_id}::${record.date}`;

export const getLatestAttendanceByStudentDate = (
  records: AttendanceRecord[],
  date?: string
): Map<string, AttendanceRecord> => {
  const latest = new Map<string, AttendanceRecord>();

  for (const record of records) {
    if (!record?.student_id || !record.date) continue;
    if (date && record.date !== date) continue;

    const key = attendanceStateKey(record);
    const current = latest.get(key);
    if (!current || isNewerAttendanceRecord(record, current)) {
      latest.set(key, record);
    }
  }

  return latest;
};

export const uniqueAttendanceByStudentDate = (
  records: AttendanceRecord[],
  date?: string
): AttendanceRecord[] => Array.from(getLatestAttendanceByStudentDate(records, date).values());

export const getAttendanceForDate = (
  records: AttendanceRecord[],
  date: string
): AttendanceRecord[] => uniqueAttendanceByStudentDate(records, date);

export const getAttendanceStatusCounts = (
  records: AttendanceRecord[],
  totalStudents: number,
  options: { date?: string; isHoliday?: boolean } = {}
): AttendanceCounts => {
  const uniqueRecords = uniqueAttendanceByStudentDate(records, options.date);
  const present = uniqueRecords.filter(record => record.status === 'present').length;
  const late = uniqueRecords.filter(record => record.status === 'late').length;
  const attended = present + late;
  const absent = options.isHoliday ? 0 : Math.max(0, totalStudents - attended);

  return {
    present,
    late,
    absent,
    attended,
    total: totalStudents
  };
};

export const upsertAttendanceRecord = (
  records: AttendanceRecord[],
  nextRecord: AttendanceRecord
): AttendanceRecord[] => {
  const byState = getLatestAttendanceByStudentDate(records);
  const key = attendanceStateKey(nextRecord);
  const current = byState.get(key);

  if (!current || isNewerAttendanceRecord(nextRecord, current)) {
    byState.set(key, nextRecord);
  }

  return Array.from(byState.values());
};
