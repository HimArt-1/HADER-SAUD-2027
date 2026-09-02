import type {
  DismissalCallRequest,
  DismissalRecord,
  DismissalSchedule,
  Notification,
  Student
} from '../../types';
import { normalizeStudentId } from '../../services/dbHelpers';

export type DismissalPort = Readonly<{
  addRecord(record: DismissalRecord): Promise<void>;
  loadTodayRecords(): Promise<DismissalRecord[]>;
  loadStudentRecords(studentId: string): Promise<DismissalRecord[]>;
  loadRecordsByRange(startDate: string, endDate: string): Promise<DismissalRecord[]>;
  isDismissedToday(studentId: string): Promise<boolean>;
  loadSchedules(): Promise<DismissalSchedule[]>;
  saveSchedules(schedules: DismissalSchedule[]): Promise<void>;
  addCall(call: DismissalCallRequest): Promise<void>;
  loadActiveCalls(): Promise<DismissalCallRequest[]>;
  updateCallStatus(callId: string, status: DismissalCallRequest['status']): Promise<void>;
  subscribeToCalls(listener: (calls: DismissalCallRequest[]) => void): { unsubscribe(): void };
  findStudent(studentId: string): Promise<Student | null>;
  saveNotification(notification: Notification): Promise<void>;
}>;

export type DismissalQuery =
  | Readonly<{ type: 'overview' }>
  | Readonly<{ type: 'today' }>
  | Readonly<{ type: 'student'; studentId: string }>
  | Readonly<{ type: 'range'; startDate: string; endDate: string }>
  | Readonly<{ type: 'active-calls' }>
  | Readonly<{ type: 'schedules' }>
  | Readonly<{ type: 'dismissed-today'; studentId: string }>;

export type DismissalSnapshot = Readonly<{
  records: DismissalRecord[];
  calls: DismissalCallRequest[];
  schedules: DismissalSchedule[];
  dismissed: boolean | null;
}>;

export type DismissalCommand =
  | Readonly<{
      type: 'request-call';
      student: Pick<Student, 'id' | 'name' | 'class_name' | 'section'>;
      requester: Readonly<{ id: string; name?: string }>;
      id?: string;
      requestTime?: string;
    }>
  | Readonly<{
      type: 'record-dismissal';
      studentId: string;
      method: DismissalRecord['method'];
      callId?: string;
      recordedBy?: string | null;
      recordedByLabel?: string | null;
      pickedUpBy?: string;
      notes?: string;
      id?: string;
      occurredAt?: string;
      date?: string;
    }>
  | Readonly<{
      type: 'transition-call';
      callId: string;
      status: DismissalCallRequest['status'];
    }>
  | Readonly<{
      type: 'save-schedules';
      schedules: DismissalSchedule[];
    }>;

export type DismissalExecutionResult = Readonly<{
  outcome: 'requested' | 'already-requested' | 'recorded' | 'already-dismissed' | 'updated';
  call: DismissalCallRequest | null;
  record: DismissalRecord | null;
  notification: Notification | null;
  resolvedCallIds: string[];
  schedules: DismissalSchedule[];
}>;

export type DismissalModule = Readonly<{
  load(query: DismissalQuery): Promise<DismissalSnapshot>;
  execute(command: DismissalCommand): Promise<DismissalExecutionResult>;
  subscribe(listener: (calls: DismissalCallRequest[]) => void): { unsubscribe(): void };
}>;

type DismissalEnvironment = Readonly<{
  now?: () => Date;
  createId?: () => string;
  onNotificationError?: (error: unknown) => void;
}>;

const emptySnapshot = (): DismissalSnapshot => ({
  records: [],
  calls: [],
  schedules: [],
  dismissed: null
});

const emptyResult = (): DismissalExecutionResult => ({
  outcome: 'updated',
  call: null,
  record: null,
  notification: null,
  resolvedCallIds: [],
  schedules: []
});

const localDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const callTimestamp = (call: DismissalCallRequest) => {
  const value = call.called_at ?? call.request_time;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeActiveCalls = (
  calls: readonly DismissalCallRequest[],
  activeDate?: string
): DismissalCallRequest[] => {
  const byId = new Map<string, DismissalCallRequest>();
  for (const call of calls) {
    if (!call.id || !call.student_id || (call.status !== 'pending' && call.status !== 'called')) continue;
    const requestDate = call.request_time ? localDate(new Date(call.request_time)) : '';
    if (activeDate && requestDate !== activeDate) continue;
    const current = byId.get(call.id);
    if (!current || callTimestamp(call) >= callTimestamp(current)) byId.set(call.id, call);
  }

  const byStudent = new Map<string, DismissalCallRequest>();
  for (const call of byId.values()) {
    const key = normalizeStudentId(call.student_id);
    if (!key) continue;
    const current = byStudent.get(key);
    const callPriority = call.status === 'called' ? 1 : 0;
    const currentPriority = current?.status === 'called' ? 1 : 0;
    if (!current || callPriority > currentPriority
      || (callPriority === currentPriority && callTimestamp(call) >= callTimestamp(current))) {
      byStudent.set(key, call);
    }
  }

  return Array.from(byStudent.values(), call => ({ ...call }))
    .sort((a, b) => callTimestamp(a) - callTimestamp(b));
};

const normalizeSchedules = (
  schedules: readonly DismissalSchedule[],
  createId: () => string
): DismissalSchedule[] => schedules.map(schedule => {
  const className = schedule.class_name.trim();
  const time = String(schedule.dismissal_time || '').slice(0, 5);
  if (!className) throw new Error('اسم الصف مطلوب في جدول الانصراف');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`وقت الانصراف غير صالح للصف ${className}`);
  }
  const days = Array.from(new Set(schedule.days || []))
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  return {
    ...schedule,
    id: schedule.id || createId(),
    class_name: className,
    dismissal_time: time,
    days
  };
});

