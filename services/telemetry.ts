import { AuthAuditAction, ClientErrorSeverity, ClientErrorSource, Role, STORAGE_KEYS, User } from '../types';

type AuthAuditPayload = {
  action: AuthAuditAction;
  user?: User | null;
  path?: string;
  meta?: Record<string, any>;
};

type ClientErrorPayload = {
  severity: ClientErrorSeverity;
  source: ClientErrorSource;
  error?: unknown;
  message?: string;
  stack?: string;
  path?: string;
  user?: User | null;
  meta?: Record<string, any>;
};

const TELEMETRY_QUEUE_EVENT = 'hader:telemetry-queue-update';
const MESSAGE_LIMIT = 2000;
const STACK_LIMIT = 8000;
const QUEUE_LIMIT = 200;

let telemetryInitialized = false;

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const getSupabase = async () => (await import('./supabase')).supabase;

const generateUuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `telemetry-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

export const getSessionKey = () => {
  if (!isBrowser) return 'server-session';
  const existing = localStorage.getItem(STORAGE_KEYS.TELEMETRY_SESSION_KEY);
  if (existing) return existing;
  const generated = generateUuid();
  localStorage.setItem(STORAGE_KEYS.TELEMETRY_SESSION_KEY, generated);
  return generated;
};

const truncate = (value: string, limit: number) => {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
};

const redactPatterns = [
  { pattern: /(bearer|token)\s+[\w\-._~+/]+=*/gi, replace: '$1 ***' },
  { pattern: /(authorization|auth)\s*[:=]\s*bearer\s+\S+/gi, replace: '$1: ***' },
  { pattern: /(password|passcode|secret|api[_-]?key|session|refresh[_-]?token)\s*[:=]\s*\S+/gi, replace: '$1=***' },
  { pattern: /\b\d{9,}\b/g, replace: '***' },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replace: '***' }
];

export const sanitize = (input: string) => {
  let sanitized = input ?? '';
  redactPatterns.forEach(({ pattern, replace }) => {
    sanitized = sanitized.replace(pattern, replace);
  });
  return sanitized;
};

const sanitizeValue = (value: unknown, limit: number) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return truncate(sanitize(value), limit);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, limit));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = sanitizeValue(val, limit);
      return acc;
    }, {});
  }
  return truncate(sanitize(String(value)), limit);
};

const readQueue = <T>(key: string): T[] => {
  if (!isBrowser) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeQueue = <T>(key: string, entries: T[]) => {
  if (!isBrowser) return;
  localStorage.setItem(key, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent(TELEMETRY_QUEUE_EVENT));
};

const pushQueue = <T>(key: string, entry: T) => {
  const existing = readQueue<T>(key);
  const next = [entry, ...existing].slice(0, QUEUE_LIMIT);
  writeQueue(key, next);
};

const buildActorLabel = (user?: User | null) => {
  if (!user) return 'anonymous';
  if (user.role === Role.SITE_ADMIN) return 'admin';
  return 'user';
};

const shouldLogSessionRestore = (sessionKey: string) => {
  if (!isBrowser) return true;
  const lastKey = localStorage.getItem(STORAGE_KEYS.TELEMETRY_SESSION_RESTORE);
  if (lastKey === sessionKey) {
    return false;
  }
  localStorage.setItem(STORAGE_KEYS.TELEMETRY_SESSION_RESTORE, sessionKey);
  return true;
};

export const logAuthEvent = async ({ action, user, path, meta }: AuthAuditPayload) => {
  const sessionKey = getSessionKey();
  if (action === 'SESSION_RESTORE' && !shouldLogSessionRestore(sessionKey)) {
    return;
  }

  const payload = {
    action,
    actor_user_id: (user?.id && user.id.length > 0) ? user.id : null,
    actor_role: user?.role ?? null,
    actor_label: buildActorLabel(user),
    session_key: sessionKey,
    path: path ?? (isBrowser ? window.location.pathname : ''),
    ip_hint: null,
    user_agent: isBrowser ? navigator.userAgent : 'server',
    meta: sanitizeValue(meta ?? {}, 1000)
  };

  try {
    const supabase = await getSupabase();
    const { error } = await supabase.from('auth_audit_logs').insert(payload);
    if (error) throw error;
  } catch (error) {
    if (isBrowser) {
      pushQueue(STORAGE_KEYS.TELEMETRY_AUTH_QUEUE, payload);
    }
  }
};

export const logClientError = async ({
  severity,
  source,
  error,
  message,
  stack,
  path,
  user,
  meta
}: ClientErrorPayload) => {
  const sessionKey = getSessionKey();
  let resolvedMessage = message ?? '';
  let resolvedStack = stack ?? '';

  if (!resolvedMessage && typeof error === 'string') {
    resolvedMessage = error;
  } else if (!resolvedMessage && error instanceof Error) {
    resolvedMessage = error.message;
    resolvedStack = error.stack || resolvedStack;
  } else if (!resolvedMessage && error) {
    resolvedMessage = String(error);
  }

  const sanitizedMessage = truncate(sanitize(resolvedMessage || 'Unknown error'), MESSAGE_LIMIT);
  const sanitizedStack = resolvedStack ? truncate(sanitize(resolvedStack), STACK_LIMIT) : null;

  const payload = {
    severity,
    source,
    message: sanitizedMessage,
    stack: sanitizedStack,
    path: path ?? (isBrowser ? window.location.pathname : ''),
    actor_user_id: (user?.id && user.id.length > 0) ? user.id : null,
    actor_role: user?.role ?? null,
    session_key: sessionKey,
    user_agent: isBrowser ? navigator.userAgent : 'server',
    meta: sanitizeValue(meta ?? {}, 1000)
  };

  try {
    const supabase = await getSupabase();
    const { error: insertError } = await supabase.from('client_error_logs').insert(payload);
    if (insertError) throw insertError;
  } catch (insertError) {
    if (isBrowser) {
      pushQueue(STORAGE_KEYS.TELEMETRY_ERROR_QUEUE, payload);
    }
  }
};

const flushQueue = async (key: string, table: 'auth_audit_logs' | 'client_error_logs') => {
  const queue = readQueue<any>(key);
  if (!queue.length) return;
  const supabase = await getSupabase();
  const { error } = await supabase.from(table).insert(queue);
  if (!error) {
    writeQueue(key, []);
  }
};

export const flushQueues = async () => {
  try {
    await flushQueue(STORAGE_KEYS.TELEMETRY_AUTH_QUEUE, 'auth_audit_logs');
    await flushQueue(STORAGE_KEYS.TELEMETRY_ERROR_QUEUE, 'client_error_logs');
  } catch {
    // Ignore flush errors; queues will retry later.
  }
};

// Store listener references for cleanup
let onlineHandler: (() => void) | null = null;
let queueEventHandler: (() => void) | null = null;

const scheduleQueueFlush = () => {
  if (!isBrowser) return;
  const requestIdleCallback = (window as any).requestIdleCallback as
    | undefined
    | ((callback: () => void, options?: { timeout?: number }) => number);

  if (requestIdleCallback) {
    requestIdleCallback(() => void flushQueues(), { timeout: 5000 });
    return;
  }

  window.setTimeout(() => void flushQueues(), 1500);
};

export const initTelemetry = () => {
  if (!isBrowser || telemetryInitialized) return;
  telemetryInitialized = true;
  
  // Store handler references for cleanup
  onlineHandler = () => {
    void flushQueues();
  };
  queueEventHandler = () => {
    void flushQueues();
  };
  
  window.addEventListener('online', onlineHandler);
  window.addEventListener(TELEMETRY_QUEUE_EVENT, queueEventHandler);
  scheduleQueueFlush();
};

/**
 * Cleanup telemetry listeners to prevent memory leaks
 */
export const cleanupTelemetry = () => {
  if (!isBrowser) return;
  
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  if (queueEventHandler) {
    window.removeEventListener(TELEMETRY_QUEUE_EVENT, queueEventHandler);
    queueEventHandler = null;
  }
  telemetryInitialized = false;
};
