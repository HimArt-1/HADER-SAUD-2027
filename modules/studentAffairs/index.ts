import type {
  ExitRecord,
  ExitRequesterRelation,
  GuardianExcuseRecord,
  GuardianExcuseStatus,
  Notification,
  ViolationRecord
} from '../../types';

export type StudentAffairsPort = Readonly<{
  saveExit(record: ExitRecord, mode: 'create' | 'update'): Promise<void>;
  deleteExit(exitId: string): Promise<void>;
  loadExits(date?: string): Promise<ExitRecord[]>;
  loadStudentExits(studentId: string): Promise<ExitRecord[]>;
  saveViolation(record: ViolationRecord): Promise<void>;
  deleteViolation(violationId: string): Promise<void>;
  loadViolations(studentId?: string): Promise<ViolationRecord[]>;
  loadViolationsForDate(date: string): Promise<ViolationRecord[]>;
  saveExcuse(record: GuardianExcuseRecord, mode: 'create' | 'update'): Promise<void>;
  loadExcuses(filters?: StudentAffairsExcuseFilters): Promise<GuardianExcuseRecord[]>;
  sendNotification(notification: Notification): Promise<void>;
}>;

export type StudentAffairsExcuseFilters = Readonly<{
  studentId?: string;
  status?: GuardianExcuseStatus | 'all';
  limit?: number;
}>;

export type StudentAffairsQuery =
  | Readonly<{ type: 'day'; date?: string }>
  | Readonly<{ type: 'student'; studentId: string; includeExcuses?: boolean }>
  | Readonly<{ type: 'exits'; date?: string }>
  | Readonly<{ type: 'violations'; date?: string; studentId?: string }>
  | Readonly<{ type: 'excuses'; filters?: StudentAffairsExcuseFilters }>;

export type GuardianExcuseDraft = Omit<
  GuardianExcuseRecord,
  | 'id'
  | 'status'
  | 'admin_notes'
  | 'reviewed_by'
  | 'reviewed_by_label'
  | 'reviewed_at'
  | 'created_at'
  | 'updated_at'
> & Partial<Pick<GuardianExcuseRecord, 'id' | 'created_at' | 'updated_at'>>;

export type StudentAffairsCommand =
  | Readonly<{
      type: 'save-exit';
      id?: string;
      exitId?: string;
      studentId: string;
      reason: string;
      requesterRelation: ExitRequesterRelation;
      requesterRelationOther?: string | null;
      notes?: string;
      supervisorName?: string;
      createdBy?: string | null;
      occurredAt?: string;
      date?: string;
    }>
  | Readonly<{ type: 'delete-exit'; exitId: string }>
  | Readonly<{
      type: 'record-violation';
      studentId: string;
      violationType: string;
      level: number;
      description?: string;
      actionTaken?: string;
      summonGuardian?: boolean;
      guardianNotified?: boolean;
      violationId?: string;
      createdBy?: string | null;
      createdByLabel?: string | null;
      id?: string;
      occurredAt?: string;
      date?: string;
      guardianNotification?: Readonly<{ title: string; message: string }>;
    }>
  | Readonly<{ type: 'delete-violation'; violationId: string }>
  | Readonly<{
      type: 'submit-excuse';
      excuse: GuardianExcuseDraft;
      notifyAdmin?: boolean;
    }>
  | Readonly<{
      type: 'review-excuse';
      excuse: GuardianExcuseRecord;
      status: Exclude<GuardianExcuseStatus, 'pending'>;
      notes?: string;
      reviewer: Readonly<{ id?: string | null; label: string }>;
    }>;

export type StudentAffairsSnapshot = Readonly<{
  exits: ExitRecord[];
  violations: ViolationRecord[];
  excuses: GuardianExcuseRecord[];
}>;

export type StudentAffairsExecutionResult = Readonly<{
  exit: ExitRecord | null;
  violation: ViolationRecord | null;
  excuse: GuardianExcuseRecord | null;
  notification: Notification | null;
}>;

export type StudentAffairsModule = Readonly<{
  load(query: StudentAffairsQuery): Promise<StudentAffairsSnapshot>;
  execute(command: StudentAffairsCommand): Promise<StudentAffairsExecutionResult>;
}>;

type StudentAffairsEnvironment = Readonly<{
  now?: () => Date;
  createId?: () => string;
  onNotificationError?: (error: unknown) => void;
}>;

const emptySnapshot = (): StudentAffairsSnapshot => ({ exits: [], violations: [], excuses: [] });

