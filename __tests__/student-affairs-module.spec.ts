import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryStudentAffairsPort,
  createStudentAffairsModule,
  type GuardianExcuseDraft,
  type StudentAffairsPort
} from '../modules/studentAffairs';
import type { GuardianExcuseRecord, Notification } from '../types';

const timestamp = '2026-08-18T09:30:00.000Z';
const createModule = (port = createInMemoryStudentAffairsPort()) => {
  let sequence = 0;
  return createStudentAffairsModule(port, {
    now: () => new Date(timestamp),
    createId: () => `generated-${++sequence}`
  });
};

const excuseDraft = (overrides: Partial<GuardianExcuseDraft> = {}): GuardianExcuseDraft => ({
  student_id: 's1',
  student_name: 'طالب الاختبار',
  class_name: 'الأول',
  section: 'أ',
  guardian_id: 'g1',
  guardian_name: 'ولي الأمر',
  guardian_phone: '0500000000',
  absence_date: '2026-08-18',
  reason: ' ظرف صحي ',
  attachment_url: 'https://example.test/excuse.pdf',
  attachment_path: 's1/excuse.pdf',
  ...overrides
});

const storedExcuse = (overrides: Partial<GuardianExcuseRecord> = {}): GuardianExcuseRecord => ({
  ...excuseDraft(),
  id: 'excuse-1',
  status: 'pending',
  created_at: timestamp,
  updated_at: timestamp,
  ...overrides
});

