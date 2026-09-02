import { describe, expect, it } from 'vitest';
import { parseStaffTimetableRows } from '../modules/staffOperations/timetableImport';
import type { StaffTeacher } from '../modules/staffOperations';

const teachers: readonly StaffTeacher[] = [
  { id: 't-1', name: 'أحمد محمد', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
  { id: 't-2', name: 'سارة علي', specialty: 'علوم', maxWeeklyWaits: 3, isActive: true }
];

describe('staff timetable import', () => {
  it('rejects an empty worksheet so it cannot wipe the active timetable', () => {
    expect(parseStaffTimetableRows([], teachers)).toEqual({
      slots: [],
      errors: ['ملف الجدول فارغ']
    });
  });

  it('maps Arabic headers, weekdays, and digits into reviewed timetable slots', () => {
    const result = parseStaffTimetableRows([
      {
        'اسم المعلم': '  أحمد   محمد ',
        اليوم: 'الأربعاء',
        الحصة: '٢',
        المادة: 'الرياضيات',
        الصف: 'الأول',
        الفصل: 'أ'
      },
      {
        'معرف المعلم': 't-2',
        Day: 'Sunday',
        Period: 1,
        Subject: 'Science',
        Class: 'الثاني',
        Section: 'ب'
      }
    ], teachers);

    expect(result.errors).toEqual([]);
    expect(result.slots).toEqual([
      { teacherId: 't-1', day: 3, period: 2, subject: 'الرياضيات', className: 'الأول', section: 'أ' },
      { teacherId: 't-2', day: 0, period: 1, subject: 'Science', className: 'الثاني', section: 'ب' }
    ]);
  });

  it('reports row-specific errors and never guesses an unknown teacher or weekday', () => {
    const result = parseStaffTimetableRows([
      { 'اسم المعلم': 'معلم غير معروف', اليوم: 'الأربعاء', الحصة: 1, المادة: 'علوم', الصف: 'الأول', الفصل: 'أ' },
      { 'اسم المعلم': 'أحمد محمد', اليوم: 'يوم غير صالح', الحصة: 2, المادة: 'رياضيات', الصف: 'الأول', الفصل: 'أ' },
      { 'اسم المعلم': 'سارة علي', اليوم: 'الأحد', الحصة: 20, المادة: 'علوم', الصف: 'الثاني', الفصل: 'ب' }
    ], teachers);

    expect(result.slots).toEqual([]);
    expect(result.errors).toEqual([
      'الصف 2: لم تتم مطابقة المعلم',
      'الصف 3: اليوم غير معروف',
      'الصف 4: رقم الحصة يجب أن يكون بين 1 و12'
    ]);
  });

  it('keeps teacher identifiers literal and rejects a conflicting name and identifier', () => {
    const similarIds: readonly StaffTeacher[] = [
      { id: 't-1', name: 'المعلم الأول', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
      { id: 't_1', name: 'المعلم الثاني', specialty: 'علوم', maxWeeklyWaits: 3, isActive: true }
    ];
    const exact = parseStaffTimetableRows([{
      'معرف المعلم': 't-1', اليوم: 'الأحد', الحصة: 1, المادة: 'رياضيات', الصف: 'الأول', الفصل: 'أ'
    }], similarIds);
    expect(exact.slots[0]?.teacherId).toBe('t-1');

    const conflicting = parseStaffTimetableRows([{
      'معرف المعلم': 't-1', 'اسم المعلم': 'المعلم الثاني', اليوم: 'الأحد', الحصة: 1,
      المادة: 'رياضيات', الصف: 'الأول', الفصل: 'أ'
    }], similarIds);
    expect(conflicting.slots).toEqual([]);
    expect(conflicting.errors).toEqual(['الصف 2: اسم المعلم لا يطابق المعرّف']);
  });
});
