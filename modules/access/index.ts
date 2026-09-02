import {
  type DismissalCallRequest,
  type DismissalSchedule,
  type Notification,
  Role,
  type SchoolClass,
  type Student,
  type User
} from '../../types';
import {
  normalizeClassName,
  normalizeSectionName,
  normalizeStudentId,
  parseClassSectionTargetId
} from '../../services/dbHelpers';

const ADMIN_ROLES: readonly Role[] = [Role.SITE_ADMIN, Role.SCHOOL_ADMIN];
const SUPERVISOR_NOTIFICATION_ROLES: readonly Role[] = [
  Role.SUPERVISOR_GLOBAL,
  Role.SUPERVISOR_CLASS,
  Role.WATCHER
];

const ROUTE_ROLES = {
  kiosk: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.KIOSK],
  mobileScanner: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
  dismissalKiosk: [
    Role.SITE_ADMIN,
    Role.SCHOOL_ADMIN,
    Role.WATCHER,
    Role.KIOSK,
    Role.SUPERVISOR_GLOBAL,
    Role.SUPERVISOR_CLASS
  ],
  callBoard: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
  guardStation: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.CALL_STATION],
  admin: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN],
  watcher: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
  supervision: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
  parents: [Role.GUARDIAN],
  support: [Role.SITE_ADMIN],
  telegram: [Role.SITE_ADMIN],
  storage: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN],
  reports: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS],
  diagnostics: [Role.SITE_ADMIN]
} as const satisfies Record<string, readonly Role[]>;

export type ProtectedRouteKey = keyof typeof ROUTE_ROLES;

const isAssignedClassSupervisor = (user: User | null | undefined): user is User =>
  user?.role === Role.SUPERVISOR_CLASS;

const isSupervisorScopedRole = (user: User): boolean =>
  user.role === Role.SUPERVISOR_GLOBAL || user.role === Role.SUPERVISOR_CLASS;

const isClassSectionAllowedForUserScope = (
  className: unknown,
  section: unknown,
  user: User | null | undefined
): boolean => {
  if (!isAssignedClassSupervisor(user)) return true;
  if (!user.assigned_classes?.length) return false;

  const normalizedClass = normalizeClassName(className);
  const assignedClass = user.assigned_classes.find(
    assigned => normalizeClassName(assigned.class_name) === normalizedClass
  );

  if (!assignedClass) return false;
  if (!assignedClass.sections?.length) return true;

  const allowedSections = assignedClass.sections.map(sectionName => normalizeSectionName(sectionName));
  return allowedSections.includes(normalizeSectionName(section));
};

const isStudentAllowedForUserScope = (
  student: Student,
  user: User | null | undefined
): boolean => isClassSectionAllowedForUserScope(student.class_name, student.section, user);

const filterStudentsBySupervisorScope = (students: Student[], user: User): Student[] => {
  if (user.role === Role.SUPERVISOR_GLOBAL) return students;
  if (user.role !== Role.SUPERVISOR_CLASS) return students;
  if (!user.assigned_classes?.length) return [];

  return students.filter(student => isStudentAllowedForUserScope(student, user));
};

const filterSchoolClassesBySupervisorScope = (
  classes: SchoolClass[],
  user: User
): SchoolClass[] => {
  if (user.role === Role.SUPERVISOR_GLOBAL) return classes;
  if (user.role !== Role.SUPERVISOR_CLASS) return classes;
  if (!user.assigned_classes?.length) return [];

  const allowedClassNames = new Set(
    user.assigned_classes.map(assigned => normalizeClassName(assigned.class_name))
  );
  const allowedSections = new Map(
    user.assigned_classes.map(assigned => [
      normalizeClassName(assigned.class_name),
      new Set((assigned.sections || []).map(section => normalizeSectionName(section)))
    ])
  );

  return classes
    .filter(schoolClass => {
      const className = normalizeClassName(schoolClass.name);
      if (!allowedClassNames.has(className)) return false;
      const sections = allowedSections.get(className);
      if (!sections || sections.size === 0) return true;
      return (schoolClass.sections || []).some(section => sections.has(normalizeSectionName(section)));
    })
    .map(schoolClass => {
      const className = normalizeClassName(schoolClass.name);
      const sections = allowedSections.get(className);
      if (!sections || sections.size === 0) return schoolClass;
      return {
        ...schoolClass,
        sections: (schoolClass.sections || []).filter(section => sections.has(normalizeSectionName(section)))
      };
    });
};

