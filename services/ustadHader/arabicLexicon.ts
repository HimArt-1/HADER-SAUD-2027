// =============================================================================
// نظام حاضر (Hader) - معجم «أستاذ حاضر» للفصحى واللهجة المحلية
// =============================================================================
// تطبيع الكلام العربي، تقطيعه إلى كلمات، ربط كل كلمة بمفاهيمها، واستخراج إشارة الصف والشعبة.
// هذه الوحدة نقية تماماً: لا قاعدة بيانات ولا واجهة، لتُختبر بجمل المعلمين الفعلية.

// تطبيع النصوص العربية لمطابقة الكلمات بدقة
export function normalizeArabicSpeech(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ٰٟـ]/g, '') // التشكيل والتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ئ/g, 'ي') // «غائب» و«غايب» كلمة واحدة
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^ء-ي0-9a-zA-Z\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export type ConceptId =
  | 'open' | 'show' | 'search' | 'count' | 'who' | 'today' | 'question'
  | 'absence' | 'attendance' | 'late' | 'record' | 'call' | 'dismissal'
  | 'kiosk' | 'board' | 'home' | 'guard' | 'monitor' | 'scanner'
  | 'reports' | 'report' | 'week' | 'chronic' | 'surveys' | 'whatsapp' | 'messages'
  | 'alert' | 'send' | 'guardian' | 'phone' | 'staff' | 'studentWord' | 'manage'
  | 'backup' | 'settings' | 'support' | 'help' | 'theme' | 'dark' | 'night' | 'light'
  | 'integrations' | 'activity' | 'status' | 'greeting' | 'place';

// الكلمات تُكتب بإملائها الطبيعي وتُطبَّع عند التحميل. تُقبل معها لواحق الجمع والضمائر الشائعة.
const CONCEPT_WORDS: Record<ConceptId, string> = {
  open: 'افتح افتحي افتحلي فتح وديني ودني خذني دخلني انتقل اذهب رجعني ارجع',
  show: 'اعرض اعرضي عرض ورني وريني ورنا طلع طلعلي جيب جيبلي هات اشوف شوف ابي ابغى ابغا اريد بغيت ودي عطني عطيني اعطني اعطيني قل قلي قولي خبرني اخبرني كشف جهز جهزلي',
  search: 'ابحث بحث دور دورلي فتش',
  count: 'كم عدد احصاء احصائية احصائيات إجمالي مجموع نسبة معدل',
  who: 'مين أسماء قائمة',
  today: 'اليوم الحين هالحين الآن حاليا هاليوم يومي',
  question: 'هل وش ايش شنو ماذا كيف وين متى ليش شلون',
  absence: 'غياب غيابات غائب متغيب غاب',
  attendance: 'حضور حاضر حضر داوم دوام موجود متواجد',
  late: 'تأخر تأخير متأخر',
  record: 'سجل سجلي اعتمد ثبت خل خلي حط اجعل عدل فعل فعلي شغل شغلي',
  call: 'نداء نادي ناد استدعاء استدعي اطلب خروج',
  dismissal: 'انصراف انصرف مغادرة مغادرين غادر',
  kiosk: 'كشك',
  board: 'لوحة شاشة',
  home: 'رئيسية رئيسي قيادة داشبورد',
  guard: 'حارس بوابة',
  monitor: 'مراقبة',
  scanner: 'ماسح باركود سكانر',
  reports: 'تقارير',
  report: 'تقرير ملخص خلاصة',
  week: 'أسبوع هالأسبوع أسبوعي',
  chronic: 'مزمن متكرر تكرار أكثر كثير دايم دائما',
  surveys: 'استبيان استطلاع',
  whatsapp: 'واتساب واتس وتساب واتسب',
  messages: 'رسائل رسايل رسالة مسجات',
  alert: 'تنبيه إشعار تبليغ بلاغ',
  send: 'أرسل ارسلي ابعث ابعثي بلغ نبه راسل إرسال',
  guardian: 'ولي أولياء أهل أهالي أمر أمور',
  phone: 'رقم جوال هاتف تلفون موبايل',
  staff: 'انتظار حصص احتياط معلم مدرسين',
  studentWord: 'طالب طلاب تلاميذ',
  manage: 'إدارة بيانات',
  backup: 'نسخ نسخة احتياطي',
  settings: 'إعدادات ضبط خيارات',
  support: 'دعم فني',
  help: 'مساعدة ساعدني أوامر تقدر تسوي تفعل قدراتك',
  theme: 'وضع مظهر ثيم',
  dark: 'داكن مظلم',
  night: 'ليلي',
  light: 'فاتح نهاري',
  integrations: 'تكاملات تكامل ربط منصات',
  activity: 'أنشطة نشاط',
  status: 'حالة حالته',
  greeting: 'السلام سلام مرحبا هلا أهلا صباح مساء',
  place: 'مركز صفحة قسم نافذة تبويب محطة نظام'
};

