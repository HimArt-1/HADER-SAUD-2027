import { MappingConfig, MappingSuggestion, MappingTarget, MappingConfidence } from '../../types/import';

const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/[_\s-]+/g, '');

const matches = (column: string, candidates: string[]) => {
  const normalized = normalizeKey(column);
  return candidates.some(candidate => normalizeKey(candidate) === normalized);
};

const findColumn = (columns: string[], candidates: string[]): string | null => {
  for (const column of columns) {
    if (matches(column, candidates)) return column;
  }
  return null;
};

const confidenceFor = (column: string | null, candidates: string[]): MappingConfidence => {
  if (!column) return 'Low';
  if (candidates.some(candidate => normalizeKey(candidate) === normalizeKey(column))) return 'High';
  return 'Medium';
};

const ID_KEYS = ['id', 'ID', 'student_id', 'studentId', 'رقم', 'الهوية', 'المعرف', 'رقم الطالب', 'معرف', 'رقم_الطالب', 'student_number', 'number', 'الرقم', 'رمز الطالب'];
const NAME_KEYS = ['name', 'Name', 'student_name', 'studentName', 'الاسم', 'اسم الطالب', 'student', 'الطالب', 'اسم', 'fullname', 'full_name', 'الاسم الكامل', 'اسم_الطالب'];
const GRADE_KEYS = ['grade', 'Grade', 'صف', 'الصف', 'stage', 'level', 'المرحلة', 'المستوى', 'grade_level', 'gradeLevel'];
const CLASS_KEYS = ['class', 'Class', 'الفصل', 'فصل', 'section', 'Section', 'شعبة', 'الشعبة', 'class_name', 'className'];
const SECTION_KEYS = ['section', 'Section', 'الفصل', 'فصل', 'شعبة', 'الشعبة'];
const PHONE_KEYS = [
  'phone', 'mobile', 'cell', 'guardian_phone', 'parent_phone',
  'جوال', 'موبايل', 'هاتف', 'رقم ولي الأمر', 'جوال ولي الأمر', 'رقم الجوال',
  'phone_number', 'whatsapp', 'واتساب', 'الهاتف', 'رقم_ولي_الأمر',
  'الجوال', 'guardian_mobile', 'parent_mobile', 'رقم الولي', 'جوال الولي',
  'تلفون', 'رقم التواصل', 'contact', 'contact_phone', 'tel', 'telephone'
];

// ═══════════════════════════════════════════════════════════════
// 🔍 Smart Data-Based Column Detection
// ═══════════════════════════════════════════════════════════════

type DetectedType = 'phone' | 'id' | 'name' | 'unknown';

/**
 * Analyze sample values from a column to detect its type.
 * Takes the first N non-empty values and checks patterns.
 */
const detectColumnTypeByData = (values: string[]): DetectedType => {
  const samples = values
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, 15);

  if (samples.length === 0) return 'unknown';

  // Phone detection: Saudi numbers (05xxx, +966, 00966, 966xxx)
  const phonePattern = /^(\+?966|00966|0?5)\d{8,}$/;
  const phoneMatches = samples.filter(v => phonePattern.test(v.replace(/[\s\-().]/g, '')));
  if (phoneMatches.length >= samples.length * 0.5) return 'phone';

  // ID detection: short numeric or alphanumeric codes
  const idPattern = /^[A-Za-z0-9._-]{2,20}$/;
  const allId = samples.every(v => idPattern.test(v));
  const allNumeric = samples.every(v => /^\d+$/.test(v));
  if (allId && allNumeric && samples[0].length <= 12) return 'id';

  // Name detection: Arabic text with spaces
  const arabicPattern = /[\u0600-\u06FF]/;
  const nameMatches = samples.filter(v => arabicPattern.test(v) && v.includes(' '));
  if (nameMatches.length >= samples.length * 0.6) return 'name';

  return 'unknown';
};

/**
 * Get sample values for each column (for display in UI).
 */
export const getColumnSamples = (
  columns: string[],
  rows: Record<string, unknown>[],
  count: number = 3
): Record<string, string[]> => {
  const samples: Record<string, string[]> = {};
  for (const col of columns) {
    samples[col] = rows
      .map(row => String(row[col] ?? '').trim())
      .filter(Boolean)
      .slice(0, count);
  }
  return samples;
};

// ═══════════════════════════════════════════════════════════════
// 🤖 Main Auto-Map Function
// ═══════════════════════════════════════════════════════════════

