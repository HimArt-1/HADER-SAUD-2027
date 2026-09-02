import type {
  AttendanceRecord,
  DailySummary,
  ExitRecord,
  SchoolClass,
  Student,
  SystemSettings,
  User,
  ViolationRecord
} from '../../types';
import { accessPolicy } from '../access';
import { uniqueAttendanceByStudentDate } from '../attendance';

export type SchoolDayDataPort = Readonly<{
  getRoster(): Promise<Readonly<{
    students: Student[];
    classes: SchoolClass[];
  }>>;
  getSettings(): Promise<SystemSettings>;
  getDailySummary(date: string): Promise<DailySummary | null>;
  getExits(date: string): Promise<ExitRecord[]>;
  getViolations(date: string): Promise<ViolationRecord[]>;
  getAttendance(date: string): Promise<AttendanceRecord[]>;
}>;

export type SchoolDayActorResolver = (
  actor: User | null | undefined
) => Promise<User | null>;

export type SchoolDaySnapshot = Readonly<{
  date: string;
  actor: User | null;
  students: Student[];
  classes: SchoolClass[];
  settings: SystemSettings;
  summary: DailySummary | null;
  exits: ExitRecord[];
  violations: ViolationRecord[];
  attendance: AttendanceRecord[];
}>;

export type LoadSchoolDaySnapshotInput = Readonly<{
  actor: User | null | undefined;
  date: string;
  previousAttendance?: readonly AttendanceRecord[];
}>;

export type LoadSchoolDaySnapshotResult =
  | Readonly<{ status: 'stale' }>
  | Readonly<{
      status: 'ready';
      snapshot: SchoolDaySnapshot;
      attendancePreserved: boolean;
    }>;

export type SchoolDayWorkflow = Readonly<{
  loadSnapshot(input: LoadSchoolDaySnapshotInput): Promise<LoadSchoolDaySnapshotResult>;
}>;

const REGRESSION_GUARD_MINIMUM = 5;
const REGRESSION_GUARD_RATIO = 0.5;

/**
 * Coordinates one authoritative school-day read. The workflow owns actor
 * hydration, supervisor scope, attendance de-duplication, regression
 * protection and stale-response rejection so UI consumers do not repeat them.
 */
export const createSchoolDayWorkflow = (
  data: SchoolDayDataPort,
  resolveActor: SchoolDayActorResolver
): SchoolDayWorkflow => {
  let latestRequest = 0;

  return Object.freeze({
    async loadSnapshot({
      actor,
      date,
      previousAttendance = []
    }: LoadSchoolDaySnapshotInput): Promise<LoadSchoolDaySnapshotResult> {
      const request = ++latestRequest;
      const [
        roster,
        settings,
        summary,
        exits,
        violations,
        attendance,
        resolvedActor
      ] = await Promise.all([
        data.getRoster(),
        data.getSettings(),
        data.getDailySummary(date),
        data.getExits(date),
        data.getViolations(date),
        data.getAttendance(date),
        resolveActor(actor)
      ]);

      const { students: allStudents, classes: allClasses } = roster;

      if (request !== latestRequest) return { status: 'stale' };

      const scopedStudents = resolvedActor && accessPolicy.isSupervisorScopedRole(resolvedActor)
        ? accessPolicy.filterStudentsBySupervisorScope(allStudents, resolvedActor)
        : allStudents;
      const scopedClasses = resolvedActor && accessPolicy.isSupervisorScopedRole(resolvedActor)
        ? accessPolicy.filterSchoolClassesBySupervisorScope(allClasses, resolvedActor)
        : allClasses;

      const scopeRows = <T extends { student_id: string }>(rows: readonly T[]): T[] =>
        accessPolicy.filterRowsByStudentScope([...rows], allStudents, resolvedActor);

      const nextAttendance = uniqueAttendanceByStudentDate(
        scopeRows(attendance),
        date
      );
      const scopedPreviousAttendance = uniqueAttendanceByStudentDate(
        scopeRows(previousAttendance),
        date
      );
      const attendancePreserved =
        scopedPreviousAttendance.length > REGRESSION_GUARD_MINIMUM &&
        nextAttendance.length < scopedPreviousAttendance.length * REGRESSION_GUARD_RATIO;

      return {
        status: 'ready',
        attendancePreserved,
        snapshot: {
          date,
          actor: resolvedActor,
          students: scopedStudents,
          classes: scopedClasses,
          settings,
          summary,
          exits: scopeRows(exits),
          violations: scopeRows(violations),
          attendance: attendancePreserved ? scopedPreviousAttendance : nextAttendance
        }
      };
    }
  });
};
