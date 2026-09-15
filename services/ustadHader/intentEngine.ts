// =============================================================================
// نظام حاضر (Hader) - محرك الأوامر الذكية لـ «أستاذ حاضر»
// =============================================================================
// يصنّف الجملة عبر جدول النوايا، ثم ينفذ النية بعد فحص الصلاحيات ونطاق الفصول.
// الإجراءات التي تغيّر البيانات تتطلب تأكيداً صريحاً، وتُسجَّل في سجل الأنشطة.

import { db, getLocalISODate } from '../db';
import { getLocalDateStr, normalizeStudentId } from '../dbHelpers';
import { dismissals } from '../dismissals';
import { ATTENDANCE_DEFAULTS, Student, User } from '../../types';
import { accessPolicy, ProtectedRouteKey } from '../../modules/access';
import { getAttendanceStatusCounts } from '../../modules/attendance';
import { analyzeUtterance, ClassReference, matchesClassReference, normalizeArabicSpeech } from './arabicLexicon';
import { IntentMatch, rankIntents, suggestIntents, SUGGESTED_COMMANDS, UstadIntentId } from './intentClassifier';
import { resolveStudent } from './studentResolver';
import { stripWakeWord } from './speechService';
import { buildAbsenceAlertMessage, sendAbsenceAlerts } from './absenceAlerts';
import { learnPhrase, recallPhrase } from './learnedPhrases';
import { loadMorningBriefing } from './morningBriefing';
import {
  absenceAlertWindowNotice,
  attendedStudentIds,
  canSendWhatsApp,
  canUseRoute,
  deniedResult,
  findAbsenceAlertRecipients,
  findScopedStudent,
  formatClassLabel,
  isWithinArrivalWindow,
  loadScopedStudents,
  pad2,
  studentUnavailableResult,
  summarizeStudent,
  todayRecordFor
} from './engineSupport';
import type {
  UstadActionPayload,
  UstadConversationContext,
  UstadPendingAction,
  UstadStudentFollowUp,
  UstadSuggestion
} from './assistantTypes';

export type {
  UstadActionPayload,
  UstadConversationContext,
  UstadSuggestion,
  UstadPendingAction,
  UstadResultType,
  UstadStudentFollowUp,
  UstadStudentSummary
} from './assistantTypes';

const WEEKDAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const SILENCE_COMMANDS = new Set(['اسكت', 'توقف', 'اصمت', 'بس']);
// إغلاق البطاقة بالصوت: أمر مباشر، أو عبارة ختام تُرد بتحية قصيرة
const DISMISS_COMMANDS = new Set(['اغلق', 'اقفل', 'سكر', 'الغاء', 'انتهيت', 'خلاص', 'باي', 'مع السلامه', 'وداعا']);
const FAREWELL_COMMANDS = new Set(['شكرا', 'شكرا لك', 'شكرا جزيلا', 'يعطيك العافيه', 'الله يعطيك العافيه', 'ما قصرت', 'تسلم', 'كفو']);
// المتابعة «وفي رابع أ؟» أو «سجله حاضر» تُفهم خلال دقائق من الطلب السابق فقط
const CONTEXT_TTL_MS = 3 * 60 * 1000;
const CLASS_FOLLOW_UP_INTENTS = new Set<string>(['class.absence', 'stats.absence', 'stats.attendance', 'stats.late', 'briefing.today']);

interface NavigationTarget {
  path: string;
  title: string;
  // null: متاح لكل من يدخل المنصة
  route: ProtectedRouteKey | 'whatsapp' | null;
  speech: string;
}

