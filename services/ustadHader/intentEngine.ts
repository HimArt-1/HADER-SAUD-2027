// =============================================================================
// نظام حاضر (Hader) - محرك الأوامر الذكية لـ «أستاذ حاضر»
// =============================================================================
// تحليل الأوامر الصوتية باللغة العربية، فحص الصلاحيات ونطاق الفصول، التمييز بين الأسماء المتشابهة،
// وتنفيذ الإجراءات بعد تأكيد صريح عبر خدمات المنصة الفعلية (الحضور، نداء الخروج، تنبيهات الغياب).

import { db, getLocalISODate } from '../db';
import { getLocalDateStr, normalizeStudentId } from '../dbHelpers';
import { dismissals } from '../dismissals';
import { getCachedHolidays } from '../academicCalendarService';
import { ATTENDANCE_DEFAULTS, AttendanceRecord, Role, Student, SystemSettings, User } from '../../types';
import { accessPolicy, ProtectedRouteKey } from '../../modules/access';
import {
  decideAttendanceTiming,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate
} from '../../modules/attendance';
import { resolveStudentWhatsAppPhone } from '../../components/supervision/supervisionCommunication';
import { applyColorMode } from '../../utils/colorMode';
import { normalizeArabicSpeech, stripWakeWord } from './speechService';
import { AbsenceAlertRecipient, buildAbsenceAlertMessage, sendAbsenceAlerts } from './absenceAlerts';

export type UstadResultType =
  | 'navigate'
  | 'stats_absence'
  | 'stats_attendance'
  | 'class_absence'
  | 'weekly_report'
  | 'alerts_preview'
  | 'student_card'
  | 'disambiguation'
  | 'confirmation'
  | 'staff_waiting'
  | 'theme_changed'
  | 'help'
  | 'info'
  | 'success'
  | 'error'
  | 'silence';

export interface UstadStudentSummary {
  id: string;
  name: string;
  class_name: string;
  section: string;
  guardianPhone?: string;
}

// إجراء ينتظر تأكيد المستخدم الصريح؛ تُعاد فحوص الصلاحية والنطاق لحظة تنفيذه
export type UstadPendingAction =
  | { type: 'mark_attendance'; studentId: string; newStatus: 'present' | 'absent' }
  | { type: 'call_dismissal'; studentId: string }
  | { type: 'send_absence_alerts'; studentIds: string[] };

export interface UstadActionPayload {
  type: UstadResultType;
  title: string;
  spokenText: string;
  data?: any;
  pendingAction?: UstadPendingAction;
  actionButton?: {
    label: string;
    path?: string;
    onClickKey?: string;
  };
}

// تطبيع أسماء الصفوف والأقسام
export function parseGradeAndSection(query: string): { grade: string; section: string } | null {
  const norm = normalizeArabicSpeech(query);

  // مصفوفة تعيين الكلمات الشائعة للأرقام والصفوف
  const gradeKeywords: Record<string, string> = {
    'اول': 'أول',
    'اولي': 'أول',
    'ثاني': 'ثاني',
    'ثانيه': 'ثاني',
    'ثالث': 'ثالث',
    'رابع': 'رابع',
    'خامس': 'خامس',
    'سادس': 'سادس',
    '1': 'أول',
    '2': 'ثاني',
    '3': 'ثالث',
    '4': 'رابع',
    '5': 'خامس',
    '6': 'سادس',
  };

  // مصفوفة تعيين الشعب
  const sectionKeywords: Record<string, string> = {
    'الف': 'أ',
    'ا': 'أ',
    '1': 'أ',
    'باء': 'ب',
    'ب': 'ب',
    '2': 'ب',
    'جيم': 'ج',
    'ج': 'ج',
    '3': 'ج',
    'دال': 'د',
    'د': 'د',
    '4': 'د',
    'هاء': 'هـ',
    'ه': 'هـ',
    '5': 'هـ'
  };

  let matchedGrade = '';
  let matchedSection = '';

  for (const [key, val] of Object.entries(gradeKeywords)) {
    if (norm.includes(key)) {
      matchedGrade = val;
      break;
    }
  }

  for (const [key, val] of Object.entries(sectionKeywords)) {
    // نتحقق أن حرف الشعبة مذكور ككلمة مستقلة أو مسبوقة بـ (شعبة / فصل)
    const regex = new RegExp(`(?:شعبة|فصل|صف|\\s)${key}(?:\\s|$)`, 'i');
    if (regex.test(norm) || norm.endsWith(' ' + key)) {
      matchedSection = val;
      break;
    }
  }

  if (matchedGrade) {
    return { grade: matchedGrade, section: matchedSection };
  }

  return null;
}

// استخراج اسم الطالب من الأمر الصوتي
export function extractStudentName(query: string): string {
  const norm = normalizeArabicSpeech(query);
  const prefixes = [
    'سجل حضور الطالب',
    'سجل حضور',
    'سجل غياب الطالب',
    'سجل غياب',
    'حاضر الطالب',
    'حاضر',
    'غائب الطالب',
    'غائب',
    'ابحث عن الطالب',
    'ابحث عن',
    'هل الطالب',
    'هل',
    'نداء خروج للطالب',
    'نداء خروج',
    'استدعاء الطالب',
    'استدعاء',
    'رقم ولي امر الطالب',
    'رقم ولي امر',
    'من ولي امر الطالب',
    'من ولي امر',
    'ولي امر',
    'ملف الطالب',
    'ملف'
  ];

  let cleaned = norm;
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix + ' ')) {
      cleaned = cleaned.substring(prefix.length).trim();
      break;
    }
  }

  // إزالة الكلمات الزائدة في النهاية مثل (اليوم، حاضر، غايب، الآن)
  const suffixes = ['اليوم', 'الان', 'حاضر', 'غايب', 'غائب', 'في المدرسه'];
  for (const suf of suffixes) {
    if (cleaned.endsWith(' ' + suf)) {
      cleaned = cleaned.substring(0, cleaned.length - suf.length - 1).trim();
    }
  }
  return cleaned;
}