export const autoMapColumns = (columns: string[], rows?: Record<string, unknown>[]): MappingSuggestion => {
  const mapping: MappingConfig = {};
  const warnings: string[] = [];

  // Phase 1: Match by column header keywords
  const idCol = findColumn(columns, ID_KEYS);
  const nameCol = findColumn(columns, NAME_KEYS);
  const gradeCol = findColumn(columns, GRADE_KEYS);
  const sectionCol = findColumn(columns, SECTION_KEYS);
  const classCol = findColumn(columns, CLASS_KEYS);
  const phoneCol = findColumn(columns, PHONE_KEYS);

  // Phase 2: If we have row data, try data-based detection for unmatched columns
  let dataPhoneCol: string | null = null;
  let dataIdCol: string | null = null;
  let dataNameCol: string | null = null;

  if (rows && rows.length > 0) {
    const unmappedCols = columns.filter(c =>
      c !== idCol && c !== nameCol && c !== gradeCol &&
      c !== sectionCol && c !== classCol && c !== phoneCol
    );

    for (const col of unmappedCols) {
      const values = rows.map(r => String(r[col] ?? ''));
      const detected = detectColumnTypeByData(values);
      if (detected === 'phone' && !phoneCol && !dataPhoneCol) {
        dataPhoneCol = col;
      } else if (detected === 'id' && !idCol && !dataIdCol) {
        dataIdCol = col;
      } else if (detected === 'name' && !nameCol && !dataNameCol) {
        dataNameCol = col;
      }
    }

    if (dataPhoneCol) warnings.push(`📱 تم اكتشاف عمود الهاتف تلقائياً من البيانات: "${dataPhoneCol}"`);
    if (dataIdCol) warnings.push(`🔢 تم اكتشاف عمود المعرف تلقائياً من البيانات: "${dataIdCol}"`);
    if (dataNameCol) warnings.push(`📝 تم اكتشاف عمود الاسم تلقائياً من البيانات: "${dataNameCol}"`);
  }

  const hasGrade = Boolean(gradeCol);
  const hasSection = Boolean(sectionCol);
  let inferredSchema: MappingSuggestion['inferredSchema'] = 'unknown';

  if (hasGrade) inferredSchema = 'legacy';
  if (hasSection) inferredSchema = 'new';

  const ambiguous = !hasGrade && !hasSection && Boolean(classCol);
  if (ambiguous) {
    warnings.push('⚠️ أعمدة الصف/الفصل غير واضحة. يرجى التأكد من المطابقة.');
  }

  mapping.id = idCol || dataIdCol || null;
  mapping.name = nameCol || dataNameCol || null;
  mapping.guardianPhone = phoneCol || dataPhoneCol || null;

  if (inferredSchema === 'legacy') {
    mapping.gradeLevel = gradeCol || null;
    mapping.sectionName = sectionCol || classCol || null;
  } else {
    mapping.gradeLevel = classCol || gradeCol || null;
    mapping.sectionName = sectionCol || null;
  }

  const confidence: Record<MappingTarget, MappingConfidence> = {
    id: mapping.id ? (idCol ? confidenceFor(idCol, ID_KEYS) : 'Medium') : 'Low',
    name: mapping.name ? (nameCol ? confidenceFor(nameCol, NAME_KEYS) : 'Medium') : 'Low',
    gradeLevel: confidenceFor(mapping.gradeLevel ?? null, hasGrade ? GRADE_KEYS : CLASS_KEYS),
    sectionName: confidenceFor(mapping.sectionName ?? null, hasSection ? SECTION_KEYS : CLASS_KEYS),
    guardianPhone: mapping.guardianPhone ? (phoneCol ? confidenceFor(phoneCol, PHONE_KEYS) : 'Medium') : 'Low'
  };

  return {
    mapping,
    confidence,
    warnings,
    ambiguous,
    inferredSchema
  };
};

/**
 * Auto-detect phone and ID columns specifically for guardian phone import mode.
 * Returns { id, phone, name } column names with confidence.
 */
export const autoDetectPhoneImportColumns = (
  columns: string[],
  rows: Record<string, unknown>[]
): { id: string; phone: string; name: string; confidence: Record<'id' | 'phone' | 'name', MappingConfidence> } => {
  // Keyword matching first
  const idCol = findColumn(columns, ID_KEYS) || '';
  const phoneCol = findColumn(columns, PHONE_KEYS) || '';
  const nameCol = findColumn(columns, NAME_KEYS) || '';

  let finalId = idCol;
  let finalPhone = phoneCol;
  let finalName = nameCol;

  const idConf: MappingConfidence = idCol ? confidenceFor(idCol, ID_KEYS) : 'Low';
  const phoneConf: MappingConfidence = phoneCol ? confidenceFor(phoneCol, PHONE_KEYS) : 'Low';
  const nameConf: MappingConfidence = nameCol ? confidenceFor(nameCol, NAME_KEYS) : 'Low';

  // Data-based fallback for undetected columns
  if (rows.length > 0) {
    const remaining = columns.filter(c => c !== finalId && c !== finalPhone && c !== finalName);
    for (const col of remaining) {
      const values = rows.map(r => String(r[col] ?? ''));
      const type = detectColumnTypeByData(values);
      if (type === 'phone' && !finalPhone) finalPhone = col;
      else if (type === 'id' && !finalId) finalId = col;
      else if (type === 'name' && !finalName) finalName = col;
    }
  }

  return {
    id: finalId,
    phone: finalPhone,
    name: finalName,
    confidence: {
      id: finalId ? (idCol === finalId ? idConf : 'Medium') : 'Low',
      phone: finalPhone ? (phoneCol === finalPhone ? phoneConf : 'Medium') : 'Low',
      name: finalName ? (nameCol === finalName ? nameConf : 'Medium') : 'Low'
    }
  };
};