const NAVIGATION: Partial<Record<UstadIntentId, NavigationTarget>> = {
  'nav.integrations': { path: '/admin?tab=integrations', title: 'مركز التكاملات', route: 'admin', speech: 'أبشر، جاري فتح مركز التكاملات ومراجعة المنصات.' },
  'nav.kiosk': { path: '/kiosk', title: 'كشك الحضور', route: 'kiosk', speech: 'جاري فتح كشك الحضور.' },
  'nav.dismissal_kiosk': { path: '/dismissal-kiosk', title: 'كشك الانصراف', route: 'dismissalKiosk', speech: 'جاري فتح كشك الانصراف.' },
  'nav.call_board': { path: '/call-board', title: 'لوحة النداءات', route: 'callBoard', speech: 'جاري فتح لوحة نداءات الانصراف.' },
  'nav.guard_station': { path: '/guard-station', title: 'محطة الحارس', route: 'guardStation', speech: 'جاري فتح محطة الحارس والموزع.' },
  'nav.watcher': { path: '/watcher', title: 'المراقبة اليومية', route: 'watcher', speech: 'جاري فتح شاشة المراقبة اليومية.' },
  'nav.scanner': { path: '/scanner', title: 'ماسح الباركود', route: 'mobileScanner', speech: 'جاري فتح ماسح الباركود السريع.' },
  'nav.reports': { path: '/reports', title: 'التقارير', route: 'reports', speech: 'جاري فتح مركز التقارير المدرسية.' },
  'nav.surveys': { path: '/surveys', title: 'الاستبيانات', route: 'surveys', speech: 'جاري فتح استبيانات قياس الرضا.' },
  'nav.whatsapp': { path: '/whatsapp', title: 'بوابة رسائل واتساب', route: 'whatsapp', speech: 'جاري فتح بوابة رسائل واتساب.' },
  'nav.staff': { path: '/admin?tab=staff-operations', title: 'المعلمين وحصص الانتظار', route: 'admin', speech: 'تم فتح جدول المعلمين وحصص الانتظار لليوم.' },
  'nav.students': { path: '/admin?tab=students', title: 'إدارة الطلاب', route: 'admin', speech: 'جاري فتح قائمة وسجلات الطلاب.' },
  'nav.backup': { path: '/admin?tab=backup', title: 'النسخ الاحتياطي', route: 'admin', speech: 'تم فتح مركز النسخ الاحتياطي وقاعدة البيانات.' },
  'nav.settings': { path: '/admin?tab=settings', title: 'إعدادات النظام', route: 'admin', speech: 'جاري فتح إعدادات النظام.' },
  'nav.support': { path: '/support', title: 'الدعم الفني', route: 'support', speech: 'جاري فتح شاشة الدعم الفني والمساعدة.' },
  'nav.home': { path: '/', title: 'لوحة القيادة الرئيسية', route: null, speech: 'تمت العودة للوحة القيادة الرئيسية.' },
  'nav.activity_log': { path: '/admin?tab=activity-log', title: 'سجل الأنشطة', route: 'admin', speech: 'جاري فتح سجل الأنشطة.' },
  'report.chronic': { path: '/reports', title: 'تقرير الغياب المزمن', route: 'reports', speech: 'تم فتح تقرير حالات الغياب المتكرر والمزمن.' }
};

const STUDENT_FOLLOW_UPS: Partial<Record<UstadIntentId, UstadStudentFollowUp>> = {
  'student.lookup': { kind: 'lookup' },
  'student.mark_present': { kind: 'mark_attendance', newStatus: 'present' },
  'student.mark_absent': { kind: 'mark_attendance', newStatus: 'absent' },
  'student.dismissal_call': { kind: 'call_dismissal' }
};

const unknownResult = (): UstadActionPayload => ({
  type: 'info',
  title: 'أمر غير معروف',
  spokenText: 'لم أفهم طلبك بدقة. يمكنك قول: «كم طالب غائب اليوم؟»، «افتح مركز التكاملات»، أو «مساعدة» لعرض الأوامر.',
  actionButton: { label: 'عرض دليل الأوامر', onClickKey: 'help' }
});

const forcedMatch = (id: UstadIntentId, classRef: ClassReference | null): IntentMatch => ({
  id, score: 0, studentQuery: '', classRef, signals: 1, studentFromContext: false
});

const followUpIntent = (followUp: UstadStudentFollowUp): UstadIntentId =>
  followUp.kind === 'lookup'
    ? 'student.lookup'
    : followUp.kind === 'call_dismissal'
    ? 'student.dismissal_call'
    : followUp.newStatus === 'present'
    ? 'student.mark_present'
    : 'student.mark_absent';

