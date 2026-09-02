import type { AcademicHoliday, AttendanceRecord, Student } from '../../types';
import { ATTENDANCE_DEFAULTS } from '../../types';
import { formatDateKey, getDateRange, isDateHoliday } from '../../services/academicCalendarService';
import { uniqueAttendanceByStudentDate } from '../attendance';

export type AttendanceRiskLevel = 'high' | 'medium' | 'low' | 'normal' | 'unknown';

export type AttendanceRiskPatternType =
  | 'consecutive_absences'
  | 'weekend_proximity'
  | 'chronic_lateness';

export type AttendanceRiskPattern = Readonly<{
  type: AttendanceRiskPatternType;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}>;

export type AttendanceRiskRecommendation = Readonly<{
  title: string;
  summary: string;
  suggestedAction: string;
  recommendedParentMessage: string;
}>;

export type StudentAttendanceRiskProfile = Readonly<{
  studentId: string;
  studentName: string;
  className: string;
  section: string;
  guardianName: string;
  guardianPhone: string;
  riskScore: number;
  riskLevel: AttendanceRiskLevel;
  detectedPatterns: AttendanceRiskPattern[];
  totalDaysEvaluated: number;
  absentDaysCount: number;
  lateDaysCount: number;
  totalLostMinutes: number;
  attendanceRate: number | null;
  consecutiveAbsentDays: number;
  recommendation: AttendanceRiskRecommendation;
}>;

export type SchoolAttendanceRiskOverview = Readonly<{
  evaluatedStudentsCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  normalCount: number;
  unknownCount: number;
  averageSchoolAttendanceRate: number | null;
  topRiskPatterns: Array<{ pattern: string; affectedCount: number }>;
  totalLostEducationalHours: number;
}>;

export type AttendanceIntelligencePeriod = Readonly<{
  startDate: string;
  endDate: string;
}>;

export type AnalyzeAttendanceRiskInput = Readonly<{
  students: readonly Student[];
  attendanceRecords: readonly AttendanceRecord[];
  period: AttendanceIntelligencePeriod;
  workDays?: readonly number[];
  holidays?: readonly AcademicHoliday[];
  minutesPerSchoolDay?: number;
}>;

export type AttendanceRiskAnalysis = Readonly<{
  profiles: StudentAttendanceRiskProfile[];
  overview: SchoolAttendanceRiskOverview;
}>;

export type WeeklyAttendanceDay = Readonly<{
  date: string;
  status: AttendanceRecord['status'] | 'unrecorded';
  minutesLate: number;
}>;

export type WeeklyAttendanceScorecard = Readonly<{
  studentId: string;
  studentName: string;
  className: string;
  section: string;
  period: AttendanceIntelligencePeriod;
  days: WeeklyAttendanceDay[];
  scheduledDays: number;
  recordedDays: number;
  unrecordedDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  attendanceRate: number | null;
  recordingCompletionRate: number;
  riskScore: number;
  riskLevel: AttendanceRiskLevel;
  recommendation: AttendanceRiskRecommendation;
}>;

export type BuildWeeklyAttendanceScorecardInput = Readonly<{
  student: Student;
  attendanceRecords: readonly AttendanceRecord[];
  weekStartDate: string;
  workDays?: readonly number[];
  holidays?: readonly AcademicHoliday[];
  minutesPerSchoolDay?: number;
}>;

type AttendanceEvaluationContext = Readonly<{
  period: AttendanceIntelligencePeriod;
  workDays: readonly number[];
  holidays: readonly AcademicHoliday[];
  minutesPerSchoolDay: number;
}>;

const roundOneDecimal = (value: number): number => Number(value.toFixed(1));

const getSchoolDates = (
  period: AttendanceIntelligencePeriod,
  workDays: readonly number[],
  holidays: readonly AcademicHoliday[]
): string[] => getDateRange(period.startDate, period.endDate)
  .filter(date => !isDateHoliday(date, [...workDays], [...holidays]));

