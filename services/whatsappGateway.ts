import {
  type WhatsAppCommand,
  type WhatsAppGateway,
  type WhatsAppMissionOptions,
  type WhatsAppOutboundMessage,
  type WhatsAppProgress,
  type WhatsAppQueueItem,
  type WhatsAppQueueStatus,
  type WhatsAppSimpleCommand,
  type WhatsAppStatus,
  type WhatsAppSubscription
} from '../modules/whatsapp';
import { secureSessionStorage } from './secureStorage';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type HttpWhatsAppGatewayOptions = Readonly<{
  baseUrl?: string;
  apiKey?: string | (() => string);
  fetcher?: Fetcher;
  retryBaseMs?: number;
  retryMaxMs?: number;
}>;

type UnknownRecord = Record<string, unknown>;

const DEFAULT_API_URL = 'http://localhost:5001';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const QUEUE_STATUS_PRIORITY: Record<WhatsAppQueueStatus, number> = {
  sending: 0,
  pending: 1,
  unconfirmed: 2,
  failed: 3,
  invalid_phone: 4,
  skipped: 5,
  sent: 6
};

/** Every simple command maps to one POST route on the local bridge. */
export const WHATSAPP_COMMAND_ROUTES: Record<WhatsAppSimpleCommand, string> = {
  start: '/api/start',
  stop: '/api/stop',
  clear: '/api/clear',
  'sending:start': '/api/sending/start',
  'sending:pause': '/api/sending/pause',
  'sending:resume': '/api/sending/resume',
  'sending:stop': '/api/sending/stop',
  'window:focus': '/api/window/focus'
};

const serializeMissionOptions = (options?: WhatsAppMissionOptions): Record<string, unknown> => {
  if (!options) return {};
  const mapped: Record<string, unknown> = {
    batch_size: options.batchSize,
    min_delay: options.minDelay,
    max_delay: options.maxDelay,
    long_break: options.longBreak,
    continuous: options.continuous
  };
  return Object.fromEntries(Object.entries(mapped).filter(([, value]) => value !== undefined));
};

export class WhatsAppGatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'WhatsAppGatewayError';
  }
}

const readConfiguredApiKey = (): string => {
  try {
    const stored = typeof localStorage !== 'undefined'
      ? localStorage.getItem('hader:whatsapp_api_key')
      : null;
    if (stored) return stored;
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
  return import.meta.env.VITE_WHATSAPP_API_KEY || '';
};

/**
 * In Production Web: Base URL is strictly locked to the relative proxy route '/api/whatsapp'.
 * Arbitrary localStorage overrides are strictly disallowed in production to prevent
 * unauthorized redirection of authenticated requests or student data.
 *
 * In Development (import.meta.env.DEV) or Electron Desktop mode:
 * Developer may configure a custom URL via localStorage or VITE_WHATSAPP_API_URL,
 * provided it is a valid HTTP/HTTPS URL.
 */
export const resolveBaseUrl = (optionsBaseUrl?: string): string => {
  if (optionsBaseUrl) {
    return optionsBaseUrl.replace(/\/+$/, '');
  }

  const isDev = Boolean(import.meta.env.DEV);
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron);

  if (!isDev && !isElectron) {
    // Production Web: ALWAYS use the secure serverless backend proxy
    return '/api/whatsapp';
  }

  // Development / Electron Desktop mode:
  try {
    const stored = typeof localStorage !== 'undefined'
      ? localStorage.getItem('hader:whatsapp_api_url')
      : null;
    if (stored) {
      const parsed = new URL(stored);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return stored.replace(/\/+$/, '');
      }
      console.warn('⚠️ [WhatsApp] Invalid development API URL ignored:', stored);
    }
  } catch {
    // Ignore invalid stored URLs
  }

  return (import.meta.env.VITE_WHATSAPP_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
};

/**
 * The session token the backend proxy can actually verify.
 *
 * Hader staff do not sign in through Supabase Auth: the hader-auth edge function
 * checks the credentials itself and hands back a plain user record, and the
 * session kept in the browser is an encrypted blob whose own token is a
 * crypto.randomUUID() minted on this device. None of that proves anything to a
 * server, which is why the proxy's search for an "sb-*-auth-token" always came up
 * empty and every call to /api/whatsapp answered 401.
 *
 * The one credential the server issued is surveyAdminToken: created by
 * create_hader_survey_admin_session, stored hashed with an expiry, and verified
 * against the database. It is only minted for site_admin and school_admin, so
 * that is the reach of this path for now — a general Hader session token is the
 * follow-up that will widen it to anyone with can_use_whatsapp.
 */