// توافق مع الاستخدامات السابقة: «اعرض غياب ثالث باء» ← { grade: 'ثالث', section: 'ب' }
export function parseGradeAndSection(query: string): { grade: string; section: string } | null {
  const ref = analyzeUtterance(query).classRef;
  return ref ? { grade: ref.gradeLabel, section: ref.sectionLabel } : null;
}

// اسم الطالب بعد حذف كلمات الأوامر والمجاملة والصف
export function extractStudentName(query: string): string {
  return analyzeUtterance(query).tokens
    .filter(token => token.role === 'word' && token.concepts.length === 0)
    .map(token => token.text)
    .join(' ');
}

function followUpRoute(followUp: UstadStudentFollowUp): { route: ProtectedRouteKey; denied: string } {
  return followUp.kind === 'call_dismissal'
    ? { route: 'callBoard', denied: 'عفواً، لا يملك حسابك صلاحية إرسال نداءات الخروج.' }
    : followUp.kind === 'mark_attendance'
    ? { route: 'watcher', denied: 'عفواً، لا يملك حسابك صلاحية تعديل سجلات حضور الطلاب.' }
    : { route: 'watcher', denied: 'عفواً، لا يملك حسابك صلاحية الاطلاع على بيانات الطلاب.' };
}

class UstadIntentEngine {
  /**
   * معالجة الأمر الصوتي أو المكتوب وإرجاع النتيجة المناسبة
   */
  public async executeCommand(
    command: string,
    currentUser: User | null,
    navigate: (path: string) => void,
    context: UstadConversationContext | null = null
  ): Promise<UstadActionPayload> {
    const utterance = stripWakeWord(command.trim());
    const norm = normalizeArabicSpeech(utterance);

    if (!norm) {
      return { type: 'info', title: 'أستاذ حاضر يستمع', spokenText: 'نعم، تفضّل.' };
    }
    if (SILENCE_COMMANDS.has(norm)) {
      return { type: 'silence', title: 'تم إيقاف الرد الصوتي', spokenText: '' };
    }
    if (DISMISS_COMMANDS.has(norm)) {
      return { type: 'dismiss', title: 'إلى اللقاء', spokenText: '' };
    }
    if (FAREWELL_COMMANDS.has(norm)) {
      return { type: 'dismiss', title: 'في الخدمة دائماً', spokenText: 'العفو، في الخدمة.' };
    }

    const activeContext = context && Date.now() - context.at <= CONTEXT_TTL_MS ? context : null;
    return (await this.understand(utterance, currentUser, navigate, activeContext)) ?? this.suggestionsFor(utterance);
  }

  /**
   * تنفيذ اقتراح اختاره المستخدم لجملة لم تُفهم، مع تذكّر الجملة على هذا الجهاز
   */
  public async executeSuggestion(
    suggestion: UstadSuggestion,
    utterance: string,
    currentUser: User | null,
    navigate: (path: string) => void
  ): Promise<UstadActionPayload> {
    const intentId = suggestion.intentId as UstadIntentId;
    if (SUGGESTED_COMMANDS[intentId] !== suggestion.command) return unknownResult();
    learnPhrase(stripWakeWord(utterance), intentId);
    return this.executeCommand(suggestion.command, currentUser, navigate);
  }

