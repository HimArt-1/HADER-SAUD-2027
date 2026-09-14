// =============================================================================
// نظام حاضر (Hader) - مصنِّف نوايا «أستاذ حاضر»
// =============================================================================
// جدول أوامر بدل سلسلة شروط: لكل نية مفاهيمها المطلوبة والمعززة والمانعة.
// تُقيَّم كل النوايا وتُختار الأعلى درجة، لا أول شرط يتطابق.

import { analyzeUtterance, ClassReference, ConceptId, hasPronounReference, UtteranceAnalysis } from './arabicLexicon';

export type UstadIntentId =
  | 'greeting' | 'help' | 'briefing.today'
  | 'alerts.absence'
  | 'stats.absence' | 'stats.attendance' | 'stats.late' | 'stats.dismissal'
  | 'class.absence'
  | 'report.weekly' | 'report.chronic'
  | 'student.lookup' | 'student.mark_present' | 'student.mark_absent' | 'student.dismissal_call'
  | 'theme.dark' | 'theme.light'
  | 'nav.integrations' | 'nav.dismissal_kiosk' | 'nav.kiosk' | 'nav.call_board' | 'nav.guard_station'
  | 'nav.watcher' | 'nav.scanner' | 'nav.reports' | 'nav.surveys' | 'nav.whatsapp' | 'nav.staff'
  | 'nav.students' | 'nav.backup' | 'nav.settings' | 'nav.support' | 'nav.home' | 'nav.activity_log';

interface IntentRule {
  // كل مجموعة يكفي فيها مفهوم واحد، ويجب تحقق كل المجموعات
  requires: readonly (readonly ConceptId[])[];
}

interface IntentDefinition {
  id: UstadIntentId;
  rules: readonly IntentRule[];
  boosts?: readonly ConceptId[];
  forbids?: readonly ConceptId[];
  student?: 'required' | 'forbidden';
  classRef?: 'required' | 'optional' | 'forbidden';
}

export interface IntentMatch {
  id: UstadIntentId;
  score: number;
  // اسم الطالب كما قيل، بعد حذف كلمات الأمر والمجاملة والصف
  studentQuery: string;
  classRef: ClassReference | null;
  // عدد مفاهيم هذه النية الواردة في الجملة؛ صفر يعني أن الجملة اسم مجرد
  signals: number;
  // الطالب هو آخر من ذُكر في المحادثة («سجله حاضر»)
  studentFromContext: boolean;
}

const REQUIRED_GROUP_SCORE = 3;
const ENTITY_SCORE = 3;
const BOOST_SCORE = 1;
const CONCEPT_IN_NAME_PENALTY = 1;

// مفاهيم لا تغيّر معنى أي أمر: «افتح لي… اليوم»، «هل…»، «مركز…»
const UNIVERSAL_CONCEPTS: readonly ConceptId[] = ['today', 'question', 'show', 'open', 'studentWord', 'greeting', 'place'];