// =============================================================================
// الصلاحيات ونطاق البيانات
// =============================================================================

const ADMIN_ROLES: readonly Role[] = [Role.SITE_ADMIN, Role.SCHOOL_ADMIN];
const SUPERVISOR_ROLES: readonly Role[] = [Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS];
const WEEKDAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

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

const canUseRoute = (user: User | null, route: ProtectedRouteKey): user is User =>
  Boolean(user && accessPolicy.canAccessRoute(user, route));

const deniedResult = (spokenText: string): UstadActionPayload => ({
  type: 'error',
  title: 'صلاحيات غير كافية',
  spokenText
});

const studentUnavailableResult = (): UstadActionPayload => ({
  type: 'error',
  title: 'الطالب غير متاح',
  spokenText: 'لم أعد أجد هذا الطالب ضمن الطلاب المتاحين لحسابك.'
});

const isActiveStudent = (student: Student) =>
  student.is_active !== false && (student.is_active as unknown) !== 0;

// الطلاب النشطون ضمن نطاق المستخدم: مشرف الفصل لا يرى إلا فصوله المسندة
async function loadScopedStudents(user: User): Promise<Student[]> {
  const students = (await db.getStudents()).filter(isActiveStudent);
  return accessPolicy.filterStudentsForRoleScopedWidgets(students, user);
}

async function findScopedStudent(studentId: string, user: User): Promise<Student | null> {
  const key = normalizeStudentId(studentId);
  return (await loadScopedStudents(user)).find(student => normalizeStudentId(student.id) === key) ?? null;
}

function attendedStudentIds(records: AttendanceRecord[], date: string): Set<string> {
  return new Set(
    uniqueAttendanceByStudentDate(records, date)
      .filter(record => record.status === 'present' || record.status === 'late')
      .map(record => normalizeStudentId(record.student_id))
  );
}