  // الترتيب: عبارة تعلّمها من قبل، ثم جدول النوايا مع سياق المحادثة، ثم متابعة صف سابق
  private async understand(
    utterance: string,
    user: User | null,
    navigate: (path: string) => void,
    context: UstadConversationContext | null
  ): Promise<UstadActionPayload | null> {
    const learned = recallPhrase(utterance);
    if (learned && !STUDENT_FOLLOW_UPS[learned]) {
      const match = forcedMatch(learned, analyzeUtterance(utterance).classRef);
      const result = await this.dispatch(match, user, navigate, utterance);
      if (result) return this.withContext(result, match.id, match.classRef);
    }

    const [best] = rankIntents(utterance, { contextStudent: Boolean(context?.studentId) });
    if (best?.studentFromContext && context?.studentId) {
      return this.executeStudentFollowUp(STUDENT_FOLLOW_UPS[best.id] ?? { kind: 'lookup' }, context.studentId, user, utterance);
    }

    if (best) {
      const result = await this.dispatch(best, user, navigate, utterance);
      if (result) return this.withContext(result, best.id, best.classRef);

      // لا طالب بالاسم المستخرج: ربما كانت الكلمة الزائدة مجاملة لا اسماً
      const [withoutName] = rankIntents(utterance, { ignoreRemainder: true });
      if (withoutName) {
        const fallback = await this.dispatch(withoutName, user, navigate, utterance);
        if (fallback) return this.withContext(fallback, withoutName.id, withoutName.classRef);
      }
      if (best.signals > 0) {
        return {
          type: 'error',
          title: 'لم يتم العثور على الطالب',
          spokenText: `لم أجد طالباً باسم "${best.studentQuery}" ضمن الطلاب المتاحين لحسابك.`
        };
      }
    }

    // «وفي رابع أ؟» بعد كشف غياب أو إحصائية: الصف الجديد على الطلب نفسه
    const { classRef } = analyzeUtterance(utterance);
    if (classRef && context && CLASS_FOLLOW_UP_INTENTS.has(context.intentId)) {
      return this.withContext(await this.handleClassAbsenceRoster(classRef, user), 'class.absence', classRef);
    }
    return null;
  }

  private suggestionsFor(utterance: string): UstadActionPayload {
    return {
      type: 'suggestions',
      title: 'هل تقصد أحد هذه الأوامر؟',
      spokenText: 'لم أفهم طلبك بدقة. اختر الأمر الأقرب لما تقصد، وسأتذكر هذه الصياغة في المرة القادمة.',
      data: { suggestions: suggestIntents(utterance), utterance }
    };
  }

  // ما تحتاجه الجملة التالية لتُفهم كمتابعة: آخر نية، وآخر طالب، وآخر صف
  private withContext(result: UstadActionPayload, intentId: UstadIntentId, classRef: ClassReference | null): UstadActionPayload {
    if (result.type === 'error' || result.type === 'navigate' || result.type === 'silence') return result;
    const pending = result.pendingAction;
    const studentId: string | undefined = result.data?.student?.id
      ?? (pending && pending.type !== 'send_absence_alerts' ? pending.studentId : undefined);
    return { ...result, context: { intentId, studentId, classRef, at: Date.now() } };
  }

  /**
   * تنفيذ إجراء بعد تأكيد المستخدم الصريح، وتوثيقه في سجل الأنشطة
   */
  public async executeConfirmedAction(action: UstadPendingAction, currentUser: User | null): Promise<UstadActionPayload> {
    const result = action.type === 'mark_attendance'
      ? await this.confirmAttendance(action.studentId, action.newStatus, currentUser)
      : action.type === 'call_dismissal'
      ? await this.confirmDismissalCall(action.studentId, currentUser)
      : await this.confirmAbsenceAlerts(action.studentIds, currentUser);

    await recordAssistantActivity(action, result, currentUser);
    return result;
  }

  /**
   * متابعة الطلب الأصلي بعد اختيار طالب من قائمة الأسماء المتشابهة
   */
  public async executeStudentFollowUp(
    followUp: UstadStudentFollowUp,
    studentId: string,
    currentUser: User | null,
    utterance?: string
  ): Promise<UstadActionPayload> {
    const { route, denied } = followUpRoute(followUp);
    if (!canUseRoute(currentUser, route)) return deniedResult(denied);

    try {
      const student = await findScopedStudent(studentId, currentUser);
      if (!student) return studentUnavailableResult();
      return this.withContext(await this.presentStudentFollowUp(followUp, student, currentUser, utterance), followUpIntent(followUp), null);
    } catch {
      return { type: 'error', title: 'خطأ في البحث', spokenText: 'حدث خطأ أثناء قراءة بيانات الطالب.' };
    }
  }