// الترتيب يحسم التعادل: النية الأسبق أولى
const INTENTS: readonly IntentDefinition[] = [
  {
    id: 'alerts.absence',
    rules: [
      { requires: [['send', 'alert', 'messages'], ['absence']] },
      { requires: [['alert', 'send'], ['guardian']] }
    ],
    boosts: ['guardian', 'whatsapp'],
    classRef: 'forbidden'
  },
  { id: 'stats.absence', rules: [{ requires: [['absence']] }], boosts: ['count', 'who'], forbids: ['record', 'send', 'alert', 'week', 'chronic', 'call'], classRef: 'forbidden' },
  { id: 'stats.attendance', rules: [{ requires: [['attendance']] }], boosts: ['count'], forbids: ['absence', 'late', 'record', 'week', 'call'], classRef: 'forbidden' },
  { id: 'stats.late', rules: [{ requires: [['late']] }], boosts: ['count', 'who'], forbids: ['record', 'week'], classRef: 'forbidden' },
  { id: 'stats.dismissal', rules: [{ requires: [['dismissal']] }], boosts: ['count', 'who', 'status'], forbids: ['kiosk', 'board'], classRef: 'forbidden' },
  { id: 'class.absence', rules: [{ requires: [['absence', 'attendance', 'count']] }], boosts: ['who'], forbids: ['record', 'send', 'alert', 'week'], classRef: 'required' },
  { id: 'briefing.today', rules: [{ requires: [['report', 'status'], ['today']] }], boosts: ['count', 'attendance', 'absence'], forbids: ['week', 'chronic', 'record', 'send', 'alert', 'dark', 'light', 'night'], classRef: 'forbidden' },
  { id: 'report.weekly', rules: [{ requires: [['report', 'reports', 'attendance', 'absence', 'count'], ['week']] }], boosts: ['report'] },
  { id: 'report.chronic', rules: [{ requires: [['absence'], ['chronic']] }], boosts: ['report', 'reports'] },
  {
    id: 'student.lookup',
    rules: [{ requires: [] }, { requires: [['search']] }],
    boosts: ['attendance', 'absence', 'late', 'phone', 'guardian', 'status', 'who'],
    student: 'required',
    classRef: 'optional'
  },
  { id: 'student.mark_present', rules: [{ requires: [['record'], ['attendance']] }], forbids: ['absence', 'late'], student: 'required', classRef: 'optional' },
  { id: 'student.mark_absent', rules: [{ requires: [['record'], ['absence']] }], student: 'required', classRef: 'optional' },
  { id: 'student.dismissal_call', rules: [{ requires: [['call']] }], boosts: ['dismissal'], forbids: ['board', 'kiosk'], student: 'required', classRef: 'optional' },
  { id: 'theme.dark', rules: [{ requires: [['dark']] }, { requires: [['theme'], ['night']] }], boosts: ['theme', 'record'] },
  { id: 'theme.light', rules: [{ requires: [['theme'], ['light']] }], boosts: ['record'] },
  { id: 'nav.integrations', rules: [{ requires: [['integrations']] }] },
  { id: 'nav.dismissal_kiosk', rules: [{ requires: [['kiosk'], ['dismissal']] }], boosts: ['studentWord'] },
  { id: 'nav.kiosk', rules: [{ requires: [['kiosk']] }], boosts: ['attendance'], forbids: ['dismissal'] },
  { id: 'nav.call_board', rules: [{ requires: [['board'], ['call']] }], boosts: ['dismissal'] },
  { id: 'nav.guard_station', rules: [{ requires: [['guard']] }] },
  { id: 'nav.watcher', rules: [{ requires: [['monitor']] }], boosts: ['board'] },
  { id: 'nav.scanner', rules: [{ requires: [['scanner']] }] },
  { id: 'nav.reports', rules: [{ requires: [['reports']] }, { requires: [['open'], ['report']] }], forbids: ['week', 'chronic'] },
  { id: 'nav.surveys', rules: [{ requires: [['surveys']] }] },
  { id: 'nav.whatsapp', rules: [{ requires: [['whatsapp', 'messages']] }], boosts: ['manage', 'send'], forbids: ['absence'] },
  { id: 'nav.staff', rules: [{ requires: [['staff']] }], boosts: ['who'] },
  { id: 'nav.students', rules: [{ requires: [['studentWord'], ['open', 'manage']] }], boosts: ['record'] },
  { id: 'nav.backup', rules: [{ requires: [['backup']] }] },
  { id: 'nav.settings', rules: [{ requires: [['settings']] }], boosts: ['manage'] },
  { id: 'nav.support', rules: [{ requires: [['support']] }] },
  { id: 'nav.home', rules: [{ requires: [['home']] }], boosts: ['board'] },
  { id: 'nav.activity_log', rules: [{ requires: [['activity']] }], boosts: ['record'] },
  { id: 'help', rules: [{ requires: [['help']] }] },
  { id: 'greeting', rules: [{ requires: [['greeting']] }] }
];

function scoreIntent(intent: IntentDefinition, analysis: UtteranceAnalysis, ignoreRemainder: boolean, contextStudent: boolean): IntentMatch | null {
  const { concepts, classRef, tokens } = analysis;
  if (intent.forbids?.some(concept => concepts.has(concept))) return null;

  const satisfiedRules = intent.rules.filter(rule =>
    rule.requires.every(group => group.some(concept => concepts.has(concept)))
  );
  if (satisfiedRules.length === 0) return null;
  let score = Math.max(...satisfiedRules.map(rule => rule.requires.length * REQUIRED_GROUP_SCORE));

  const classMode = intent.classRef ?? 'optional';
  if (classMode === 'required' && !classRef) return null;
  if (classMode === 'forbidden' && classRef) return null;
  if (classMode === 'required') score += ENTITY_SCORE;

  const ownConcepts = new Set<ConceptId>([...intent.rules.flatMap(rule => rule.requires.flat()), ...(intent.boosts ?? [])]);
  const vocabulary = new Set<ConceptId>([...ownConcepts, ...UNIVERSAL_CONCEPTS]);
  const remainder = tokens.filter(token =>
    token.role === 'word' && !token.concepts.some(concept => vocabulary.has(concept))
  );
  const studentQuery = remainder.map(token => token.text).join(' ');

  let studentFromContext = false;
  if (intent.student === 'required') {
    if (ignoreRemainder) return null;
    if (studentQuery.length >= 2) {
      // اسم يتكون من كلمات أوامر معروفة أقل احتمالاً من اسم حقيقي
      score -= remainder.filter(token => token.concepts.length > 0).length * CONCEPT_IN_NAME_PENALTY;
    } else if (contextStudent && hasPronounReference(tokens)) {
      studentFromContext = true;
    } else {
      return null;
    }
    score += ENTITY_SCORE;
  } else if (remainder.length > 0 && !ignoreRemainder) {
    return null;
  }

  const boosts = intent.boosts ?? [];
  score += boosts.filter(concept => concepts.has(concept)).length * BOOST_SCORE;

  return {
    id: intent.id,
    score,
    studentQuery: intent.student === 'required' ? studentQuery : '',
    classRef,
    signals: [...ownConcepts].filter(concept => concepts.has(concept)).length,
    studentFromContext
  };
}

