import {
  type WhatsAppCommand,
  type WhatsAppGateway,
  type WhatsAppOutboundMessage,
  type WhatsAppQueueItem,
  type WhatsAppQueueStatus,
  type WhatsAppStatus,
  type WhatsAppSubscription
} from '../modules/whatsapp';

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
  failed: 2,
  sent: 3
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

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' ? value as UnknownRecord : {};

const asText = (value: unknown, fallback = ''): string =>
  value === null || value === undefined ? fallback : String(value);

const normalizeStatus = (value: unknown): WhatsAppStatus => {
  const raw = asRecord(value);
  return {
    running: raw.running === true,
    logs: Array.isArray(raw.logs) ? raw.logs.map(log => String(log)) : [],
    state: raw.state === undefined ? undefined : String(raw.state),
    state_message: raw.state_message === undefined ? undefined : String(raw.state_message),
    version: raw.version === undefined ? undefined : String(raw.version),
    stats: raw.stats && typeof raw.stats === 'object'
      ? raw.stats as Record<string, unknown>
      : undefined
  };
};

const normalizeQueueStatus = (value: unknown): WhatsAppQueueStatus =>
  value === 'sending' || value === 'sent' || value === 'failed'
    ? value
    : 'pending';

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
  const baseUrl = (options.baseUrl ?? import.meta.env.VITE_WHATSAPP_API_URL ?? DEFAULT_API_URL)
    .replace(/\/$/, '');
  const fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  const configuredApiKey = options.apiKey;
  const resolveApiKey: () => string = typeof configuredApiKey === 'function'
    ? configuredApiKey
    : () => configuredApiKey ?? readConfiguredApiKey();
  const retryBaseMs = options.retryBaseMs ?? 2_000;
  const retryMaxMs = options.retryMaxMs ?? 30_000;

  const headers = (json = false): Record<string, string> => {
    const result: Record<string, string> = {};
    const apiKey = resolveApiKey();
    if (apiKey) result['X-API-Key'] = apiKey;
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

    try {
      const response = await fetcher(`${baseUrl}${path}`, {
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
        const action = raw.action === 'clear' ? 'clear' : 'send';
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
    async enqueue(messages: readonly WhatsAppOutboundMessage[]) {
      if (messages.length === 0) return;
      await request('/api/send?append=true', {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(messages)
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
        await request(`/api/${command}`, { method: 'POST' });
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
          const response = await fetcher(`${baseUrl}/api/events`, {
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
