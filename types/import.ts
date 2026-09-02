export type CanonicalStudent = {
  id: string;
  name: string;
  gradeLevel: string;
  sectionName: string;
  guardianPhone?: string;
};

export type LegacyRow = Record<string, unknown> & {
  id?: string;
  name?: string;
  grade?: string;
  class?: string;
  mobile?: string;
  phone?: string;
};

export type NewSchemaRow = Record<string, unknown> & {
  id?: string;
  name?: string;
  class?: string;
  section?: string;
  guardian_phone?: string;
};

export type MappingTarget = 'id' | 'name' | 'gradeLevel' | 'sectionName' | 'guardianPhone';

export type MappingConfig = {
  id?: string | null;
  name?: string | null;
  gradeLevel?: string | null;
  sectionName?: string | null;
  guardianPhone?: string | null;
  defaults?: {
    gradeLevel?: string;
    sectionName?: string;
  };
};

export type MappingConfidence = 'High' | 'Medium' | 'Low';

export type MappingSuggestion = {
  mapping: MappingConfig;
  confidence: Record<MappingTarget, MappingConfidence>;
  warnings: string[];
  ambiguous: boolean;
  inferredSchema: 'legacy' | 'new' | 'unknown';
};

export type ImportError = {
  rowIndex: number;
  message: string;
  raw?: Record<string, unknown>;
};

export type ImportReport = {
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: ImportError[];
};

export type ImportResult = {
  students: CanonicalStudent[];
  report: ImportReport;
  duplicates: CanonicalStudent[];
};

export type ParsedData = {
  rows: Record<string, unknown>[];
  columns: string[];
  sheets?: string[];
  sheetName?: string;
  tables?: string[];
  tableName?: string;
};