function summarizeStudent(student: Student, user: User | null): UstadStudentSummary {
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

const formatClassLabel = (student: Pick<Student, 'class_name' | 'section'>) =>
  [student.class_name, student.section].filter(Boolean).join(' - ');

const pad2 = (value: number) => String(value).padStart(2, '0');

// تنبيه الغياب قبل انتهاء مهلة الحضور يصل لأولياء أمور طلاب ما زالوا في الطريق
function absenceAlertWindowNotice(settings: SystemSettings | null): UstadActionPayload | null {
  const timing = decideAttendanceTiming({
    occurredAt: new Date(),
    settings: settings ?? undefined,
    holidays: settings?.attendance_settings?.academic_holidays ?? getCachedHolidays()
  });

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

async function findAbsenceAlertRecipients(user: User): Promise<{ recipients: AbsenceAlertRecipient[]; withoutPhone: number }> {
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

class UstadIntentEngine {
  /**
   * معالجة الأمر الصوتي وإرجاع النتيجة المناسبة
   */
  public async executeCommand(command: string, currentUser: User | null, navigate: (path: string) => void): Promise<UstadActionPayload> {
    const raw = stripWakeWord(command.trim());
    const norm = normalizeArabicSpeech(raw);

    if (!norm) {
      return {
        type: 'info',
        title: 'أستاذ حاضر يستمع',
        spokenText: 'نعم، تفضّل.'
      };
    }

    // 0. التحقق من أمر الإسكات
    if (norm === 'اسكت' || norm === 'توقف' || norm === 'اصمت' || norm === 'بس') {
      return {
        type: 'silence',
        title: 'تم إيقاف الرد الصوتي',
        spokenText: ''
      };
    }

    // 1. أوامر المساعدة واستعراض القدرات
    if (norm.includes('مساعده') || norm.includes('اوامر') || norm.includes('ماذا تفعل') || norm.includes('ايش تسوي') || norm.includes('وش تسوي')) {
      return {
        type: 'help',
        title: 'دليل أوامر أستاذ حاضر',
        spokenText: 'أهلاً بك! يمكنك سؤالي عن الغياب، أو طلب فتح أي شاشة، أو إعداد التقارير، أو إرسال الرسائل.',
      };
    }

    // 2. أوامر المظهر والوضع الداكن
    if (norm.includes('وضع داكن') || norm.includes('الوضع الداكن') || norm.includes('الوضع الليلي') || norm.includes('ليلي')) {
      applyColorMode('dark', true);
      return {
        type: 'theme_changed',
        title: 'تم تفعيل الوضع الداكن',
        spokenText: 'تم تفعيل الوضع الداكن بنجاح.'
      };
    }

    if (norm.includes('وضع فاتح') || norm.includes('الوضع الفاتح') || norm.includes('الوضع النهاري') || norm.includes('نهاري')) {
      applyColorMode('light', true);
      return {
        type: 'theme_changed',
        title: 'تم تفعيل الوضع الفاتح',
        spokenText: 'تم تفعيل الوضع الفاتح بنجاح.'
      };
    }

    // 3. أمر «أرسل تنبيه لأولياء أمور الغائبين» — قبل التنقل حتى لا تفتح كلمة «واتساب» صفحة أخرى
    if (
      norm.includes('ارسل تنبيه لاولياء امور') ||
      norm.includes('ارسل تنبيه للغائبين') ||
      norm.includes('تنبيه اولياء امور الغائبين') ||
      norm.includes('ارسل رسائل للغائبين') ||
      norm.includes('اشعار اولياء الامور')
    ) {
      return await this.handleAbsenceAlertsPreview(currentUser);
    }

    // 4. أوامر الغياب والحضور العامة
    // «كم طالب غائب اليوم؟»
    if (norm.includes('غائب اليوم') || norm.includes('كم الغياب') || norm.includes('عدد الغائبين') || norm.includes('الغياب اليوم') || norm.includes('كم طالب غايب')) {
      return await this.handleAbsenceTodayStats(currentUser);
    }

    // «كم الحضور اليوم؟» / «نسبة الحضور»
    if (norm.includes('كم الحضور') || norm.includes('نسبه الحضور') || norm.includes('احصائيه الحضور') || norm.includes('الحضور اليوم')) {
      return await this.handleAttendanceTodayStats(currentUser);
    }

    // «كم المتأخرين اليوم؟»
    if (norm.includes('المتاخرين') || norm.includes('كم تاخر') || norm.includes('التاخر اليوم')) {
      return await this.handleLateTodayStats(currentUser);
    }

    // «كم طالب انصرف اليوم؟» / «حالة الانصراف»
    if (norm.includes('انصرف اليوم') || norm.includes('كم الانصراف') || norm.includes('حاله الانصراف') || norm.includes('المغادرين')) {
      return this.handleDismissalsStats();
    }

    // 5. أوامر التنقل المباشر
    // «افتح مركز التكاملات»
    if (norm.includes('مركز التكاملات') || norm.includes('التكاملات') || norm.includes('تكاملات')) {
      return this.handleNavigate(
        '/admin?tab=integrations',
        'مركز التكاملات',
        currentUser,
        'admin',
        navigate,
        'أبشر، جاري فتح مركز التكاملات ومراجعة المنصات.'
      );
    }

    // «افتح كشك الحضور»
    if (norm.includes('كشك الحضور') || (norm.includes('كشك') && !norm.includes('انصراف'))) {
      return this.handleNavigate('/kiosk', 'كشك الحضور', currentUser, 'kiosk', navigate, 'جاري فتح كشك الحضور.');
    }

    // «افتح كشك الانصراف»
    if (norm.includes('كشك الانصراف') || norm.includes('انصراف الطلاب')) {
      return this.handleNavigate('/dismissal-kiosk', 'كشك الانصراف', currentUser, 'dismissalKiosk', navigate, 'جاري فتح كشك الانصراف.');
    }

    // «افتح لوحة النداءات»
    if (norm.includes('لوحه النداءات') || norm.includes('لوحه النداء') || norm.includes('شاشه النداء')) {
      return this.handleNavigate('/call-board', 'لوحة النداءات', currentUser, 'callBoard', navigate, 'جاري فتح لوحة نداءات الانصراف.');
    }

    // «افتح محطة الحارس»
    if (norm.includes('محطه الحارس') || norm.includes('حارس') || norm.includes('بوابه')) {
      return this.handleNavigate('/guard-station', 'محطة الحارس', currentUser, 'guardStation', navigate, 'جاري فتح محطة الحارس والموزع.');
    }

    // «افتح المراقبة اليومية»
    if (norm.includes('المراقبه اليوميه') || norm.includes('المراقبه') || norm.includes('شاشه المراقبه')) {
      return this.handleNavigate('/watcher', 'المراقبة اليومية', currentUser, 'watcher', navigate, 'جاري فتح شاشة المراقبة اليومية.');
    }

    // «افتح ماسح الباركود»
    if (norm.includes('ماسح الباركود') || norm.includes('الماسح') || norm.includes('كاميرا الباركود')) {
      return this.handleNavigate('/scanner', 'ماسح الباركود', currentUser, 'mobileScanner', navigate, 'جاري فتح ماسح الباركود السريع.');
    }

    // «افتح التقارير»
    if (norm.includes('افتح التقارير') || (norm.includes('تقارير') && norm.includes('افتح'))) {
      return this.handleNavigate('/reports', 'التقارير', currentUser, 'reports', navigate, 'جاري فتح مركز التقارير المدرسية.');
    }

    // «افتح الاستبيانات»
    if (norm.includes('الاستبيانات') || norm.includes('استبيان')) {
      return this.handleNavigate('/surveys', 'الاستبيانات', currentUser, 'surveys', navigate, 'جاري فتح استبيانات قياس الرضا.');
    }

    // «افتح إدارة الرسائل / واتساب»
    if (norm.includes('واتساب') || norm.includes('الرسائل') || norm.includes('ارسال الرسائل')) {
      if (!canSendWhatsApp(currentUser)) {
        return deniedResult('عفواً، لا يملك حسابك صلاحية استخدام بوابة واتساب وإدارة الرسائل.');
      }
      navigate('/whatsapp');
      return {
        type: 'navigate',
        title: 'إدارة رسائل واتساب',
        spokenText: 'جاري فتح بوابة رسائل واتساب.',
        actionButton: { label: 'فتح واتساب', path: '/whatsapp' }
      };
    }

    // «افتح المعلمين والانتظار»
    if (norm.includes('الانتظار') || norm.includes('حصص الانتظار') || norm.includes('المعلمين والانتظار') || norm.includes('من في الانتظار')) {
      return this.handleNavigate(
        '/admin?tab=staff-operations',
        'المعلمين وحصص الانتظار',
        currentUser,
        'admin',
        navigate,
        'تم فتح جدول المعلمين وحصص الانتظار لليوم.'
      );
    }

    // «افتح إدارة الطلاب»
    if (norm.includes('اداره الطلاب') || (norm.includes('الطلاب') && norm.includes('افتح'))) {
      return this.handleNavigate('/admin?tab=students', 'إدارة الطلاب', currentUser, 'admin', navigate, 'جاري فتح قائمة وسجلات الطلاب.');
    }

    // «افتح النسخ الاحتياطي»
    if (norm.includes('نسخ احتياطي') || norm.includes('النسخ الاحتياطي')) {
      return this.handleNavigate('/admin?tab=backup', 'النسخ الاحتياطي', currentUser, 'admin', navigate, 'تم فتح مركز النسخ الاحتياطي وقاعدة البيانات.');
    }

    // «افتح إعدادات النظام»
    if (norm.includes('الاعدادات') || norm.includes('اعدادات النظام')) {
      return this.handleNavigate('/admin?tab=settings', 'إعدادات النظام', currentUser, 'admin', navigate, 'جاري فتح إعدادات النظام.');
    }

    // «افتح الدعم الفني»
    if (norm.includes('الدعم الفني') || norm.includes('الدعم')) {
      return this.handleNavigate('/support', 'الدعم الفني', currentUser, 'support', navigate, 'جاري فتح شاشة الدعم الفني والمساعدة.');
    }

    // «افتح الرئيسية / لوحة القيادة»
    if (norm.includes('الرئيسيه') || norm.includes('لوحه القياده') || norm.includes('الصفحه الرئيسيه')) {
      navigate('/');
      return {
        type: 'navigate',
        title: 'لوحة القيادة الرئيسية',
        spokenText: 'تمت العودة للوحة القيادة الرئيسية.',
        actionButton: { label: 'الانتقال للرئيسية', path: '/' }
      };
    }

    // 6. أوامر التقارير المجهزة
    // «جهّز تقرير الأسبوع»
    if (norm.includes('تقرير الاسبوع') || norm.includes('التقرير الاسبوعي') || norm.includes('ملخص الاسبوع')) {
      return await this.handleWeeklyReport(currentUser);
    }

    // «اعرض تقرير الغياب المزمن»
    if (norm.includes('غياب مزمن') || norm.includes('الغياب المزمن') || norm.includes('اكثر الطلاب غيابا')) {
      if (!accessPolicy.canAccessRoute(currentUser, 'reports')) {
        return deniedResult('عفواً، لا يملك حسابك صلاحية الوصول لتقارير الغياب المزمن.');
      }
      navigate('/reports');
      return {
        type: 'navigate',
        title: 'تقرير الغياب المزمن',
        spokenText: 'تم فتح تقرير حالات الغياب المتكرر والمزمن.',
        actionButton: { label: 'فتح تقرير الغياب المزمن', path: '/reports' }
      };
    }

    // 7. أمر كشف غياب فصل محدد («اعرض غياب ثالث باء»)
    if (norm.includes('غياب') || norm.includes('كشف غياب') || norm.includes('اعرض غياب')) {
      const parsedClass = parseGradeAndSection(raw);
      if (parsedClass) {
        return await this.handleClassAbsenceRoster(parsedClass.grade, parsedClass.section, currentUser);
      }
    }

    // 8. أوامر شؤون الطلاب (بحث، استفسار عن حضور، رقم ولي أمر، نداء خروج، تسجيل حضور)
    // نداء خروج لطالب
    if (norm.includes('نداء خروج') || norm.includes('استدعاء الطالب') || norm.includes('نداء للطالب')) {
      const studentName = extractStudentName(raw);
      if (studentName) {
        return await this.handleStudentDismissalCall(studentName, currentUser);
      }
    }

    // تسجيل حضور / غياب طالب
    if (norm.includes('سجل حضور') || norm.includes('سجل غياب') || norm.includes('حاضر الطالب') || norm.includes('غائب الطالب')) {
      const isAbsent = norm.includes('غياب') || norm.includes('غائب');
      const studentName = extractStudentName(raw);
      if (studentName) {
        return await this.handleStudentAttendanceModification(studentName, isAbsent ? 'absent' : 'present', currentUser);
      }
    }

    // استفسار هل الطالب حاضر اليوم؟ أو البحث عنه أو رقم ولي أمره
    if (
      norm.includes('هل الطالب') ||
      norm.includes('ابحث عن') ||
      norm.includes('رقم ولي امر') ||
      norm.includes('ولي امر الطالب') ||
      norm.includes('معلومات الطالب')
    ) {
      const studentName = extractStudentName(raw);
      if (studentName) {
        return await this.handleStudentLookup(studentName, currentUser);
      }
    }

    // إذا لم يتطابق مع أمر محدد، نبحث هل يحتوي على اسم طالب
    const possibleName = extractStudentName(raw);
    if (possibleName.length >= 3 && canUseRoute(currentUser, 'watcher')) {
      const lookupResult = await this.handleStudentLookup(possibleName, currentUser);
      if (lookupResult.type !== 'error') {
        return lookupResult;
      }
    }

    // رد افتراضي ذكي
    return {
      type: 'info',
      title: 'أمر غير معروف',
      spokenText: 'لم أفهم طلبك بدقة. يمكنك قول: «كم طالب غائب اليوم؟»، «افتح مركز التكاملات»، أو «مساعدة» لعرض الأوامر.',
      actionButton: {
        label: 'عرض دليل الأوامر',
        onClickKey: 'help'
      }
    };
  }

  /**
   * تنفيذ إجراء بعد تأكيد المستخدم الصريح
   */
  public async executeConfirmedAction(action: UstadPendingAction, currentUser: User | null): Promise<UstadActionPayload> {
    switch (action.type) {
      case 'mark_attendance':
        return this.confirmAttendance(action.studentId, action.newStatus, currentUser);
      case 'call_dismissal':
        return this.confirmDismissalCall(action.studentId, currentUser);
      case 'send_absence_alerts':
        return this.confirmAbsenceAlerts(action.studentIds, currentUser);
    }
  }

  /**
   * فحص الصلاحية والتنقل السلس
   */
  private handleNavigate(
    path: string,
    title: string,
    currentUser: User | null,
    requiredRoute: ProtectedRouteKey,
    navigate: (path: string) => void,
    speech: string
  ): UstadActionPayload {
    if (!canUseRoute(currentUser, requiredRoute)) {
      return deniedResult(`عفواً، حسابك لا يملك صلاحية الوصول إلى شاشة ${title}.`);
    }

    navigate(path);
    return {
      type: 'navigate',
      title,
      spokenText: speech,
      actionButton: {
        label: `الانتقال إلى ${title}`,
        path
      }
    };
  }

  /**
   * أعداد اليوم محسوبة من طلاب نطاق المستخدم فقط
   */
  private async loadTodayCounts(user: User) {
    const today = getLocalISODate();
    const [students, attendance] = await Promise.all([loadScopedStudents(user), db.getAttendance(today)]);
    const scopedIds = new Set(students.map(student => normalizeStudentId(student.id)));
    const counts = getAttendanceStatusCounts(
      attendance.filter(record => scopedIds.has(normalizeStudentId(record.student_id))),
      students.length,
      { date: today }
    );
    const rate = counts.total > 0 ? Math.round((counts.attended / counts.total) * 100) : 0;
    return { ...counts, rate, date: today };
  }

  /**
   * معالجة استعلام غياب اليوم
   */
  private async handleAbsenceTodayStats(user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على إحصائيات الحضور.');
    }

    try {
      const counts = await this.loadTodayCounts(user);
      const spoken = `عدد الطلاب الغائبين اليوم هو ${counts.absent} ${counts.absent === 1 ? 'طالب' : 'طالباً'}، من إجمالي ${counts.total}، بنسبة حضور بلغت ${counts.rate} بالمئة.`;

      return {
        type: 'stats_absence',
        title: 'إحصائية الغياب اليومي',
        spokenText: spoken,
        data: counts,
        actionButton: {
          label: 'عرض في المراقبة اليومية',
          path: '/watcher?tab=absent'
        }
      };
    } catch {
      return {
        type: 'error',
        title: 'تعذر جلب الإحصائيات',
        spokenText: 'عفواً، تعذر استرجاع إحصائيات الغياب حالياً.'
      };
    }
  }

  /**
   * معالجة استعلام الحضور ونسبة اليوم
   */
  private async handleAttendanceTodayStats(user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على إحصائيات الحضور.');
    }

    try {
      const counts = await this.loadTodayCounts(user);
      const spoken = `نسبة الحضور اليوم ${counts.rate} بالمئة، وحضر حتى الآن ${counts.attended} طالباً من أصل ${counts.total}.`;

      return {
        type: 'stats_attendance',
        title: 'إحصائية الحضور اليومي',
        spokenText: spoken,
        data: counts,
        actionButton: {
          label: 'فتح المراقبة اليومية',
          path: '/watcher'
        }
      };
    } catch {
      return {
        type: 'error',
        title: 'تعذر جلب الإحصائية',
        spokenText: 'تعذر الوصول إلى بيانات الحضور الآن.'
      };
    }
  }

  /**
   * معالجة إحصائية التأخر
   */
  private async handleLateTodayStats(user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على إحصائيات الحضور.');
    }

    try {
      const counts = await this.loadTodayCounts(user);
      const spoken = `عدد الطلاب المتأخرين المسجلين اليوم هو ${counts.late} ${counts.late === 1 ? 'طالب' : 'طلاب'}.`;

      return {
        type: 'stats_absence',
        title: 'إحصائية التأخر الصباحي',
        spokenText: spoken,
        data: counts,
        actionButton: {
          label: 'عرض المتأخرين في المراقبة',
          path: '/watcher?tab=late'
        }
      };
    } catch {
      return {
        type: 'error',
        title: 'خطأ في جلب التأخر',
        spokenText: 'حدث خطأ أثناء قراءة بيانات المتأخرين.'
      };
    }
  }

  /**
   * معالجة حالة الانصراف
   */
  private handleDismissalsStats(): UstadActionPayload {
    return {
      type: 'info',
      title: 'حالة انصراف الطلاب',
      spokenText: 'يمكنك متابعة وتوثيق نداءات ومغادرة الطلاب عبر كشك الانصراف ولوحة النداء.',
      actionButton: {
        label: 'فتح كشك الانصراف',
        path: '/dismissal-kiosk'
      }
    };
  }

  /**
   * معالجة كشف غياب فصل وشعبة محددة («اعرض غياب ثالث باء»)
   */
  private async handleClassAbsenceRoster(grade: string, section: string, user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على كشوف الغياب.');
    }

    try {
      const today = getLocalISODate();
      const [students, todayAttendance] = await Promise.all([loadScopedStudents(user), db.getAttendance(today)]);
      const attended = attendedStudentIds(todayAttendance, today);

      // تصفية طلاب الصف والشعبة
      const normTargetGrade = normalizeArabicSpeech(grade);
      const normTargetSection = normalizeArabicSpeech(section);
      const classStudents = students.filter(s => {
        const matchGrade = normalizeArabicSpeech(s.class_name || '').includes(normTargetGrade);
        const matchSection = normTargetSection ? normalizeArabicSpeech(s.section || '').includes(normTargetSection) : true;
        return matchGrade && matchSection;
      });

      const absentStudents = classStudents
        .filter(s => !attended.has(normalizeStudentId(s.id)))
        .map(s => summarizeStudent(s, null));

      const label = `الصف ${grade} ${section ? `شعبة (${section})` : ''}`.trim();
      const spoken = absentStudents.length === 0
        ? `ما شاء الله! لا يوجد أي غياب مسجل اليوم في ${label}.`
        : `كشف غياب ${label}: يوجد ${absentStudents.length} ${absentStudents.length === 1 ? 'طالب غائب' : 'طلاب غائبين'} اليوم.`;

      const searchParam = encodeURIComponent(`${grade} ${section}`.trim());

      return {
        type: 'class_absence',
        title: `كشف غياب ${label}`,
        spokenText: spoken,
        data: {
          classLabel: label,
          absentStudents,
          totalInClass: classStudents.length,
          absentCount: absentStudents.length
        },
        actionButton: {
          label: 'فتح الكشف في المراقبة اليومية',
          path: `/watcher?tab=absent&search=${searchParam}`
        }
      };
    } catch {
      return {
        type: 'error',
        title: 'تعذر جلب كشف الصف',
        spokenText: 'عفواً، تعذر جلب كشف غياب هذا الفصل حالياً.'
      };
    }
  }

  /**
   * ملخص الأسبوع الدراسي الحالي من سجلات الحضور الفعلية
   */
  private async handleWeeklyReport(user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'reports')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الوصول إلى التقارير.');
    }

    try {
      const today = getLocalISODate();
      const [students, settings] = await Promise.all([loadScopedStudents(user), db.getSettings()]);
      const configuredDays = settings?.work_days?.length ? settings.work_days : ATTENDANCE_DEFAULTS.WORK_DAYS;
      const workDays = [...configuredDays].sort((a, b) => a - b);

      // أيام الأسبوع الدراسي الحالي بدءاً من الأحد
      const weekStart = new Date(`${today}T12:00:00`);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekDates = workDays.map(dayIndex => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + dayIndex);
        return { dayIndex, date: getLocalDateStr(date) };
      });

      const scopedIds = new Set(students.map(student => normalizeStudentId(student.id)));
      const records = (await db.getAttendanceRange(weekDates[0].date, weekDates[weekDates.length - 1].date))
        .filter(record => scopedIds.has(normalizeStudentId(record.student_id)));

      const days = weekDates.map(({ dayIndex, date }) => {
        const dayRecords = records.filter(record => record.date === date);
        // يوم بلا أي سجل (عطلة أو لم يُحضَّر بعد) لا يُحسب حضوره صفراً
        const hasData = date <= today && dayRecords.length > 0 && students.length > 0;
        const { attended } = getAttendanceStatusCounts(dayRecords, students.length, { date });
        return {
          day: WEEKDAY_NAMES[dayIndex] ?? '',
          date,
          presence: hasData ? Math.round((attended / students.length) * 100) : 0,
          isCompleted: date <= today,
          hasData
        };
      });

      const measuredDays = days.filter(day => day.hasData);
      const avgPresence = measuredDays.length > 0
        ? Math.round(measuredDays.reduce((sum, day) => sum + day.presence, 0) / measuredDays.length)
        : null;
      const spoken = avgPresence === null
        ? 'لا توجد سجلات حضور لهذا الأسبوع حتى الآن.'
        : `تقرير الأسبوع: متوسط الحضور في الأيام المسجلة حتى الآن ${avgPresence} بالمئة.`;

      return {
        type: 'weekly_report',
        title: 'ملخص الأسبوع الدراسي',
        spokenText: spoken,
        data: {
          avgPresence,
          totalStudents: students.length,
          days
        },
        actionButton: {
          label: 'الانتقال لمركز التقارير الكامل',
          path: '/reports'
        }
      };
    } catch {
      return {
        type: 'error',
        title: 'تعذر تجهيز التقرير',
        spokenText: 'حدث خطأ أثناء تجهيز التقرير الأسبوعي.'
      };
    }
  }

  /**
   * معاينة تنبيهات أولياء الأمور قبل الإرسال مع اشتراط التأكيد
   */
  private async handleAbsenceAlertsPreview(user: User | null): Promise<UstadActionPayload> {
    if (!canSendWhatsApp(user)) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية إرسال رسائل واتساب لأولياء الأمور.');
    }

    try {
      const settings = await db.getSettings();
      const windowNotice = absenceAlertWindowNotice(settings);
      if (windowNotice) return windowNotice;

      const today = getLocalISODate();
      const { recipients, withoutPhone } = await findAbsenceAlertRecipients(user);

      if (recipients.length === 0) {
        return {
          type: 'info',
          title: 'لا توجد تنبيهات للإرسال',
          spokenText: withoutPhone > 0
            ? `لا يوجد طالب غائب لديه رقم واتساب صالح لولي أمره. عدد الغائبين بلا رقم صالح: ${withoutPhone}.`
            : 'لا يوجد طلاب غائبون اليوم.'
        };
      }

      return {
        type: 'alerts_preview',
        title: 'تأكيد إرسال تنبيهات الغياب',
        spokenText: `وجدت ${recipients.length} من أولياء أمور الطلاب الغائبين. راجع الأسماء ونص الرسالة، ثم اضغط تأكيد الإرسال.`,
        data: {
          recipientsCount: recipients.length,
          withoutPhone,
          recipients: recipients.map(({ student, phone }) => ({
            studentId: student.id,
            studentName: student.name,
            className: formatClassLabel(student),
            phone
          })),
          messagePreview: buildAbsenceAlertMessage(settings, recipients[0].student, today),
          date: today
        },
        pendingAction: {
          type: 'send_absence_alerts',
          studentIds: recipients.map(({ student }) => student.id)
        }
      };
    } catch {
      return {
        type: 'error',
        title: 'تعذر فحص قائمة الغائبين',
        spokenText: 'حدث خطأ أثناء حصر أولياء أمور الغائبين.'
      };
    }
  }

  /**
   * البحث عن طالب ضمن نطاق المستخدم مع معالجة تشابه الأسماء
   */
  private async handleStudentLookup(studentNameQuery: string, user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على بيانات الطلاب.');
    }

    try {
      const students = await loadScopedStudents(user);
      const queryNorm = normalizeArabicSpeech(studentNameQuery);

      const matched = students.filter(s =>
        normalizeArabicSpeech(s.name).includes(queryNorm)
      );

      if (matched.length === 0) {
        return {
          type: 'error',
          title: 'لم يتم العثور على الطالب',
          spokenText: `لم أجد طالباً باسم "${studentNameQuery}" ضمن الطلاب المتاحين لحسابك.`
        };
      }

      // إذا وُجد أكثر من طالب بنفس الاسم -> سؤال توضيحي للتمييز (Disambiguation)
      if (matched.length > 1) {
        return {
          type: 'disambiguation',
          title: 'تحديد الطالب المطلوب',
          spokenText: `وجدت ${matched.length} طلاب بهذا الاسم. أي طالب تقصد؟`,
          data: {
            students: matched.map(s => summarizeStudent(s, null)),
            originalQuery: studentNameQuery
          }
        };
      }

      // وُجد طالب واحد بالضبط
      const student = matched[0];
      const today = getLocalISODate();
      const record = uniqueAttendanceByStudentDate(await db.getAttendance(today), today)
        .find(a => normalizeStudentId(a.student_id) === normalizeStudentId(student.id));

      const status = record?.status || 'absent';
      const statusArabic = status === 'present' ? 'حاضر' : status === 'late' ? 'متأخر' : 'غائب';

      const spoken = `الطالب ${student.name}، في الصف ${student.class_name || ''} شعبة ${student.section || ''}. حالته اليوم: ${statusArabic}.`;

      return {
        type: 'student_card',
        title: `بيانات الطالب: ${student.name}`,
        spokenText: spoken,
        data: {
          student: summarizeStudent(student, user),
          status,
          statusArabic,
          timestamp: record?.timestamp || record?.created_at
        },
        actionButton: {
          label: 'عرض في المراقبة اليومية',
          path: `/watcher?search=${encodeURIComponent(student.name)}`
        }
      };
    } catch {
      return {
        type: 'error',
        title: 'خطأ في البحث',
        spokenText: 'حدث خطأ أثناء البحث عن بيانات الطالب.'
      };
    }
  }

  /**
   * طلب تعديل حضور طالب مع التأكيد وكشف التشابه
   */
  private async handleStudentAttendanceModification(studentNameQuery: string, newStatus: 'present' | 'absent', user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية تعديل سجلات حضور الطلاب.');
    }

    const lookup = await this.handleStudentLookup(studentNameQuery, user);
    if (lookup.type !== 'student_card') {
      return lookup;
    }

    const student: UstadStudentSummary = lookup.data.student;
    const statusLabel = newStatus === 'present' ? 'حاضر' : 'غائب';

    return {
      type: 'confirmation',
      title: `تأكيد تسجيل ${statusLabel}`,
      spokenText: `هل تؤكد تسجيل الطالب ${student.name} ${statusLabel} اليوم؟`,
      data: {
        prompt: `تسجيل الطالب ${student.name} ${statusLabel} اليوم`,
        studentName: student.name,
        className: formatClassLabel(student)
      },
      pendingAction: { type: 'mark_attendance', studentId: student.id, newStatus }
    };
  }

  /**
   * نداء خروج طالب
   */
  private async handleStudentDismissalCall(studentNameQuery: string, user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'callBoard')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية إرسال نداءات الخروج.');
    }

    const lookup = await this.handleStudentLookup(studentNameQuery, user);
    if (lookup.type !== 'student_card') {
      return lookup;
    }

    const student: UstadStudentSummary = lookup.data.student;

    return {
      type: 'confirmation',
      title: 'تأكيد نداء خروج',
      spokenText: `هل تريد إرسال نداء خروج للطالب ${student.name} إلى لوحة النداءات؟`,
      data: {
        prompt: `إرسال نداء خروج للطالب ${student.name}`,
        studentName: student.name,
        className: formatClassLabel(student)
      },
      pendingAction: { type: 'call_dismissal', studentId: student.id }
    };
  }

  private async confirmAttendance(studentId: string, newStatus: 'present' | 'absent', user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية تعديل سجلات حضور الطلاب.');
    }

    try {
      const student = await findScopedStudent(studentId, user);
      if (!student) return studentUnavailableResult();
      const today = getLocalISODate();

      if (newStatus === 'absent') {
        const result = await db.addManualAbsence({ student_id: student.id, date: today });
        if (!result.success) {
          return { type: 'error', title: 'تعذر تسجيل الغياب', spokenText: result.message || 'تعذر تسجيل غياب الطالب.' };
        }
        return { type: 'success', title: 'تم تسجيل الغياب', spokenText: `تم تسجيل الطالب ${student.name} غائباً اليوم.` };
      }

      const existing = uniqueAttendanceByStudentDate(await db.getAttendance(today), today)
        .find(record => normalizeStudentId(record.student_id) === normalizeStudentId(student.id));
      if (existing && existing.status !== 'absent') {
        return {
          type: 'info',
          title: 'الحضور مسجل مسبقاً',
          spokenText: `الطالب ${student.name} مسجل ${existing.status === 'late' ? 'متأخراً' : 'حاضراً'} اليوم بالفعل.`
        };
      }

      // الوقت الفعلي يحدد الحضور أو التأخر وفق إعدادات الطابور والعطل
      const now = new Date();
      const result = await db.addManualAttendance({
        student_id: student.id,
        date: today,
        time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      });
      if (!result.success) {
        return { type: 'error', title: 'تعذر تسجيل الحضور', spokenText: result.message || 'تعذر تسجيل حضور الطالب.' };
      }
      return {
        type: 'success',
        title: 'تم تسجيل الحضور',
        spokenText: result.status === 'late'
          ? `تم تسجيل حضور الطالب ${student.name} متأخراً ${result.minutes_late ?? 0} دقيقة.`
          : `تم تسجيل حضور الطالب ${student.name}.`
      };
    } catch {
      return { type: 'error', title: 'تعذر تسجيل الحضور', spokenText: 'حدث خطأ أثناء حفظ سجل الحضور. لم يتغير شيء.' };
    }
  }

  private async confirmDismissalCall(studentId: string, user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'callBoard')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية إرسال نداءات الخروج.');
    }

    try {
      const student = await findScopedStudent(studentId, user);
      if (!student) return studentUnavailableResult();

      const result = await dismissals.execute({
        type: 'request-call',
        student: { id: student.id, name: student.name, class_name: student.class_name, section: student.section },
        requester: { id: user.id, name: user.name }
      });

      if (result.outcome === 'already-requested') {
        return { type: 'info', title: 'يوجد نداء نشط', spokenText: `يوجد طلب نداء نشط للطالب ${student.name} بالفعل.` };
      }
      return {
        type: 'success',
        title: 'تم إرسال نداء الخروج',
        spokenText: `تم إرسال نداء خروج للطالب ${student.name} إلى لوحة النداءات.`,
        actionButton: { label: 'فتح لوحة النداءات', path: '/call-board' }
      };
    } catch {
      return { type: 'error', title: 'تعذر إرسال النداء', spokenText: 'حدث خطأ أثناء إرسال نداء الخروج. أعد المحاولة.' };
    }
  }

  private async confirmAbsenceAlerts(studentIds: string[], user: User | null): Promise<UstadActionPayload> {
    if (!canSendWhatsApp(user)) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية إرسال رسائل واتساب لأولياء الأمور.');
    }

    try {
      const settings = await db.getSettings();
      const windowNotice = absenceAlertWindowNotice(settings);
      if (windowNotice) return windowNotice;

      // يُرسل فقط لمن راجعهم المستخدم وما زالوا غائبين الآن
      const confirmedIds = new Set(studentIds.map(id => normalizeStudentId(id)));
      const { recipients } = await findAbsenceAlertRecipients(user);
      const stillAbsent = recipients.filter(({ student }) => confirmedIds.has(normalizeStudentId(student.id)));
      const noLongerEligible = confirmedIds.size - stillAbsent.length;

      const { queued, alreadySent } = stillAbsent.length > 0
        ? await sendAbsenceAlerts(stillAbsent, getLocalISODate(), settings)
        : { queued: 0, alreadySent: 0 };

      const notes = [
        alreadySent > 0 ? `تم تخطي ${alreadySent} سبق تنبيههم اليوم.` : '',
        noLongerEligible > 0 ? `واستُبعد ${noLongerEligible} لم يعودوا ضمن الغائبين.` : ''
      ].filter(Boolean).join(' ');

      if (queued === 0) {
        return {
          type: 'info',
          title: 'لم تُرسل رسائل جديدة',
          spokenText: `لم تُضف أي رسالة جديدة. ${notes}`.trim()
        };
      }
      return {
        type: 'success',
        title: 'أُضيفت التنبيهات إلى طابور واتساب',
        spokenText: `أُضيفت تنبيهات الغياب إلى طابور واتساب لـ ${queued} من أولياء الأمور. ${notes}`.trim(),
        actionButton: { label: 'متابعة طابور واتساب', path: '/whatsapp' }
      };
    } catch {
      return {
        type: 'error',
        title: 'تعذر إرسال التنبيهات',
        spokenText: 'تعذر إرسال التنبيهات، ولم تُضف أي رسالة إلى الطابور. تأكد من تشغيل خادم واتساب ثم أعد المحاولة.'
      };
    }
  }
}

export const ustadIntentEngine = new UstadIntentEngine();
