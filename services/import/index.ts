import { CanonicalStudent, ImportError, ImportReport, ImportResult, LegacyRow, MappingConfig, NewSchemaRow, ParsedData } from '../../types/import';

const normalizeValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

export const toDbRowNewSchema = (student: CanonicalStudent) => ({
  id: student.id,
  name: student.name,
  class: student.gradeLevel,
  section: student.sectionName,
  guardian_phone: student.guardianPhone
});

export const fromLegacyRow = (row: LegacyRow): CanonicalStudent => ({
  id: normalizeValue(row.id),
  name: normalizeValue(row.name),
  gradeLevel: normalizeValue(row.grade ?? ''),
  sectionName: normalizeValue(row.class ?? ''),
  guardianPhone: normalizeValue(row.mobile ?? row.phone ?? '')
});

const pickValue = (row: Record<string, unknown>, key?: string | null): string => {
  if (!key) return '';
  return normalizeValue(row[key]);
};

const buildCanonical = (
  row: Record<string, unknown>,
  mapping: MappingConfig
): CanonicalStudent => {
  const gradeLevel = pickValue(row, mapping.gradeLevel) || mapping.defaults?.gradeLevel || '';
  const sectionName = pickValue(row, mapping.sectionName) || mapping.defaults?.sectionName || '';
  const guardianPhone = pickValue(row, mapping.guardianPhone);

  return {
    id: pickValue(row, mapping.id),
    name: pickValue(row, mapping.name),
    gradeLevel,
    sectionName,
    guardianPhone
  };
};

export const normalizeParsedData = (
  parsed: ParsedData,
  mapping: MappingConfig
): ImportResult => {
  const errors: ImportError[] = [];
  const students: CanonicalStudent[] = [];
  const duplicates: CanonicalStudent[] = [];
  const seenIds = new Set<string>();

  parsed.rows.forEach((row, index) => {
    const canonical = buildCanonical(row, mapping);
    if (!canonical.id) {
      errors.push({ rowIndex: index + 1, message: 'المعرف مطلوب', raw: row });
      return;
    }
    if (!canonical.name) {
      errors.push({ rowIndex: index + 1, message: 'اسم الطالب مطلوب', raw: row });
      return;
    }
    if (!canonical.gradeLevel) {
      errors.push({ rowIndex: index + 1, message: 'حقل الصف مطلوب (أو حدّد قيمة افتراضية)', raw: row });
      return;
    }
    if (!canonical.sectionName) {
      errors.push({ rowIndex: index + 1, message: 'حقل الفصل مطلوب (أو حدّد قيمة افتراضية)', raw: row });
      return;
    }

    if (seenIds.has(canonical.id)) {
      duplicates.push(canonical);
      return;
    }

    seenIds.add(canonical.id);
    students.push(canonical);
  });

  const report: ImportReport = {
    totalRows: parsed.rows.length,
    imported: students.length,
    skipped: errors.length,
    duplicates: duplicates.length,
    errors
  };

  return { students, report, duplicates };
};

export const mapNewSchemaRow = (row: NewSchemaRow): CanonicalStudent => ({
  id: normalizeValue(row.id),
  name: normalizeValue(row.name),
  gradeLevel: normalizeValue(row.class ?? ''),
  sectionName: normalizeValue(row.section ?? ''),
  guardianPhone: normalizeValue(row.guardian_phone ?? '')
});
