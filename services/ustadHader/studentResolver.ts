// =============================================================================
// نظام حاضر (Hader) - تحديد الطالب المقصود من اسم منطوق
// =============================================================================
// يرتب الطلاب حسب قرب الاسم: تطابق كامل، ثم بداية الاسم، ثم كلمات الاسم، ثم جزء منه.
// «خالد» وحدها بين عشرين طالباً سؤال توضيحي، و«خالد سعد الشهري» طالب واحد.

import { ClassReference, matchesClassReference, normalizePersonName, tokenVariants } from './arabicLexicon';

type NamedStudent = { id: string; name: string; class_name?: string | null; section?: string | null };

export type StudentResolution<T> =
  | { kind: 'none' }
  | { kind: 'single'; student: T }
  | { kind: 'ambiguous'; candidates: T[]; total: number };

const EXACT = 100;
const NAME_STARTS_WITH_QUERY = 80;
const ALL_WORDS_IN_NAME = 60;
const LAST_WORD_PARTIAL = 40;
const SUBSTRING = 20;

function scoreName(name: string, query: string): number {
  const normalizedName = normalizePersonName(name);
  const normalizedQuery = normalizePersonName(query);
  if (!normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return EXACT;

  const nameWords = normalizedName.split(' ').map(word => tokenVariants(word));
  const queryWords = normalizedQuery.split(' ');
  const used = new Set<number>();
  const positions: number[] = [];

  const wholeWordsMatch = queryWords.every(queryWord => {
    const variants = tokenVariants(queryWord);
    const index = nameWords.findIndex((wordVariants, position) =>
      !used.has(position) && variants.some(variant => wordVariants.includes(variant))
    );
    if (index < 0) return false;
    used.add(index);
    positions.push(index);
    return true;
  });

  if (wholeWordsMatch) {
    return positions.every((position, order) => position === order) ? NAME_STARTS_WITH_QUERY : ALL_WORDS_IN_NAME;
  }

  // التعرف الصوتي قد يقطع آخر كلمة: «خالد الشه»
  const lastWord = queryWords[queryWords.length - 1];
  if (lastWord.length >= 2 && used.size === queryWords.length - 1) {
    const partial = nameWords.some((wordVariants, position) =>
      !used.has(position) && wordVariants.some(variant => variant.startsWith(lastWord))
    );
    if (partial) return LAST_WORD_PARTIAL;
  }

  return normalizedQuery.length >= 3 && normalizedName.includes(normalizedQuery) ? SUBSTRING : 0;
}

export function resolveStudent<T extends NamedStudent>(
  students: readonly T[],
  query: string,
  classRef: ClassReference | null,
  limit = 8
): StudentResolution<T> {
  const pool = classRef ? students.filter(student => matchesClassReference(student, classRef)) : students;
  const ranked = pool
    .map(student => ({ student, score: scoreName(student.name, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.student.name.localeCompare(b.student.name, 'ar'));

  if (ranked.length === 0) return { kind: 'none' };

  const topScore = ranked[0].score;
  const topTier = ranked.filter(entry => entry.score === topScore);
  if (topTier.length === 1 && (topScore >= ALL_WORDS_IN_NAME || ranked.length === 1)) {
    return { kind: 'single', student: ranked[0].student };
  }

  return {
    kind: 'ambiguous',
    candidates: ranked.slice(0, limit).map(entry => entry.student),
    total: ranked.length
  };
}
