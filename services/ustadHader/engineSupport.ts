// =============================================================================
// نظام حاضر (Hader) - صلاحيات ونطاق بيانات «أستاذ حاضر»
// =============================================================================

import { db, getLocalISODate } from '../db';
import { normalizeStudentId } from '../dbHelpers';
import { getCachedHolidays } from '../academicCalendarService';
import { AttendanceRecord, Role, Student, SystemSettings, User } from '../../types';
import { accessPolicy, ProtectedRouteKey } from '../../modules/access';
import { decideAttendanceTiming, uniqueAttendanceByStudentDate } from '../../modules/attendance';
import { resolveStudentWhatsAppPhone } from '../../components/supervision/supervisionCommunication';
import type { AbsenceAlertRecipient } from './absenceAlerts';
import type { UstadActionPayload, UstadStudentSummary } from './assistantTypes';

const ADMIN_ROLES: readonly Role[] = [Role.SITE_ADMIN, Role.SCHOOL_ADMIN];
const SUPERVISOR_ROLES: readonly Role[] = [Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS];

// مطابق لحارس مسار /whatsapp في App.tsx
export function canSendWhatsApp(user: User | null): user is User {
  return Boolean(user && (user.role === Role.SITE_ADMIN || user.can_use_whatsapp));
}

// أرقام أولياء الأمور تظهر في شاشات الإدارة والإشراف وواتساب، ولا تظهر لحساب المراقب
export function canViewGuardianPhone(user: User | null): boolean {
  return Boolean(user && (
    ADMIN_ROLES.includes(user.role) ||
    SUPERVISOR_ROLES.includes(user.role) ||
    user.can_use_whatsapp
  ));
}

export const canUseRoute = (user: User | null, route: ProtectedRouteKey): user is User =>
  Boolean(user && accessPolicy.canAccessRoute(user, route));

export const deniedResult = (spokenText: string): UstadActionPayload => ({
  type: 'error',
  title: 'صلاحيات غير كافية',
  spokenText
});

export const studentUnavailableResult = (): UstadActionPayload => ({
  type: 'error',
  title: 'الطالب غير متاح',
  spokenText: 'لم أعد أجد هذا الطالب ضمن الطلاب المتاحين لحسابك.'
});

const isActiveStudent = (student: Student) =>
  student.is_active !== false && (student.is_active as unknown) !== 0;

// الطلاب النشطون ضمن نطاق المستخدم: مشرف الفصل لا يرى إلا فصوله المسندة
export async function loadScopedStudents(user: User): Promise<Student[]> {
  const students = (await db.getStudents()).filter(isActiveStudent);
  return accessPolicy.filterStudentsForRoleScopedWidgets(students, user);
}

export async function findScopedStudent(studentId: string, user: User): Promise<Student | null> {
  const key = normalizeStudentId(studentId);
  return (await loadScopedStudents(user)).find(student => normalizeStudentId(student.id) === key) ?? null;
}

export function attendedStudentIds(records: AttendanceRecord[], date: string): Set<string> {
  return new Set(
    uniqueAttendanceByStudentDate(records, date)
      .filter(record => record.status === 'present' || record.status === 'late')
      .map(record => normalizeStudentId(record.student_id))
  );
}

export function todayRecordFor(records: AttendanceRecord[], date: string, studentId: string): AttendanceRecord | undefined {
  const key = normalizeStudentId(studentId);
  return uniqueAttendanceByStudentDate(records, date).find(record => normalizeStudentId(record.student_id) === key);
}

export function summarizeStudent(student: Student, user: User | null): UstadStudentSummary {
  const guardianPhone = canViewGuardianPhone(user)
    ? student.guardian_phone || student.parent_phone || student.whatsapp_phone
    : undefined;
  return {
    id: student.id,
    name: student.name,
    class_name: student.class_name || '',
    section: student.section || '',
    ...(guardianPhone ? { guardianPhone } : {})
  };
}

export const formatClassLabel = (student: Pick<Student, 'class_name' | 'section'>) =>
  [student.class_name, student.section].filter(Boolean).join(' - ');

export const pad2 = (value: number) => String(value).padStart(2, '0');

function decideNow(settings: SystemSettings | null) {
  return decideAttendanceTiming({
    occurredAt: new Date(),
    settings: settings ?? undefined,
    holidays: settings?.attendance_settings?.academic_holidays ?? getCachedHolidays()
  });
}

// قبل انتهاء مهلة الطابور، الطالب بلا سجل «لم يصل بعد» وليس غائباً
export function isWithinArrivalWindow(settings: SystemSettings | null): boolean {
  const timing = decideNow(settings);
  return timing.allowed !== false && timing.status === 'present';
}

// تنبيه الغياب قبل انتهاء مهلة الحضور يصل لأولياء أمور طلاب ما زالوا في الطريق
export function absenceAlertWindowNotice(settings: SystemSettings | null): UstadActionPayload | null {
  const timing = decideNow(settings);

  if (timing.allowed === false) {
    return timing.reason === 'holiday'
      ? { type: 'info', title: 'اليوم عطلة', spokenText: 'اليوم عطلة دراسية، فلا توجد تنبيهات غياب لإرسالها.' }
      : null;
  }
  if (timing.status === 'present') {
    return {
      type: 'info',
      title: 'لم تنتهِ مهلة الحضور',
      spokenText: 'لم تنتهِ مهلة الحضور الصباحي بعد، وقد يكون بعض الطلاب في الطريق. أعد الطلب بعد انتهاء المهلة.'
    };
  }
  return null;
}

export async function findAbsenceAlertRecipients(user: User): Promise<{ recipients: AbsenceAlertRecipient[]; withoutPhone: number }> {
  const today = getLocalISODate();
  const [students, attendance] = await Promise.all([loadScopedStudents(user), db.getAttendance(today)]);
  const attended = attendedStudentIds(attendance, today);

  const recipients: AbsenceAlertRecipient[] = [];
  let withoutPhone = 0;
  for (const student of students) {
    if (attended.has(normalizeStudentId(student.id))) continue;
    const phone = resolveStudentWhatsAppPhone(student);
    if (phone) {
      recipients.push({ student, phone });
    } else {
      withoutPhone++;
    }
  }
  return { recipients, withoutPhone };
}