// كلمات مجاملة وربط لا تحمل معنى للأمر ولا تُعد جزءاً من اسم الطالب
const STOP_WORDS = normalizeWordList(
  'يا لو سمحت ممكن من فضلك رجاء يعطيك العافية شكرا طيب اوكي تمام زين حبيبي استاذ استاذي ' +
  'لي لنا له لها لهم عندنا عندي في فيه على عن إلى الى مع او ثم بعد كذا هذا هذي هذه ذا اللي الذي التي ' +
  'كل جميع كامل حق تبع حقت مال المدرسة مدرسة عبر طريق بواسطة صف فصل شعبة ياخي اخوي تكفى انت ' +
  'الخير النور عليكم عليك ورحمة وبركاته اسم باسم الاسم لا نعم ايه اي بس و'
);

const ALLOWED_SUFFIXES = ['ا', 'ين', 'ون', 'ات', 'ه', 'ي', 'يه', 'يين', 'وا', 'و', 'ها', 'هم', 'ته', 'تهم', 'لي', 'لنا'];
const MULTI_LETTER_PREFIXES = ['وبال', 'وال', 'فال', 'بال', 'كال', 'لل', 'ال'];
const SINGLE_LETTER_PREFIXES = ['و', 'ب', 'ل', 'ف'];

const GRADE_WORDS: Record<string, number> = {
  اول: 1, اولي: 1, ثاني: 2, ثانيه: 2, ثالث: 3, ثالثه: 3,
  رابع: 4, رابعه: 4, خامس: 5, خامسه: 5, سادس: 6, سادسه: 6
};
const GRADE_LABELS = ['', 'أول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس'];
const STAGE_WORDS: Record<string, number> = { ابتدايي: 1, متوسط: 2, ثانوي: 3 };
const SECTION_WORDS: Record<string, number> = {
  ا: 1, الف: 1, a: 1, ب: 2, باء: 2, b: 2, ج: 3, جيم: 3, c: 3, د: 4, دال: 4, d: 4, ه: 5, هاء: 5, e: 5
};
const SECTION_LABELS = ['', 'أ', 'ب', 'ج', 'د', 'هـ'];
const CLASS_CONTEXT_WORDS = new Set(['صف', 'فصل', 'شعبه']);

function normalizeWordList(words: string): Set<string> {
  return new Set(words.split(/\s+/).map(normalizeArabicSpeech).filter(Boolean));
}

const CONCEPT_INDEX: ReadonlyArray<readonly [string, ConceptId]> = Object.entries(CONCEPT_WORDS)
  .flatMap(([concept, words]) => [...normalizeWordList(words)].map(word => [word, concept as ConceptId] as const));

/** صيغ الكلمة بعد نزع حروف العطف والجر و«ال»: «والغائبين» ← «غائبين». */
export function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  for (const prefix of MULTI_LETTER_PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= 2) variants.add(token.slice(prefix.length));
  }
  for (const prefix of SINGLE_LETTER_PREFIXES) {
    // حرف واحد يُنزع فقط من كلمة طويلة، فلا يصبح اسم «بدور» كلمة «دور»
    if (token.startsWith(prefix) && token.length - prefix.length >= 4) variants.add(token.slice(prefix.length));
  }
  return [...variants];
}

function wordMatches(variant: string, word: string): boolean {
  if (variant === word) return true;
  if (word.length < 3 || !variant.startsWith(word)) return false;
  return ALLOWED_SUFFIXES.includes(variant.slice(word.length));
}

export function conceptsOfToken(token: string): ConceptId[] {
  const variants = tokenVariants(token);
  const concepts = new Set<ConceptId>();
  for (const [word, concept] of CONCEPT_INDEX) {
    if (variants.some(variant => wordMatches(variant, word))) concepts.add(concept);
  }
  return [...concepts];
}

const lookupVariant = <T>(token: string, table: Record<string, T>): T | undefined => {
  for (const variant of tokenVariants(token)) {
    if (variant in table) return table[variant];
  }
  return undefined;
};

export interface ClassReference {
  grade: number;
  gradeLabel: string;
  section: number | null;
  sectionLabel: string;
  stage: number | null;
}

export type TokenRole = 'class' | 'stop' | 'word';

export interface AnalyzedToken {
  text: string;
  role: TokenRole;
  concepts: ConceptId[];
}

