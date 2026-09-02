/**
 * ═══════════════════════════════════════════════════════════════
 * ✅ Validation Utilities - Input Validation & Sanitization
 * ═══════════════════════════════════════════════════════════════
 */

import { ValidationError } from '../types/errors';

// ═══════════════════════════════════════════════════════════════
// Type Guards
// ═══════════════════════════════════════════════════════════════

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

export function isNonEmptyArray(value: unknown): value is unknown[] {
  return isArray(value) && value.length > 0;
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

export function isValidISODate(value: unknown): value is string {
  if (!isString(value)) return false;
  const date = new Date(value);
  return isValidDate(date);
}

// ═══════════════════════════════════════════════════════════════
// String Validation
// ═══════════════════════════════════════════════════════════════

export function validateRequired(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || value === '') {
    throw new ValidationError(`${fieldName} مطلوب`, 'REQUIRED_FIELD', { fieldName });
  }
  return String(value);
}

export function validateString(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    patternMessage?: string;
  } = {}
): string | undefined {
  // Check required
  if (options.required) {
    validateRequired(value, fieldName);
  } else if (value === null || value === undefined || value === '') {
    return undefined;
  }
  
  const str = String(value).trim();
  
  // Check min length
  if (options.minLength !== undefined && str.length < options.minLength) {
    throw new ValidationError(
      `${fieldName} يجب أن يحتوي على ${options.minLength} أحرف على الأقل`,
      'MIN_LENGTH',
      { fieldName, minLength: options.minLength, actualLength: str.length }
    );
  }
  
  // Check max length
  if (options.maxLength !== undefined && str.length > options.maxLength) {
    throw new ValidationError(
      `${fieldName} يجب ألا يتجاوز ${options.maxLength} حرف`,
      'MAX_LENGTH',
      { fieldName, maxLength: options.maxLength, actualLength: str.length }
    );
  }
  
  // Check pattern
  if (options.pattern && !options.pattern.test(str)) {
    throw new ValidationError(
      options.patternMessage || `${fieldName} غير صحيح`,
      'PATTERN_MISMATCH',
      { fieldName, pattern: options.pattern.source }
    );
  }
  
  return str;
}

// ═══════════════════════════════════════════════════════════════
// Number Validation
// ═══════════════════════════════════════════════════════════════

export function validateNumber(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
  } = {}
): number | undefined {
  // Check required
  if (options.required && (value === null || value === undefined)) {
    throw new ValidationError(`${fieldName} مطلوب`, 'REQUIRED_FIELD', { fieldName });
  } else if (value === null || value === undefined) {
    return undefined;
  }
  
  const num = Number(value);
  
  // Check if valid number
  if (!isNumber(num)) {
    throw new ValidationError(
      `${fieldName} يجب أن يكون رقماً صحيحاً`,
      'INVALID_NUMBER',
      { fieldName, value }
    );
  }
  
  // Check integer
  if (options.integer && !Number.isInteger(num)) {
    throw new ValidationError(
      `${fieldName} يجب أن يكون عدداً صحيحاً`,
      'MUST_BE_INTEGER',
      { fieldName, value: num }
    );
  }
  
  // Check min
  if (options.min !== undefined && num < options.min) {
    throw new ValidationError(
      `${fieldName} يجب أن يكون ${options.min} على الأقل`,
      'MIN_VALUE',
      { fieldName, min: options.min, actual: num }
    );
  }
  
  // Check max
  if (options.max !== undefined && num > options.max) {
    throw new ValidationError(
      `${fieldName} يجب ألا يتجاوز ${options.max}`,
      'MAX_VALUE',
      { fieldName, max: options.max, actual: num }
    );
  }
  
  return num;
}

// ═══════════════════════════════════════════════════════════════
// Phone Number Validation
// ═══════════════════════════════════════════════════════════════

export function validatePhoneNumber(value: unknown, fieldName: string = 'رقم الجوال'): string {
  const str = validateString(value, fieldName, { required: true });
  
  if (!str) {
    throw new ValidationError(`${fieldName} مطلوب`, 'REQUIRED_FIELD', { fieldName });
  }
  
  // Remove all non-digit characters
  const digits = str.replace(/\D/g, '');
  
  // Saudi phone number should be 9 or 10 digits (with or without country code)
  if (digits.length < 9 || digits.length > 12) {
    throw new ValidationError(
      `${fieldName} غير صحيح`,
      'INVALID_PHONE',
      { fieldName, value: str }
    );
  }
  
  return digits;
}

