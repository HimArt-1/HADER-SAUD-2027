import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryNotificationsPort,
  createNotificationsModule,
  type NotificationsPort
} from '../modules/notifications';
import { Role, type Notification, type User } from '../types';

const baseTime = '2026-08-18T09:30:00.000Z';
const guardian: User = {
  id: 'guardian-1',
  username: 'guardian',
  name: 'ولي أمر',
  role: Role.GUARDIAN
};

const notification = (
  id: string,
  audience: Notification['target_audience'] = 'all',
  createdAt = baseTime
): Notification => ({
  id,
  title: `إشعار ${id}`,
  message: `رسالة ${id}`,
  type: 'general',
  target_audience: audience,
  created_at: createdAt
});

const createModule = (port = createInMemoryNotificationsPort()) => {
  let sequence = 0;
  return createNotificationsModule(port, {
    now: () => new Date(baseTime),
    createId: () => `generated-${++sequence}`,
    pollIntervalMs: 0
  });
};

const flushSeed = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('notifications module interface', () => {
  it('owns audience filtering, newest-first ordering and duplicate removal', async () => {
    const center = createModule(createInMemoryNotificationsPort([
      notification('old', 'all', '2026-08-18T08:00:00.000Z'),
      notification('admin', 'admin', '2026-08-18T10:00:00.000Z'),
      notification('new', 'guardian', '2026-08-18T11:00:00.000Z'),
      notification('new', 'guardian', '2026-08-18T07:00:00.000Z')
    ]));

    const visible = await center.load({ type: 'user', recipient: guardian });

    expect(visible.map(item => item.id)).toEqual(['new', 'old']);
    expect(visible[0].created_at).toBe('2026-08-18T11:00:00.000Z');
  });

  it('loads only notifications relevant to a selected student and class', async () => {
    const memory = createInMemoryNotificationsPort([
      { ...notification('student'), target_audience: 'student', target_id: 's1' },
      { ...notification('class'), target_audience: 'class', target_id: 'الأول' },
      { ...notification('other'), target_audience: 'student', target_id: 's2' },
      notification('all')
    ]);
    const leakyAdapter: NotificationsPort = {
      ...memory,
      loadStudentNotifications: () => memory.loadAllNotifications()
    };
    const center = createModule(leakyAdapter);

    const visible = await center.load({
      type: 'student',
      studentId: 's1',
      className: 'الأول'
    });

    expect(visible.map(item => item.id).sort()).toEqual(['all', 'class', 'student']);
  });

  it('normalizes ids and timestamps once and persists a de-duplicated batch', async () => {
    const port = createInMemoryNotificationsPort();
    const center = createModule(port);

    const result = await center.execute({
      type: 'send-many',
      notifications: [
        {
          id: '',
          title: ' الأول ',
          message: ' الرسالة الأولى ',
          type: 'general',
          target_audience: 'all'
        },
        {
          id: 'fixed',
          message: 'الأصل',
          type: 'general',
          target_audience: 'admin'
        },
        {
          id: 'fixed',
          message: 'نسخة مكررة',
          type: 'general',
          target_audience: 'admin'
        }
      ]
    });

    expect(result.notifications).toHaveLength(2);
    expect(result.notifications[0]).toMatchObject({
      id: 'generated-1',
      title: 'الأول',
      message: 'الرسالة الأولى',
      created_at: baseTime
    });
    expect((await port.loadAllNotifications()).map(item => item.id).sort()).toEqual(['fixed', 'generated-1']);
  });

  it('builds broadcasts consistently and rejects empty messages before storage', async () => {
    const port = createInMemoryNotificationsPort();
    const center = createModule(port);

    const result = await center.execute({
      type: 'broadcast',
      title: ' تنبيه عام ',
      message: ' محتوى التنبيه ',
      targetAudience: 'supervisor',
      createdBy: 'admin-1'
    });

    expect(result.notifications[0]).toMatchObject({
      id: 'generated-1',
      title: 'تنبيه عام',
      message: 'محتوى التنبيه',
      type: 'announcement',
      target_audience: 'supervisor',
      is_popup: true,
      created_by: 'admin-1'
    });
    await expect(center.execute({
      type: 'send',
      notification: { message: '   ', type: 'general', target_audience: 'all' }
    })).rejects.toThrow('Notification message cannot be empty');
    expect(await port.loadAllNotifications()).toHaveLength(1);
  });

  it('seeds old rows silently, delivers matching inserts once and stops after unsubscribe', async () => {
    const port = createInMemoryNotificationsPort([notification('existing', 'guardian')]);
    const center = createModule(port);
    const received: string[] = [];
    const subscription = center.subscribe(guardian, item => received.push(item.id));
    await flushSeed();

    await center.execute({
      type: 'send',
      notification: { id: 'new', message: 'جديد', type: 'general', target_audience: 'guardian' }
    });
    await port.saveNotification(notification('new', 'guardian'));
    await center.execute({
      type: 'send',
      notification: { id: 'admin-only', message: 'للإدارة', type: 'general', target_audience: 'admin' }
    });

    subscription.unsubscribe();
    await port.saveNotification(notification('after-unsubscribe', 'guardian'));

    expect(received).toEqual(['new']);
  });

  it('uses polling as a fallback when realtime delivery is unavailable', async () => {
    vi.useFakeTimers();
    try {
      let stored = [notification('existing', 'guardian')];
      const port: NotificationsPort = {
        async saveNotification(item) { stored = [item, ...stored]; },
        async saveNotifications(items) { stored = [...items, ...stored]; },
        async loadStudentNotifications() { return stored; },
        async loadAllNotifications(limit) { return stored.slice(0, limit ?? stored.length); },
        subscribeToInserts() { return { unsubscribe() {} }; }
      };
      const center = createNotificationsModule(port, { pollIntervalMs: 1_000 });
      const received: string[] = [];
      const subscription = center.subscribe(guardian, item => received.push(item.id));
      await flushSeed();

      stored = [notification('polled', 'guardian', '2026-08-18T10:00:00.000Z'), ...stored];
      await vi.advanceTimersByTimeAsync(1_000);
      subscription.unsubscribe();

      expect(received).toEqual(['polled']);
    } finally {
      vi.useRealTimers();
    }
  });
});
