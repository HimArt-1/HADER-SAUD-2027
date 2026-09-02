import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExitRecord, Notification, Student, User, ViolationRecord } from '../types';
import { Role } from '../types';

const {
  localDbMock,
  queueChangeMock,
  syncNowMock,
  supabaseStatusMock,
  supabaseFromMock
} = vi.hoisted(() => {
  const createTable = () => ({
    put: vi.fn(async () => undefined),
    bulkPut: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    toArray: vi.fn(async () => []),
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined)
  });

  return {
    localDbMock: {
      students: createTable(),
      exits: createTable(),
      violations: createTable(),
      notifications: createTable(),
      users: createTable(),
      dismissal_schedules: createTable()
    },
    queueChangeMock: vi.fn(async () => 1),
    syncNowMock: vi.fn(async () => ({ errors: [] })),
    supabaseStatusMock: { isConfigured: false },
    supabaseFromMock: vi.fn()
  };
});

vi.mock('../services/localDb', () => ({
  localDb: localDbMock,
  queueChange: queueChangeMock,
  getSyncMeta: vi.fn(async () => null),
  setSyncMeta: vi.fn(async () => undefined)
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    on: vi.fn(() => () => undefined),
    syncNow: syncNowMock
  }
}));

vi.mock('../services/supabase', () => {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
    send: vi.fn(async () => undefined)
  };

  return {
    supabaseStatus: supabaseStatusMock,
    supabase: {
      from: supabaseFromMock,
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => undefined)
    }
  };
});

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('../services/liveNotificationService', () => ({
  liveNotificationService: {
    handleAttendanceRecorded: vi.fn(async () => undefined)
  }
}));

vi.mock('../services/settingsBroadcast', () => ({
  broadcastSettingsUpdate: vi.fn(),
  subscribeToSettingsUpdates: vi.fn(() => () => undefined)
}));

vi.mock('../services/security', () => ({
  ensurePasswordForCloud: vi.fn(async (user) => user)
}));

vi.mock('../services/settingsRemoteId', () => ({
  rememberRemoteSettingsPk: vi.fn(),
  resolveSettingsUpsertId: vi.fn(async () => '00000000-0000-0000-0000-000000000000')
}));

import { HybridProvider } from '../services/hybridProvider';