  // null تعني نية طالب لم يُعثر على اسمه
  private async dispatch(
    match: IntentMatch,
    user: User | null,
    navigate: (path: string) => void,
    utterance: string
  ): Promise<UstadActionPayload | null> {
    const followUp = STUDENT_FOLLOW_UPS[match.id];
    if (followUp) return this.handleStudentIntent(match, followUp, user, utterance);

    const target = NAVIGATION[match.id];
    if (target) return this.handleNavigate(target, user, navigate);

    switch (match.id) {
      case 'greeting':
        return {
          type: 'info',
          title: 'أهلاً بك',
          actionButton: { label: 'ملخص اليوم', onClickKey: 'briefing' },
          spokenText: normalizeArabicSpeech(utterance).includes('سلام') ? 'وعليكم السلام ورحمة الله، تفضّل كيف أخدمك؟' : 'أهلاً بك، تفضّل كيف أخدمك؟'
        };
      case 'briefing.today':
        return this.handleBriefing(user);
      case 'help':
        return {
          type: 'help',
          title: 'دليل أوامر أستاذ حاضر',
          spokenText: 'أهلاً بك! يمكنك سؤالي عن الغياب، أو طلب فتح أي شاشة، أو إعداد التقارير، أو إرسال الرسائل.'
        };
      case 'theme.dark':
        return { type: 'theme_changed', title: 'تم تفعيل الوضع الداكن', spokenText: 'تم تفعيل الوضع الداكن بنجاح.', data: { mode: 'dark' } };
      case 'theme.light':
        return { type: 'theme_changed', title: 'تم تفعيل الوضع الفاتح', spokenText: 'تم تفعيل الوضع الفاتح بنجاح.', data: { mode: 'light' } };
      case 'alerts.absence':
        return this.handleAbsenceAlertsPreview(user, utterance);
      case 'stats.absence':
      case 'stats.attendance':
      case 'stats.late':
        return this.handleTodayStats(match.id, user);
      case 'stats.dismissal':
        return {
          type: 'info',
          title: 'حالة انصراف الطلاب',
          spokenText: 'يمكنك متابعة وتوثيق نداءات ومغادرة الطلاب عبر كشك الانصراف ولوحة النداء.',
          actionButton: { label: 'فتح كشك الانصراف', path: '/dismissal-kiosk' }
        };
      case 'class.absence':
        return match.classRef ? this.handleClassAbsenceRoster(match.classRef, user) : unknownResult();
      case 'report.weekly':
        return this.handleWeeklyReport(user);
      default:
        return unknownResult();
    }
  }

  private async handleBriefing(user: User | null): Promise<UstadActionPayload> {
    try {
      const briefing = await loadMorningBriefing(user);
      if (!briefing) return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على إحصائيات الحضور.');
      if (briefing.status !== 'ready') {
        return {
          type: 'info',
          title: briefing.status === 'holiday' ? 'اليوم عطلة' : 'الملخص لم يجهز بعد',
          spokenText: briefing.spokenText,
          data: briefing
        };
      }
      return {
        type: 'briefing',
        title: 'ملخص اليوم',
        spokenText: briefing.spokenText,
        data: briefing,
        actionButton: { label: 'عرض الغائبين في المراقبة', path: '/watcher?tab=absent' }
      };
    } catch {
      return { type: 'error', title: 'تعذر تجهيز الملخص', spokenText: 'حدث خطأ أثناء تجهيز ملخص اليوم.' };
    }
  }

  private handleNavigate(target: NavigationTarget, user: User | null, navigate: (path: string) => void): UstadActionPayload {
    const allowed = target.route === null
      ? Boolean(user)
      : target.route === 'whatsapp'
      ? canSendWhatsApp(user)
      : canUseRoute(user, target.route);
    if (!allowed) {
      return deniedResult(`عفواً، حسابك لا يملك صلاحية الوصول إلى شاشة ${target.title}.`);
    }

    navigate(target.path);
    return {
      type: 'navigate',
      title: target.title,
      spokenText: target.speech,
      actionButton: { label: `الانتقال إلى ${target.title}`, path: target.path }
    };
  }

