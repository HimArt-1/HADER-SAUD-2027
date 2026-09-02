import type { SchoolClass, Student } from '../../types';
import {
  buildStructureFromStudents,
  normalizeClassName,
  normalizeSectionName,
  normalizeStudentId
} from '../../services/dbHelpers';

export type RosterPort = Readonly<{
  loadStudents(options?: Readonly<{ forceSync?: boolean }>): Promise<Student[]>;
  loadClasses(): Promise<SchoolClass[]>;
  saveStudents(students: Student[]): Promise<Student[]>;
  updateStudent(student: Student): Promise<Student>;
  renameStudentId(currentId: string, nextId: string): Promise<Student>;
  deleteStudent(studentId: string): Promise<void>;
  saveClass(schoolClass: SchoolClass): Promise<void>;
  deleteClass(classId: string): Promise<void>;
}>;

export type RosterSnapshot = Readonly<{
  students: Student[];
  classes: SchoolClass[];
}>;

export type RosterStructureSummary = Readonly<{
  created: number;
  updated: number;
  classes: number;
  sections: number;
  missingSections: number;
}>;

export type RosterCommand =
  | Readonly<{ type: 'save-students'; students: Student[] }>
  | Readonly<{ type: 'import-students'; students: Student[] }>
  | Readonly<{ type: 'update-student'; student: Student }>
  | Readonly<{ type: 'rename-student'; currentId: string; nextId: string }>
  | Readonly<{ type: 'delete-student'; studentId: string }>
  | Readonly<{ type: 'save-class'; schoolClass: SchoolClass }>
  | Readonly<{ type: 'delete-class'; classId: string }>
  | Readonly<{ type: 'sync-structure' }>;

export type RosterExecutionResult = Readonly<{
  savedStudents: Student[];
  student: Student | null;
  structure: RosterStructureSummary | null;
}>;

export type RosterModule = Readonly<{
  load(options?: Readonly<{ forceSync?: boolean }>): Promise<RosterSnapshot>;
  findStudent(inputId: string): Promise<Student | null>;
  execute(command: RosterCommand): Promise<RosterExecutionResult>;
  invalidate(): void;
}>;

type RosterEnvironment = Readonly<{
  canRefreshMissing?: () => boolean;
  now?: () => number;
  lookupRefreshTtlMs?: number;
  onRefreshError?: (error: unknown) => void;
  onLookupMiss?: (details: Readonly<{
    input: string;
    normalized: string;
    knownStudents: number;
  }>) => void;
}>;

const emptyResult = (): RosterExecutionResult => ({
  savedStudents: [],
  student: null,
  structure: null
});

/**
 * Owns roster consistency: normalized lookup, refresh-on-miss, mutation
 * invalidation, bulk import and class/section reconstruction.
 */
