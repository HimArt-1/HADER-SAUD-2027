export type StaffWorkDay = 0 | 1 | 2 | 3 | 4;
export type StaffAttendanceStatus = 'present' | 'late' | 'absent';

export type StaffTeacher = Readonly<{
  id: string;
  name: string;
  specialty: string;
  phone?: string;
  maxWeeklyWaits: number;
  isActive: boolean;
}>;

export type StaffTeachingSlot = Readonly<{
  id: string;
  teacherId: string;
  day: StaffWorkDay;
  period: number;
  subject: string;
  className: string;
  section: string;
}>;

export type StaffTeachingSlotInput = Omit<StaffTeachingSlot, 'id'>;

export type StaffAttendanceRecord = Readonly<{
  id: string;
  teacherId: string;
  date: string;
  status: StaffAttendanceStatus;
  minutesLate?: number;
  recordedAt: string;
}>;

export type CoverageAssignment = Readonly<{
  id: string;
  lessonSlotId: string;
  absentTeacherId: string;
  substituteTeacherId: string | null;
  period: number;
  subject: string;
  className: string;
  section: string;
  status: 'proposed' | 'approved' | 'unfilled';
  reasons: readonly string[];
}>;

export type CoveragePlan = Readonly<{
  id: string;
  date: string;
  inputRevision: string;
  inputVersion: number;
  generatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  assignments: readonly CoverageAssignment[];
  unfilledCount: number;
}>;

export type StaffOperationsAuditEvent = Readonly<{
  id: string;
  action: 'teacher-saved' | 'timetable-replaced' | 'attendance-recorded' | 'coverage-approved';
  actorId: string;
  occurredAt: string;
  details: Readonly<Record<string, string | number | boolean>>;
}>;

export type StaffOperationsSnapshot = Readonly<{
  version: number;
  teachers: readonly StaffTeacher[];
  timetable: readonly StaffTeachingSlot[];
  attendance: readonly StaffAttendanceRecord[];
  coveragePlans: readonly CoveragePlan[];
}>;

export type StaffOperationsDashboard = StaffOperationsSnapshot & Readonly<{
  date: string;
  absentTeacherIds: readonly string[];
  approvedPlan: CoveragePlan | null;
}>;

export type StaffOperationsPort = Readonly<{
  load(): Promise<StaffOperationsSnapshot>;
  saveTeacher(teacher: StaffTeacher, audit: StaffOperationsAuditEvent, expectedVersion: number): Promise<void>;
  replaceTimetable(slots: readonly StaffTeachingSlot[], audit: StaffOperationsAuditEvent, expectedVersion: number): Promise<void>;
  saveAttendance(record: StaffAttendanceRecord, audit: StaffOperationsAuditEvent, expectedVersion: number): Promise<void>;
  saveCoveragePlan(plan: CoveragePlan, audit: StaffOperationsAuditEvent, expectedVersion: number): Promise<void>;
  auditEvents(): Promise<readonly StaffOperationsAuditEvent[]>;
}>;

type StaffOperator = Readonly<{
  id: string;
  displayName: string;
  canManageStaff: boolean;
}>;

type StaffOperationsEnvironment = Readonly<{
  now?: () => Date;
  createId?: () => string;
  resolveOperator: () => StaffOperator | null;
}>;

export type StaffOperationsModule = Readonly<{
  dashboard(date: string): Promise<StaffOperationsDashboard>;
  saveTeacher(input: Readonly<{
    id?: string;
    name: string;
    specialty: string;
    phone?: string;
    maxWeeklyWaits: number;
    isActive?: boolean;
  }>): Promise<StaffTeacher>;
  replaceTimetable(input: Readonly<{ slots: readonly StaffTeachingSlotInput[] }>): Promise<readonly StaffTeachingSlot[]>;
  recordAttendance(input: Readonly<{
    teacherId: string;
    date: string;
    status: StaffAttendanceStatus;
    minutesLate?: number;
  }>): Promise<StaffAttendanceRecord>;
  generateCoverage(date: string): Promise<CoveragePlan>;
  approveCoverage(plan: CoveragePlan): Promise<CoveragePlan>;
  auditEvents(): Promise<readonly StaffOperationsAuditEvent[]>;
}>;