describe('HybridProvider queued payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseStatusMock.isConfigured = false;
  });

  it('queues exits with the generated local id', async () => {
    const provider = new HybridProvider();

    const saved = await provider.saveExit({
      id: '',
      student_id: 'student-1',
      reason: 'early leave',
      exit_time: '2026-05-16T09:00:00.000Z'
    } as ExitRecord);

    expect(saved.id).toEqual(expect.any(String));
    expect(saved.id).not.toBe('');
    expect(localDbMock.exits.put).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }));
    expect(queueChangeMock).toHaveBeenCalledWith(
      'exits',
      'UPSERT',
      expect.objectContaining({ id: saved.id, _synced: false })
    );
  });

  it('queues violations with the generated local id', async () => {
    const provider = new HybridProvider();

    const saved = await provider.saveViolation({
      id: '',
      student_id: 'student-1',
      type: 'behavior',
      level: 1,
      created_at: '2026-05-16T09:00:00.000Z'
    } as ViolationRecord);

    expect(saved.id).toEqual(expect.any(String));
    expect(saved.id).not.toBe('');
    expect(localDbMock.violations.put).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }));
    expect(queueChangeMock).toHaveBeenCalledWith(
      'violations',
      'UPSERT',
      expect.objectContaining({ id: saved.id, _synced: false })
    );
  });

  it('queues notifications with the generated local id', async () => {
    const provider = new HybridProvider();

    const saved = await provider.saveNotification({
      id: '',
      message: 'sync test',
      type: 'general',
      target_audience: 'all',
      created_at: '2026-05-16T09:00:00.000Z'
    } as Notification);

    expect(saved.id).toEqual(expect.any(String));
    expect(saved.id).not.toBe('');
    expect(localDbMock.notifications.put).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id }));
    expect(queueChangeMock).toHaveBeenCalledWith(
      'notifications',
      'UPSERT',
      expect.objectContaining({ id: saved.id, _synced: false })
    );
  });

  it('normalizes and queues class supervisor assignments', async () => {
    const provider = new HybridProvider();

    const saved = await provider.saveUser({
      id: '',
      username: 'class-supervisor',
      password: 'secret',
      name: 'مشرف صف',
      role: Role.SUPERVISOR_CLASS,
      assigned_classes: '[{"className":" الأول ","sections":[" a ","A"," b "]}]' as any
    } as User);

    expect(saved.assigned_classes).toEqual([
      { class_name: 'الأول', sections: ['A', 'B'] }
    ]);
    expect(localDbMock.users.put).toHaveBeenCalledWith(expect.objectContaining({
      id: saved.id,
      assigned_classes: [{ class_name: 'الأول', sections: ['A', 'B'] }]
    }));
    expect(queueChangeMock).toHaveBeenCalledWith(
      'users',
      'INSERT',
      expect.objectContaining({
        id: saved.id,
        assigned_classes: [{ class_name: 'الأول', sections: ['A', 'B'] }]
      })
    );
  });

  it('hydrates users from Supabase before returning the admin users list', async () => {
    const provider = new HybridProvider();
    supabaseStatusMock.isConfigured = true;

    const cloudUser = {
      id: 'user-1',
      username: 'class-supervisor',
      name: 'مشرف صف',
      role: Role.SUPERVISOR_CLASS,
      assigned_classes: [{ class_name: 'الأول', sections: ['A'] }],
      is_active: true,
      created_at: '2026-05-16T10:00:00.000Z'
    };
    const orderMock = vi.fn(async () => ({ data: [cloudUser], error: null }));
    const selectMock = vi.fn(() => ({ order: orderMock }));
    supabaseFromMock.mockReturnValue({ select: selectMock });
    localDbMock.users.toArray.mockResolvedValueOnce([{
      ...cloudUser,
      _synced: true,
      _updated_at: cloudUser.created_at
    }]);

    const users = await provider.getUsers();

    expect(supabaseFromMock).toHaveBeenCalledWith('users');
    expect(selectMock).toHaveBeenCalledWith('*');
    expect(localDbMock.users.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'user-1',
        assigned_classes: [{ class_name: 'الأول', sections: ['A'] }],
        _synced: true
      })
    ]);
    expect(users).toEqual([
      expect.objectContaining({
        id: 'user-1',
        role: Role.SUPERVISOR_CLASS,
        assigned_classes: [{ class_name: 'الأول', sections: ['A'] }]
      })
    ]);
  });

  it('queues updated students using the same syncable row stored locally', async () => {
    const provider = new HybridProvider();
    const student: Student = {
      id: 'student-1',
      name: 'Student One',
      class_name: '1',
      section: 'A'
    };

    await provider.updateStudent(student);

    expect(localDbMock.students.put).toHaveBeenCalledWith(expect.objectContaining({
      id: student.id,
      _synced: false
    }));
    expect(queueChangeMock).toHaveBeenCalledWith(
      'students',
      'UPDATE',
      expect.objectContaining({ id: student.id, _synced: false })
    );
  });

  it('queues renamed students with the final row metadata', async () => {
    const provider = new HybridProvider();
    localDbMock.students.get.mockResolvedValueOnce({
      id: 'old-id',
      name: 'Student One',
      class_name: '1',
      section: 'A',
      _synced: true,
      _updated_at: 'old-watermark'
    });

    await provider.renameStudentId('old-id', 'new-id');

    expect(queueChangeMock).toHaveBeenCalledWith('students', 'DELETE', 'old-id');
    expect(queueChangeMock).toHaveBeenCalledWith(
      'students',
      'INSERT',
      expect.objectContaining({ id: 'new-id', _synced: false })
    );

    const insertPayload = queueChangeMock.mock.calls.find(
      ([table, operation]) => table === 'students' && operation === 'INSERT'
    )?.[2] as { _updated_at?: string };

    expect(insertPayload?._updated_at).toEqual(expect.any(String));
    expect(insertPayload?._updated_at).not.toBe('old-watermark');
  });

  it('updates local dismissal schedules and queues replacement when cloud is unavailable', async () => {
    const provider = new HybridProvider();
    localDbMock.dismissal_schedules.toArray.mockResolvedValueOnce([
      {
        id: 'old-schedule',
        class_name: '1',
        dismissal_time: '11:30',
        days: [0],
        _synced: true
      }
    ]);

    await provider.saveDismissalSchedules([
      {
        id: '',
        class_name: '2',
        dismissal_time: '12:15:00',
        days: [1, 2],
        label: 'Second grade'
      }
    ]);

    expect(localDbMock.dismissal_schedules.clear).toHaveBeenCalledOnce();
    expect(localDbMock.dismissal_schedules.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({
        class_name: '2',
        dismissal_time: '12:15',
        days: [1, 2],
        day_of_week: [1, 2],
        _synced: false
      })
    ]);
    expect(queueChangeMock).toHaveBeenCalledWith('dismissal_schedules', 'DELETE', 'old-schedule');
    expect(queueChangeMock).toHaveBeenCalledWith(
      'dismissal_schedules',
      'UPSERT',
      expect.objectContaining({
        class_name: '2',
        dismissal_time: '12:15',
        _synced: false
      })
    );
  });
});