export interface UtteranceAnalysis {
  normalized: string;
  tokens: AnalyzedToken[];
  concepts: Set<ConceptId>;
  classRef: ClassReference | null;
}

/**
 * يستخرج «ثالث ب» أو «الصف الثالث متوسط شعبة 2». يُطابق الكلمة كاملة، فلا تُقرأ «أولياء» صفاً أول.
 */
function findClassReference(tokens: string[]): { ref: ClassReference; indexes: Set<number> } | null {
  const indexes = new Set<number>();
  let gradeIndex = -1;
  let grade = 0;

  tokens.forEach((token, index) => {
    if (grade) return;
    const word = lookupVariant(token, GRADE_WORDS);
    const previousIsContext = index > 0 && tokenVariants(tokens[index - 1]).some(v => CLASS_CONTEXT_WORDS.has(v));
    const nextIsSection = index + 1 < tokens.length && lookupVariant(tokens[index + 1], SECTION_WORDS) !== undefined;
    const digit = /^[1-6]$/.test(token) && (previousIsContext || nextIsSection) ? Number(token) : 0;
    if (word || digit) {
      grade = word || digit;
      gradeIndex = index;
    }
  });
  if (!grade) return null;
  indexes.add(gradeIndex);

  let section: number | null = null;
  let stage: number | null = null;
  for (let index = gradeIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    const stageWord = lookupVariant(token, STAGE_WORDS);
    if (stageWord && stage === null) {
      stage = stageWord;
      indexes.add(index);
      continue;
    }
    const afterSectionWord = tokenVariants(tokens[index - 1]).includes('شعبه');
    const sectionWord = SECTION_WORDS[token] ?? (afterSectionWord && /^[1-9]$/.test(token) ? Number(token) : undefined);
    if (sectionWord && section === null) {
      section = sectionWord;
      indexes.add(index);
    }
  }
  tokens.forEach((token, index) => {
    if (tokenVariants(token).some(v => CLASS_CONTEXT_WORDS.has(v))) indexes.add(index);
  });

  return {
    ref: {
      grade,
      gradeLabel: GRADE_LABELS[grade],
      section,
      sectionLabel: section ? SECTION_LABELS[section] ?? String(section) : '',
      stage
    },
    indexes
  };
}

export function analyzeUtterance(text: string): UtteranceAnalysis {
  const normalized = normalizeArabicSpeech(text);
  const words = normalized ? normalized.split(' ') : [];
  const classMatch = findClassReference(words);
  const concepts = new Set<ConceptId>();

  const tokens = words.map((word, index): AnalyzedToken => {
    if (classMatch?.indexes.has(index)) return { text: word, role: 'class', concepts: [] };
    if (STOP_WORDS.has(word)) return { text: word, role: 'stop', concepts: [] };
    const tokenConcepts = conceptsOfToken(word);
    tokenConcepts.forEach(concept => concepts.add(concept));
    return { text: word, role: 'word', concepts: tokenConcepts };
  });

  return { normalized, tokens, concepts, classRef: classMatch?.ref ?? null };
}

// =============================================================================
// مطابقة الصف والشعبة وأسماء الطلاب
// =============================================================================

/** رقم الشعبة من «أ» أو «A» أو «1»، أو null إن لم تُعرف. */
export function sectionNumber(value: string | null | undefined): number | null {
  const norm = normalizeArabicSpeech(value || '');
  if (!norm) return null;
  if (/^[1-9]$/.test(norm)) return Number(norm);
  return SECTION_WORDS[norm] ?? null;
}

export function matchesClassReference(
  student: { class_name?: string | null; section?: string | null },
  ref: ClassReference
): boolean {
  const classTokens = normalizeArabicSpeech(student.class_name || '').split(' ').filter(Boolean);
  const grades = classTokens.map(token => lookupVariant(token, GRADE_WORDS) ?? (/^[1-6]$/.test(token) ? Number(token) : undefined));
  if (!grades.includes(ref.grade)) return false;

  if (ref.stage !== null) {
    const stages = classTokens.map(token => lookupVariant(token, STAGE_WORDS)).filter((stage): stage is number => stage !== undefined);
    if (stages.length > 0 && !stages.includes(ref.stage)) return false;
  }

  if (ref.section !== null) {
    return sectionNumber(student.section) === ref.section;
  }
  return true;
}

/** «عبد الله» و«عبدالله» اسم واحد عند المطابقة. */
export function normalizePersonName(name: string): string {
  return normalizeArabicSpeech(name).replace(/(^|\s)(عبد|ابو)\s+/g, '$1$2');
}