/**
 * Owns the dismissal lifecycle: duplicate prevention, call creation,
 * recording, active-call resolution, guardian notification and schedules.
 */
export const createDismissalModule = (
  port: DismissalPort,
  environment: DismissalEnvironment = {}
): DismissalModule => {
  const now = environment.now ?? (() => new Date());
  const createId = environment.createId ?? (() => crypto.randomUUID());
  const completions = new Map<string, Promise<DismissalExecutionResult>>();
  const requests = new Map<string, Promise<DismissalExecutionResult>>();

  const requestCall = async (
    command: Extract<DismissalCommand, { type: 'request-call' }>
  ): Promise<DismissalExecutionResult> => {
    const studentId = normalizeStudentId(command.student.id);
    if (!studentId || !command.student.name.trim() || !command.requester.id.trim()) {
      throw new Error('بيانات الطالب ومقدم طلب النداء مطلوبة');
    }
    const activeCalls = normalizeActiveCalls(await port.loadActiveCalls(), localDate(now()));
    const existing = activeCalls.find(call => normalizeStudentId(call.student_id) === studentId);
    if (existing) {
      return { ...emptyResult(), outcome: 'already-requested', call: existing };
    }
    const call: DismissalCallRequest = {
      id: command.id || createId(),
      student_id: command.student.id,
      student_name: command.student.name,
      class_name: command.student.class_name,
      section: command.student.section,
      requested_by: command.requester.id,
      requested_by_name: command.requester.name,
      status: 'pending',
      request_time: command.requestTime ?? now().toISOString()
    };
    await port.addCall(call);
    return { ...emptyResult(), outcome: 'requested', call };
  };

  const resolveCallsForStudent = async (studentId: string, explicitCallId?: string) => {
    const activeDate = localDate(now());
    const activeCalls = (await port.loadActiveCalls()).filter(call => {
      if (call.status !== 'pending' && call.status !== 'called') return false;
      return call.request_time && localDate(new Date(call.request_time)) === activeDate;
    });
    const normalizedStudentId = normalizeStudentId(studentId);
    const ids = new Set(
      activeCalls
        .filter(call => normalizeStudentId(call.student_id) === normalizedStudentId)
        .map(call => call.id)
    );
    if (explicitCallId) ids.add(explicitCallId);
    await Promise.all(Array.from(ids, callId => port.updateCallStatus(callId, 'dismissed')));
    return Array.from(ids);
  };

  const completeDismissal = async (
    command: Extract<DismissalCommand, { type: 'record-dismissal' }>
  ): Promise<DismissalExecutionResult> => {
    const timestamp = command.occurredAt ?? now().toISOString();
    const alreadyDismissed = await port.isDismissedToday(command.studentId);
    let record: DismissalRecord | null = null;

    if (!alreadyDismissed) {
      record = {
        id: command.id || createId(),
        student_id: command.studentId,
        date: command.date ?? localDate(new Date(timestamp)),
        exit_time: timestamp,
        method: command.method,
        recorded_by: command.recordedBy,
        recorded_by_label: command.recordedByLabel,
        picked_up_by: command.pickedUpBy,
        notes: command.notes,
        created_at: timestamp
      };
      await port.addRecord(record);
    }

    const resolvedCallIds = await resolveCallsForStudent(command.studentId, command.callId);
    let notification: Notification | null = null;

    if (record) {
      try {
        const student = await port.findStudent(command.studentId);
        const studentName = student?.name || command.studentId;
        const time = new Date(timestamp).toLocaleTimeString('ar-SA', {
          hour: '2-digit',
          minute: '2-digit'
        });
        notification = {
          id: createId(),
          title: 'تم تسجيل الانصراف',
          message: `تم تسجيل انصراف ${studentName} الساعة ${time}`,
          type: 'attendance',
          target_audience: 'guardian',
          target_id: command.studentId,
          is_popup: true,
          created_at: timestamp
        };
        await port.saveNotification(notification);
      } catch (error) {
        environment.onNotificationError?.(error);
      }
    }

    return {
      ...emptyResult(),
      outcome: alreadyDismissed ? 'already-dismissed' : 'recorded',
      record,
      notification,
      resolvedCallIds
    };
  };

  return Object.freeze({
    async load(query) {
      switch (query.type) {
        case 'overview': {
          const [records, calls, schedules] = await Promise.all([
            port.loadTodayRecords(),
            port.loadActiveCalls(),
            port.loadSchedules()
          ]);
          return { records, calls: normalizeActiveCalls(calls, localDate(now())), schedules, dismissed: null };
        }
        case 'today':
          return { ...emptySnapshot(), records: await port.loadTodayRecords() };
        case 'student':
          return { ...emptySnapshot(), records: await port.loadStudentRecords(query.studentId) };
        case 'range':
          return { ...emptySnapshot(), records: await port.loadRecordsByRange(query.startDate, query.endDate) };
        case 'active-calls':
          return { ...emptySnapshot(), calls: normalizeActiveCalls(await port.loadActiveCalls(), localDate(now())) };
        case 'schedules':
          return { ...emptySnapshot(), schedules: await port.loadSchedules() };
        case 'dismissed-today':
          return { ...emptySnapshot(), dismissed: await port.isDismissedToday(query.studentId) };
      }
    },

    async execute(command) {
      switch (command.type) {
        case 'request-call': {
          const key = normalizeStudentId(command.student.id);
          const active = requests.get(key);
          if (active) return active;
          const request = requestCall(command);
          requests.set(key, request);
          try {
            return await request;
          } finally {
            if (requests.get(key) === request) requests.delete(key);
          }
        }
        case 'record-dismissal': {
          const key = normalizeStudentId(command.studentId);
          const active = completions.get(key);
          if (active) return active;
          const completion = completeDismissal(command);
          completions.set(key, completion);
          try {
            return await completion;
          } finally {
            if (completions.get(key) === completion) completions.delete(key);
          }
        }
        case 'transition-call':
          await port.updateCallStatus(command.callId, command.status);
          return emptyResult();
        case 'save-schedules': {
          const schedules = normalizeSchedules(command.schedules, createId);
          await port.saveSchedules(schedules);
          return { ...emptyResult(), schedules };
        }
      }
    },

    subscribe(listener) {
      return port.subscribeToCalls(calls => listener(normalizeActiveCalls(calls, localDate(now()))));
    }
  });
};

