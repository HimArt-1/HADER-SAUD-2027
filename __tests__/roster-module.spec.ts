import { describe, expect, it } from 'vitest';
import {
  createInMemoryRosterPort,
  createRosterModule,
  type RosterPort
} from '../modules/roster';
import type { Student } from '../types';

const students: Student[] = [
  { id: '1234', name: 'Student 1', class_name: 'الأول', section: 'ب' },
  { id: '5678', name: 'Student 2', class_name: 'الأول', section: 'ج' },
  { id: '9012', name: 'Student 3', class_name: 'الثاني', section: '' }
];

describe('roster module interface', () => {
  it('loads one coherent student and class snapshot', async () => {
    const roster = createRosterModule(createInMemoryRosterPort({
      students,
      classes: [{ id: 'class-1', name: 'الأول', sections: ['A'] }]
    }));

    const snapshot = await roster.load();

    expect(snapshot.students).toHaveLength(3);
    expect(snapshot.classes).toEqual([
      { id: 'class-1', name: 'الأول', sections: ['A'] }
    ]);
  });

  it('finds normalized Arabic and Latin student identifiers through its index', async () => {
    const memory = createInMemoryRosterPort({ students });
    let loadStudentsCalls = 0;
    const port: RosterPort = {
      ...memory,
      async loadStudents(options) {
        loadStudentsCalls += 1;
        return memory.loadStudents(options);
      }
    };
    const roster = createRosterModule(port);

    expect((await roster.findStudent('١٢٣٤'))?.name).toBe('Student 1');
    expect((await roster.findStudent('1234'))?.name).toBe('Student 1');
    expect(loadStudentsCalls).toBe(1);
  });

  it('refreshes a missing lookup once and observes newly synchronized students', async () => {
    const memory = createInMemoryRosterPort({ students: students.slice(0, 1) });
    let forceSyncCalls = 0;
    const port: RosterPort = {
      ...memory,
      async loadStudents(options) {
        if (options?.forceSync) forceSyncCalls += 1;
        return memory.loadStudents(options);
      }
    };
    const roster = createRosterModule(port, {
      canRefreshMissing: () => true,
      now: () => 60_000,
      lookupRefreshTtlMs: 30_000
    });
    await roster.load();
    await memory.saveStudents([students[1]]);

    expect((await roster.findStudent('5678'))?.name).toBe('Student 2');
    expect(forceSyncCalls).toBe(1);
    expect(await roster.findStudent('missing')).toBeNull();
    expect(forceSyncCalls).toBe(1);
  });

  it('imports students and reconciles class sections as one command', async () => {
    const port = createInMemoryRosterPort({
      students: students.slice(0, 1),
      classes: [{ id: 'class-1', name: 'الأول', sections: ['A'] }]
    });
    const roster = createRosterModule(port);

    const result = await roster.execute({
      type: 'import-students',
      students: students.slice(1)
    });
    const snapshot = await roster.load();

    expect(result.savedStudents).toHaveLength(2);
    expect(result.structure).toEqual({
      created: 1,
      updated: 1,
      classes: 2,
      sections: 2,
      missingSections: 1
    });
    expect(snapshot.classes).toEqual([
      { id: 'class-1', name: 'الأول', sections: ['ب', 'ج'] },
      { id: 'memory-class-2', name: 'الثاني', sections: [] }
    ]);
  });

  it('invalidates lookup state after student mutations', async () => {
    const memory = createInMemoryRosterPort({ students });
    let loadStudentsCalls = 0;
    const port: RosterPort = {
      ...memory,
      async loadStudents(options) {
        loadStudentsCalls += 1;
        return memory.loadStudents(options);
      }
    };
    const roster = createRosterModule(port);
    await roster.findStudent('1234');

    await roster.execute({
      type: 'rename-student',
      currentId: '1234',
      nextId: '4321'
    });

    expect(await roster.findStudent('1234')).toBeNull();
    expect((await roster.findStudent('٤٣٢١'))?.name).toBe('Student 1');
    expect(loadStudentsCalls).toBe(2);
  });
});
