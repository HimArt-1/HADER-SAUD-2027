import { describe, expect, it } from 'vitest';
import {
  createInMemoryStaffOperationsPort,
  createStaffOperationsModule,
  type StaffTeacher
} from '../modules/staffOperations';

const teachers: readonly StaffTeacher[] = [
  { id: 'absent-1', name: 'المعلم الغائب الأول', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
  { id: 'absent-2', name: 'المعلم الغائب الثاني', specialty: 'علوم', maxWeeklyWaits: 3, isActive: true },
  { id: 'busy', name: 'المعلم المرتبط', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
  { id: 'candidate-a', name: 'أحمد البديل', specialty: 'رياضيات', maxWeeklyWaits: 3, isActive: true },
  { id: 'candidate-b', name: 'بدر البديل', specialty: 'علوم', maxWeeklyWaits: 3, isActive: true },
  { id: 'inactive', name: 'معلم غير نشط', specialty: 'علوم', maxWeeklyWaits: 3, isActive: false }
];

const createModule = (initial = {}) => {
  const port = createInMemoryStaffOperationsPort(initial);
  const module = createStaffOperationsModule(port, {
    now: () => new Date('2026-09-02T06:30:00.000Z'),
    createId: (() => {
      let sequence = 0;
      return () => `generated-${++sequence}`;
    })(),
    resolveOperator: () => ({ id: 'admin-1', displayName: 'مدير المدرسة', canManageStaff: true })
  });
  return { module, port };
};

describe('staff operations module', () => {
  it('rejects dangling teachers and timetable collisions before replacing the active timetable', async () => {
    const { module } = createModule({ teachers });

    await expect(module.replaceTimetable({
      slots: [{ teacherId: 'missing', day: 3, period: 1, subject: 'رياضيات', className: 'الأول', section: 'أ' }]
    })).rejects.toThrow('غير موجود');

    await expect(module.replaceTimetable({
      slots: [
        { teacherId: 'candidate-a', day: 3, period: 1, subject: 'رياضيات', className: 'الأول', section: 'أ' },
        { teacherId: 'candidate-a', day: 3, period: 1, subject: 'رياضيات', className: 'الثاني', section: 'ب' }
      ]
    })).rejects.toThrow('تعارض في جدول المعلم');

    await expect(module.replaceTimetable({
      slots: [
        { teacherId: 'candidate-a', day: 3, period: 1, subject: 'رياضيات', className: 'الأول', section: 'أ' },
        { teacherId: 'candidate-b', day: 3, period: 1, subject: 'علوم', className: 'الأول', section: 'أ' }
      ]
    })).rejects.toThrow('تعارض في جدول الفصل');

    await expect(module.replaceTimetable({ slots: [] })).rejects.toThrow('فارغ');
    await expect(module.replaceTimetable({
      slots: [{ teacherId: 'inactive', day: 3, period: 1, subject: 'علوم', className: 'الثالث', section: 'ج' }]
    })).rejects.toThrow('غير نشط');

    expect((await module.dashboard('2026-09-02')).timetable).toEqual([]);
  });

  it('covers simultaneous absent lessons without assigning busy, absent, inactive, or duplicate substitutes', async () => {
    const { module } = createModule({
      teachers,
      timetable: [
        { id: 'absence-slot-1', teacherId: 'absent-1', day: 3, period: 1, subject: 'رياضيات', className: 'الأول', section: 'أ' },
        { id: 'absence-slot-2', teacherId: 'absent-2', day: 3, period: 1, subject: 'علوم', className: 'الثاني', section: 'ب' },
        { id: 'busy-slot', teacherId: 'busy', day: 3, period: 1, subject: 'لغة عربية', className: 'الثالث', section: 'ج' }
      ],
      attendance: [
        { id: 'a1', teacherId: 'absent-1', date: '2026-09-02', status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'a2', teacherId: 'absent-2', date: '2026-09-02', status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'a3', teacherId: 'candidate-a', date: '2026-09-02', status: 'present', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'a4', teacherId: 'candidate-b', date: '2026-09-02', status: 'present', recordedAt: '2026-09-02T06:00:00.000Z' }
      ]
    });

    const plan = await module.generateCoverage('2026-09-02');
    const substitutes = plan.assignments.map(assignment => assignment.substituteTeacherId);

    expect(plan.assignments).toHaveLength(2);
    expect(new Set(substitutes).size).toBe(2);
    expect(substitutes).toEqual(expect.arrayContaining(['candidate-a', 'candidate-b']));
    expect(substitutes).not.toEqual(expect.arrayContaining(['absent-1', 'absent-2', 'busy', 'inactive']));
    expect(plan.unfilledCount).toBe(0);
  });

  it('prefers the lowest weekly wait load, requires an admin, and rejects a stale plan', async () => {
    const { module, port } = createModule({
      teachers,
      timetable: [
        { id: 'absence-slot', teacherId: 'absent-1', day: 3, period: 2, subject: 'رياضيات', className: 'الأول', section: 'أ' },
        { id: 'busy-slot', teacherId: 'busy', day: 3, period: 2, subject: 'لغة عربية', className: 'الثاني', section: 'ب' }
      ],
      attendance: [
        { id: 'a1', teacherId: 'absent-1', date: '2026-09-02', status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'a2', teacherId: 'absent-2', date: '2026-09-02', status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'a3', teacherId: 'candidate-a', date: '2026-09-02', status: 'present', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'a4', teacherId: 'candidate-b', date: '2026-09-02', status: 'present', recordedAt: '2026-09-02T06:00:00.000Z' }
      ],
      coveragePlans: [{
        id: 'older-plan',
        date: '2026-08-30',
        inputRevision: 'older',
        inputVersion: 0,
        generatedAt: '2026-08-30T06:00:00.000Z',
        approvedAt: '2026-08-30T06:05:00.000Z',
        approvedBy: 'admin-1',
        assignments: [{
          id: 'older-assignment',
          lessonSlotId: 'older-slot',
          absentTeacherId: 'someone',
          substituteTeacherId: 'candidate-a',
          period: 1,
          subject: 'رياضيات',
          className: 'الأول',
          section: 'أ',
          status: 'approved',
          reasons: []
        }],
        unfilledCount: 0
      }]
    });

    const plan = await module.generateCoverage('2026-09-02');
    expect(plan.assignments[0].substituteTeacherId).toBe('candidate-b');

    const denied = createStaffOperationsModule(port, {
      resolveOperator: () => ({ id: 'watcher-1', displayName: 'مراقب', canManageStaff: false })
    });
    await expect(denied.approveCoverage(plan)).rejects.toThrow('صلاحية مدير');

    await module.recordAttendance({ teacherId: 'candidate-b', date: '2026-09-02', status: 'absent' });
    await expect(module.approveCoverage(plan)).rejects.toThrow('تغيرت بيانات اليوم');
  });

  it('cannot approve an unfilled lesson even if a caller tampers with the summary counter', async () => {
    const onlyAbsentTeacher: StaffTeacher = {
      id: 'only-teacher',
      name: 'المعلم الوحيد',
      specialty: 'رياضيات',
      maxWeeklyWaits: 3,
      isActive: true
    };
    const { module } = createModule({
      teachers: [onlyAbsentTeacher],
      timetable: [{
        id: 'only-slot', teacherId: 'only-teacher', day: 3, period: 1,
        subject: 'رياضيات', className: 'الأول', section: 'أ'
      }],
      attendance: [{
        id: 'only-attendance', teacherId: 'only-teacher', date: '2026-09-02',
        status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z'
      }]
    });

    const plan = await module.generateCoverage('2026-09-02');
    expect(plan.unfilledCount).toBe(1);
    await expect(module.approveCoverage({ ...plan, unfilledCount: 0 })).rejects.toThrow('بلا تغطية');
  });

  it('persists an approved plan with its audit event through the public port', async () => {
    const { module } = createModule({
      teachers: [teachers[0], teachers[3]],
      timetable: [{
        id: 'lesson-1', teacherId: 'absent-1', day: 3, period: 3,
        subject: 'رياضيات', className: 'الأول', section: 'أ'
      }],
      attendance: [
        {
          id: 'attendance-1', teacherId: 'absent-1', date: '2026-09-02',
          status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z'
        },
        {
          id: 'attendance-2', teacherId: 'candidate-a', date: '2026-09-02',
          status: 'present', recordedAt: '2026-09-02T06:00:00.000Z'
        }
      ]
    });

    const approved = await module.approveCoverage(await module.generateCoverage('2026-09-02'));
    const dashboard = await module.dashboard('2026-09-02');

    expect(approved.assignments[0].status).toBe('approved');
    expect(dashboard.approvedPlan?.id).toBe(approved.id);
    expect((await module.auditEvents()).map(event => event.action)).toEqual(['coverage-approved']);
  });

  it('counts assignments generated today against the weekly waiting limit', async () => {
    const limited: StaffTeacher = {
      id: 'limited', name: 'بديل محدود', specialty: 'رياضيات', maxWeeklyWaits: 1, isActive: true
    };
    const { module } = createModule({
      teachers: [teachers[0], limited],
      timetable: [
        { id: 'lesson-1', teacherId: 'absent-1', day: 3, period: 1, subject: 'رياضيات', className: 'الأول', section: 'أ' },
        { id: 'lesson-2', teacherId: 'absent-1', day: 3, period: 2, subject: 'رياضيات', className: 'الثاني', section: 'ب' }
      ],
      attendance: [
        { id: 'absent', teacherId: 'absent-1', date: '2026-09-02', status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'present', teacherId: 'limited', date: '2026-09-02', status: 'present', recordedAt: '2026-09-02T06:00:00.000Z' }
      ]
    });

    const plan = await module.generateCoverage('2026-09-02');
    expect(plan.assignments.map(assignment => assignment.substituteTeacherId)).toEqual(['limited', null]);
    expect(plan.unfilledCount).toBe(1);
  });

  it('requires explicit present or late attendance before a teacher can cover a lesson', async () => {
    const { module } = createModule({
      teachers: [teachers[0], teachers[3]],
      timetable: [{
        id: 'lesson-1', teacherId: 'absent-1', day: 3, period: 1,
        subject: 'رياضيات', className: 'الأول', section: 'أ'
      }],
      attendance: [{
        id: 'absent', teacherId: 'absent-1', date: '2026-09-02',
        status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z'
      }]
    });

    expect((await module.generateCoverage('2026-09-02')).unfilledCount).toBe(1);
  });

  it('rejects approval atomically if inputs change between validation and persistence', async () => {
    const basePort = createInMemoryStaffOperationsPort({
      teachers: [teachers[0], teachers[3]],
      timetable: [{
        id: 'lesson-1', teacherId: 'absent-1', day: 3, period: 1,
        subject: 'رياضيات', className: 'الأول', section: 'أ'
      }],
      attendance: [
        { id: 'absent', teacherId: 'absent-1', date: '2026-09-02', status: 'absent', recordedAt: '2026-09-02T06:00:00.000Z' },
        { id: 'present', teacherId: 'candidate-a', date: '2026-09-02', status: 'present', recordedAt: '2026-09-02T06:00:00.000Z' }
      ]
    });
    let injectConcurrentChange = false;
    const port = {
      ...basePort,
      async saveCoveragePlan(...args: Parameters<typeof basePort.saveCoveragePlan>) {
        if (injectConcurrentChange) {
          await basePort.saveAttendance(
            { id: 'present', teacherId: 'candidate-a', date: '2026-09-02', status: 'late', minutesLate: 1, recordedAt: '2026-09-02T06:31:00.000Z' },
            { id: 'race', action: 'attendance-recorded', actorId: 'admin-2', occurredAt: '2026-09-02T06:31:00.000Z', details: {} },
            args[2]
          );
        }
        return basePort.saveCoveragePlan(...args);
      }
    };
    const module = createStaffOperationsModule(port, {
      now: () => new Date('2026-09-02T06:30:00.000Z'),
      createId: () => 'generated',
      resolveOperator: () => ({ id: 'admin-1', displayName: 'مدير المدرسة', canManageStaff: true })
    });
    const plan = await module.generateCoverage('2026-09-02');
    injectConcurrentChange = true;

    await expect(module.approveCoverage(plan)).rejects.toThrow('أثناء الاعتماد');
    expect((await basePort.load()).coveragePlans).toEqual([]);
  });

  it('uses version CAS so concurrent timetable assignment cannot race with teacher deactivation', async () => {
    const activeTeacher = teachers[3];
    const basePort = createInMemoryStaffOperationsPort({ teachers: [activeTeacher] });
    const port = {
      ...basePort,
      async saveTeacher(...args: Parameters<typeof basePort.saveTeacher>) {
        await basePort.replaceTimetable(
          [{
            id: 'concurrent-slot', teacherId: activeTeacher.id, day: 3, period: 1,
            subject: 'رياضيات', className: 'الأول', section: 'أ'
          }],
          { id: 'race', action: 'timetable-replaced', actorId: 'admin-2', occurredAt: '2026-09-02T06:31:00.000Z', details: {} },
          args[2]
        );
        return basePort.saveTeacher(...args);
      }
    };
    const module = createStaffOperationsModule(port, {
      resolveOperator: () => ({ id: 'admin-1', displayName: 'مدير المدرسة', canManageStaff: true })
    });

    await expect(module.saveTeacher({ ...activeTeacher, isActive: false })).rejects.toThrow('تغيرت البيانات');
    const snapshot = await basePort.load();
    expect(snapshot.teachers[0].isActive).toBe(true);
    expect(snapshot.timetable[0].teacherId).toBe(activeTeacher.id);
  });

  it('rejects impossible calendar dates and unsupported attendance states at runtime', async () => {
    const { module } = createModule({ teachers: [teachers[3]] });
    await expect(module.dashboard('2026-02-31')).rejects.toThrow('تاريخ التشغيل غير صالح');
    await expect(module.recordAttendance({
      teacherId: 'candidate-a', date: '2026-09-02', status: 'vacation' as never
    })).rejects.toThrow('حالة الحضور غير صالحة');
  });
});