const resolveAuthToken = (): string | null => {
  try {
    const session = secureSessionStorage.get();
    const token = session?.surveyAdminToken;
    if (!token) return null;
    if (session?.surveyAdminExpiresAt && session.surveyAdminExpiresAt <= Date.now()) return null;
    return token;
  } catch {
    // Storage may be unavailable in hardened browser contexts.
    return null;
  }
};

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' ? value as UnknownRecord : {};

const asText = (value: unknown, fallback = ''): string =>
  value === null || value === undefined ? fallback : String(value);

const asCount = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const normalizeProgress = (value: unknown): WhatsAppProgress | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = asRecord(value);
  return {
    current: asCount(raw.current),
    total: asCount(raw.total),
    sent: asCount(raw.sent),
    failed: asCount(raw.failed),
    skipped: asCount(raw.skipped),
    unconfirmed: asCount(raw.unconfirmed),
    lastPhone: asText(raw.last_phone ?? raw.lastPhone),
    lastName: asText(raw.last_name ?? raw.lastName)
  };
};

const normalizeStatus = (value: unknown): WhatsAppStatus => {
  const raw = asRecord(value);
  const state = raw.state === undefined ? undefined : String(raw.state);
  const sending = raw.sending === undefined
    ? state === 'sending' || state === 'paused'
    : raw.sending === true;
  return {
    running: raw.running === true,
    logs: Array.isArray(raw.logs) ? raw.logs.map(log => String(log)) : [],
    state,
    state_message: raw.state_message === undefined ? undefined : String(raw.state_message),
    version: raw.version === undefined ? undefined : String(raw.version),
    stats: raw.stats && typeof raw.stats === 'object'
      ? raw.stats as Record<string, unknown>
      : undefined,
    logged_in: raw.logged_in === undefined ? undefined : raw.logged_in === true,
    sending,
    paused: raw.paused === undefined ? state === 'paused' : raw.paused === true,
    pending: raw.pending === undefined ? undefined : asCount(raw.pending),
    progress: normalizeProgress(raw.progress),
    last_error: raw.last_error === undefined || raw.last_error === null ? null : String(raw.last_error)
  };
};

const isQueueStatus = (value: unknown): value is WhatsAppQueueStatus =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUEUE_STATUS_PRIORITY, value);

/**
 * Skipped rows and numbers without WhatsApp used to fall through to 'pending', so the dashboard
 * listed them as still waiting while the bridge's own pending count had already dropped them.
 */
const normalizeQueueStatus = (value: unknown): WhatsAppQueueStatus => {
  // 'confirming' is the bridge's last step before a message leaves.
  if (value === 'confirming') return 'sending';
  return isQueueStatus(value) ? value : 'pending';
};

const normalizeQueue = (value: unknown): WhatsAppQueueItem[] => {
  if (!Array.isArray(value)) {
    throw new WhatsAppGatewayError('استجابة طابور واتساب غير صالحة');
  }

  return value
    .map((item, index) => {
      const raw = asRecord(item);
      const phone = asText(raw.phone);
      const message = asText(raw.message);
      const sourceId = asText(raw.id).trim();
      const sourceStudentName = asText(raw.student_name ?? raw.studentName).trim();
      const stableSuffix = message.slice(0, 10).replace(/\s/g, '') || 'no_content';
      const timestamp = Number(raw.timestamp);
      return {
        id: sourceId || `msg_${phone}_${index}_${stableSuffix}`,
        studentName: sourceStudentName || phone || 'Unknown',
        phone,
        message,
        status: normalizeQueueStatus(raw.status),
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        statusLabel: asText(raw.status_label ?? raw.statusLabel),
        attachment: raw.attachment === null || raw.attachment === undefined
          ? undefined
          : String(raw.attachment)
      } satisfies WhatsAppQueueItem;
    })
    .sort((a, b) => {
      const priorityDifference = QUEUE_STATUS_PRIORITY[a.status] - QUEUE_STATUS_PRIORITY[b.status];
      if (priorityDifference !== 0) return priorityDifference;
      if (a.status === 'pending' || a.status === 'sending') return a.timestamp - b.timestamp;
      return b.timestamp - a.timestamp;
    });
};

