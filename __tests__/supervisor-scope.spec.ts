import { describe, expect, it } from 'vitest';
import type { DismissalCallRequest, DismissalRecord, DismissalSchedule, Notification, Student, User } from '../types';
import { Role } from '../types';
import {
  buildClassSectionTargetId,
  filterRowsByDashboardStudents,
  isActiveStudent
} from '../services/dbHelpers';
import { accessPolicy } from '../modules/access';

const {
  filterDismissalCallsForUserScope,
  filterDismissalCallsForUserScopeWithStudents,
  filterDismissalSchedulesForUserScope,
  filterStudentsForRoleScopedWidgets,
  filterRowsByStudentScope,
  isClassSectionAllowedForUserScope,
  notificationMatchesUser,
  isStudentAllowedForUserScope
} = accessPolicy;

const supervisor = (assigned_classes: User['assigned_classes']): User => ({
  id: 'supervisor-1',
  username: 'supervisor',
  name: 'مشرف صف',
  role: Role.SUPERVISOR_CLASS,
  assigned_classes
});

const schoolAdmin: User = {
  id: 'admin-1',
  username: 'admin',
  name: 'مدير',
  role: Role.SCHOOL_ADMIN
};

const globalSupervisor: User = {
  id: 'global-supervisor-1',
  username: 'global-supervisor',
  name: 'مشرف عام',
  role: Role.SUPERVISOR_GLOBAL
};

const guardian: User = {
  id: 'guardian-1',
  username: 'guardian',
  name: 'ولي أمر',
  role: Role.GUARDIAN
};

const students: Student[] = [
  { id: 's1', name: 'Student 1', class_name: 'الأول', section: 'A' },
  { id: 's2', name: 'Student 2', class_name: 'الأول', section: 'B' },
  { id: 's3', name: 'Student 3', class_name: 'الثاني', section: 'A' }
];

const call = (student: Student): DismissalCallRequest => ({
  id: `call-${student.id}`,
  student_id: student.id,
  student_name: student.name,
  class_name: student.class_name,
  section: student.section,
  requested_by: 'guardian',
  requested_by_name: 'ولي الأمر',
  status: 'pending',
  request_time: '2026-05-16T12:00:00.000Z'
});

