import type { StaffTeachingSlotInput, StaffTeacher, StaffWorkDay } from './index';

export type StaffTimetableImportResult = Readonly<{
  slots: readonly StaffTeachingSlotInput[];
  errors: readonly string[];
}>;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const normalizeDigits = (value: string): string => value.replace(/[٠-٩۰-۹]/g, digit => {
  const arabicIndex = ARABIC_DIGITS.indexOf(digit);
  return String(arabicIndex >= 0 ? arabicIndex : PERSIAN_DIGITS.indexOf(digit));
});

const normalizeText = (value: unknown): string => normalizeDigits(String(value ?? ''))
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/ـ/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeKey = (value: unknown): string => normalizeText(value)
  .replace(/[_-]+/g, ' ')
  .toLocaleLowerCase('ar');

const normalizeId = (value: unknown): string => normalizeText(value).toLocaleLowerCase('en');

const HEADER_ALIASES = Object.freeze({
  teacherId: ['معرف المعلم', 'رقم المعلم', 'teacher id', 'teacherid'],
  teacherName: ['اسم المعلم', 'المعلم', 'teacher name', 'teacher'],
  day: ['اليوم', 'يوم', 'day', 'weekday'],
  period: ['الحصة', 'رقم الحصة', 'period', 'lesson'],
  subject: ['المادة', 'اسم المادة', 'subject'],
  className: ['الصف', 'الصف الدراسي', 'class', 'grade'],
  section: ['الفصل', 'الشعبة', 'section']
});

const DAY_ALIASES = new Map<string, StaffWorkDay>([
  ['الاحد', 0],
  ['الأحد', 0],
  ['sunday', 0],
  ['sun', 0],
  ['الاثنين', 1],
  ['الإثنين', 1],
  ['monday', 1],
  ['mon', 1],
  ['الثلاثاء', 2],
  ['tuesday', 2],
  ['tue', 2],
  ['الاربعاء', 3],
  ['الأربعاء', 3],
  ['wednesday', 3],
  ['wed', 3],
  ['الخميس', 4],
  ['thursday', 4],
  ['thu', 4]
].map(([label, day]) => [normalizeKey(label), day as StaffWorkDay]));

const readColumn = (
  row: Readonly<Record<string, unknown>>,
  aliases: readonly string[]
): unknown => {
  const aliasSet = new Set(aliases.map(normalizeKey));
  const entry = Object.entries(row).find(([header]) => aliasSet.has(normalizeKey(header)));
  return entry?.[1];
};

/**
 * Converts a reviewed spreadsheet shape into timetable inputs. When any row is
 * unsafe or ambiguous, no slots are returned so callers cannot partially apply it.
 */
export const parseStaffTimetableRows = (
  rows: readonly Readonly<Record<string, unknown>>[],
  teachers: readonly StaffTeacher[]
): StaffTimetableImportResult => {
  if (rows.length === 0) {
    return Object.freeze({
      slots: Object.freeze([]),
      errors: Object.freeze(['ملف الجدول فارغ'])
    });
  }

  const errors: string[] = [];
  const slots: StaffTeachingSlotInput[] = [];
  const teachersById = new Map<string, StaffTeacher[]>();
  const teachersByName = new Map<string, StaffTeacher[]>();
  teachers.forEach(teacher => {
    const idKey = normalizeId(teacher.id);
    teachersById.set(idKey, [...(teachersById.get(idKey) ?? []), teacher]);
    const key = normalizeKey(teacher.name);
    teachersByName.set(key, [...(teachersByName.get(key) ?? []), teacher]);
  });

  rows.forEach((row, index) => {
    const sheetRow = index + 2;
    const teacherId = normalizeText(readColumn(row, HEADER_ALIASES.teacherId));
    const teacherName = normalizeText(readColumn(row, HEADER_ALIASES.teacherName));
    const byId = teacherId ? teachersById.get(normalizeId(teacherId)) ?? [] : [];
    const byName = teacherName ? teachersByName.get(normalizeKey(teacherName)) ?? [] : [];
    const teacher = teacherId ? (byId.length === 1 ? byId[0] : undefined) : byName.length === 1 ? byName[0] : undefined;
    if (!teacher || (!teacherId && byName.length !== 1)) {
      errors.push(`الصف ${sheetRow}: لم تتم مطابقة المعلم`);
      return;
    }
    if (teacherName && (byName.length !== 1 || byName[0].id !== teacher.id)) {
      errors.push(`الصف ${sheetRow}: اسم المعلم لا يطابق المعرّف`);
      return;
    }

    const day = DAY_ALIASES.get(normalizeKey(readColumn(row, HEADER_ALIASES.day)));
    if (day === undefined) {
      errors.push(`الصف ${sheetRow}: اليوم غير معروف`);
      return;
    }

    const period = Number(normalizeText(readColumn(row, HEADER_ALIASES.period)));
    if (!Number.isInteger(period) || period < 1 || period > 12) {
      errors.push(`الصف ${sheetRow}: رقم الحصة يجب أن يكون بين 1 و12`);
      return;
    }

    const subject = normalizeText(readColumn(row, HEADER_ALIASES.subject));
    const className = normalizeText(readColumn(row, HEADER_ALIASES.className));
    const section = normalizeText(readColumn(row, HEADER_ALIASES.section));
    if (!subject || !className || !section) {
      errors.push(`الصف ${sheetRow}: المادة أو الصف أو الفصل غير مكتمل`);
      return;
    }

    slots.push(Object.freeze({
      teacherId: teacher.id,
      day,
      period,
      subject,
      className,
      section
    }));
  });

  return Object.freeze({
    slots: Object.freeze(errors.length > 0 ? [] : slots),
    errors: Object.freeze(errors)
  });
};
