import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceRecord, Student, SystemSettings } from '../types';

const {
  localDbMock,
  queueChangeMock,
  syncNowMock,
  liveNotificationMock
} = vi.hoisted(() => {
  const createCollection = (getRows: () => any[]) => ({
    first: vi.fn(async () => getRows()[0]),
    toArray: vi.fn(async () => getRows()),
    equals: vi.fn((value: unknown) => createCollection(() => getRows().filter(row => row === value))),
    between: vi.fn((start: string, end: string) => createCollection(() => {
      return getRows().filter(row => row >= start && row <= end);
    }))
  });

  const createAttendanceTable = () => {
    let rows: any[] = [];
    const table = {
      put: vi.fn(async (record: any) => {
        const index = rows.findIndex(row => row.id === record.id);
        if (index >= 0) rows[index] = record;
        else rows.push(record);
      }),
      bulkPut: vi.fn(async (records: any[]) => {
        for (const record of records) {
          const index = rows.findIndex(row => row.id === record.id);
          if (index >= 0) rows[index] = record;
          else rows.push(record);
        }
      }),
      bulkDelete: vi.fn(async (ids: string[]) => {
        rows = rows.filter(row => !ids.includes(row.id));
      }),
      delete: vi.fn(async (id: string) => {
        rows = rows.filter(row => row.id !== id);
      }),
      toArray: vi.fn(async () => rows),
      where: vi.fn((query: string | Record<string, unknown>) => {
        if (typeof query === 'string') {
          return {
            equals: vi.fn((value: unknown) => createCollection(() => rows.filter(row => row[query] === value))),
            between: vi.fn((start: string, end: string) => createCollection(() => {
              return rows.filter(row => row[query] >= start && row[query] <= end);
            }))
          };
        }

        return createCollection(() => rows.filter(row => {
          return Object.entries(query).every(([key, value]) => row[key] === value);
        }));
      }),
      _setRows: (next: any[]) => {
        rows = next;
      },
      _rows: () => rows
    };

    return table;
  };

  const createStudentsTable = () => {
    let rows: Student[] = [];
    return {
      get: vi.fn(async (id: string) => rows.find(row => row.id === id)),
      _setRows: (next: Student[]) => {
        rows = next;
      }
    };
  };

  return {
    localDbMock: {
      students: createStudentsTable(),
      settings: {
        get: vi.fn()
      },
      attendance_logs: createAttendanceTable()
    },
    queueChangeMock: vi.fn(async () => 1),
    syncNowMock: vi.fn(async () => undefined),
    liveNotificationMock: vi.fn(async () => undefined)
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
    supabaseStatus: { isConfigured: false },
    supabase: {
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
    handleAttendanceRecorded: liveNotificationMock
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

const student: Student = {
  id: 'student-1',
  name: 'Student One',
  class_name: '1',
  section: 'A'
};

const settings: SystemSettings = {
  id: '00000000-0000-0000-0000-000000000000',
  system_ready: true,
  school_active: true,
  dark_mode: true,
  assembly_time: '06:45',
  grace_period: 15,
  work_days: [0, 1, 2, 3, 4, 5, 6]
};

describe('HybridProvider attendance queued payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localDbMock.students._setRows([student]);
    localDbMock.attendance_logs._setRows([]);
    localDbMock.settings.get.mockResolvedValue(settings);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues kiosk attendance with the generated local id and late minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 17, 7, 20, 0));
    const provider = new HybridProvider();

    const result = await provider.markAttendance('student-1');

    expect(result.success).toBe(true);
    expect(result.record?.id).toEqual(expect.any(String));
    expect(result.record?.status).toBe('late');
    expect(result.record?.minutes_late).toBe(20);
    expect(queueChangeMock).toHaveBeenCalledWith(
      'attendance_logs',
      'INSERT',
      expect.objectContaining({
        id: result.record?.id,
        student_id: 'student-1',
        status: 'late',
        minutes_late: 20,
        _synced: false
      })
    );
  });

  it('queues manual late attendance with the generated local id', async () => {
    const provider = new HybridProvider();

    const result = await provider.addManualAttendance({
      student_id: 'student-1',
      date: '2026-05-17',
      time: '07:20'
    });

    expect(result.success).toBe(true);
    expect(result.record?.id).toEqual(expect.any(String));
    expect(result.status).toBe('late');
    expect(result.minutes_late).toBe(20);
    expect(queueChangeMock).toHaveBeenCalledWith(
      'attendance_logs',
      'INSERT',
      expect.objectContaining({
        id: result.record?.id,
        status: 'late',
        minutes_late: 20,
        _synced: false
      })
    );
  });

  it('queues absent-to-present updates with the same stored record id', async () => {
    const provider = new HybridProvider();
    localDbMock.attendance_logs._setRows([
      {
        id: 'attendance-1',
        student_id: 'student-1',
        date: '2026-05-17',
        timestamp: '2026-05-17T09:00:00.000Z',
        status: 'absent',
        minutes_late: 0,
        _synced: true,
        _updated_at: 'old-watermark'
      }
    ]);

    const result = await provider.addManualAttendance({
      student_id: 'student-1',
      date: '2026-05-17',
      time: '06:50'
    });

    expect(result.success).toBe(true);
    expect(result.record?.id).toBe('attendance-1');
    expect(result.record?.status).toBe('present');
    expect(queueChangeMock).toHaveBeenCalledWith(
      'attendance_logs',
      'UPDATE',
      expect.objectContaining({
        id: 'attendance-1',
        status: 'present',
        minutes_late: 0,
        _synced: false
      })
    );
  });

  it('queues existing attendance as absent with the same stored record id', async () => {
    const provider = new HybridProvider();
    localDbMock.attendance_logs._setRows([
      {
        id: 'attendance-2',
        student_id: 'student-1',
        date: '2026-05-17',
        timestamp: '2026-05-17T04:00:00.000Z',
        status: 'present',
        minutes_late: 0,
        _synced: true
      }
    ]);

    const result = await provider.addManualAbsence({
      student_id: 'student-1',
      date: '2026-05-17'
    });

    expect(result.success).toBe(true);
    expect(result.record?.id).toBe('attendance-2');
    expect(result.record?.status).toBe('absent');
    expect(queueChangeMock).toHaveBeenCalledWith(
      'attendance_logs',
      'UPDATE',
      expect.objectContaining({
        id: 'attendance-2',
        status: 'absent',
        minutes_late: 0,
        _synced: false
      })
    );
  });

  it('normalizes batch attendance rows before saving and queuing', async () => {
    const provider = new HybridProvider();
    const records = [
      {
        id: '',
        student_id: 'student-1',
        date: '2026-05-17',
        timestamp: '2026-05-17T04:20:00.000Z',
        status: 'late',
        minutes_late: 20
      },
      {
        id: '',
        student_id: 'student-2',
        date: '2026-05-17',
        timestamp: '2026-05-17T04:10:00.000Z',
        status: 'absent',
        minutes_late: 99
      }
    ] as AttendanceRecord[];

    await provider.saveAttendanceBatch(records);

    const savedRows = localDbMock.attendance_logs._rows();
    expect(savedRows).toHaveLength(2);
    expect(savedRows[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      status: 'late',
      minutes_late: 20,
      _synced: false
    }));
    expect(savedRows[1]).toEqual(expect.objectContaining({
      id: expect.any(String),
      status: 'absent',
      minutes_late: 0,
      _synced: false
    }));
    expect(queueChangeMock).toHaveBeenCalledWith('attendance_logs', 'UPSERT', savedRows[0]);
    expect(queueChangeMock).toHaveBeenCalledWith('attendance_logs', 'UPSERT', savedRows[1]);
  });
});