const getStudentRecordsByDate = (
  attendanceRecords: readonly AttendanceRecord[],
  studentId: string,
  schoolDates: readonly string[]
): Map<string, AttendanceRecord> => {
  const schoolDateSet = new Set(schoolDates);
  const records = uniqueAttendanceByStudentDate(
    attendanceRecords.filter(record => record.student_id === studentId && schoolDateSet.has(record.date))
  );
  return new Map(records.map(record => [record.date, record]));
};

const recommendationFor = (
  student: Student,
  riskLevel: AttendanceRiskLevel,
  absentDays: number,
  lateDays: number,
  lostMinutes: number
): AttendanceRiskRecommendation => {
  if (riskLevel === 'unknown') {
    return {
      title: 'بيانات غير مكتملة',
      summary: 'لا توجد سجلات كافية لتقييم انتظام الطالب خلال الفترة المحددة.',
      suggestedAction: 'استكمال تسجيل أيام الدوام أولًا ثم إعادة تشغيل التحليل.',
      recommendedParentMessage: ''
    };
  }

  if (riskLevel === 'high') {
    return {
      title: 'تدخل إرشادي عاجل',
      summary: `${absentDays} أيام غياب و${lateDays} حالات تأخر خلال الفترة المحددة.`,
      suggestedAction: 'مراجعة الحالة مع المرشد الطلابي والتواصل المباشر مع ولي الأمر.',
      recommendedParentMessage: `ولي أمر الطالب ${student.name}، نأمل التواصل مع إدارة المدرسة لمتابعة انتظام الطالب بعد فقده ${lostMinutes} دقيقة تعليمية.`
    };
  }

  if (riskLevel === 'medium') {
    return {
      title: 'متابعة وقائية',
      summary: 'توجد مؤشرات مبكرة تستحق المتابعة قبل تحولها إلى نمط مستمر.',
      suggestedAction: 'تنبيه ولي الأمر ومتابعة الحضور خلال الأسبوع القادم.',
      recommendedParentMessage: `ولي أمر الطالب ${student.name}، نأمل دعم انتظام الطالب ومتابعة حضوره المبكر خلال الأيام القادمة.`
    };
  }

  return {
    title: 'تعزيز الانتظام',
    summary: 'مؤشرات الحضور مستقرة خلال الفترة المحددة.',
    suggestedAction: 'الاستمرار في المتابعة وتعزيز السلوك الإيجابي.',
    recommendedParentMessage: `ولي أمر الطالب ${student.name}، نشكركم على دعم انتظام الطالب وحضوره.`
  };
};

const riskLevelFor = (
  score: number,
  attendanceRate: number,
  consecutiveAbsentDays: number,
  absentDays: number,
  lateDays: number
): AttendanceRiskLevel => {
  if (score >= 60 || consecutiveAbsentDays >= 3 || attendanceRate < 80) return 'high';
  if (score >= 35 || absentDays >= 2 || lateDays >= 3) return 'medium';
  if (score >= 15 || absentDays >= 1 || lateDays >= 1) return 'low';
  return 'normal';
};

/**
 * Evaluates one student against a normalized school calendar. It calculates
 * loss, streaks and risk patterns from explicit records only; missing dates
 * reset streaks and remain unknown rather than becoming implicit absences.
 */
