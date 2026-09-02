export type WhatsAppQueueStatus = 'pending' | 'sending' | 'sent' | 'failed';

export type WhatsAppStatus = Readonly<{
  running: boolean;
  logs: string[];
  state?: string;
  state_message?: string;
  version?: string;
  stats?: Record<string, unknown>;
}>;

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
  action: 'send' | 'clear';
  added: number;
}>;

export type WhatsAppCommand =
  | 'start'
  | 'stop'
  | 'clear'
  | Readonly<{ type: 'remove'; id: string }>;

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
}>;

/** A second adapter for component tests and offline prototypes. */
export const createInMemoryWhatsAppGateway = (
  options: InMemoryWhatsAppGatewayOptions = {}
): WhatsAppGateway => {
  let currentStatus: WhatsAppStatus = {
    running: options.status?.running ?? false,
    logs: [...(options.status?.logs ?? [])],
    state: options.status?.state ?? 'idle',
    state_message: options.status?.state_message,
    version: options.status?.version ?? 'memory',
    stats: options.status?.stats
  };
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
  const observers = new Set<WhatsAppSubscription>();

  const publishStatus = () => {
    observers.forEach(observer => observer.onStatus?.(currentStatus));
  };
  const publishQueue = (update: WhatsAppQueueUpdate) => {
    observers.forEach(observer => observer.onQueueUpdate?.(update));
  };

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
    },
    async upload(file) {
      return `memory://uploads/${encodeURIComponent(file.name)}`;
    },
    async control(command) {
      if (command === 'start' || command === 'stop') {
        const running = command === 'start';
        currentStatus = {
          ...currentStatus,
          running,
          state: running ? 'running' : 'stopped'
        };
        publishStatus();
        return;
      }
      if (command === 'clear') {
        queue = [];
        publishQueue({ action: 'clear', added: 0 });
        return;
      }
      queue = queue.filter(item => item.id !== command.id);
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