/**
 * ترتيب النوايا المحتملة للجملة من الأعلى درجة.
 * ignoreRemainder: يتجاهل الكلمات غير المفهومة ويستبعد نوايا الطلاب، ويُستخدم حين لا يوجد طالب بالاسم المستخرج.
 */
export function rankIntents(text: string, options: { ignoreRemainder?: boolean; contextStudent?: boolean } = {}): IntentMatch[] {
  const analysis = analyzeUtterance(text);
  if (analysis.tokens.length === 0) return [];
  return INTENTS
    .map((intent, order) => ({ match: scoreIntent(intent, analysis, Boolean(options.ignoreRemainder), Boolean(options.contextStudent)), order }))
    .filter((entry): entry is { match: IntentMatch; order: number } => entry.match !== null)
    .sort((a, b) => b.match.score - a.match.score || a.order - b.order)
    .map(entry => entry.match);
}

export function classifyUtterance(text: string): IntentMatch | null {
  return rankIntents(text)[0] ?? null;
}

// صياغة معيارية لكل أمر تُعرض كاقتراح «هل تقصد؟»
export const SUGGESTED_COMMANDS: Partial<Record<UstadIntentId, string>> = {
  'stats.absence': 'كم طالب غائب اليوم؟',
  'stats.attendance': 'كم نسبة الحضور اليوم؟',
  'stats.late': 'كم المتأخرين اليوم؟',
  'briefing.today': 'ملخص اليوم',
  'alerts.absence': 'أرسل تنبيه لأولياء أمور الغائبين',
  'report.weekly': 'جهّز تقرير الأسبوع',
  'report.chronic': 'اعرض الغياب المتكرر',
  'nav.watcher': 'افتح المراقبة اليومية',
  'nav.reports': 'افتح التقارير',
  'nav.call_board': 'افتح لوحة النداءات',
  'nav.kiosk': 'افتح كشك الحضور',
  'nav.whatsapp': 'افتح الواتساب',
  'nav.staff': 'من في الانتظار اليوم؟',
  'nav.students': 'افتح إدارة الطلاب',
  'nav.settings': 'افتح إعدادات النظام',
  help: 'مساعدة'
};

const DEFAULT_SUGGESTIONS: readonly UstadIntentId[] = ['stats.absence', 'briefing.today', 'help'];

export interface IntentSuggestion {
  intentId: UstadIntentId;
  command: string;
}

/** أقرب الأوامر إلى جملة لم تُفهم، حسب المفاهيم المشتركة معها. */
export function suggestIntents(text: string, limit = 3): IntentSuggestion[] {
  const { concepts } = analyzeUtterance(text);
  const universal = new Set<ConceptId>(UNIVERSAL_CONCEPTS);

  const ranked = INTENTS.flatMap((intent, order) => {
    const command = SUGGESTED_COMMANDS[intent.id];
    if (!command) return [];
    const own = new Set<ConceptId>([...intent.rules.flatMap(rule => rule.requires.flat()), ...(intent.boosts ?? [])]);
    const overlap = [...own].filter(concept => !universal.has(concept) && concepts.has(concept)).length;
    return overlap > 0 ? [{ intentId: intent.id, command, overlap, order }] : [];
  }).sort((a, b) => b.overlap - a.overlap || a.order - b.order);

  const picks = ranked.slice(0, limit).map(({ intentId, command }) => ({ intentId, command }));
  return picks.length > 0
    ? picks
    : DEFAULT_SUGGESTIONS.map(intentId => ({ intentId, command: SUGGESTED_COMMANDS[intentId] ?? '' }));
}