const evaluateStudent = (
  student: Student,
  attendanceRecords: readonly AttendanceRecord[],
  context: AttendanceEvaluationContext
): StudentAttendanceRiskProfile => {
  const { period, workDays, holidays, minutesPerSchoolDay } = context;
  const schoolDates = getSchoolDates(period, workDays, holidays);
  const recordsByDate = getStudentRecordsByDate(attendanceRecords, student.id, schoolDates);
  const studentRecords = Array.from(recordsByDate.values());

  let absentDays = 0;
  let lateDays = 0;
  let totalLostMinutes = 0;
  let consecutiveAbsentDays = 0;
  let currentConsecutiveAbsences = 0;

  for (const date of schoolDates) {
    const record = recordsByDate.get(date);
    if (!record) {
      currentConsecutiveAbsences = 0;
      continue;
    }

    if (record.status === 'absent') {
      absentDays += 1;
      totalLostMinutes += minutesPerSchoolDay;
      currentConsecutiveAbsences += 1;
      consecutiveAbsentDays = Math.max(consecutiveAbsentDays, currentConsecutiveAbsences);
      continue;
    }

    currentConsecutiveAbsences = 0;
    if (record.status === 'late') {
      lateDays += 1;
      totalLostMinutes += Math.max(0, record.minutes_late || 0);
    }
  }

  const totalDaysEvaluated = studentRecords.length;
  const attendanceRate = totalDaysEvaluated > 0
    ? roundOneDecimal(((totalDaysEvaluated - absentDays) / totalDaysEvaluated) * 100)
    : null;
  const absentRatio = totalDaysEvaluated > 0 ? absentDays / totalDaysEvaluated : 0;
  const lateRatio = totalDaysEvaluated > 0 ? lateDays / totalDaysEvaluated : 0;
  const riskScore = Math.min(100, Math.round(
    Math.min(absentRatio * 60, 50)
    + Math.min(lateRatio * 30, 30)
    + (consecutiveAbsentDays >= 3 ? 20 : consecutiveAbsentDays === 2 ? 10 : 0)
  ));
  const riskLevel = attendanceRate === null
    ? 'unknown'
    : riskLevelFor(
      riskScore,
      attendanceRate,
      consecutiveAbsentDays,
      absentDays,
      lateDays
    );
  const detectedPatterns: AttendanceRiskPattern[] = [];

  if (consecutiveAbsentDays >= 2) {
    detectedPatterns.push({
      type: 'consecutive_absences',
      title: 'غياب متتالٍ',
      description: `سُجّل غياب الطالب ${consecutiveAbsentDays} أيام دراسية متتالية.`,
      severity: consecutiveAbsentDays >= 3 ? 'high' : 'medium'
    });
  }

  const boundaryWorkDays = new Set(workDays.length > 0
    ? [workDays[0], workDays[workDays.length - 1]]
    : []);
  const boundaryAbsenceCount = studentRecords.filter(record =>
    record.status === 'absent'
    && boundaryWorkDays.has(new Date(`${record.date}T00:00:00`).getDay())
  ).length;
  if (absentDays >= 2 && boundaryAbsenceCount >= 2 && boundaryAbsenceCount >= absentDays * 0.6) {
    detectedPatterns.push({
      type: 'weekend_proximity',
      title: 'غياب ملاصق لعطلة الأسبوع',
      description: 'تتركز حالات الغياب في أول يوم دوام أو آخره بصورة متكررة.',
      severity: 'medium'
    });
  }

  if (lateDays >= 3) {
    detectedPatterns.push({
      type: 'chronic_lateness',
      title: 'تأخر صباحي متكرر',
      description: `تكرر تأخر الطالب ${lateDays} مرات خلال الفترة المحددة.`,
      severity: lateDays >= 5 ? 'high' : 'medium'
    });
  }

  return {
    studentId: student.id,
    studentName: student.name,
    className: student.class_name,
    section: student.section,
    guardianName: student.guardian_name || '',
    guardianPhone: student.guardian_phone || student.parent_phone || student.whatsapp_phone || '',
    riskScore,
    riskLevel,
    detectedPatterns,
    totalDaysEvaluated,
    absentDaysCount: absentDays,
    lateDaysCount: lateDays,
    totalLostMinutes,
    attendanceRate,
    consecutiveAbsentDays,
    recommendation: recommendationFor(student, riskLevel, absentDays, lateDays, totalLostMinutes)
  };
};

/**
 * Builds read-only risk profiles from explicit attendance records.
 * Missing records remain missing data and are never converted to absences.
 */