// ═══════════════════════════════════════════════════════════════
// Email Validation
// ═══════════════════════════════════════════════════════════════

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: unknown, fieldName: string = 'البريد الإلكتروني'): string {
  const str = validateString(value, fieldName, {
    required: true,
    pattern: EMAIL_PATTERN,
    patternMessage: `${fieldName} غير صحيح`
  });
  
  if (!str) {
    throw new ValidationError(`${fieldName} مطلوب`, 'REQUIRED_FIELD', { fieldName });
  }
  
  return str.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════
// Date Validation
// ═══════════════════════════════════════════════════════════════

export function validateDate(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean;
    min?: Date;
    max?: Date;
  } = {}
): Date | undefined {
  // Check required
  if (options.required && (value === null || value === undefined)) {
    throw new ValidationError(`${fieldName} مطلوب`, 'REQUIRED_FIELD', { fieldName });
  } else if (value === null || value === undefined) {
    return undefined;
  }
  
  let date: Date;
  
  if (value instanceof Date) {
    date = value;
  } else if (isString(value)) {
    date = new Date(value);
  } else {
    throw new ValidationError(
      `${fieldName} غير صحيح`,
      'INVALID_DATE',
      { fieldName, value }
    );
  }
  
  if (!isValidDate(date)) {
    throw new ValidationError(
      `${fieldName} غير صحيح`,
      'INVALID_DATE',
      { fieldName, value }
    );
  }
  
  // Check min
  if (options.min && date < options.min) {
    throw new ValidationError(
      `${fieldName} يجب أن يكون بعد ${options.min.toLocaleDateString('ar-SA')}`,
      'DATE_TOO_EARLY',
      { fieldName, min: options.min, actual: date }
    );
  }
  
  // Check max
  if (options.max && date > options.max) {
    throw new ValidationError(
      `${fieldName} يجب أن يكون قبل ${options.max.toLocaleDateString('ar-SA')}`,
      'DATE_TOO_LATE',
      { fieldName, max: options.max, actual: date }
    );
  }
  
  return date;
}

// ═══════════════════════════════════════════════════════════════
// Sanitization
// ═══════════════════════════════════════════════════════════════

/**
 * Sanitize string to prevent XSS attacks
 */
export function sanitizeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

/**
 * Sanitize string for SQL (basic escaping)
 */
export function sanitizeSql(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Remove all non-alphanumeric characters except spaces and Arabic
 */
export function sanitizeText(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s]/gu, '');
}

/**
 * Sanitize phone number (keep only digits)
 */
export function sanitizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

// ═══════════════════════════════════════════════════════════════
// Collection Validation
// ═══════════════════════════════════════════════════════════════

export function validateArray<T>(
  value: unknown,
  fieldName: string,
  itemValidator: (item: unknown, index: number) => T,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
  } = {}
): T[] | undefined {
  // Check required
  if (options.required && (value === null || value === undefined)) {
    throw new ValidationError(`${fieldName} مطلوب`, 'REQUIRED_FIELD', { fieldName });
  } else if (value === null || value === undefined) {
    return undefined;
  }
  
  if (!isArray(value)) {
    throw new ValidationError(
      `${fieldName} يجب أن يكون مصفوفة`,
      'MUST_BE_ARRAY',
      { fieldName, value }
    );
  }
  
  // Check min length
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new ValidationError(
      `${fieldName} يجب أن يحتوي على ${options.minLength} عناصر على الأقل`,
      'MIN_LENGTH',
      { fieldName, minLength: options.minLength, actualLength: value.length }
    );
  }
  
  // Check max length
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new ValidationError(
      `${fieldName} يجب ألا يتجاوز ${options.maxLength} عنصر`,
      'MAX_LENGTH',
      { fieldName, maxLength: options.maxLength, actualLength: value.length }
    );
  }
  
  // Validate each item
  return value.map((item, index) => {
    try {
      return itemValidator(item, index);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(
          `${fieldName}[${index}]: ${error.message}`,
          error.code,
          { ...error.details, fieldName, index }
        );
      }
      throw error;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// Composite Validators
// ═══════════════════════════════════════════════════════════════

export function validateObject<T extends Record<string, unknown>>(
  value: unknown,
  fieldName: string,
  schema: {
    [K in keyof T]: (value: unknown) => T[K];
  },
  options: {
    required?: boolean;
  } = {}
): T | undefined {
  // Check required
  if (options.required && (value === null || value === undefined)) {
    throw new ValidationError(`${fieldName} مطلوب`, 'REQUIRED_FIELD', { fieldName });
  } else if (value === null || value === undefined) {
    return undefined;
  }
  
  if (!isObject(value)) {
    throw new ValidationError(
      `${fieldName} يجب أن يكون كائناً`,
      'MUST_BE_OBJECT',
      { fieldName, value }
    );
  }
  
  const result = {} as T;
  
  for (const key in schema) {
    try {
      result[key] = schema[key]((value as Record<string, unknown>)[key]);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(
          `${fieldName}.${key}: ${error.message}`,
          error.code,
          { ...error.details, fieldName: `${fieldName}.${key}` }
        );
      }
      throw error;
    }
  }
  
  return result;
}