  private async handleStudentIntent(
    match: IntentMatch,
    followUp: UstadStudentFollowUp,
    user: User | null,
    utterance: string
  ): Promise<UstadActionPayload | null> {
    const { route, denied } = followUpRoute(followUp);
    if (!canUseRoute(user, route)) return deniedResult(denied);

    try {
      const resolution = resolveStudent(await loadScopedStudents(user), match.studentQuery, match.classRef);
      if (resolution.kind === 'none') return null;

      if (resolution.kind === 'ambiguous') {
        const { candidates, total } = resolution;
        return {
          type: 'disambiguation',
          title: 'تحديد الطالب المطلوب',
          spokenText: total > candidates.length
            ? `وجدت ${total} طلاب بهذا الاسم، وأعرض أقربهم. اذكر الاسم كاملاً أو الصف لتضييق البحث.`
            : `وجدت ${total} طلاب بهذا الاسم. أي طالب تقصد؟`,
          data: {
            students: candidates.map(student => summarizeStudent(student, null)),
            total,
            query: match.studentQuery,
            utterance
          },
          followUp
        };
      }

      return await this.presentStudentFollowUp(followUp, resolution.student, user, utterance);
    } catch {
      return { type: 'error', title: 'خطأ في البحث', spokenText: 'حدث خطأ أثناء البحث عن بيانات الطالب.' };
    }
  }

  private async presentStudentFollowUp(
    followUp: UstadStudentFollowUp,
    student: Student,
    user: User,
    utterance?: string
  ): Promise<UstadActionPayload> {
    if (followUp.kind === 'lookup') return this.studentCard(student, user);

    const className = formatClassLabel(student);
    if (followUp.kind === 'mark_attendance') {
      const statusLabel = followUp.newStatus === 'present' ? 'حاضر' : 'غائب';
      return {
        type: 'confirmation',
        title: `تأكيد تسجيل ${statusLabel}`,
        spokenText: `هل تؤكد تسجيل الطالب ${student.name} ${statusLabel} اليوم؟`,
        data: { prompt: `تسجيل الطالب ${student.name} ${statusLabel} اليوم`, studentName: student.name, className },
        pendingAction: { type: 'mark_attendance', studentId: student.id, newStatus: followUp.newStatus, utterance }
      };
    }

    return {
      type: 'confirmation',
      title: 'تأكيد نداء خروج',
      spokenText: `هل تريد إرسال نداء خروج للطالب ${student.name} إلى لوحة النداءات؟`,
      data: { prompt: `إرسال نداء خروج للطالب ${student.name}`, studentName: student.name, className },
      pendingAction: { type: 'call_dismissal', studentId: student.id, utterance }
    };
  }