export const analyzeAttendanceRisk = ({
  students,
  attendanceRecords,
  period,
  workDays = ATTENDANCE_DEFAULTS.WORK_DAYS,
  holidays = [],
  minutesPerSchoolDay = 360
}: AnalyzeAttendanceRiskInput): AttendanceRiskAnalysis => {
  const context: AttendanceEvaluationContext = {
    period,
    workDays,
    holidays,
    minutesPerSchoolDay: Math.max(0, minutesPerSchoolDay)
  };
  const profiles = students
    .filter(student => student.is_active !== false)
    .map(student => evaluateStudent(student, attendanceRecords, context))
    .sort((left, right) => right.riskScore - left.riskScore || left.studentName.localeCompare(right.studentName, 'ar'));

  const patternCounts = new Map<string, number>();
  for (const profile of profiles) {
    for (const pattern of profile.detectedPatterns) {
      patternCounts.set(pattern.title, (patternCounts.get(pattern.title) || 0) + 1);
    }
  }

  const countLevel = (level: AttendanceRiskLevel): number =>
    profiles.filter(profile => profile.riskLevel === level).length;
  const evaluatedProfiles = profiles.filter(profile => profile.attendanceRate !== null);

  return {
    profiles,
    overview: {
      evaluatedStudentsCount: evaluatedProfiles.length,
      highRiskCount: countLevel('high'),
      mediumRiskCount: countLevel('medium'),
      lowRiskCount: countLevel('low'),
      normalCount: countLevel('normal'),
      unknownCount: countLevel('unknown'),
      averageSchoolAttendanceRate: evaluatedProfiles.length > 0
        ? roundOneDecimal(evaluatedProfiles.reduce((sum, profile) => sum + (profile.attendanceRate ?? 0), 0) / evaluatedProfiles.length)
        : null,
      topRiskPatterns: Array.from(patternCounts.entries())
        .map(([pattern, affectedCount]) => ({ pattern, affectedCount }))
        .sort((left, right) => right.affectedCount - left.affectedCount || left.pattern.localeCompare(right.pattern, 'ar'))
        .slice(0, 4),
      totalLostEducationalHours: roundOneDecimal(
        profiles.reduce((sum, profile) => sum + profile.totalLostMinutes, 0) / 60
      )
    }
  };
};

/**
 * Builds a seven-day scorecard while excluding configured off-days and holidays.
 */
export const buildWeeklyAttendanceScorecard = ({
  student,
  attendanceRecords,
  weekStartDate,
  workDays = ATTENDANCE_DEFAULTS.WORK_DAYS,
  holidays = [],
  minutesPerSchoolDay = 360
}: BuildWeeklyAttendanceScorecardInput): WeeklyAttendanceScorecard => {
  const weekEnd = new Date(`${weekStartDate}T00:00:00`);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const period = {
    startDate: weekStartDate,
    endDate: formatDateKey(weekEnd)
  };
  const schoolDates = getSchoolDates(period, workDays, holidays);
  const recordsByDate = getStudentRecordsByDate(attendanceRecords, student.id, schoolDates);
  const days: WeeklyAttendanceDay[] = schoolDates.map(date => {
    const record = recordsByDate.get(date);
    return {
      date,
      status: record?.status || 'unrecorded',
      minutesLate: record?.status === 'late' ? Math.max(0, record.minutes_late || 0) : 0
    };
  });
  const profile = evaluateStudent(
    student,
    attendanceRecords,
    {
      period,
      workDays,
      holidays,
      minutesPerSchoolDay: Math.max(0, minutesPerSchoolDay)
    }
  );
  const recordedDays = days.filter(day => day.status !== 'unrecorded').length;
  const presentDays = days.filter(day => day.status === 'present').length;
  const lateDays = days.filter(day => day.status === 'late').length;
  const absentDays = days.filter(day => day.status === 'absent').length;

  return {
    studentId: student.id,
    studentName: student.name,
    className: student.class_name,
    section: student.section,
    period,
    days,
    scheduledDays: days.length,
    recordedDays,
    unrecordedDays: days.length - recordedDays,
    presentDays,
    lateDays,
    absentDays,
    attendanceRate: recordedDays > 0
      ? roundOneDecimal(((presentDays + lateDays) / recordedDays) * 100)
      : null,
    recordingCompletionRate: days.length > 0
      ? roundOneDecimal((recordedDays / days.length) * 100)
      : 100,
    riskScore: profile.riskScore,
    riskLevel: profile.riskLevel,
    recommendation: profile.recommendation
  };
};
