import { describe, expect, it } from 'vitest';
import { createSchoolDayWorkflow, type SchoolDayDataPort } from '../modules/schoolDay';
import {
  Role,
  type AttendanceRecord,
  type SchoolClass,
  type Student,
  type User
} from '../types';

const date = '2026-08-18';
const students: Student[] = [
  { id: 's1', name: 'Student 1', class_name: 'الأول', section: 'A' },
  { id: 's2', name: 'Student 2', class_name: 'الأول', section: 'B' },
  { id: 's3', name: 'Student 3', class_name: 'الثاني', section: 'A' }
];
const classes: SchoolClass[] = [
  { id: 'c1', name: 'الأول', sections: ['A', 'B'] },
  { id: 'c2', name: 'الثاني', sections: ['A'] }
];

const attendance = (
  studentId: string,
  suffix = '1',
  timestamp = `${date}T06:45:00.000Z`
): AttendanceRecord => ({
  id: `attendance-${studentId}-${suffix}`,
  student_id: studentId,
  date,
  timestamp,
  status: 'present',
  minutes_late: 0
});

const createPort = (
  overrides: Partial<SchoolDayDataPort> = {}
): SchoolDayDataPort => ({
  getRoster: async () => ({ students, classes }),
  getSettings: async () => ({ school_name: 'مدرسة الاختبار' }),
  getDailySummary: async requestedDate => ({ date: requestedDate, total_students: 3 }),
  getExits: async () => [
    { id: 'exit-s1', student_id: 's1', reason: 'appointment', exit_time: `${date}T10:00:00.000Z` },
    { id: 'exit-s2', student_id: 's2', reason: 'sick', exit_time: `${date}T10:10:00.000Z` }
  ],
  getViolations: async () => [
    { id: 'violation-s1', student_id: 's1', type: 'uniform', level: 1, created_at: `${date}T08:00:00.000Z` },
    { id: 'violation-s2', student_id: 's2', type: 'phone', level: 1, created_at: `${date}T08:10:00.000Z` }
  ],
  getAttendance: async () => [
    attendance('s1', 'old', `${date}T06:45:00.000Z`),
    attendance('s1', 'new', `${date}T06:50:00.000Z`),
    attendance('s2')
  ],
  ...overrides
});

describe('school-day workflow', () => {
  it('hydrates the actor, applies class scope and de-duplicates attendance', async () => {
    const sessionActor: User = {
      id: 'supervisor-1',
      username: 'supervisor',
      name: 'مشرف',
      role: Role.SUPERVISOR_CLASS
    };
    const hydratedActor: User = {
      ...sessionActor,
      assigned_classes: [{ class_name: 'الأول', sections: ['A'] }]
    };
    const workflow = createSchoolDayWorkflow(createPort(), async actor =>
      actor ? hydratedActor : null
    );

    const result = await workflow.loadSnapshot({ actor: sessionActor, date });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a ready snapshot');
    expect(result.snapshot.actor).toEqual(hydratedActor);
    expect(result.snapshot.students.map(student => student.id)).toEqual(['s1']);
    expect(result.snapshot.classes).toEqual([
      { id: 'c1', name: 'الأول', sections: ['A'] }
    ]);
    expect(result.snapshot.attendance.map(record => record.id)).toEqual(['attendance-s1-new']);
    expect(result.snapshot.exits.map(record => record.student_id)).toEqual(['s1']);
    expect(result.snapshot.violations.map(record => record.student_id)).toEqual(['s1']);
    expect(result.attendancePreserved).toBe(false);
  });

  it('preserves significant prior attendance when a refresh drops by more than half', async () => {
    const localStudents: Student[] = Array.from({ length: 6 }, (_, index) => ({
      id: `s${index + 1}`,
      name: `Student ${index + 1}`,
      class_name: 'الأول',
      section: 'A'
    }));
    const previousAttendance = localStudents.map(student => attendance(student.id));
    const workflow = createSchoolDayWorkflow(createPort({
      getRoster: async () => ({ students: localStudents, classes }),
      getAttendance: async () => previousAttendance.slice(0, 2),
      getDailySummary: async () => ({ date, present_count: 2 })
    }), async actor => actor ?? null);
    const admin: User = {
      id: 'admin-1',
      username: 'admin',
      name: 'Admin',
      role: Role.SCHOOL_ADMIN
    };

    const result = await workflow.loadSnapshot({ actor: admin, date, previousAttendance });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected a ready snapshot');
    expect(result.attendancePreserved).toBe(true);
    expect(result.snapshot.attendance).toHaveLength(6);
    expect(result.snapshot.summary?.present_count).toBe(2);
  });

  it('rejects an older response when a newer load finishes first', async () => {
    let resolveFirst: ((value: { date: string }) => void) | undefined;
    const firstSummary = new Promise<{ date: string }>(resolve => {
      resolveFirst = resolve;
    });
    const workflow = createSchoolDayWorkflow(createPort({
      getDailySummary: requestedDate => requestedDate === 'first'
        ? firstSummary
        : Promise.resolve({ date: requestedDate })
    }), async actor => actor ?? null);

    const first = workflow.loadSnapshot({ actor: null, date: 'first' });
    const second = workflow.loadSnapshot({ actor: null, date: 'second' });
    const secondResult = await second;
    resolveFirst?.({ date: 'first' });
    const firstResult = await first;

    expect(secondResult.status).toBe('ready');
    expect(firstResult).toEqual({ status: 'stale' });
  });
});