const clone = <T>(value: T): T => (
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T
);

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();
const normalizeKey = (value: string): string => normalizeText(value).toLocaleLowerCase('ar');
const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const assertDate = (date: string): void => {
  if (!isIsoDate(date)) throw new Error('تاريخ التشغيل غير صالح');
};

const getOperator = (resolveOperator: () => StaffOperator | null): StaffOperator => {
  const operator = resolveOperator();
  if (!operator?.id.trim() || !operator.canManageStaff) {
    throw new Error('تتطلب إدارة المعلمين صلاحية مدير موثوق');
  }
  return operator;
};

const toAudit = (
  action: StaffOperationsAuditEvent['action'],
  operator: StaffOperator,
  details: StaffOperationsAuditEvent['details'],
  createId: () => string,
  now: () => Date
): StaffOperationsAuditEvent => Object.freeze({
  id: createId(),
  action,
  actorId: operator.id,
  occurredAt: now().toISOString(),
  details: Object.freeze({ ...details })
});

export const validateStaffTimetable = (
  slots: readonly StaffTeachingSlotInput[],
  teachers: readonly StaffTeacher[]
): readonly string[] => {
  const errors: string[] = [];
  const teacherById = new Map(teachers.map(teacher => [teacher.id, teacher] as const));
  const teacherSlots = new Set<string>();
  const classSlots = new Set<string>();

  slots.forEach((slot, index) => {
    const row = index + 2;
    const teacher = teacherById.get(slot.teacherId);
    if (!teacher) {
      errors.push(`الصف ${row}: المعلم غير موجود`);
      return;
    }
    if (!teacher.isActive) {
      errors.push(`الصف ${row}: لا يمكن إسناد حصة إلى معلم غير نشط`);
      return;
    }
    if (![0, 1, 2, 3, 4].includes(slot.day) || !Number.isInteger(slot.period) || slot.period < 1 || slot.period > 12) {
      errors.push(`الصف ${row}: اليوم أو رقم الحصة غير صالح`);
      return;
    }
    if (
      !normalizeText(slot.subject)
      || !normalizeText(slot.className)
      || !normalizeText(slot.section)
    ) {
      errors.push(`الصف ${row}: بيانات الحصة غير مكتملة`);
      return;
    }

    const teacherKey = `${slot.teacherId}:${slot.day}:${slot.period}`;
    if (teacherSlots.has(teacherKey)) {
      errors.push(`الصف ${row}: تعارض في جدول المعلم`);
      return;
    }
    teacherSlots.add(teacherKey);

    const classKey = `${normalizeKey(slot.className)}:${normalizeKey(slot.section)}:${slot.day}:${slot.period}`;
    if (classSlots.has(classKey)) {
      errors.push(`الصف ${row}: تعارض في جدول الفصل`);
      return;
    }
    classSlots.add(classKey);
  });
  return Object.freeze(errors);
};

const startOfWeek = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
};

const createRevision = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const compareAssignments = (
  left: readonly CoverageAssignment[],
  right: readonly CoverageAssignment[]
): boolean => {
  const project = (assignment: CoverageAssignment) => ({
    lessonSlotId: assignment.lessonSlotId,
    absentTeacherId: assignment.absentTeacherId,
    substituteTeacherId: assignment.substituteTeacherId,
    period: assignment.period,
    status: assignment.status
  });
  return JSON.stringify(left.map(project)) === JSON.stringify(right.map(project));
};

