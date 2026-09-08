export type WhatsAppQueueStatus = 'pending' | 'sending' | 'sent' | 'failed';

/**
 * Engine lifecycle reported by the local bridge (whatsapp/engine_controller.py).
 *
 *  idle → initializing → waiting_login → ready ⇄ sending ⇄ paused
 *                                          ↓
 *                                   stopped / error
 */
export type WhatsAppEngineState =
  | 'idle'
  | 'initializing'
  | 'waiting_login'
  | 'ready'
  | 'sending'
  | 'paused'
  | 'error'
  | 'stopped';

export const WHATSAPP_ENGINE_STATES: readonly WhatsAppEngineState[] = [
  'idle', 'initializing', 'waiting_login', 'ready', 'sending', 'paused', 'error', 'stopped'
];

export const WHATSAPP_ALIVE_STATES: ReadonlySet<WhatsAppEngineState> = new Set([
  'initializing', 'waiting_login', 'ready', 'sending', 'paused'
]);

export type WhatsAppProgress = Readonly<{
  current: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  lastPhone: string;
  lastName: string;
}>;

export type WhatsAppStatus = Readonly<{
  /** True while the engine (Chrome window) is alive — any of the "alive" states. */
  running: boolean;
  logs: string[];
  state?: string;
  state_message?: string;
  version?: string;
  stats?: Record<string, unknown>;
  /** WhatsApp Web session is authenticated (QR scanned / session restored). */
  logged_in?: boolean;
  /** A dispatch mission is active (sending or paused). */
  sending?: boolean;
  paused?: boolean;
  /** Messages still waiting in the server queue. */
  pending?: number;
  progress?: WhatsAppProgress;
  last_error?: string | null;
}>;

export const normalizeEngineState = (value: unknown): WhatsAppEngineState =>
  (WHATSAPP_ENGINE_STATES as readonly string[]).includes(String(value))
    ? value as WhatsAppEngineState
    : 'idle';

export const isEngineAlive = (status: WhatsAppStatus | null | undefined): boolean =>
  Boolean(status?.running) || WHATSAPP_ALIVE_STATES.has(normalizeEngineState(status?.state));

export type WhatsAppOutboundMessage = Readonly<{
  id?: string;
  phone: string;
  message: string;
  attachment?: string | null;
  student_name?: string;
  status_label?: string;
  status?: WhatsAppQueueStatus;
  timestamp?: number;
  meta?: Record<string, unknown>;
}>;

export type WhatsAppQueueItem = Readonly<{
  id: string;
  studentName: string;
  phone: string;
  message: string;
  status: WhatsAppQueueStatus;
  timestamp: number;
  statusLabel?: string;
  attachment?: string | null;
}>;

export type WhatsAppQueueUpdate = Readonly<{
  action: 'send' | 'clear' | 'remove';
  added: number;
}>;

/** Tuning knobs for a dispatch mission (all optional — the bridge applies safe defaults). */
export type WhatsAppMissionOptions = Readonly<{
  batchSize?: number;
  minDelay?: number;
  maxDelay?: number;
  longBreak?: number;
  /** Keep the mission alive and pick up new queue items automatically. */
  continuous?: boolean;
}>;

export type WhatsAppSimpleCommand =
  | 'start'
  | 'stop'
  | 'clear'
  | 'sending:start'
  | 'sending:pause'
  | 'sending:resume'
  | 'sending:stop'
  | 'window:focus';

export type WhatsAppCommand =
  | WhatsAppSimpleCommand
  | Readonly<{ type: 'remove'; id: string }>
  | Readonly<{ type: 'start'; autoSend?: boolean; options?: WhatsAppMissionOptions }>
  | Readonly<{ type: 'sending:start'; options?: WhatsAppMissionOptions }>;

export type WhatsAppSubscription = Readonly<{
  onStatus?: (status: WhatsAppStatus) => void;
  onQueueUpdate?: (update: WhatsAppQueueUpdate) => void;
  onOpen?: () => void;
  onError?: (error: Error) => void;
}>;

export type WhatsAppGateway = Readonly<{
  getStatus(options?: Readonly<{ timeoutMs?: number }>): Promise<WhatsAppStatus>;
  getQueue(): Promise<WhatsAppQueueItem[]>;
  enqueue(messages: readonly WhatsAppOutboundMessage[]): Promise<void>;
  upload(file: File): Promise<string>;
  control(command: WhatsAppCommand): Promise<void>;
  subscribe(observer: WhatsAppSubscription): () => void;
}>;

type InMemoryWhatsAppGatewayOptions = Readonly<{
  status?: Partial<WhatsAppStatus>;
  queue?: readonly WhatsAppOutboundMessage[];
  /** When true, `start` parks in waiting_login until `control('sending:start')` is not possible. */
  requireQrScan?: boolean;
}>;

export class WhatsAppCommandError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = 'WhatsAppCommandError';
  }
}

const EMPTY_PROGRESS: WhatsAppProgress = {
  current: 0, total: 0, sent: 0, failed: 0, skipped: 0, lastPhone: '', lastName: ''
};

