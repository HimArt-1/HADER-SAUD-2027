import { describe, expect, it } from 'vitest';
import type { Student } from '../types';
import { matchSpokenStudents } from '../components/guard/guardVoiceMatching';

const students: Student[] = [
  { id: '1', name: 'أحمد محمد عبدالله', class_name: 'الأول', section: 'أ' },
  { id: '2', name: 'أحمد علي محمد', class_name: 'الثاني', section: 'ب' },
  { id: '3', name: 'محمود علي', class_name: 'الثاني', section: 'ب' },
  { id: '4', name: 'فاطمة علي', class_name: 'الأول', section: 'أ' },
  { id: '5', name: 'أحمد محمود', class_name: 'الأول', section: 'أ', is_active: false }
];

describe('spoken student names', () => {
  it('normalizes Arabic diacritics, alef, and compound Abdullah spelling', () => {
    expect(matchSpokenStudents(students, 'أَحْمَد مُحَمَّد عبد الله').map(s => s.id)).toEqual(['1']);
    expect(matchSpokenStudents(students, 'فاطمه علي').map(s => s.id)).toEqual(['4']);
  });
  it('keeps every ambiguous candidate instead of guessing a student', () => {
    expect(matchSpokenStudents(students, 'أحمد محمد').map(s => s.id).sort()).toEqual(['1', '2']);
  });
  it('supports a name prefix and omitted middle names while keeping token order', () => {
    expect(matchSpokenStudents(students, 'نادي الطالب احمد عبد الله').map(s => s.id)).toEqual(['1']);
    expect(matchSpokenStudents(students, 'محمد أحمد')).toEqual([]);
  });
  it('never treats substrings, inactive students, or unknown speech as a match', () => {
    for (const transcript of ['', 'أ', 'حمد', 'أحمد محمود', 'خالد عبدالله']) expect(matchSpokenStudents(students, transcript)).toEqual([]);
  });
});
