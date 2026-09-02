import Dexie, { type Table } from 'dexie';
import { Role } from '../types';
import {
  createStaffOperationsModule,
  validateStaffTimetable,
  type CoveragePlan,
  type StaffAttendanceRecord,
  type StaffOperationsAuditEvent,
  type StaffOperationsModule,
  type StaffOperationsPort,
  type StaffOperationsSnapshot,
  type StaffTeacher,
  type StaffTeachingSlot
} from '../modules/staffOperations';
import {
  parseStaffTimetableRows,
  type StaffTimetableImportResult
} from '../modules/staffOperations/timetableImport';
import { auth } from './auth';
import { parseXlsxFile } from './import/parsers/xlsx';

class HaderStaffOperationsDB extends Dexie {
  teachers!: Table<StaffTeacher, string>;
  timetable!: Table<StaffTeachingSlot, string>;
  attendance!: Table<StaffAttendanceRecord, string>;
  coveragePlans!: Table<CoveragePlan, string>;
  audit!: Table<StaffOperationsAuditEvent, string>;
  metadata!: Table<Readonly<{ key: string; value: number }>, string>;

  constructor(name = 'HaderStaffOperationsDB') {
    super(name);
    this.version(1).stores({
      teachers: '&id, name, specialty',
      timetable: '&id, teacherId, day, period, [day+period], [teacherId+day+period]',
      attendance: '&id, teacherId, date, status, [date+teacherId]',
      coveragePlans: '&id, date, approvedAt',
      audit: '&id, action, occurredAt, actorId'
    });
    this.version(2).stores({
      metadata: '&key'
    });
  }
}

const readVersion = async (database: HaderStaffOperationsDB): Promise<number> => (
  (await database.metadata.get('version'))?.value ?? 0
);

const incrementVersion = async (database: HaderStaffOperationsDB): Promise<void> => {
  await database.metadata.put({ key: 'version', value: (await readVersion(database)) + 1 });
};

export const createIndexedDbStaffOperationsPort = (
  database = new HaderStaffOperationsDB()
): StaffOperationsPort => Object.freeze({
  async load(): Promise<StaffOperationsSnapshot> {
    return database.transaction(
      'r',
      [
        database.teachers,
        database.timetable,
        database.attendance,
        database.coveragePlans,
        database.metadata
      ],
      async () => {
        const [version, teachers, timetable, attendance, coveragePlans] = await Promise.all([
          readVersion(database),
          database.teachers.toArray(),
          database.timetable.toArray(),
          database.attendance.toArray(),
          database.coveragePlans.toArray()
        ]);
        return Object.freeze({ version, teachers, timetable, attendance, coveragePlans });
      }
    );
  },

  async saveTeacher(teacher, event, expectedVersion) {
    await database.transaction('rw', database.teachers, database.audit, database.metadata, async () => {
      if (await readVersion(database) !== expectedVersion) throw new Error('تغيرت البيانات؛ أعد المحاولة');
      await database.teachers.put(teacher);
      await database.audit.put(event);
      await incrementVersion(database);
    });
  },

  async replaceTimetable(slots, event, expectedVersion) {
    await database.transaction('rw', database.timetable, database.audit, database.metadata, async () => {
      if (await readVersion(database) !== expectedVersion) throw new Error('تغيرت البيانات؛ أعد المحاولة');
      await database.timetable.clear();
      if (slots.length > 0) await database.timetable.bulkPut([...slots]);
      await database.audit.put(event);
      await incrementVersion(database);
    });
  },

  async saveAttendance(record, event, expectedVersion) {
    await database.transaction('rw', database.attendance, database.audit, database.metadata, async () => {
      if (await readVersion(database) !== expectedVersion) throw new Error('تغيرت البيانات؛ أعد المحاولة');
      await database.attendance.put(record);
      await database.audit.put(event);
      await incrementVersion(database);
    });
  },

  async saveCoveragePlan(plan, event, expectedVersion) {
    await database.transaction('rw', database.coveragePlans, database.audit, database.metadata, async () => {
      if (await readVersion(database) !== expectedVersion) {
        throw new Error('تغيرت بيانات اليوم أثناء الاعتماد؛ أعد توليد جدول الانتظار');
      }
      const existing = await database.coveragePlans.where('date').equals(plan.date).toArray();
      if (existing.length > 0) {
        await database.coveragePlans.bulkDelete(existing.map(candidate => candidate.id));
      }
      await database.coveragePlans.put(plan);
      await database.audit.put(event);
      await incrementVersion(database);
    });
  },

  async auditEvents() {
    return database.audit.orderBy('occurredAt').reverse().limit(100).toArray();
  }
});

export type StaffOperationsController = StaffOperationsModule & Readonly<{
  previewTimetableFile(file: File): Promise<StaffTimetableImportResult>;
}>;

export const createStaffOperationsController = (
  port: StaffOperationsPort = createIndexedDbStaffOperationsPort()
): StaffOperationsController => {
  const module = createStaffOperationsModule(port, {
    resolveOperator: () => {
      const user = auth.getSession();
      if (!user) return null;
      return {
        id: user.id,
        displayName: user.name,
        canManageStaff: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN].includes(user.role)
      };
    }
  });

  return Object.freeze({
    ...module,
    async previewTimetableFile(file) {
      const [parsed, snapshot] = await Promise.all([parseXlsxFile(file), port.load()]);
      const result = parseStaffTimetableRows(parsed.rows, snapshot.teachers);
      if (result.errors.length > 0) return result;
      const errors = validateStaffTimetable(result.slots, snapshot.teachers);
      return Object.freeze({ slots: result.slots, errors });
    }
  });
};