describe('student affairs module interface', () => {
  it('normalizes exit creation and preserves immutable details during an update', async () => {
    const affairs = createModule();
    const created = await affairs.execute({
      type: 'save-exit',
      studentId: ' s1 ',
      reason: ' موعد طبي ',
      requesterRelation: 'other',
      requesterRelationOther: ' العم ',
      notes: ' بوابة 2 ',
      supervisorName: 'المشرف',
      createdBy: 'u1'
    });

    expect(created.exit).toMatchObject({
      id: 'generated-1',
      student_id: 's1',
      reason: 'موعد طبي',
      requester_relation_other: 'العم',
      exit_time: timestamp,
      date: '2026-08-18',
      status: 'approved'
    });

    const updated = await affairs.execute({
      type: 'save-exit',
      exitId: created.exit!.id,
      studentId: 's1',
      reason: 'تم التصحيح',
      requesterRelation: 'father'
    });

    expect(updated.exit).toMatchObject({
      id: 'generated-1',
      reason: 'تم التصحيح',
      requester_relation: 'father',
      requester_relation_other: null,
      exit_time: timestamp,
      supervisor_name: 'المشرف',
      created_by: 'u1'
    });
    expect((await affairs.load({ type: 'student', studentId: 's1' })).exits).toHaveLength(1);

    await expect(affairs.execute({
      type: 'save-exit',
      exitId: created.exit!.id,
      studentId: 's2',
      reason: 'محاولة نقل',
      requesterRelation: 'father'
    })).rejects.toThrow('Exit student cannot be changed');
  });

  it('enforces exit invariants and fails updates for missing records', async () => {
    const affairs = createModule();

    await expect(affairs.execute({
      type: 'save-exit',
      studentId: 's1',
      reason: 'سبب',
      requesterRelation: 'other'
    })).rejects.toThrow('Other requester relation must be described');

    await expect(affairs.execute({
      type: 'save-exit',
      exitId: 'missing',
      studentId: 's1',
      reason: 'سبب',
      requesterRelation: 'father'
    })).rejects.toThrow('Exit record not found');
  });

  it('filters leaky adapters and returns a newest-first day snapshot', async () => {
    const memory = createInMemoryStudentAffairsPort({
      exits: [
        { id: 'today', student_id: 's1', reason: 'اليوم', exit_time: timestamp, date: '2026-08-18' },
        { id: 'old', student_id: 's1', reason: 'قديم', exit_time: '2026-08-17T09:00:00.000Z', date: '2026-08-17' }
      ],
      violations: [
        { id: 'v1', student_id: 's1', type: 'سلوك', level: 2, created_at: timestamp, date: '2026-08-18' },
        { id: 'v-old', student_id: 's1', type: 'قديم', level: 1, created_at: '2026-08-17T09:00:00.000Z', date: '2026-08-17' }
      ]
    });
    const leakyPort: StudentAffairsPort = {
      ...memory,
      loadExits: () => memory.loadExits(),
      loadViolationsForDate: () => memory.loadViolations()
    };
    const affairs = createModule(leakyPort);

    const snapshot = await affairs.load({ type: 'day', date: '2026-08-18' });

    expect(snapshot.exits.map(row => row.id)).toEqual(['today']);
    expect(snapshot.violations.map(row => row.id)).toEqual(['v1']);
  });

  it('records a violation and creates its guardian notification as one workflow', async () => {
    const memory = createInMemoryStudentAffairsPort();
    const sent: Notification[] = [];
    const port: StudentAffairsPort = {
      ...memory,
      async sendNotification(notification) { sent.push(notification); }
    };
    const affairs = createModule(port);

    const result = await affairs.execute({
      type: 'record-violation',
      studentId: 's1',
      violationType: ' سلوك غير مناسب ',
      level: 9,
      summonGuardian: true,
      createdBy: 'u1',
      createdByLabel: 'المشرف',
      guardianNotification: { title: 'استدعاء', message: 'يرجى مراجعة الإدارة' }
    });

    expect(result.violation).toMatchObject({
      id: 'generated-1',
      student_id: 's1',
      type: 'سلوك غير مناسب',
      level: 5,
      guardian_notified: true,
      date: '2026-08-18'
    });
    expect(result.notification).toMatchObject({
      id: 'generated-2',
      target_audience: 'guardian',
      target_id: 's1'
    });
    expect(sent).toHaveLength(1);
  });

  it('keeps a saved violation successful when notification delivery fails', async () => {
    const memory = createInMemoryStudentAffairsPort();
    const onNotificationError = vi.fn();
    const affairs = createStudentAffairsModule({
      ...memory,
      async sendNotification() { throw new Error('offline'); }
    }, {
      now: () => new Date(timestamp),
      createId: () => crypto.randomUUID(),
      onNotificationError
    });

    const result = await affairs.execute({
      type: 'record-violation',
      studentId: 's1',
      violationType: 'مخالفة',
      level: 2,
      summonGuardian: true,
      guardianNotification: { title: 'تنبيه', message: 'مراجعة' }
    });

    expect(result.violation?.id).toBeTruthy();
    expect(result.violation?.guardian_notified).toBe(false);
    expect(result.notification).toBeNull();
    expect(onNotificationError).toHaveBeenCalledOnce();
    expect((await affairs.load({ type: 'student', studentId: 's1' })).violations).toHaveLength(1);
  });

  it('updates a violation without duplicating its guardian notification, then deletes it', async () => {
    const memory = createInMemoryStudentAffairsPort();
    const sendNotification = vi.fn(async () => undefined);
    const affairs = createModule({ ...memory, sendNotification });

    const created = await affairs.execute({
      type: 'record-violation',
      studentId: 's1',
      violationType: 'مخالفة أولى',
      level: 2,
      summonGuardian: true,
      guardianNotification: { title: 'تنبيه', message: 'مراجعة' }
    });
    const updated = await affairs.execute({
      type: 'record-violation',
      violationId: created.violation!.id,
      studentId: 's1',
      violationType: 'مخالفة مصححة',
      level: 4,
      summonGuardian: true,
      guardianNotification: { title: 'تنبيه', message: 'مراجعة' }
    });

    expect(updated.violation).toMatchObject({
      id: created.violation!.id,
      type: 'مخالفة مصححة',
      level: 4,
      guardian_notified: true,
      created_at: timestamp
    });
    expect(sendNotification).toHaveBeenCalledOnce();
    expect((await affairs.load({ type: 'student', studentId: 's1' })).violations).toHaveLength(1);

    await expect(affairs.execute({
      type: 'record-violation',
      violationId: created.violation!.id,
      studentId: 's2',
      violationType: 'نقل غير صالح',
      level: 1
    })).rejects.toThrow('Violation student cannot be changed');

    await affairs.execute({ type: 'delete-violation', violationId: created.violation!.id });
    expect((await affairs.load({ type: 'student', studentId: 's1' })).violations).toHaveLength(0);
  });

  it('submits an excuse with pending review state and alerts administration', async () => {
    const memory = createInMemoryStudentAffairsPort();
    const sendNotification = vi.fn(async () => undefined);
    const affairs = createModule({ ...memory, sendNotification });

    const result = await affairs.execute({ type: 'submit-excuse', excuse: excuseDraft() });

    expect(result.excuse).toMatchObject({
      id: 'generated-1',
      reason: 'ظرف صحي',
      status: 'pending',
      reviewed_at: null,
      created_at: timestamp
    });
    expect(result.notification).toMatchObject({
      id: 'generated-2',
      target_audience: 'admin',
      target_id: 's1'
    });
    expect(sendNotification).toHaveBeenCalledOnce();
    expect((await affairs.load({
      type: 'excuses',
      filters: { studentId: 's1', status: 'pending' }
    })).excuses).toHaveLength(1);
  });

  it('reviews an excuse and notifies the guardian with the decision', async () => {
    const memory = createInMemoryStudentAffairsPort({ excuses: [storedExcuse()] });
    const sendNotification = vi.fn(async () => undefined);
    const affairs = createModule({ ...memory, sendNotification });

    const result = await affairs.execute({
      type: 'review-excuse',
      excuse: storedExcuse(),
      status: 'approved',
      notes: ' مقبول ',
      reviewer: { id: 'admin-1', label: 'مدير المدرسة' }
    });

    expect(result.excuse).toMatchObject({
      status: 'approved',
      admin_notes: 'مقبول',
      reviewed_by: 'admin-1',
      reviewed_by_label: 'مدير المدرسة',
      reviewed_at: timestamp
    });
    expect(result.notification?.message).toContain('تم اعتماد عذر الغياب');
    expect((await affairs.load({
      type: 'excuses',
      filters: { status: 'approved' }
    })).excuses).toHaveLength(1);
  });
});