describe('supervisor assigned class scope', () => {
  it('limits dismissal calls to assigned class sections', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);

    const visible = filterDismissalCallsForUserScope(students.map(call), user);

    expect(visible.map(row => row.student_id)).toEqual(['s1']);
  });

  it('allows all sections when a class is assigned without section restrictions', () => {
    const user = supervisor([{ class_name: 'الأول', sections: [] }]);

    const visible = filterDismissalCallsForUserScope(students.map(call), user);

    expect(visible.map(row => row.student_id)).toEqual(['s1', 's2']);
  });

  it('uses student data for call-board scope when dismissal call metadata is missing', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const calls = students.map(student => ({
      ...call(student),
      class_name: '',
      section: ''
    }));

    const visible = filterDismissalCallsForUserScopeWithStudents(calls, students, user);

    expect(visible.map(row => row.student_id)).toEqual(['s1']);
  });

  it('uses student data as the authoritative call-board scope when call metadata is stale', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const calls = [
      { ...call(students[0]), class_name: 'الثاني', section: 'B' },
      { ...call(students[1]), class_name: 'الأول', section: 'A' }
    ];

    const visible = filterDismissalCallsForUserScopeWithStudents(calls, students, user);

    expect(visible.map(row => row.student_id)).toEqual(['s1']);
  });

  it('matches call-board rows to students with normalized student ids', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const localStudents: Student[] = [
      { id: '1234', name: 'Student 1234', class_name: 'الأول', section: 'A' }
    ];
    const calls: DismissalCallRequest[] = [
      {
        ...call(localStudents[0]),
        student_id: '١٢٣٤',
        class_name: '',
        section: ''
      }
    ];

    const visible = filterDismissalCallsForUserScopeWithStudents(calls, localStudents, user);

    expect(visible.map(row => row.student_id)).toEqual(['١٢٣٤']);
  });

  it('blocks kiosk scan for students outside a class supervisor scope', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);

    expect(isStudentAllowedForUserScope(students[0], user)).toBe(true);
    expect(isStudentAllowedForUserScope(students[1], user)).toBe(false);
    expect(isStudentAllowedForUserScope(students[2], user)).toBe(false);
  });

  it('filters dismissal counts by scoped students', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const dismissals: DismissalRecord[] = students.map(student => ({
      id: `dismissal-${student.id}`,
      student_id: student.id,
      date: '2026-05-16',
      exit_time: '2026-05-16T12:20:00.000Z',
      method: 'kiosk'
    }));

    const visible = filterRowsByStudentScope(dismissals, students, user);

    expect(visible.map(row => row.student_id)).toEqual(['s1']);
  });

  it('matches scoped dismissal rows with normalized student ids', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const localStudents: Student[] = [
      { id: '1234', name: 'Student 1234', class_name: 'الأول', section: 'A' }
    ];
    const dismissals: DismissalRecord[] = [
      {
        id: 'dismissal-1',
        student_id: '١٢٣٤',
        date: '2026-05-16',
        exit_time: '2026-05-16T12:20:00.000Z',
        method: 'kiosk'
      }
    ];

    const visible = filterRowsByStudentScope(dismissals, localStudents, user);

    expect(visible.map(row => row.student_id)).toEqual(['١٢٣٤']);
  });

  it('keeps class-level schedules for any assigned section in that class', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const schedules: DismissalSchedule[] = [
      { id: 'schedule-1', class_name: 'الأول', dismissal_time: '12:00', days: [0, 1, 2, 3, 4] },
      { id: 'schedule-2', class_name: 'الثاني', dismissal_time: '12:30', days: [0, 1, 2, 3, 4] }
    ];

    const visible = filterDismissalSchedulesForUserScope(schedules, user);

    expect(visible.map(row => row.id)).toEqual(['schedule-1']);
  });

  it('does not restrict non-class-supervisor users', () => {
    const visible = filterDismissalCallsForUserScope(students.map(call), schoolAdmin);

    expect(visible).toHaveLength(3);
  });

  it('does not restrict global supervisors in dashboard scoped widgets', () => {
    const visible = filterStudentsForRoleScopedWidgets(students, globalSupervisor);

    expect(visible.map(student => student.id)).toEqual(['s1', 's2', 's3']);
  });

  it('uses active students only for dashboard totals', () => {
    const inactiveStudent: Student = { ...students[1], is_active: false };

    expect([students[0], inactiveStudent].filter(isActiveStudent).map(student => student.id)).toEqual(['s1']);
  });

  it('keeps dashboard rows global while supervision rows stay class-scoped', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const calls = students.map(call);

    expect(filterRowsByDashboardStudents(calls, students).map(row => row.student_id)).toEqual(['s1', 's2', 's3']);
    expect(filterDismissalCallsForUserScope(calls, user).map(row => row.student_id)).toEqual(['s1']);
  });

  it('targets dismissal notifications to matching class supervisors', () => {
    const user = supervisor([{ class_name: 'الأول', sections: ['A'] }]);
    const matchingNotification: Notification = {
      id: 'notification-1',
      title: 'نداء انصراف جديد',
      message: 'نداء انصراف',
      type: 'dismissal_call',
      target_audience: 'supervisor',
      target_id: buildClassSectionTargetId('الأول', 'A'),
      is_popup: true,
      created_at: '2026-05-16T12:00:00.000Z'
    };
    const otherSectionNotification: Notification = {
      ...matchingNotification,
      id: 'notification-2',
      target_id: buildClassSectionTargetId('الأول', 'B')
    };

    expect(notificationMatchesUser(matchingNotification, user)).toBe(true);
    expect(notificationMatchesUser(otherSectionNotification, user)).toBe(false);
    expect(notificationMatchesUser(matchingNotification, globalSupervisor)).toBe(true);
  });

  it('does not leak class-targeted notifications to unrelated roles', () => {
    const classNotification: Notification = {
      id: 'notification-class-1',
      message: 'إشعار صف',
      type: 'announcement',
      target_audience: 'class',
      target_id: buildClassSectionTargetId('الأول', 'A'),
      created_at: '2026-05-16T12:00:00.000Z'
    };

    expect(isClassSectionAllowedForUserScope('الأول', 'A', supervisor([{ class_name: 'الأول', sections: ['A'] }]))).toBe(true);
    expect(notificationMatchesUser(classNotification, guardian)).toBe(false);
    expect(notificationMatchesUser(classNotification, schoolAdmin)).toBe(true);
  });
});