const emptyResult = (): StudentAffairsExecutionResult => ({
  exit: null,
  violation: null,
  excuse: null,
  notification: null
});

const localDate = (date: Date): string => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')
].join('-');

const sortAndDedupe = <T extends { id: string }>(
  rows: readonly T[],
  timestamp: (row: T) => string | undefined
): T[] => {
  const byId = new Map<string, T>();
  [...rows]
    .filter(row => Boolean(row?.id))
    .sort((left, right) =>
      String(timestamp(right) || '').localeCompare(String(timestamp(left) || '')) ||
      right.id.localeCompare(left.id)
    )
    .forEach(row => {
      if (!byId.has(row.id)) byId.set(row.id, { ...row });
    });
  return [...byId.values()];
};

const normalizeExits = (rows: readonly ExitRecord[]): ExitRecord[] =>
  sortAndDedupe(rows, row => row.exit_time || row.created_at);

const normalizeViolations = (rows: readonly ViolationRecord[]): ViolationRecord[] =>
  sortAndDedupe(rows, row => row.created_at || row.date);

const normalizeExcuses = (rows: readonly GuardianExcuseRecord[]): GuardianExcuseRecord[] =>
  sortAndDedupe(rows, row => row.created_at);

/**
 * Owns student-affairs workflows and their notification side effects.
 * Persistence details stay behind StudentAffairsPort.
 */