export const createInMemoryDismissalPort = (
  initial: Readonly<{
    students?: readonly Student[];
    records?: readonly DismissalRecord[];
    calls?: readonly DismissalCallRequest[];
    schedules?: readonly DismissalSchedule[];
    today?: string;
  }> = {}
): DismissalPort => {
  const students = [...(initial.students ?? [])];
  let records = [...(initial.records ?? [])];
  let calls = [...(initial.calls ?? [])];
  let schedules = [...(initial.schedules ?? [])];
  const today = initial.today ?? localDate(new Date());
  const listeners = new Set<(calls: DismissalCallRequest[]) => void>();
  const activeCalls = () => calls.filter(call => call.status === 'pending' || call.status === 'called');
  const emit = () => listeners.forEach(listener => listener(activeCalls().map(call => ({ ...call }))));

  return Object.freeze({
    async addRecord(record) {
      records = [record, ...records.filter(candidate => candidate.id !== record.id)];
    },
    async loadTodayRecords() {
      return records.filter(record => record.date === today).map(record => ({ ...record }));
    },
    async loadStudentRecords(studentId) {
      return records.filter(record => record.student_id === studentId).map(record => ({ ...record }));
    },
    async loadRecordsByRange(startDate, endDate) {
      return records
        .filter(record => record.date >= startDate && record.date <= endDate)
        .map(record => ({ ...record }));
    },
    async isDismissedToday(studentId) {
      const key = normalizeStudentId(studentId);
      return records.some(record => record.date === today && normalizeStudentId(record.student_id) === key);
    },
    async loadSchedules() {
      return schedules.map(schedule => ({ ...schedule, days: [...schedule.days] }));
    },
    async saveSchedules(nextSchedules) {
      schedules = nextSchedules.map(schedule => ({ ...schedule, days: [...schedule.days] }));
    },
    async addCall(call) {
      calls = [call, ...calls.filter(candidate => candidate.id !== call.id)];
      emit();
    },
    async loadActiveCalls() {
      return activeCalls().map(call => ({ ...call }));
    },
    async updateCallStatus(callId, status) {
      const timestamp = new Date().toISOString();
      calls = calls.map(call => call.id === callId ? {
        ...call,
        status,
        ...(status === 'called' ? { called_at: timestamp } : {}),
        ...(status === 'dismissed' ? { dismissed_at: timestamp } : {})
      } : call);
      emit();
    },
    subscribeToCalls(listener) {
      listeners.add(listener);
      listener(activeCalls().map(call => ({ ...call })));
      return { unsubscribe: () => listeners.delete(listener) };
    },
    async findStudent(studentId) {
      const key = normalizeStudentId(studentId);
      return students.find(student => normalizeStudentId(student.id) === key) ?? null;
    },
    async saveNotification() {
      // Notification persistence is intentionally inert in the memory adapter.
    }
  });
};