  private async studentCard(student: Student, user: User): Promise<UstadActionPayload> {
    const today = getLocalISODate();
    const [attendance, settings] = await Promise.all([db.getAttendance(today), db.getSettings()]);
    const record = todayRecordFor(attendance, today, student.id);

    const status = record?.status ?? (isWithinArrivalWindow(settings) ? 'pending' : 'absent');
    const statusArabic = status === 'present'
      ? 'حاضر'
      : status === 'late'
      ? 'متأخر'
      : status === 'pending'
      ? 'لم يُسجَّل وصوله بعد'
      : 'غائب';

    return {
      type: 'student_card',
      title: `بيانات الطالب: ${student.name}`,
      spokenText: `الطالب ${student.name}، في الصف ${student.class_name || ''} شعبة ${student.section || ''}. حالته اليوم: ${statusArabic}.`,
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

  private async handleTodayStats(intent: 'stats.absence' | 'stats.attendance' | 'stats.late', user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على إحصائيات الحضور.');
    }

    try {
      const counts = await this.loadTodayCounts(user);
      if (intent === 'stats.attendance') {
        return {
          type: 'stats_attendance',
          title: 'إحصائية الحضور اليومي',
          spokenText: `نسبة الحضور اليوم ${counts.rate} بالمئة، وحضر حتى الآن ${counts.attended} طالباً من أصل ${counts.total}.`,
          data: counts,
          actionButton: { label: 'فتح المراقبة اليومية', path: '/watcher' }
        };
      }
      if (intent === 'stats.late') {
        return {
          type: 'stats_absence',
          title: 'إحصائية التأخر الصباحي',
          spokenText: `عدد الطلاب المتأخرين المسجلين اليوم هو ${counts.late} ${counts.late === 1 ? 'طالب' : 'طلاب'}.`,
          data: counts,
          actionButton: { label: 'عرض المتأخرين في المراقبة', path: '/watcher?tab=late' }
        };
      }
      return {
        type: 'stats_absence',
        title: 'إحصائية الغياب اليومي',
        spokenText: `عدد الطلاب الغائبين اليوم هو ${counts.absent} ${counts.absent === 1 ? 'طالب' : 'طالباً'}، من إجمالي ${counts.total}، بنسبة حضور بلغت ${counts.rate} بالمئة.`,
        data: counts,
        actionButton: { label: 'عرض في المراقبة اليومية', path: '/watcher?tab=absent' }
      };
    } catch {
      return { type: 'error', title: 'تعذر جلب الإحصائيات', spokenText: 'عفواً، تعذر استرجاع إحصائيات الحضور حالياً.' };
    }
  }

  /**
   * كشف غياب فصل وشعبة محددة («اعرض غياب ثالث باء»)
   */
  private async handleClassAbsenceRoster(classRef: ClassReference, user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية الاطلاع على كشوف الغياب.');
    }

    try {
      const today = getLocalISODate();
      const [students, attendance] = await Promise.all([loadScopedStudents(user), db.getAttendance(today)]);
      const attended = attendedStudentIds(attendance, today);
      const classStudents = students.filter(student => matchesClassReference(student, classRef));
      const absentStudents = classStudents
        .filter(student => !attended.has(normalizeStudentId(student.id)))
        .map(student => summarizeStudent(student, null));

      const label = `الصف ${classRef.gradeLabel}${classRef.sectionLabel ? ` شعبة (${classRef.sectionLabel})` : ''}`;
      const spoken = classStudents.length === 0
        ? `لم أجد طلاباً في ${label} ضمن الطلاب المتاحين لحسابك.`
        : absentStudents.length === 0
        ? `ما شاء الله! لا يوجد أي غياب مسجل اليوم في ${label}.`
        : `كشف غياب ${label}: يوجد ${absentStudents.length} ${absentStudents.length === 1 ? 'طالب غائب' : 'طلاب غائبين'} اليوم.`;

      return {
        type: 'class_absence',
        title: `كشف غياب ${label}`,
        spokenText: spoken,
        data: { classLabel: label, absentStudents, totalInClass: classStudents.length, absentCount: absentStudents.length },
        actionButton: {
          label: 'فتح الكشف في المراقبة اليومية',
          path: `/watcher?tab=absent&search=${encodeURIComponent(`${classRef.gradeLabel} ${classRef.sectionLabel}`.trim())}`
        }
      };
    } catch {
      return { type: 'error', title: 'تعذر جلب كشف الصف', spokenText: 'عفواً، تعذر جلب كشف غياب هذا الفصل حالياً.' };
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

      return {
        type: 'weekly_report',
        title: 'ملخص الأسبوع الدراسي',
        spokenText: avgPresence === null
          ? 'لا توجد سجلات حضور لهذا الأسبوع حتى الآن.'
          : `تقرير الأسبوع: متوسط الحضور في الأيام المسجلة حتى الآن ${avgPresence} بالمئة.`,
        data: { avgPresence, totalStudents: students.length, days },
        actionButton: { label: 'الانتقال لمركز التقارير الكامل', path: '/reports' }
      };
    } catch {
      return { type: 'error', title: 'تعذر تجهيز التقرير', spokenText: 'حدث خطأ أثناء تجهيز التقرير الأسبوعي.' };
    }
  }

