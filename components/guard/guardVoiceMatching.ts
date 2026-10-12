import type { Student } from '../../types';
import { normalizeArabicSpeech } from '../../services/ustadHader/arabicLexicon';

const normalizeName = (text: string) => normalizeArabicSpeech(text).replace(/(^|\s)عبد\s+/g, '$1عبد');

/** Match whole name tokens, never substrings or a guessed fuzzy "best" student. */
export function matchSpokenStudents(students: readonly Student[], transcript: string): Student[] {
  const query = normalizeName(transcript)
    .replace(/^(?:(?:نادي|ناد|نداء|استدعاء|استدعي|ابحث عن|اسم)\s+)?(?:ل?الطالب(?:ه)?\s+)?/, '')
    .trim();
  if (query.length < 2) return [];
  const tokens = query.split(' ');
  return students
    .filter(student => {
      if (student.is_active === false) return false;
      const nameTokens = normalizeName(student.name).split(' ');
      let cursor = 0;
      return tokens.every(token => {
        const index = nameTokens.indexOf(token, cursor);
        if (index === -1) return false;
        cursor = index + 1;
        return true;
      });
    })
    .sort((a, b) => Number(normalizeName(b.name) === query) - Number(normalizeName(a.name) === query)
      || a.name.localeCompare(b.name, 'ar-SA'));
}
