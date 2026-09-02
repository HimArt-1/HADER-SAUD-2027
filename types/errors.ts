/**
 * ═══════════════════════════════════════════════════════════════
 * 🛡️ Error Types & Type Guards - Comprehensive Error Handling
 * ═══════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════
// Base Error Types
// ═══════════════════════════════════════════════════════════════

export enum ErrorCategory {
  AUTH = 'AUTH',
  NETWORK = 'NETWORK',
  DATABASE = 'DATABASE',
  VALIDATION = 'VALIDATION',
  PERMISSION = 'PERMISSION',
  RESOURCE = 'RESOURCE',
  SYNC = 'SYNC',
  UNKNOWN = 'UNKNOWN'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface AppError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  timestamp: string;
  recoverable: boolean;
  retryable: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Specific Error Classes
// ═══════════════════════════════════════════════════════════════

export class AuthenticationError extends Error implements AppError {
  readonly category = ErrorCategory.AUTH;
  readonly severity = ErrorSeverity.HIGH;
  readonly recoverable = true;
  readonly retryable = false;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class NetworkError extends Error implements AppError {
  readonly category = ErrorCategory.NETWORK;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoverable = true;
  readonly retryable = true;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class DatabaseError extends Error implements AppError {
  readonly category = ErrorCategory.DATABASE;
  readonly severity = ErrorSeverity.HIGH;
  readonly recoverable = true;
  readonly retryable = true;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class ValidationError extends Error implements AppError {
  readonly category = ErrorCategory.VALIDATION;
  readonly severity = ErrorSeverity.LOW;
  readonly recoverable = true;
  readonly retryable = false;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class PermissionError extends Error implements AppError {
  readonly category = ErrorCategory.PERMISSION;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoverable = false;
  readonly retryable = false;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PermissionError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

export class ResourceNotFoundError extends Error implements AppError {
  readonly category = ErrorCategory.RESOURCE;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoverable = true;
  readonly retryable = false;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ResourceNotFoundError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, ResourceNotFoundError.prototype);
  }
}

export class SyncError extends Error implements AppError {
  readonly category = ErrorCategory.SYNC;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoverable = true;
  readonly retryable = true;
  readonly timestamp: string;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, SyncError.prototype);
  }
}

// ═══════════════════════════════════════════════════════════════
// Type Guards
// ═══════════════════════════════════════════════════════════════

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    'severity' in error &&
    'message' in error &&
    'recoverable' in error &&
    'retryable' in error
  );
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isPermissionError(error: unknown): error is PermissionError {
  return error instanceof PermissionError;
}

export function isResourceNotFoundError(error: unknown): error is ResourceNotFoundError {
  return error instanceof ResourceNotFoundError;
}

export function isSyncError(error: unknown): error is SyncError {
  return error instanceof SyncError;
}

export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

// ═══════════════════════════════════════════════════════════════
// Error Utilities
// ═══════════════════════════════════════════════════════════════

/**
 * Safely extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  
  if (isAppError(error)) {
    return error.message;
  }
  
  if (isError(error)) {
    return error.message;
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  
  return 'حدث خطأ غير معروف';
}

/**
 * Safely extract error details from unknown error
 */
export function getErrorDetails(error: unknown): Record<string, unknown> {
  if (isAppError(error) && error.details) {
    return error.details;
  }
  
  if (error && typeof error === 'object') {
    const details: Record<string, unknown> = {};
    for (const key in error) {
      if (key !== 'message' && key !== 'stack') {
        details[key] = (error as Record<string, unknown>)[key];
      }
    }
    return details;
  }
  
  return {};
}

/**
 * Convert unknown error to AppError
 */
export function toAppError(error: unknown, category?: ErrorCategory): AppError {
  if (isAppError(error)) {
    return error;
  }
  
  const message = getErrorMessage(error);
  const details = getErrorDetails(error);
  const errorCategory = category || ErrorCategory.UNKNOWN;
  
  return {
    category: errorCategory,
    severity: ErrorSeverity.MEDIUM,
    message,
    details,
    timestamp: new Date().toISOString(),
    recoverable: true,
    retryable: false
  };
}

/**
 * Check if error should be retried
 */
export function shouldRetryError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.retryable;
  }
  
  // Network errors are generally retryable
  if (isNetworkError(error)) {
    return true;
  }
  
  // Check for common network error messages
  const message = getErrorMessage(error).toLowerCase();
  const retryablePatterns = ['network', 'timeout', 'connection', 'fetch', 'offline'];
  
  return retryablePatterns.some(pattern => message.includes(pattern));
}

/**
 * Get user-friendly error message in Arabic
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (isAuthenticationError(error)) {
    return 'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد.';
  }
  
  if (isNetworkError(error)) {
    return 'فشل الاتصال بالشبكة. يرجى التحقق من اتصال الإنترنت.';
  }
  
  if (isDatabaseError(error)) {
    return 'حدث خطأ في قاعدة البيانات. يرجى المحاولة لاحقاً.';
  }
  
  if (isValidationError(error)) {
    return error.message; // Validation messages are already user-friendly
  }
  
  if (isPermissionError(error)) {
    return 'ليس لديك صلاحية لإجراء هذه العملية.';
  }
  
  if (isResourceNotFoundError(error)) {
    return 'المورد المطلوب غير موجود.';
  }
  
  if (isSyncError(error)) {
    return 'فشلت عملية المزامنة. سيتم إعادة المحاولة تلقائياً.';
  }
  
  return getErrorMessage(error);
}

// ═══════════════════════════════════════════════════════════════
// Logging Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Log error with proper categorization
 */
export function logError(error: unknown, context?: string): void {
  const appError = toAppError(error);
  
  const logMessage = [
    `[${appError.category}]`,
    context ? `[${context}]` : '',
    appError.message
  ].filter(Boolean).join(' ');
  
  if (appError.severity === ErrorSeverity.CRITICAL || appError.severity === ErrorSeverity.HIGH) {
    console.error(logMessage, appError.details);
  } else if (appError.severity === ErrorSeverity.MEDIUM) {
    console.warn(logMessage, appError.details);
  } else {
    console.log(logMessage, appError.details);
  }
}
