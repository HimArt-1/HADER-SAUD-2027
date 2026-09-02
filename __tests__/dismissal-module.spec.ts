import { describe, expect, it } from 'vitest';
import {
  createDismissalModule,
  createInMemoryDismissalPort,
  type DismissalPort
} from '../modules/dismissal';
import type { DismissalCallRequest, Student } from '../types';

const timestamp = '2026-08-18T09:30:00.000Z';
const today = new Date(timestamp);
const localToday = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0')
].join('-');
const student: Student = {
  id: '1234',
  name: 'طالب الاختبار',
  class_name: 'الأول',
  section: 'أ'
};
const call = (id: string, status: DismissalCallRequest['status'] = 'pending'): DismissalCallRequest => ({
  id,
  student_id: student.id,
  student_name: student.name,
  class_name: student.class_name,
  section: student.section,
  requested_by: 'guardian-1',
  status,
  request_time: timestamp
});

const createModule = (port = createInMemoryDismissalPort({ students: [student], today: localToday })) => {
  let sequence = 0;
  return createDismissalModule(port, {
    now: () => new Date(timestamp),
    createId: () => `generated-${++sequence}`
  });
};

describe('dismissal module interface', () => {
  it('creates one pending call and reuses it when the request is repeated', async () => {
    const dismissals = createModule();
    const command = {
      type: 'request-call' as const,
      student,
      requester: { id: 'guardian-1', name: 'ولي الأمر' }
    };

    const [first, concurrent] = await Promise.all([
      dismissals.execute(command),
      dismissals.execute(command)
    ]);
    const repeated = await dismissals.execute(command);

    expect(first.outcome).toBe('requested');
    expect(concurrent.call?.id).toBe(first.call?.id);
    expect(first.call).toMatchObject({ status: 'pending', student_id: '1234' });
    expect(repeated.outcome).toBe('already-requested');
    expect(repeated.call?.id).toBe(first.call?.id);
    expect((await dismissals.load({ type: 'active-calls' })).calls).toHaveLength(1);
  });

  it('records a dismissal, resolves every matching active call and prepares the guardian notification', async () => {
    const port = createInMemoryDismissalPort({
      students: [student],
      calls: [call('call-1'), call('call-2', 'called')],
      today: localToday
    });
    const dismissals = createModule(port);

    const result = await dismissals.execute({
      type: 'record-dismissal',
      studentId: '١٢٣٤',
      method: 'kiosk',
      recordedByLabel: 'لوحة النداءات'
    });

    expect(result.outcome).toBe('recorded');
    expect(result.record).toMatchObject({ student_id: '١٢٣٤', date: localToday, method: 'kiosk' });
    expect(result.resolvedCallIds.sort()).toEqual(['call-1', 'call-2']);
    expect(result.notification).toMatchObject({
      target_audience: 'guardian',
      target_id: '١٢٣٤'
    });
    expect(result.notification?.message).toContain(student.name);
    expect((await dismissals.load({ type: 'active-calls' })).calls).toEqual([]);
  });

  it('coalesces concurrent scans so only one dismissal record is written', async () => {
    const dismissals = createModule();
    const command = {
      type: 'record-dismissal' as const,
      studentId: student.id,
      method: 'scanner' as const
    };

    const [first, second] = await Promise.all([
      dismissals.execute(command),
      dismissals.execute(command)
    ]);
    const repeated = await dismissals.execute(command);

    expect(first.record?.id).toBe(second.record?.id);
    expect(repeated.outcome).toBe('already-dismissed');
    expect((await dismissals.load({ type: 'student', studentId: student.id })).records).toHaveLength(1);
  });

  it('normalizes schedules before persisting them', async () => {
    const dismissals = createModule();
    const result = await dismissals.execute({
      type: 'save-schedules',
      schedules: [{
        id: '',
        class_name: ' الأول ',
        dismissal_time: '12:15:00',
        days: [4, 0, 4, 9]
      }]
    });

    expect(result.schedules).toEqual([{
      id: 'generated-1',
      class_name: 'الأول',
      dismissal_time: '12:15',
      days: [0, 4]
    }]);
    expect((await dismissals.load({ type: 'schedules' })).schedules).toEqual(result.schedules);
  });

  it('keeps a recorded dismissal successful when guardian notification fails', async () => {
    const memory = createInMemoryDismissalPort({ students: [student], today: localToday });
    const errors: unknown[] = [];
    const port: DismissalPort = {
      ...memory,
      async saveNotification() {
        throw new Error('notification unavailable');
      }
    };
    const dismissals = createDismissalModule(port, {
      now: () => new Date(timestamp),
      createId: () => 'generated-id',
      onNotificationError: error => errors.push(error)
    });

    const result = await dismissals.execute({
      type: 'record-dismissal',
      studentId: student.id,
      method: 'kiosk'
    });

    expect(result.outcome).toBe('recorded');
    expect(result.record).not.toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('publishes normalized active-call snapshots and stops after unsubscribe', async () => {
    const dismissals = createModule();
    const snapshots: string[][] = [];
    const subscription = dismissals.subscribe(calls => snapshots.push(calls.map(item => item.id)));

    const requested = await dismissals.execute({
      type: 'request-call',
      student,
      requester: { id: 'guard-1' }
    });
    subscription.unsubscribe();
    await dismissals.execute({
      type: 'transition-call',
      callId: requested.call!.id,
      status: 'cancelled'
    });

    expect(snapshots).toEqual([[], [requested.call!.id]]);
  });

  it('hides stale calls and collapses duplicate active calls for the same student', async () => {
    const staleTimestamp = '2026-08-17T09:30:00.000Z';
    const port = createInMemoryDismissalPort({
      students: [student],
      today: localToday,
      calls: [
        { ...call('stale'), request_time: staleTimestamp },
        call('pending-new'),
        { ...call('called-new', 'called'), called_at: timestamp }
      ]
    });
    const dismissals = createModule(port);

    const active = (await dismissals.load({ type: 'active-calls' })).calls;
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: 'called-new', status: 'called' });
  });

  it('rejects incomplete call requests', async () => {
    const dismissals = createModule();
    await expect(dismissals.execute({
      type: 'request-call',
      student: { ...student, name: ' ' },
      requester: { id: 'guardian-1' }
    })).rejects.toThrow('بيانات الطالب');
  });
});