const parseJsonText = (text: string): unknown => {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new WhatsAppGatewayError('استجابة خادم واتساب غير صالحة');
  }
};

const getErrorMessage = (payload: unknown, status: number): string => {
  const raw = asRecord(payload);
  return asText(raw.message ?? raw.error, `فشل طلب واتساب (HTTP ${status})`);
};

/** HTTP + authenticated fetch-stream adapter for the local WhatsApp bridge. */
export const createHttpWhatsAppGateway = (
  options: HttpWhatsAppGatewayOptions = {}
): WhatsAppGateway => {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  const configuredApiKey = options.apiKey;
  const resolveApiKey: () => string = typeof configuredApiKey === 'function'
    ? configuredApiKey
    : () => configuredApiKey ?? readConfiguredApiKey();
  const retryBaseMs = options.retryBaseMs ?? 2_000;
  const retryMaxMs = options.retryMaxMs ?? 30_000;

  // The server key belongs to the bridge and to the backend proxy that fronts it.
  // When requests go through '/api/whatsapp' the proxy adds X-API-Key itself from a
  // server-side secret, so attaching one here would only put the key in the browser
  // bundle — readable by anyone who opens devtools — for no gain. A key is sent only
  // when the app talks to a bridge directly, which is dev and Electron desktop.
  const usesBackendProxy = baseUrl.endsWith('/api/whatsapp');

  const headers = (json = false): Record<string, string> => {
    const result: Record<string, string> = {};
    const apiKey = usesBackendProxy ? '' : resolveApiKey();
    if (apiKey) result['X-API-Key'] = apiKey;

    // ليست JWT، فلا تُرسل كـ Bearer: الوسيط يتحقق منها عبر قاعدة البيانات
    const token = resolveAuthToken();
    if (token) result['X-Hader-Auth-Token'] = token;

    if (json) result['Content-Type'] = 'application/json';
    return result;
  };

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<T> => {
    const controller = new AbortController();
    const timeoutId = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    const normalizedPath = baseUrl.endsWith('/api/whatsapp')
      ? (path.startsWith('/api/') ? path.slice(4) : path)
      : path;
    const requestUrl = `${baseUrl}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;

    try {
      const response = await fetcher(requestUrl, {
        ...init,
        signal: controller.signal,
        headers: {
          ...headers(false),
          ...(init.headers as Record<string, string> | undefined)
        }
      });
      let payload: unknown;
      try {
        payload = parseJsonText(await response.text());
      } catch (error) {
        if (response.ok) throw error;
        payload = undefined;
      }
      if (!response.ok) {
        throw new WhatsAppGatewayError(getErrorMessage(payload, response.status), response.status);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof WhatsAppGatewayError) throw error;
      const isTimeout = controller.signal.aborted;
      throw new WhatsAppGatewayError(
        isTimeout ? 'انتهت مهلة الاتصال بخادم واتساب' : 'تعذر الاتصال بخادم واتساب',
        undefined,
        error
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const dispatchEvent = (
    block: string,
    observer: WhatsAppSubscription
  ) => {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;

    try {
      const payload = JSON.parse(dataLines.join('\n'));
      if (eventName === 'status') observer.onStatus?.(normalizeStatus(payload));
      if (eventName === 'queue_update') {
        const raw = asRecord(payload);
        const action = raw.action === 'clear' ? 'clear' : raw.action === 'remove' ? 'remove' : 'send';
        const added = Number(raw.added);
        observer.onQueueUpdate?.({
          action,
          added: Number.isFinite(added) ? added : 0
        });
      }
    } catch {
      // Malformed push events are isolated from the connection lifecycle.
    }
  };

  return Object.freeze({
    async getStatus(options = {}) {
      const payload = await request<unknown>(
        '/api/status',
        { method: 'GET', headers: { 'Cache-Control': 'no-cache' } },
        options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      );
      return normalizeStatus(payload);
    },
    async getQueue() {
      return normalizeQueue(await request<unknown>('/api/queue', { method: 'GET' }));
    },
    async enqueue(
      messages: readonly WhatsAppOutboundMessage[],
      enqueueOptions?: Readonly<{ append?: boolean; idempotencyKey?: string }>
    ) {
      if (messages.length === 0) return;
      const append = enqueueOptions?.append ?? true;
      const initHeaders = headers(true);
      if (enqueueOptions?.idempotencyKey) {
        initHeaders['X-Idempotency-Key'] = enqueueOptions.idempotencyKey;
      }
      await request(`/api/send?append=${append}`, {
        method: 'POST',
        headers: initHeaders,
        body: JSON.stringify(messages)
      });
    },
    async getQrCode(opts?: Readonly<{ timeoutMs?: number }>) {
      return request<{ qr: string | null; authenticated: boolean; state: string }>(
        '/api/qr',
        { method: 'GET', headers: { 'Cache-Control': 'no-cache' } },
        opts?.timeoutMs ?? 5_000
      );
    },

    async getSchedule() {
      return request<any>('/api/schedule', { method: 'GET' });
    },

    async updateSchedule(patch) {
      return request<any>('/api/schedule', {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(patch),
      });
    },
    async upload(file: File) {
      const formData = new FormData();
      formData.append('file', file);
      const payload = asRecord(await request('/api/upload', {
        method: 'POST',
        body: formData
      }));
      const path = asText(payload.path);
      if (!path) throw new WhatsAppGatewayError('لم يُرجع خادم واتساب مسار الملف المرفوع');
      return path;
    },
    async control(command: WhatsAppCommand) {
      if (typeof command === 'string') {
        const route = WHATSAPP_COMMAND_ROUTES[command];
        if (!route) throw new WhatsAppGatewayError(`أمر واتساب غير معروف: ${command}`);
        await request(route, { method: 'POST' });
        return;
      }

      if (command.type === 'start') {
        await request(WHATSAPP_COMMAND_ROUTES.start, {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({
            auto_send: command.autoSend ?? false,
            options: serializeMissionOptions(command.options)
          })
        });
        return;
      }

      if (command.type === 'sending:start') {
        await request(WHATSAPP_COMMAND_ROUTES['sending:start'], {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({ options: serializeMissionOptions(command.options) })
        });
        return;
      }

      const id = encodeURIComponent(command.id);
      try {
        await request(`/api/queue/${id}`, { method: 'DELETE' });
      } catch (error) {
        if (!(error instanceof WhatsAppGatewayError) || error.status !== 404) throw error;
        await request(`/api/delete/${id}`, { method: 'DELETE' });
      }
    },
    subscribe(observer: WhatsAppSubscription) {
      let stopped = false;
      let retryCount = 0;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let controller: AbortController | null = null;

      const connect = async (): Promise<void> => {
        controller = new AbortController();
        try {
          const eventsPath = baseUrl.endsWith('/api/whatsapp')
            ? `${baseUrl}/events`
            : `${baseUrl}/api/events`;
          const response = await fetcher(eventsPath, {
            method: 'GET',
            headers: {
              ...headers(false),
              Accept: 'text/event-stream',
              'Cache-Control': 'no-cache'
            },
            signal: controller.signal
          });
          if (!response.ok || !response.body) {
            let payload: unknown;
            try {
              payload = parseJsonText(await response.text());
            } catch {
              payload = undefined;
            }
            throw new WhatsAppGatewayError(
              getErrorMessage(payload, response.status),
              response.status
            );
          }

          retryCount = 0;
          observer.onOpen?.();
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) throw new WhatsAppGatewayError('انقطع بث أحداث واتساب');
            buffer += decoder.decode(value, { stream: true });

            let match = buffer.match(/\r?\n\r?\n/);
            while (match?.index !== undefined) {
              const block = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              dispatchEvent(block, observer);
              match = buffer.match(/\r?\n\r?\n/);
            }
          }
        } catch (error) {
          if (stopped || controller?.signal.aborted) return;
          const gatewayError = error instanceof Error
            ? error
            : new WhatsAppGatewayError('انقطع بث أحداث واتساب', undefined, error);
          observer.onError?.(gatewayError);
          const delay = Math.min(retryBaseMs * Math.pow(2, retryCount), retryMaxMs);
          retryCount += 1;
          retryTimer = setTimeout(() => { void connect(); }, delay);
        }
      };

      void connect();
      return () => {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        controller?.abort();
      };
    }
  });
};

export const whatsappGateway = createHttpWhatsAppGateway();
