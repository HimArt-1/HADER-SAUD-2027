// =============================================================================
// نظام حاضر (Hader) - الملخص الصباحي لـ «أستاذ حاضر»
// =============================================================================
// بعد انتهاء مهلة الطابور: كم حضر، كم غاب، كم تأخر، ومن بين الغائبين غيابه متكرر.
// كل الأرقام من نطاق المستخدم نفسه، وتُحسب داخل المنصة.

import { db, getLocalISODate } from '../db';
import { getLocalDateStr, normalizeStudentId } from '../dbHelpers';
import { getCachedHolidays, isDateHoliday } from '../academicCalendarService';
import { ATTENDANCE_DEFAULTS, AcademicHoliday, AttendanceRecord, Student, SystemSettings, User } from '../../types';
import { getAttendanceStatusCounts, uniqueAttendanceByStudentDate } from '../../modules/attendance';
import { attendedStudentIds, canUseRoute, formatClassLabel, loadScopedStudents, pad2 } from './engineSupport';

const LOOKBACK_DAYS = 14;
const LISTED_REPEATED_ABSENTEES = 5;

export interface RepeatedAbsentee {
  id: string;
  name: string;
  classLabel: string;
  // أيام الغياب المتتالية قبل اليوم
  streak: number;
  // أيام الغياب خلال الأسبوعين السابقين
  recentAbsences: number;
}

export type MorningBriefing =
  | { status: 'holiday'; date: string; spokenText: string }
  | { status: 'pending'; date: string; readyAt: number; readyLabel: string; spokenText: string }
  | {
      status: 'ready';
      date: string;
      total: number;
      present: number;
      late: number;
      absent: number;
      attended: number;
      rate: number;
      repeatedAbsentees: RepeatedAbsentee[];
      repeatedCount: number;
      spokenText: string;
    };

/** نهاية مهلة الحضور: وقت الطابور + فترة السماح، كما يحسبها التحضير نفسه. */
export function arrivalCutoff(settings: SystemSettings | null, date: string): Date {
  const [hours, minutes] = String(settings?.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME).split(':').map(Number);
  const grace = Number(settings?.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD);
  const cutoff = new Date(`${date}T${pad2(Number.isFinite(hours) ? hours : 6)}:${pad2(Number.isFinite(minutes) ? minutes : 45)}:00`);
  cutoff.setMinutes(cutoff.getMinutes() + (Number.isFinite(grace) ? Math.max(0, grace) : ATTENDANCE_DEFAULTS.GRACE_PERIOD));
  return cutoff;
}

/**
 * الغياب المتكرر بين غائبي اليوم: غاب أمس أيضاً (يومان متتاليان مع اليوم)،
 * أو غاب يومين على الأقل خلال الأسبوعين السابقين (ثلاثة مع اليوم).
 * اليوم الدراسي بلا سجل يُعد مجهولاً ويقطع التتابع، ولا يُحسب غياباً.
 */
export function findRepeatedAbsentees({
  absentStudents,
  records,
  today,
  workDays,
  holidays,
  lookbackDays = LOOKBACK_DAYS
}: {
  absentStudents: readonly Student[];
  records: readonly AttendanceRecord[];
  today: string;
  workDays: number[];
  holidays: AcademicHoliday[];
  lookbackDays?: number;
}): RepeatedAbsentee[] {
  const previousSchoolDates: string[] = [];
  const cursor = new Date(`${today}T12:00:00`);
  for (let day = 0; day < lookbackDays; day++) {
    cursor.setDate(cursor.getDate() - 1);
    const date = getLocalDateStr(cursor);
    if (!isDateHoliday(date, workDays, holidays)) previousSchoolDates.push(date);
  }

  const statusByStudentDate = new Map(
    uniqueAttendanceByStudentDate([...records]).map(record => [`${normalizeStudentId(record.student_id)}|${record.date}`, record.status])
  );

  return absentStudents
    .map(student => {
      const id = normalizeStudentId(student.id);
      const statuses = previousSchoolDates.map(date => statusByStudentDate.get(`${id}|${date}`));
      const firstNotAbsent = statuses.findIndex(status => status !== 'absent');
      return {
        id: student.id,
        name: student.name,
        classLabel: formatClassLabel(student),
        streak: firstNotAbsent === -1 ? statuses.length : firstNotAbsent,
        recentAbsences: statuses.filter(status => status === 'absent').length
      };
    })
    .filter(entry => entry.streak >= 1 || entry.recentAbsences >= 2)
    .sort((a, b) => b.streak - a.streak || b.recentAbsences - a.recentAbsences || a.name.localeCompare(b.name, 'ar'));
}