const filterDismissalCallsForUserScope = (
  calls: DismissalCallRequest[],
  user: User | null | undefined
): DismissalCallRequest[] => {
  if (!isAssignedClassSupervisor(user)) return calls;
  return calls.filter(call =>
    isClassSectionAllowedForUserScope(call.class_name, call.section, user)
  );
};

const filterDismissalCallsForUserScopeWithStudents = (
  calls: DismissalCallRequest[],
  students: Student[],
  user: User | null | undefined
): DismissalCallRequest[] => {
  if (!isAssignedClassSupervisor(user)) return calls;

  const studentsById = new Map(
    students.map(student => [normalizeStudentId(student.id), student])
  );

  return calls.filter(call => {
    const student = studentsById.get(normalizeStudentId(call.student_id));
    return student
      ? isStudentAllowedForUserScope(student, user)
      : isClassSectionAllowedForUserScope(call.class_name, call.section, user);
  });
};

const filterDismissalSchedulesForUserScope = (
  schedules: DismissalSchedule[],
  user: User | null | undefined
): DismissalSchedule[] => {
  if (!isAssignedClassSupervisor(user)) return schedules;
  if (!user.assigned_classes?.length) return [];
  const allowedClasses = new Set(
    user.assigned_classes.map(assigned => normalizeClassName(assigned.class_name))
  );
  return schedules.filter(schedule =>
    allowedClasses.has(normalizeClassName(schedule.class_name))
  );
};

const filterRowsByStudentScope = <T extends { student_id: string }>(
  rows: T[],
  students: Student[],
  user: User | null | undefined
): T[] => {
  if (!isAssignedClassSupervisor(user)) return rows;
  const allowedStudentIds = new Set(
    students
      .filter(student => isStudentAllowedForUserScope(student, user))
      .map(student => normalizeStudentId(student.id))
  );
  return rows.filter(row => allowedStudentIds.has(normalizeStudentId(row.student_id)));
};

const filterStudentsForRoleScopedWidgets = (students: Student[], user: User): Student[] =>
  isSupervisorScopedRole(user)
    ? filterStudentsBySupervisorScope(students, user)
    : students;

const notificationMatchesUser = (
  notification: Notification,
  user: User | 'kiosk'
): boolean => {
  if (user === 'kiosk') return notification.target_audience === 'kiosk';
  if (notification.target_audience === 'all') return true;
  if (notification.target_audience === 'user') return notification.target_id === user.id;
  if (notification.target_audience === 'admin') return ADMIN_ROLES.includes(user.role);
  if (notification.target_audience === 'supervisor') {
    if (!SUPERVISOR_NOTIFICATION_ROLES.includes(user.role)) return false;
    if (!notification.target_id || user.role !== Role.SUPERVISOR_CLASS) return true;
    const target = parseClassSectionTargetId(notification.target_id);
    return isClassSectionAllowedForUserScope(target.className, target.section, user);
  }
  if (notification.target_audience === 'guardian') return user.role === Role.GUARDIAN;
  if (notification.target_audience === 'class' && notification.target_id) {
    if (ADMIN_ROLES.includes(user.role) || user.role === Role.SUPERVISOR_GLOBAL || user.role === Role.WATCHER) {
      return true;
    }
    if (user.role !== Role.SUPERVISOR_CLASS) return false;
    const target = parseClassSectionTargetId(notification.target_id);
    return isClassSectionAllowedForUserScope(target.className, target.section, user);
  }
  if (notification.target_audience === 'student') return notification.target_id === user.id;
  if (notification.target_audience === 'kiosk') return false;
  return (notification.target_audience as string) === user.role;
};

/** Pure interface for route, student/class scope, dismissal and notification policy. */
export const accessPolicy = Object.freeze({
  canAccessRoute(user: User | null | undefined, route: ProtectedRouteKey): boolean {
    const allowedRoles: readonly Role[] = ROUTE_ROLES[route];
    return Boolean(user && allowedRoles.includes(user.role));
  },
  isSupervisorScopedRole,
  filterStudentsBySupervisorScope,
  filterSchoolClassesBySupervisorScope,
  isClassSectionAllowedForUserScope,
  isStudentAllowedForUserScope,
  filterDismissalCallsForUserScope,
  filterDismissalCallsForUserScopeWithStudents,
  filterDismissalSchedulesForUserScope,
  filterRowsByStudentScope,
  filterStudentsForRoleScopedWidgets,
  notificationMatchesUser
});