/** A second adapter for component tests and offline prototypes — mirrors the bridge state machine. */
export const createInMemoryWhatsAppGateway = (
  options: InMemoryWhatsAppGatewayOptions = {}
): WhatsAppGateway => {
  let sequence = 0;
  let queue: WhatsAppQueueItem[] = (options.queue ?? []).map(message => ({
    id: message.id ?? `memory-${++sequence}`,
    studentName: message.student_name ?? message.phone,
    phone: message.phone,
    message: message.message,
    status: message.status ?? 'pending',
    timestamp: message.timestamp ?? 0,
    statusLabel: message.status_label ?? '',
    attachment: message.attachment
  }));
  const pendingCount = () => queue.filter(item => item.status === 'pending' || item.status === 'sending').length;
  let currentStatus: WhatsAppStatus = {
    running: options.status?.running ?? false,
    logs: [...(options.status?.logs ?? [])],
    state: options.status?.state ?? 'idle',
    state_message: options.status?.state_message,
    version: options.status?.version ?? 'memory',
    stats: options.status?.stats,
    logged_in: options.status?.logged_in ?? false,
    sending: options.status?.sending ?? false,
    paused: options.status?.paused ?? false,
    pending: options.status?.pending ?? pendingCount(),
    progress: options.status?.progress ?? EMPTY_PROGRESS
  };
  const observers = new Set<WhatsAppSubscription>();

  const publishStatus = () => {
    observers.forEach(observer => observer.onStatus?.(currentStatus));
  };
  const publishQueue = (update: WhatsAppQueueUpdate) => {
    observers.forEach(observer => observer.onQueueUpdate?.(update));
  };
  const setStatus = (patch: Partial<WhatsAppStatus>) => {
    currentStatus = { ...currentStatus, ...patch, pending: pendingCount() };
    publishStatus();
  };
  const state = () => normalizeEngineState(currentStatus.state);
  const alive = () => WHATSAPP_ALIVE_STATES.has(state());

  return Object.freeze({
    async getStatus() {
      return currentStatus;
    },
    async getQueue() {
      return [...queue];
    },
    async enqueue(messages) {
      const added = messages.map(message => ({
        id: message.id ?? `memory-${++sequence}`,
        studentName: message.student_name ?? message.phone,
        phone: message.phone,
        message: message.message,
        status: message.status ?? 'pending',
        timestamp: message.timestamp ?? Date.now(),
        statusLabel: message.status_label ?? '',
        attachment: message.attachment
      }));
      queue = [...queue, ...added];
      publishQueue({ action: 'send', added: added.length });
      setStatus({});
    },
    async upload(file) {
      return `memory://uploads/${encodeURIComponent(file.name)}`;
    },
    async control(command) {
      const name = typeof command === 'string' ? command : command.type;
      switch (name) {
        case 'start': {
          if (alive()) throw new WhatsAppCommandError('المحرك يعمل بالفعل');
          const requireQr = options.requireQrScan ?? false;
          setStatus({
            running: true,
            state: requireQr ? 'waiting_login' : 'ready',
            logged_in: !requireQr,
            sending: false,
            paused: false,
            progress: EMPTY_PROGRESS,
            state_message: requireQr ? 'بانتظار مسح رمز QR' : 'المحرك جاهز'
          });
          return;
        }
        case 'stop': {
          if (!alive()) throw new WhatsAppCommandError('المحرك متوقف بالفعل', 400);
          setStatus({ running: false, state: 'stopped', logged_in: false, sending: false, paused: false });
          return;
        }
        case 'clear': {
          queue = [];
          publishQueue({ action: 'clear', added: 0 });
          setStatus({});
          return;
        }
        case 'sending:start': {
          if (!alive()) throw new WhatsAppCommandError('شغّل المحرك أولاً ثم ابدأ الإرسال');
          if (state() === 'waiting_login') throw new WhatsAppCommandError('امسح رمز QR في نافذة واتساب ويب أولاً');
          if (state() === 'sending') throw new WhatsAppCommandError('الإرسال جارٍ بالفعل');
          queue = queue.map(item => item.status === 'pending' ? { ...item, status: 'sent' } : item);
          const total = queue.length;
          setStatus({
            state: 'ready',
            sending: false,
            paused: false,
            progress: { ...EMPTY_PROGRESS, current: total, total, sent: total },
            state_message: `اكتمل الإرسال: ${total} نجحت، 0 فشلت`
          });
          publishQueue({ action: 'send', added: 0 });
          return;
        }
        case 'sending:pause': {
          if (state() !== 'sending') throw new WhatsAppCommandError('لا يوجد إرسال جارٍ لإيقافه مؤقتاً');
          setStatus({ state: 'paused', paused: true, sending: true });
          return;
        }
        case 'sending:resume': {
          if (state() !== 'paused') throw new WhatsAppCommandError('الإرسال ليس متوقفاً مؤقتاً');
          setStatus({ state: 'sending', paused: false, sending: true });
          return;
        }
        case 'sending:stop': {
          if (state() !== 'sending' && state() !== 'paused') throw new WhatsAppCommandError('لا يوجد إرسال جارٍ');
          setStatus({ state: 'ready', paused: false, sending: false });
          return;
        }
        case 'window:focus': {
          if (!alive()) throw new WhatsAppCommandError('لا توجد نافذة واتساب مفتوحة - شغّل المحرك أولاً');
          return;
        }
        case 'remove': {
          if (typeof command === 'string' || command.type !== 'remove') return;
          queue = queue.filter(item => item.id !== command.id);
          publishQueue({ action: 'remove', added: 0 });
          setStatus({});
          return;
        }
        default:
          return;
      }
    },
    subscribe(observer) {
      observers.add(observer);
      queueMicrotask(() => {
        if (!observers.has(observer)) return;
        observer.onOpen?.();
        observer.onStatus?.(currentStatus);
      });
      return () => observers.delete(observer);
    }
  });
};