export const createStaffOperationsModule = (
  port: StaffOperationsPort,
  environment: StaffOperationsEnvironment
): StaffOperationsModule => {
  const now = environment.now ?? (() => new Date());
  const createId = environment.createId ?? (() => crypto.randomUUID());

  const coverageInputs = async (date: string) => {
    assertDate(date);
    const snapshot = await port.load();
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (![0, 1, 2, 3, 4].includes(day)) throw new Error('اليوم المحدد ليس يومًا دراسيًا');
    const attendance = snapshot.attendance.filter(record => record.date === date);
    const absentTeacherIds = new Set(
      attendance.filter(record => record.status === 'absent').map(record => record.teacherId)
    );
    const weekStart = startOfWeek(date);
    const weekEndValue = new Date(`${weekStart}T00:00:00.000Z`);
    weekEndValue.setUTCDate(weekEndValue.getUTCDate() + 6);
    const weekEnd = weekEndValue.toISOString().slice(0, 10);
    const priorApprovedPlans = snapshot.coveragePlans.filter(plan => (
      Boolean(plan.approvedAt) && plan.date >= weekStart && plan.date <= weekEnd && plan.date !== date
    ));
    const weeklyWaitCounts = new Map<string, number>();
    priorApprovedPlans.forEach(plan => plan.assignments.forEach(assignment => {
      if (!assignment.substituteTeacherId || assignment.status !== 'approved') return;
      weeklyWaitCounts.set(
        assignment.substituteTeacherId,
        (weeklyWaitCounts.get(assignment.substituteTeacherId) ?? 0) + 1
      );
    }));
    const timetable = snapshot.timetable.filter(slot => slot.day === day);
    const revision = await createRevision({
      date,
      teachers: [...snapshot.teachers].sort((a, b) => a.id.localeCompare(b.id)),
      timetable: [...timetable].sort((a, b) => a.id.localeCompare(b.id)),
      attendance: [...attendance].sort((a, b) => a.teacherId.localeCompare(b.teacherId)),
      weeklyWaitCounts: [...weeklyWaitCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
    });
    const availableTeacherIds = new Set(attendance
      .filter(record => record.status === 'present' || record.status === 'late')
      .map(record => record.teacherId));
    return { snapshot, day, timetable, absentTeacherIds, availableTeacherIds, weeklyWaitCounts, revision };
  };

  const generate = async (date: string): Promise<CoveragePlan> => {
    const inputs = await coverageInputs(date);
    const teacherById = new Map(inputs.snapshot.teachers.map(teacher => [teacher.id, teacher] as const));
    const busyKeys = new Set(inputs.timetable.map(slot => `${slot.teacherId}:${slot.period}`));
    const assignedAtPeriod = new Set<string>();
    const dailyWaitCounts = new Map<string, number>();
    const missingLessons = inputs.timetable
      .filter(slot => inputs.absentTeacherIds.has(slot.teacherId))
      .sort((left, right) => left.period - right.period || left.id.localeCompare(right.id));

    const assignments = missingLessons.map((lesson): CoverageAssignment => {
      const absentTeacher = teacherById.get(lesson.teacherId);
      const candidates = inputs.snapshot.teachers.filter(teacher => (
        teacher.isActive
        && inputs.availableTeacherIds.has(teacher.id)
        && !inputs.absentTeacherIds.has(teacher.id)
        && !busyKeys.has(`${teacher.id}:${lesson.period}`)
        && !assignedAtPeriod.has(`${teacher.id}:${lesson.period}`)
        && (inputs.weeklyWaitCounts.get(teacher.id) ?? 0) + (dailyWaitCounts.get(teacher.id) ?? 0) < teacher.maxWeeklyWaits
      )).sort((left, right) => {
        const weeklyDifference = (inputs.weeklyWaitCounts.get(left.id) ?? 0)
          - (inputs.weeklyWaitCounts.get(right.id) ?? 0);
        if (weeklyDifference !== 0) return weeklyDifference;
        const leftSpecialty = normalizeKey(left.specialty) === normalizeKey(absentTeacher?.specialty ?? '') ? 0 : 1;
        const rightSpecialty = normalizeKey(right.specialty) === normalizeKey(absentTeacher?.specialty ?? '') ? 0 : 1;
        if (leftSpecialty !== rightSpecialty) return leftSpecialty - rightSpecialty;
        const dailyDifference = (dailyWaitCounts.get(left.id) ?? 0) - (dailyWaitCounts.get(right.id) ?? 0);
        if (dailyDifference !== 0) return dailyDifference;
        return left.name.localeCompare(right.name, 'ar') || left.id.localeCompare(right.id);
      });

      const substitute = candidates[0] ?? null;
      if (substitute) {
        assignedAtPeriod.add(`${substitute.id}:${lesson.period}`);
        dailyWaitCounts.set(substitute.id, (dailyWaitCounts.get(substitute.id) ?? 0) + 1);
      }
      return Object.freeze({
        id: createId(),
        lessonSlotId: lesson.id,
        absentTeacherId: lesson.teacherId,
        substituteTeacherId: substitute?.id ?? null,
        period: lesson.period,
        subject: lesson.subject,
        className: lesson.className,
        section: lesson.section,
        status: substitute ? 'proposed' : 'unfilled',
        reasons: Object.freeze(substitute
          ? [
            `تكليفات الأسبوع: ${inputs.weeklyWaitCounts.get(substitute.id) ?? 0}`,
            normalizeKey(substitute.specialty) === normalizeKey(absentTeacher?.specialty ?? '')
              ? 'مطابقة التخصص'
              : 'متاح دون تعارض'
          ]
          : ['لا يوجد معلم متاح دون تعارض أو تجاوز للحد الأسبوعي'])
      });
    });

    return Object.freeze({
      id: createId(),
      date,
      inputRevision: inputs.revision,
      inputVersion: inputs.snapshot.version,
      generatedAt: now().toISOString(),
      assignments: Object.freeze(assignments),
      unfilledCount: assignments.filter(assignment => assignment.status === 'unfilled').length
    });
  };

  return Object.freeze({
    async dashboard(date) {
      assertDate(date);
      const inputs = await coverageInputs(date);
      const absentTeacherIds = Object.freeze(inputs.snapshot.attendance
        .filter(record => record.date === date && record.status === 'absent')
        .map(record => record.teacherId));
      const candidatePlan = inputs.snapshot.coveragePlans.find(plan => plan.date === date && plan.approvedAt) ?? null;
      const approvedPlan = candidatePlan?.inputRevision === inputs.revision ? candidatePlan : null;
      return Object.freeze({
        ...inputs.snapshot,
        date,
        absentTeacherIds,
        approvedPlan
      });
    },

    async saveTeacher(input) {
      const operator = getOperator(environment.resolveOperator);
      const snapshot = await port.load();
      const name = normalizeText(input.name);
      const specialty = normalizeText(input.specialty);
      if (!name || !specialty) throw new Error('اسم المعلم والتخصص مطلوبان');
      if (!Number.isInteger(input.maxWeeklyWaits) || input.maxWeeklyWaits < 0 || input.maxWeeklyWaits > 20) {
        throw new Error('الحد الأسبوعي للانتظار يجب أن يكون بين 0 و20');
      }
      const id = input.id?.trim() || createId();
      if (snapshot.teachers.some(teacher => teacher.id !== id && normalizeKey(teacher.name) === normalizeKey(name))) {
        throw new Error('يوجد معلم آخر بالاسم نفسه');
      }
      const teacher = Object.freeze({
        id,
        name,
        specialty,
        phone: input.phone?.replace(/\s+/g, '').trim() || undefined,
        maxWeeklyWaits: input.maxWeeklyWaits,
        isActive: input.isActive ?? true
      });
      if (!teacher.isActive && snapshot.timetable.some(slot => slot.teacherId === id)) {
        throw new Error('أعد إسناد حصص المعلم قبل تعطيله');
      }
      await port.saveTeacher(teacher, toAudit(
        'teacher-saved', operator, { teacherId: id }, createId, now
      ), snapshot.version);
      return teacher;
    },

    async replaceTimetable(input) {
      const operator = getOperator(environment.resolveOperator);
      if (input.slots.length === 0) throw new Error('لا يمكن اعتماد جدول أسبوعي فارغ');
      const snapshot = await port.load();
      const validationErrors = validateStaffTimetable(input.slots, snapshot.teachers);
      if (validationErrors.length > 0) throw new Error(validationErrors[0]);
      const slots = Object.freeze(input.slots.map(slot => Object.freeze({
        ...slot,
        id: `slot-${encodeURIComponent(slot.teacherId)}-${slot.day}-${slot.period}`,
        subject: normalizeText(slot.subject),
        className: normalizeText(slot.className),
        section: normalizeText(slot.section)
      })));
      await port.replaceTimetable(slots, toAudit(
        'timetable-replaced', operator, { slotCount: slots.length }, createId, now
      ), snapshot.version);
      return slots;
    },

    async recordAttendance(input) {
      const operator = getOperator(environment.resolveOperator);
      assertDate(input.date);
      if (!['present', 'late', 'absent'].includes(input.status)) throw new Error('حالة الحضور غير صالحة');
      const snapshot = await port.load();
      if (!snapshot.teachers.some(teacher => teacher.id === input.teacherId && teacher.isActive)) {
        throw new Error('المعلم غير موجود أو غير نشط');
      }
      if (input.status === 'late' && input.minutesLate !== undefined && !Number.isFinite(input.minutesLate)) {
        throw new Error('مدة التأخر غير صالحة');
      }
      const minutesLate = input.status === 'late' ? Math.max(0, Math.round(input.minutesLate ?? 0)) : undefined;
      const record = Object.freeze({
        id: `${input.date}:${input.teacherId}`,
        teacherId: input.teacherId,
        date: input.date,
        status: input.status,
        ...(minutesLate !== undefined ? { minutesLate } : {}),
        recordedAt: now().toISOString()
      });
      await port.saveAttendance(record, toAudit(
        'attendance-recorded', operator, { teacherId: input.teacherId, status: input.status }, createId, now
      ), snapshot.version);
      return record;
    },

    generateCoverage: generate,

    async approveCoverage(plan) {
      const operator = getOperator(environment.resolveOperator);
      if (plan.assignments.length === 0) throw new Error('لا توجد حصص انتظار لاعتمادها');
      const actualUnfilledCount = plan.assignments.filter(assignment => (
        !assignment.substituteTeacherId || assignment.status === 'unfilled'
      )).length;
      if (actualUnfilledCount > 0 || actualUnfilledCount !== plan.unfilledCount) {
        throw new Error('لا يمكن اعتماد جدول يحتوي حصصًا بلا تغطية');
      }
      const current = await generate(plan.date);
      if (current.inputRevision !== plan.inputRevision || !compareAssignments(current.assignments, plan.assignments)) {
        throw new Error('تغيرت بيانات اليوم بعد إنشاء الخطة؛ أعد توليد جدول الانتظار');
      }
      const approvedAt = now().toISOString();
      const approved = Object.freeze({
        ...current,
        approvedAt,
        approvedBy: operator.id,
        assignments: Object.freeze(current.assignments.map(assignment => Object.freeze({
          ...assignment,
          status: 'approved' as const
        })))
      });
      await port.saveCoveragePlan(approved, toAudit(
        'coverage-approved', operator, { assignmentCount: approved.assignments.length }, createId, now
      ), current.inputVersion);
      return approved;
    },

    auditEvents: port.auditEvents
  });
};

export const createInMemoryStaffOperationsPort = (
  initial: Partial<StaffOperationsSnapshot> = {}
): StaffOperationsPort => {
  let teachers = clone([...(initial.teachers ?? [])]);
  let timetable = clone([...(initial.timetable ?? [])]);
  let attendance = clone([...(initial.attendance ?? [])]);
  let coveragePlans = clone([...(initial.coveragePlans ?? [])]);
  let audit: StaffOperationsAuditEvent[] = [];
  let version = initial.version ?? 0;

  return Object.freeze({
    async load() {
      return clone({ version, teachers, timetable, attendance, coveragePlans });
    },
    async saveTeacher(teacher, event, expectedVersion) {
      if (version !== expectedVersion) throw new Error('تغيرت البيانات؛ أعد المحاولة');
      teachers = [...teachers.filter(candidate => candidate.id !== teacher.id), clone(teacher)];
      audit = [...audit, clone(event)];
      version += 1;
    },
    async replaceTimetable(slots, event, expectedVersion) {
      if (version !== expectedVersion) throw new Error('تغيرت البيانات؛ أعد المحاولة');
      timetable = clone([...slots]);
      audit = [...audit, clone(event)];
      version += 1;
    },
    async saveAttendance(record, event, expectedVersion) {
      if (version !== expectedVersion) throw new Error('تغيرت البيانات؛ أعد المحاولة');
      attendance = [...attendance.filter(candidate => candidate.id !== record.id), clone(record)];
      audit = [...audit, clone(event)];
      version += 1;
    },
    async saveCoveragePlan(plan, event, expectedVersion) {
      if (version !== expectedVersion) {
        throw new Error('تغيرت بيانات اليوم أثناء الاعتماد؛ أعد توليد جدول الانتظار');
      }
      coveragePlans = [...coveragePlans.filter(candidate => candidate.id !== plan.id), clone(plan)];
      audit = [...audit, clone(event)];
      version += 1;
    },
    async auditEvents() {
      return clone(audit);
    }
  });
};
