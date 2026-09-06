import type { StaffAttendanceRecord, StaffLessonPreparation, StaffTeacher } from '../staffOperations';

export type StaffReportPlatform = 'huduri' | 'madrasati';
export type StaffReportRecord = Omit<StaffAttendanceRecord, 'recordedAt'> | Omit<StaffLessonPreparation, 'recordedAt'>;
export const staffReportTemplates: Record<StaffReportPlatform, string> = {
  huduri: 'معرف المعلم,اسم المعلم,التاريخ,حالة الحضور,دقائق التأخر\n',
  madrasati: 'معرف المعلم,اسم المعلم,التاريخ,الحصة,المادة,الصف,الفصل,حالة التحضير\n'
};

const digits = (value: string) => value.replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
const text = (value: unknown) => digits(String(value ?? '')).replace(/\s+/g, ' ').trim();
const key = (value: unknown) => text(value).toLowerCase();
const aliases = {
  teacherId: ['معرف المعلم', 'رقم المعلم', 'الرقم الوظيفي', 'teacher id'],
  teacherName: ['اسم المعلم', 'اسم الموظف', 'teacher name'],
  date: ['التاريخ', 'date'],
  attendance: ['حالة الحضور', 'attendance status'],
  minutesLate: ['دقائق التأخر', 'minutes late'],
  period: ['الحصة', 'رقم الحصة', 'period'],
  subject: ['المادة', 'subject'],
  className: ['الصف', 'class'],
  section: ['الفصل', 'الشعبة', 'section'],
  preparation: ['حالة التحضير', 'preparation status']
} as const;

/** Strict report contract; never infer absence from a missing row or preparation. */
export function parseStaffReportRows(platform: StaffReportPlatform, rows: readonly Readonly<Record<string, unknown>>[], teachers: readonly StaffTeacher[]): readonly StaffReportRecord[] {
  if (platform !== 'huduri' && platform !== 'madrasati') throw new Error('منصة غير مدعومة');
  if (!rows.length || rows.length > 10000) throw new Error('يجب أن يحتوي التقرير بين 1 و10000 صف');
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const fail = (message: string): never => { throw new Error(`الصف ${index + 2}: ${message}`); };
    const read = (field: keyof typeof aliases, required = false) => {
      const columns = Object.keys(row).filter(header => aliases[field].some(alias => key(alias) === key(header)));
      if (columns.length > 1) fail('عناوين أعمدة متكررة أو ملتبسة');
      const value = text(row[columns[0]]);
      if (required && !value) fail(`الحقل «${aliases[field][0]}» مطلوب`);
      return value;
    };
    const teacherId = read('teacherId');
    const teacherName = read('teacherName');
    if (!teacherId && !teacherName) fail('معرف المعلم أو اسمه مطلوب');
    const matches = teachers.filter(teacher => teacherId ? text(teacher.id) === teacherId : key(teacher.name) === key(teacherName));
    if (matches.length !== 1 || !matches[0].isActive) fail('المعلم غير معروف أو غير نشط أو المطابقة ملتبسة؛ حدّث سجل المعلمين');
    const teacher = matches[0];
    if (teacherName && key(teacher.name) !== key(teacherName)) fail('اسم المعلم لا يطابق المعرف');
    const date = read('date', true);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) fail('استخدم تاريخاً ميلادياً صحيحاً بصيغة YYYY-MM-DD');
    let record: StaffReportRecord;
    if (platform === 'huduri') {
      const statuses = new Map<string, StaffAttendanceRecord['status']>([['حاضر', 'present'], ['متأخر', 'late'], ['غائب', 'absent'], ['present', 'present'], ['late', 'late'], ['absent', 'absent']]);
      const status = statuses.get(key(read('attendance', true)));
      if (!status) fail('حالة حضور غير مدعومة؛ لا يُستنتج الغياب من غياب البصمة');
      const rawMinutes = read('minutesLate');
      const minutes = rawMinutes ? Number(rawMinutes) : 0;
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || (status !== 'late' && minutes !== 0)) fail('دقائق التأخر غير صالحة أو تتعارض مع حالة الحضور');
      record = { id: `${date}:${teacher.id}`, teacherId: teacher.id, date, status, ...(status === 'late' ? { minutesLate: minutes } : {}), source: 'huduri' };
    } else {
      const period = Number(read('period', true));
      if (!Number.isInteger(period) || period < 1 || period > 12) fail('رقم الحصة يجب أن يكون بين 1 و12');
      const statuses = new Map<string, StaffLessonPreparation['status']>([['محضر', 'prepared'], ['تم التحضير', 'prepared'], ['غير محضر', 'not-prepared'], ['لم يتم التحضير', 'not-prepared'], ['prepared', 'prepared'], ['not-prepared', 'not-prepared']]);
      const status = statuses.get(key(read('preparation', true)));
      if (!status) fail('حالة تحضير غير مدعومة');
      record = { id: `${date}:${encodeURIComponent(teacher.id)}:${period}`, teacherId: teacher.id, date, period, subject: read('subject', true), className: read('className', true), section: read('section', true), status, source: 'madrasati' };
    }
    if (seen.has(record.id)) fail('سجل مكرر للمعلم في اليوم أو الحصة نفسها');
    seen.add(record.id);
    return Object.freeze(record);
  });
}