  /**
   * معاينة تنبيهات أولياء الأمور قبل الإرسال مع اشتراط التأكيد
   */
  private async handleAbsenceAlertsPreview(user: User | null, utterance: string): Promise<UstadActionPayload> {
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
        pendingAction: { type: 'send_absence_alerts', studentIds: recipients.map(({ student }) => student.id), utterance }
      };
    } catch {
      return { type: 'error', title: 'تعذر فحص قائمة الغائبين', spokenText: 'حدث خطأ أثناء حصر أولياء أمور الغائبين.' };
    }
  }

  private async confirmAttendance(studentId: string, newStatus: 'present' | 'absent', user: User | null): Promise<UstadActionPayload> {
    if (!canUseRoute(user, 'watcher')) {
      return deniedResult('عفواً، لا يملك حسابك صلاحية تعديل سجلات حضور الطلاب.');
    }

    try {
      const student = await findScopedStudent(studentId, user);
      if (!student) return studentUnavailableResult();
      const today = getLocalISODate();
      const data = { studentName: student.name };

      if (newStatus === 'absent') {
        const result = await db.addManualAbsence({ student_id: student.id, date: today });
        if (!result.success) {
          return { type: 'error', title: 'تعذر تسجيل الغياب', spokenText: result.message || 'تعذر تسجيل غياب الطالب.', data };
        }
        return { type: 'success', title: 'تم تسجيل الغياب', spokenText: `تم تسجيل الطالب ${student.name} غائباً اليوم.`, data };
      }

      const existing = todayRecordFor(await db.getAttendance(today), today, student.id);
      if (existing && existing.status !== 'absent') {
        return {
          type: 'info',
          title: 'الحضور مسجل مسبقاً',
          spokenText: `الطالب ${student.name} مسجل ${existing.status === 'late' ? 'متأخراً' : 'حاضراً'} اليوم بالفعل.`,
          data
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
        return { type: 'error', title: 'تعذر تسجيل الحضور', spokenText: result.message || 'تعذر تسجيل حضور الطالب.', data };
      }
      return {
        type: 'success',
        title: 'تم تسجيل الحضور',
        spokenText: result.status === 'late'
          ? `تم تسجيل حضور الطالب ${student.name} متأخراً ${result.minutes_late ?? 0} دقيقة.`
          : `تم تسجيل حضور الطالب ${student.name}.`,
        data
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
      const data = { studentName: student.name };

      const result = await dismissals.execute({
        type: 'request-call',
        student: { id: student.id, name: student.name, class_name: student.class_name, section: student.section },
        requester: { id: user.id, name: user.name }
      });

      if (result.outcome === 'already-requested') {
        return { type: 'info', title: 'يوجد نداء نشط', spokenText: `يوجد طلب نداء نشط للطالب ${student.name} بالفعل.`, data };
      }
      return {
        type: 'success',
        title: 'تم إرسال نداء الخروج',
        spokenText: `تم إرسال نداء خروج للطالب ${student.name} إلى لوحة النداءات.`,
        data,
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
      const data = { queued, alreadySent, noLongerEligible };

      if (queued === 0) {
        return { type: 'info', title: 'لم تُرسل رسائل جديدة', spokenText: `لم تُضف أي رسالة جديدة. ${notes}`.trim(), data };
      }
      return {
        type: 'success',
        title: 'أُضيفت التنبيهات إلى طابور واتساب',
        spokenText: `أُضيفت تنبيهات الغياب إلى طابور واتساب لـ ${queued} من أولياء الأمور. ${notes}`.trim(),
        data,
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

// كل إجراء مؤكد يُوثَّق: من طلبه، وبأي جملة، وماذا كانت النتيجة. فشل التوثيق لا يُلغي الإجراء.
async function recordAssistantActivity(action: UstadPendingAction, result: UstadActionPayload, user: User | null): Promise<void> {
  try {
    await db.logActivity('assistant_action', `أستاذ حاضر: ${result.title}`, {
      user_id: user?.id,
      user_name: user?.name,
      target_id: action.type === 'send_absence_alerts' ? undefined : action.studentId,
      target_name: result.data?.studentName,
      metadata: {
        source: 'ustad-hader',
        action: action.type,
        outcome: result.type,
        utterance: action.utterance,
        detail: result.spokenText,
        ...(action.type === 'mark_attendance' ? { newStatus: action.newStatus } : {}),
        ...(action.type === 'send_absence_alerts' ? { requestedCount: action.studentIds.length, ...result.data } : {})
      }
    });
  } catch (error) {
    console.warn('[UstadHader] Activity log entry was not saved', error);
  }
}

export const ustadIntentEngine = new UstadIntentEngine();
