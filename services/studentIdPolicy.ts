import { Student } from '../types';
import { normalizeStudentId } from './db';

export type StudentIdCharset = 'numeric' | 'alphanumeric';

export interface StudentIdPolicy {
  allow_edit: boolean;
  charset: StudentIdCharset;
  length?: number;
  prefix?: string;
}

const defaultPolicy: StudentIdPolicy = {
  allow_edit: true,
  charset: 'numeric',
  length: 6,
  prefix: ''
};

const normalizeLabel = (value: string) =>
  value.trim().replace(/\s+/g, ' ');

export const deriveStudentIdPolicy = (
  students: Student[],
  overrides?: Partial<StudentIdPolicy>
): StudentIdPolicy => {
  const base = { ...defaultPolicy, ...overrides };
  if (overrides?.charset || overrides?.length || overrides?.prefix) {
    return base;
  }

  const ids = students.map((s) => (s.id || '').trim()).filter(Boolean);
  if (!ids.length) return base;

  const numericOnly = ids.every((id) => /^[0-9]+$/.test(id));
  if (numericOnly) {
    const length = ids.every((id) => id.length === ids[0].length) ? ids[0].length : base.length;
    return { ...base, charset: 'numeric', length, prefix: '' };
  }

  const prefixed = ids.map((id) => id.match(/^([A-Za-z_.-]*)(\d+)$/)).filter(Boolean) as RegExpMatchArray[];
  if (prefixed.length === ids.length) {
    const prefixSet = new Set(prefixed.map((match) => match[1] || ''));
    const prefix = prefixSet.size === 1 ? Array.from(prefixSet)[0] : base.prefix || '';
    const digitLengths = new Set(prefixed.map((match) => match[2].length));
    const length = digitLengths.size === 1 ? prefixed[0][2].length : base.length;
    return { ...base, charset: 'numeric', prefix, length };
  }

  const alphanumeric = ids.every((id) => /^[A-Za-z0-9]+$/.test(id));
  if (alphanumeric) {
    const length = ids.every((id) => id.length === ids[0].length) ? ids[0].length : base.length;
    return { ...base, charset: 'alphanumeric', length, prefix: '' };
  }

  return base;
};

// Flexible validation for imports - allows any reasonable student ID format
export const validateStudentIdForImport = (input: string) => {
  const value = normalizeLabel(input);

  // Check if empty
  if (!value) {
    return { valid: false, message: 'المعرّف مطلوب ولا يمكن أن يكون فارغًا.' };
  }

  // Check length (minimum 1, maximum 50 characters)
  if (value.length > 50) {
    return { valid: false, message: 'المعرّف طويل جداً (الحد الأقصى 50 حرف).' };
  }

  // Allow: letters, numbers, hyphens, underscores, dots, and Arabic numerals
  // This is very permissive to handle various school ID formats
  const validPattern = /^[A-Za-z0-9\u0660-\u0669._-]+$/;
  if (!validPattern.test(value)) {
    return {
      valid: false,
      message: 'المعرّف يحتوي على رموز غير مسموحة. استخدم الأحرف والأرقام والشرطات والنقاط فقط.'
    };
  }

  // Check for spaces (not allowed)
  if (/\s/.test(value)) {
    return { valid: false, message: 'المعرّف لا يمكن أن يحتوي على مسافات.' };
  }

  return { valid: true, message: '' };
};

export const validateStudentId = (input: string, policy: StudentIdPolicy, isImporting: boolean = false) => {
  const value = normalizeLabel(input);
  if (!value) return { valid: false, message: 'المعرّف مطلوب ولا يمكن أن يكون فارغًا.' };

  // During import, use flexible validation
  if (isImporting) {
    return validateStudentIdForImport(input);
  }

  // Normal validation for manual entry
  const prefix = policy.prefix || '';
  if (prefix && !value.startsWith(prefix)) {
    return { valid: false, message: `يجب أن يبدأ المعرّف بالبادئة ${prefix}.` };
  }

  const remainder = prefix ? value.slice(prefix.length) : value;
  if (!remainder) {
    return { valid: false, message: 'يجب إدخال قيمة بعد البادئة.' };
  }

  if (policy.charset === 'numeric' && !/^\d+$/.test(remainder)) {
    return { valid: false, message: 'يجب أن يحتوي المعرّف على أرقام فقط.' };
  }

  if (policy.charset === 'alphanumeric' && !/^[A-Za-z0-9]+$/.test(remainder)) {
    return { valid: false, message: 'يجب أن يحتوي المعرّف على حروف وأرقام فقط.' };
  }

  if (policy.length && remainder.length !== policy.length) {
    return { valid: false, message: `طول المعرّف يجب أن يكون ${policy.length} خانة.` };
  }

  return { valid: true, message: '' };
};

export const isStudentIdDuplicate = (input: string, students: Student[], currentId?: string) => {
  const normalized = normalizeStudentId(input);
  return students.some((student) => {
    if (currentId && student.id === currentId) return false;
    return normalizeStudentId(student.id) === normalized;
  });
};

export const generateNextStudentId = (students: Student[], policy: StudentIdPolicy) => {
  if (policy.charset !== 'numeric' || !policy.length) return '';
  const prefix = policy.prefix || '';
  const matches = students
    .map((student) => student.id || '')
    .map((id) => id.trim())
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length))
    .filter((rest) => /^\d+$/.test(rest))
    .map((rest) => parseInt(rest, 10))
    .filter((num) => !Number.isNaN(num));

  const nextValue = (matches.length ? Math.max(...matches) + 1 : 1).toString().padStart(policy.length, '0');
  return `${prefix}${nextValue}`;
};