export const createStudentAffairsModule = (
  port: StudentAffairsPort,
  environment: StudentAffairsEnvironment = {}
): StudentAffairsModule => {
  const now = environment.now ?? (() => new Date());
  const createId = environment.createId ?? (() => crypto.randomUUID());

  const notify = async (notification: Notification): Promise<Notification | null> => {
    try {
      await port.sendNotification(notification);
      return { ...notification };
    } catch (error) {
      environment.onNotificationError?.(error);
      return null;
    }
  };

  const createNotification = (
    input: Omit<Notification, 'id' | 'created_at'>,
    createdAt: string
  ): Notification => ({ ...input, id: createId(), created_at: createdAt });

  return Object.freeze({
    async load(query) {
      if (query.type === 'day') {
        const date = query.date ?? localDate(now());
        const [exits, violations] = await Promise.all([
          port.loadExits(date),
          port.loadViolationsForDate(date)
        ]);
        return {
          ...emptySnapshot(),
          exits: normalizeExits(exits).filter(row => (row.date || row.exit_time || '').startsWith(date)),
          violations: normalizeViolations(violations).filter(row =>
            (row.date || row.created_at || '').startsWith(date)
          )
        };
      }

      if (query.type === 'student') {
        const [exits, violations, excuses] = await Promise.all([
          port.loadStudentExits(query.studentId),
          port.loadViolations(query.studentId),
          query.includeExcuses
            ? port.loadExcuses({ studentId: query.studentId, limit: 25 })
            : Promise.resolve([])
        ]);
        return {
          exits: normalizeExits(exits).filter(row => row.student_id === query.studentId),
          violations: normalizeViolations(violations).filter(row => row.student_id === query.studentId),
          excuses: normalizeExcuses(excuses).filter(row => row.student_id === query.studentId)
        };
      }

      if (query.type === 'exits') {
        const exits = normalizeExits(await port.loadExits(query.date));
        return {
          ...emptySnapshot(),
          exits: query.date
            ? exits.filter(row => (row.date || row.exit_time || '').startsWith(query.date!))
            : exits
        };
      }

      if (query.type === 'violations') {
        const violations = query.date
          ? await port.loadViolationsForDate(query.date)
          : await port.loadViolations(query.studentId);
        return {
          ...emptySnapshot(),
          violations: normalizeViolations(violations).filter(row =>
            (!query.studentId || row.student_id === query.studentId) &&
            (!query.date || (row.date || row.created_at || '').startsWith(query.date))
          )
        };
      }

      const filters = query.filters;
      let excuses = normalizeExcuses(await port.loadExcuses(filters));
      if (filters?.studentId) excuses = excuses.filter(row => row.student_id === filters.studentId);
      if (filters?.status && filters.status !== 'all') {
        excuses = excuses.filter(row => row.status === filters.status);
      }
      if (filters?.limit) excuses = excuses.slice(0, filters.limit);
      return { ...emptySnapshot(), excuses };
    },

    async execute(command) {
      if (command.type === 'save-exit') {
        const studentId = command.studentId.trim();
        const reason = command.reason.trim();
        const otherRelation = command.requesterRelationOther?.trim() || null;
        if (!studentId || !reason) throw new Error('Exit student and reason are required');
        if (command.requesterRelation === 'other' && !otherRelation) {
          throw new Error('Other requester relation must be described');
        }

        const existing = command.exitId
          ? (await port.loadExits()).find(row => row.id === command.exitId)
          : undefined;
        if (command.exitId && !existing) throw new Error('Exit record not found');
        if (existing && existing.student_id !== studentId) {
          throw new Error('Exit student cannot be changed');
        }

        const occurredAt = command.occurredAt || existing?.exit_time || now().toISOString();
        const occurredDate = new Date(occurredAt);
        if (Number.isNaN(occurredDate.getTime())) throw new Error('Exit time is invalid');
        const record: ExitRecord = {
          ...existing,
          id: existing?.id || command.exitId || command.id?.trim() || createId(),
          student_id: studentId,
          reason,
          requester_relation: command.requesterRelation,
          requester_relation_other: command.requesterRelation === 'other' ? otherRelation : null,
          exit_time: occurredAt,
          date: command.date || existing?.date || localDate(occurredDate),
          supervisor_name: existing?.supervisor_name || command.supervisorName,
          created_by: existing?.created_by ?? command.createdBy ?? null,
          notes: command.notes?.trim() || undefined,
          status: 'approved'
        };
        await port.saveExit(record, existing ? 'update' : 'create');
        return { ...emptyResult(), exit: { ...record } };
      }

      if (command.type === 'delete-exit') {
        if (!command.exitId.trim()) throw new Error('Exit id is required');
        await port.deleteExit(command.exitId);
        return emptyResult();
      }

      if (command.type === 'delete-violation') {
        if (!command.violationId.trim()) throw new Error('Violation id is required');
        await port.deleteViolation(command.violationId);
        return emptyResult();
      }

      if (command.type === 'record-violation') {
        const studentId = command.studentId.trim();
        const violationType = command.violationType.trim();
        if (!studentId || !violationType) throw new Error('Violation student and type are required');
        if (!Number.isFinite(command.level)) throw new Error('Violation level is invalid');
        const existing = command.violationId
          ? (await port.loadViolations()).find(row => row.id === command.violationId)
          : undefined;
        if (command.violationId && !existing) throw new Error('Violation record not found');
        if (existing && existing.student_id !== studentId) {
          throw new Error('Violation student cannot be changed');
        }

        const occurredAt = existing?.created_at || command.occurredAt || now().toISOString();
        const occurredDate = new Date(occurredAt);
        if (Number.isNaN(occurredDate.getTime())) throw new Error('Violation time is invalid');
        const shouldNotify = Boolean(
          command.summonGuardian &&
          command.guardianNotification &&
          !existing?.guardian_notified
        );
        const record: ViolationRecord = {
          ...existing,
          id: existing?.id || command.violationId || command.id?.trim() || createId(),
          student_id: studentId,
          type: violationType,
          level: Math.max(1, Math.min(5, Math.round(command.level))),
          description: command.description?.trim() || undefined,
          action_taken: command.actionTaken?.trim() || undefined,
          summon_guardian: Boolean(command.summonGuardian),
          guardian_notified: existing?.guardian_notified ?? command.guardianNotified ?? false,
          created_by: existing?.created_by ?? command.createdBy ?? null,
          created_by_label: existing?.created_by_label ?? command.createdByLabel ?? null,
          created_at: occurredAt,
          date: existing?.date || command.date || localDate(occurredDate)
        };
        await port.saveViolation(record);

        const notification = shouldNotify
          ? await notify(createNotification({
              title: command.guardianNotification!.title,
              message: command.guardianNotification!.message,
              type: 'behavior',
              target_audience: 'guardian',
              target_id: studentId,
              is_popup: true,
              created_by: command.createdBy
            }, occurredAt))
          : null;
        const savedRecord = notification && !record.guardian_notified
          ? { ...record, guardian_notified: true }
          : record;
        if (savedRecord !== record) await port.saveViolation(savedRecord);
        return { ...emptyResult(), violation: { ...savedRecord }, notification };
      }

      if (command.type === 'submit-excuse') {
        const createdAt = command.excuse.created_at || now().toISOString();
        if (!command.excuse.student_id.trim() || !command.excuse.reason.trim()) {
          throw new Error('Excuse student and reason are required');
        }
        const excuse: GuardianExcuseRecord = {
          ...command.excuse,
          id: command.excuse.id?.trim() || createId(),
          student_id: command.excuse.student_id.trim(),
          reason: command.excuse.reason.trim(),
          status: 'pending',
          admin_notes: null,
          reviewed_by: null,
          reviewed_by_label: null,
          reviewed_at: null,
          created_at: createdAt,
          updated_at: command.excuse.updated_at || createdAt
        };
        await port.saveExcuse(excuse, 'create');

        const studentLabel = excuse.student_name || excuse.student_id;
        const classLabel = [excuse.class_name, excuse.section].filter(Boolean).join('/');
        const notification = command.notifyAdmin === false
          ? null
          : await notify(createNotification({
              title: 'عذر غياب جديد',
              message: `ورد عذر غياب جديد للطالب ${studentLabel}${classLabel ? ` (${classLabel} - ${excuse.student_id})` : ''}. افتح تبويب الأعذار لمراجعته.`,
              type: 'attendance',
              target_audience: 'admin',
              target_id: excuse.student_id,
              is_popup: true
            }, createdAt));
        return { ...emptyResult(), excuse: { ...excuse }, notification };
      }

      const reviewedAt = now().toISOString();
      const notes = command.notes?.trim() || null;
      const excuse: GuardianExcuseRecord = {
        ...command.excuse,
        status: command.status,
        admin_notes: notes,
        reviewed_by: command.reviewer.id || null,
        reviewed_by_label: command.reviewer.label.trim() || 'الإدارة',
        reviewed_at: reviewedAt,
        updated_at: reviewedAt
      };
      await port.saveExcuse(excuse, 'update');

      const statusLabel = command.status === 'approved'
        ? 'تم اعتماد عذر الغياب'
        : 'تم رفض عذر الغياب';
      const notification = await notify(createNotification({
        title: statusLabel,
        message: `${statusLabel} للطالب ${excuse.student_name || excuse.student_id}${notes ? `\nملاحظة الإدارة: ${notes}` : ''}`,
        type: 'attendance',
        target_audience: 'guardian',
        target_id: excuse.student_id,
        is_popup: true,
        created_by: command.reviewer.id
      }, reviewedAt));
      return { ...emptyResult(), excuse: { ...excuse }, notification };
    }
  });
};