export const createRosterModule = (
  port: RosterPort,
  environment: RosterEnvironment = {}
): RosterModule => {
  let studentIndex: Map<string, Student> | null = null;
  let indexSource: Student[] | null = null;
  let indexLoad: Promise<void> | null = null;
  let generation = 0;
  let lastLookupRefreshAt = 0;
  const now = environment.now ?? Date.now;
  const lookupRefreshTtlMs = environment.lookupRefreshTtlMs ?? 30_000;

  const rebuildIndex = (students: Student[], expectedGeneration = generation) => {
    if (expectedGeneration !== generation) return;
    const next = new Map<string, Student>();
    students.forEach(student => {
      const key = normalizeStudentId(student.id);
      if (key && !next.has(key)) next.set(key, student);
    });
    indexSource = students;
    studentIndex = next;
  };

  const invalidate = () => {
    generation += 1;
    studentIndex = null;
    indexSource = null;
    indexLoad = null;
  };

  const lookup = (input: string): Student | null => {
    const normalized = normalizeStudentId(input);
    return (normalized ? studentIndex?.get(normalized) : undefined)
      ?? indexSource?.find(student => student.id.trim() === input)
      ?? null;
  };

  const ensureStudentIndex = async () => {
    if (studentIndex && indexSource) return;
    if (!indexLoad) {
      const expectedGeneration = generation;
      indexLoad = port.loadStudents().then(students => {
        rebuildIndex(students, expectedGeneration);
      }).finally(() => {
        indexLoad = null;
      });
    }
    await indexLoad;
  };

  const syncStructure = async (): Promise<RosterStructureSummary> => {
    const [students, existingClasses] = await Promise.all([
      port.loadStudents(),
      port.loadClasses()
    ]);
    rebuildIndex(students);
    const { structure, missingSections } = buildStructureFromStudents(students);
    const existingByKey = new Map<string, SchoolClass>();

    existingClasses.forEach(schoolClass => {
      const key = normalizeClassName(schoolClass.name).toLowerCase();
      if (key) existingByKey.set(key, schoolClass);
    });

    let created = 0;
    let updated = 0;
    let totalSections = 0;
    const normalizeSections = (sections: string[] = []) =>
      sections.map(normalizeSectionName).filter(Boolean);

    for (const [className, sectionSet] of structure.entries()) {
      const classKey = normalizeClassName(className).toLowerCase();
      const existing = existingByKey.get(classKey);
      const nextSections = normalizeSections(Array.from(sectionSet));
      totalSections += nextSections.length;

      if (!existing) {
        await port.saveClass({ id: '', name: className, sections: nextSections });
        created += 1;
        continue;
      }

      const existingSections = normalizeSections(existing.sections || []);
      const replacesDefaultSection =
        existingSections.length === 1 &&
        existingSections[0] === 'A' &&
        !nextSections.includes('A');
      const mergedSections = replacesDefaultSection
        ? nextSections
        : Array.from(new Set([...existingSections, ...nextSections]));
      const sortedSections = mergedSections.sort((a, b) => a.localeCompare(b));
      const sortedExisting = [...existingSections].sort((a, b) => a.localeCompare(b));
      const changed = sortedExisting.length !== sortedSections.length ||
        sortedExisting.some((section, index) => section !== sortedSections[index]);

      if (changed) {
        await port.saveClass({ ...existing, sections: sortedSections });
        updated += 1;
      }
    }

    return {
      created,
      updated,
      classes: structure.size,
      sections: totalSections,
      missingSections
    };
  };

  return Object.freeze({
    async load(options = {}) {
      const expectedGeneration = generation;
      const [students, classes] = await Promise.all([
        port.loadStudents(options),
        port.loadClasses()
      ]);
      rebuildIndex(students, expectedGeneration);
      return { students, classes };
    },

    async findStudent(inputId) {
      const trimmed = inputId?.trim();
      if (!trimmed) return null;

      await ensureStudentIndex();
      let student = lookup(trimmed);
      if (
        !student &&
        environment.canRefreshMissing?.() &&
        now() - lastLookupRefreshAt > lookupRefreshTtlMs
      ) {
        lastLookupRefreshAt = now();
        try {
          const expectedGeneration = generation;
          const freshStudents = await port.loadStudents({ forceSync: true });
          rebuildIndex(freshStudents, expectedGeneration);
          student = lookup(trimmed);
        } catch (error) {
          environment.onRefreshError?.(error);
        }
      }

      if (!student) {
        environment.onLookupMiss?.({
          input: inputId,
          normalized: normalizeStudentId(trimmed),
          knownStudents: studentIndex?.size ?? 0
        });
      }
      return student;
    },

    async execute(command) {
      const result = emptyResult();
      switch (command.type) {
        case 'save-students': {
          const savedStudents = await port.saveStudents(command.students);
          invalidate();
          return { ...result, savedStudents };
        }
        case 'import-students': {
          const savedStudents = await port.saveStudents(command.students);
          invalidate();
          const structure = await syncStructure();
          return { ...result, savedStudents, structure };
        }
        case 'update-student': {
          const student = await port.updateStudent(command.student);
          invalidate();
          return { ...result, student };
        }
        case 'rename-student': {
          const student = await port.renameStudentId(command.currentId, command.nextId);
          invalidate();
          return { ...result, student };
        }
        case 'delete-student':
          await port.deleteStudent(command.studentId);
          invalidate();
          return result;
        case 'save-class':
          await port.saveClass(command.schoolClass);
          return result;
        case 'delete-class':
          await port.deleteClass(command.classId);
          return result;
        case 'sync-structure':
          return { ...result, structure: await syncStructure() };
      }
    },

    invalidate
  });
};

export const createInMemoryRosterPort = (
  initial: Readonly<{
    students?: readonly Student[];
    classes?: readonly SchoolClass[];
  }> = {}
): RosterPort => {
  let students = [...(initial.students ?? [])];
  let classes = [...(initial.classes ?? [])];
  let classSequence = classes.length;

  return Object.freeze({
    async loadStudents() {
      return students.map(student => ({ ...student }));
    },
    async loadClasses() {
      return classes.map(schoolClass => ({
        ...schoolClass,
        sections: [...schoolClass.sections]
      }));
    },
    async saveStudents(nextStudents) {
      const nextIds = new Set(nextStudents.map(student => student.id));
      students = [
        ...students.filter(student => !nextIds.has(student.id)),
        ...nextStudents.map(student => ({ ...student }))
      ];
      return nextStudents.map(student => ({ ...student }));
    },
    async updateStudent(student) {
      const index = students.findIndex(candidate => candidate.id === student.id);
      if (index < 0) throw new Error('الطالب غير موجود');
      students[index] = { ...student };
      return { ...student };
    },
    async renameStudentId(currentId, nextId) {
      const index = students.findIndex(student => student.id === currentId);
      if (index < 0) throw new Error('الطالب غير موجود');
      students[index] = { ...students[index], id: nextId };
      return { ...students[index] };
    },
    async deleteStudent(studentId) {
      students = students.filter(student => student.id !== studentId);
    },
    async saveClass(schoolClass) {
      const normalizedName = normalizeClassName(schoolClass.name);
      const index = classes.findIndex(candidate =>
        candidate.id === schoolClass.id ||
        normalizeClassName(candidate.name) === normalizedName
      );
      const saved = {
        ...schoolClass,
        id: schoolClass.id || `memory-class-${++classSequence}`,
        sections: [...schoolClass.sections]
      };
      if (index >= 0) classes[index] = saved;
      else classes.push(saved);
    },
    async deleteClass(classId) {
      classes = classes.filter(schoolClass => schoolClass.id !== classId);
    }
  });
};