/**
 * ملخص اليوم لنطاق المستخدم، أو null لمن لا يملك صلاحية الاطلاع على الحضور.
 */
export async function loadMorningBriefing(user: User | null, now: Date = new Date()): Promise<MorningBriefing | null> {
  if (!canUseRoute(user, 'watcher')) return null;

  const today = getLocalISODate();
  const settings = await db.getSettings();
  const workDays = settings?.work_days?.length ? [...settings.work_days] : [...ATTENDANCE_DEFAULTS.WORK_DAYS];
  const holidays = settings?.attendance_settings?.academic_holidays ?? getCachedHolidays();

  if (isDateHoliday(today, workDays, holidays)) {
    return { status: 'holiday', date: today, spokenText: 'اليوم عطلة دراسية، فلا يوجد ملخص حضور.' };
  }

  const readyAt = arrivalCutoff(settings, today);
  if (now.getTime() < readyAt.getTime()) {
    const readyLabel = `${pad2(readyAt.getHours())}:${pad2(readyAt.getMinutes())}`;
    return {
      status: 'pending',
      date: today,
      readyAt: readyAt.getTime(),
      readyLabel,
      spokenText: `سيجهز ملخص اليوم بعد انتهاء مهلة الحضور الساعة ${readyLabel}.`
    };
  }

  const lookbackStart = new Date(`${today}T12:00:00`);
  lookbackStart.setDate(lookbackStart.getDate() - LOOKBACK_DAYS);
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);

  const [students, todayRecords, pastRecords] = await Promise.all([
    loadScopedStudents(user),
    db.getAttendance(today),
    db.getAttendanceRange(getLocalDateStr(lookbackStart), getLocalDateStr(yesterday))
  ]);

  const scopedIds = new Set(students.map(student => normalizeStudentId(student.id)));
  const counts = getAttendanceStatusCounts(
    todayRecords.filter(record => scopedIds.has(normalizeStudentId(record.student_id))),
    students.length,
    { date: today }
  );
  const rate = counts.total > 0 ? Math.round((counts.attended / counts.total) * 100) : 0;
  const attended = attendedStudentIds(todayRecords, today);
  const absentStudents = students.filter(student => !attended.has(normalizeStudentId(student.id)));
  const repeated = findRepeatedAbsentees({ absentStudents, records: pastRecords, today, workDays, holidays });

  const greeting = now.getHours() < 12 ? 'صباح الخير.' : 'مرحباً.';
  const lateText = counts.late > 0 ? `، والمتأخرون ${counts.late}` : '';
  const repeatedText = repeated.length > 0
    ? ` بينهم ${repeated.length} ${repeated.length === 1 ? 'طالب غيابه متكرر' : 'طلاب غيابهم متكرر'}.`
    : '';

  return {
    status: 'ready',
    date: today,
    total: counts.total,
    present: counts.present,
    late: counts.late,
    absent: counts.absent,
    attended: counts.attended,
    rate,
    repeatedAbsentees: repeated.slice(0, LISTED_REPEATED_ABSENTEES),
    repeatedCount: repeated.length,
    spokenText: `${greeting} حضر اليوم ${counts.attended} من ${counts.total} بنسبة ${rate} بالمئة. الغياب ${counts.absent}${lateText}.${repeatedText}`
  };
}
