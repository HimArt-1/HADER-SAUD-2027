import type {
  IntegrationAuditEvent,
  IntegrationAuditPort,
  IntegrationPlatform
} from './index';

const DEFAULT_KEY = 'hader:integrations:audit';
const ALLOWED_ACTIONS = new Set<IntegrationAuditEvent['action']>([
  'inspected',
  'inspect-failed',
  'apply-started',
  'apply-succeeded',
  'apply-failed',
  'apply-outcome-unknown',
  'import-started',
  'import-succeeded',
  'import-failed',
  'import-outcome-unknown'
]);
const ALLOWED_PLATFORMS = new Set<IntegrationPlatform>(['noor', 'madrasati', 'huduri']);
const ALLOWED_DETAIL_KEYS = new Set([
  'changeCount',
  'effect',
  'approvedChangeCount',
  'appliedChangeCount',
  'errorType'
]);

type LocalAuditOptions = Readonly<{
  storage?: Storage;
  storageKey?: string;
  maxEvents?: number;
}>;

const sanitizeDetails = (
  details: IntegrationAuditEvent['details']
): Readonly<Record<string, unknown>> | undefined => {
  if (!details) return undefined;
  const sanitized: Record<string, unknown> = {};
  Object.entries(details).forEach(([key, value]) => {
    if (!ALLOWED_DETAIL_KEYS.has(key)) return;
    if (key === 'errorType' && typeof value === 'string') {
      sanitized[key] = /^[A-Za-z][A-Za-z0-9]{0,99}$/.test(value)
        ? value
        : 'IntegrationOperationError';
    } else if (typeof value === 'string') sanitized[key] = value.slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean') sanitized[key] = value;
    else if (Array.isArray(value)) {
      sanitized[key] = value
        .filter(item => typeof item === 'string')
        .slice(0, 500)
        .map(item => item.slice(0, 200));
    }
  });
  return Object.freeze(sanitized);
};

const sanitizeEvent = (event: IntegrationAuditEvent): IntegrationAuditEvent => Object.freeze({
  id: event.id.slice(0, 200),
  reviewId: event.reviewId?.slice(0, 200),
  platform: event.platform,
  operation: event.operation.slice(0, 100),
  action: event.action,
  actor: event.actor?.slice(0, 200),
  occurredAt: event.occurredAt,
  details: sanitizeDetails(event.details)
});

const isAuditEvent = (value: unknown): value is IntegrationAuditEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<IntegrationAuditEvent>;
  return typeof candidate.id === 'string'
    && typeof candidate.operation === 'string'
    && typeof candidate.occurredAt === 'string'
    && (candidate.reviewId === undefined || typeof candidate.reviewId === 'string')
    && (candidate.actor === undefined || typeof candidate.actor === 'string')
    && (
      candidate.details === undefined
      || (candidate.details !== null && typeof candidate.details === 'object' && !Array.isArray(candidate.details))
    )
    && ALLOWED_PLATFORMS.has(candidate.platform as IntegrationPlatform)
    && ALLOWED_ACTIONS.has(candidate.action as IntegrationAuditEvent['action']);
};

export const createLocalIntegrationAuditPort = (
  options: LocalAuditOptions = {}
): IntegrationAuditPort & Readonly<{ events(): readonly IntegrationAuditEvent[] }> => {
  const storage = options.storage ?? globalThis.localStorage;
  const storageKey = options.storageKey?.trim() || DEFAULT_KEY;
  const maxEvents = options.maxEvents ?? 500;
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 10_000) {
    throw new Error('Integration audit maxEvents must be between 1 and 10000');
  }

  const read = (): IntegrationAuditEvent[] => {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isAuditEvent).map(sanitizeEvent).slice(-maxEvents);
    } catch {
      return [];
    }
  };

  return Object.freeze({
    async append(event) {
      const events = [...read(), sanitizeEvent(event)].slice(-maxEvents);
      storage.setItem(storageKey, JSON.stringify(events));
    },
    events() {
      return read().map(event => ({
        ...event,
        details: event.details ? { ...event.details } : undefined
      }));
    }
  });
};