export const createInMemoryStudentAffairsPort = (
  initial: Readonly<{
    exits?: readonly ExitRecord[];
    violations?: readonly ViolationRecord[];
    excuses?: readonly GuardianExcuseRecord[];
  }> = {}
): StudentAffairsPort => {
  let exits = [...(initial.exits ?? [])];
  let violations = [...(initial.violations ?? [])];
  let excuses = [...(initial.excuses ?? [])];

  return Object.freeze({
    async saveExit(record, mode) {
      if (mode === 'update') exits = exits.filter(row => row.id !== record.id);
      exits = [{ ...record }, ...exits];
    },
    async deleteExit(exitId) {
      exits = exits.filter(row => row.id !== exitId);
    },
    async loadExits(date) {
      return exits
        .filter(row => !date || (row.date || row.exit_time || '').startsWith(date))
        .map(row => ({ ...row }));
    },
    async loadStudentExits(studentId) {
      return exits.filter(row => row.student_id === studentId).map(row => ({ ...row }));
    },
    async saveViolation(record) {
      violations = [{ ...record }, ...violations.filter(row => row.id !== record.id)];
    },
    async deleteViolation(violationId) {
      violations = violations.filter(row => row.id !== violationId);
    },
    async loadViolations(studentId) {
      return violations
        .filter(row => !studentId || row.student_id === studentId)
        .map(row => ({ ...row }));
    },
    async loadViolationsForDate(date) {
      return violations
        .filter(row => (row.date || row.created_at || '').startsWith(date))
        .map(row => ({ ...row }));
    },
    async saveExcuse(record) {
      excuses = [{ ...record }, ...excuses.filter(row => row.id !== record.id)];
    },
    async loadExcuses(filters) {
      return excuses
        .filter(row => !filters?.studentId || row.student_id === filters.studentId)
        .filter(row => !filters?.status || filters.status === 'all' || row.status === filters.status)
        .slice(0, filters?.limit ?? excuses.length)
        .map(row => ({ ...row }));
    },
    async sendNotification() {
      // Tests can replace this adapter method to observe notification delivery.
    }
  });
};
