import type { Notification, User } from '../../types';
import { accessPolicy } from '../access';

export type NotificationDraft = Omit<Notification, 'id' | 'created_at'> &
  Partial<Pick<Notification, 'id' | 'created_at'>>;

export type NotificationRecipient = User | 'kiosk';

export type NotificationsPort = Readonly<{
  saveNotification(notification: Notification): Promise<void>;
  saveNotifications(notifications: Notification[]): Promise<void>;
  loadStudentNotifications(studentId: string, className: string): Promise<Notification[]>;
  loadAllNotifications(limit?: number): Promise<Notification[]>;
  subscribeToInserts(
    recipient: NotificationRecipient,
    listener: (notification: Notification) => void
  ): { unsubscribe(): void };
}>;

export type NotificationsQuery =
  | Readonly<{ type: 'user'; recipient: NotificationRecipient; limit?: number }>
  | Readonly<{ type: 'student'; studentId: string; className: string; limit?: number }>
  | Readonly<{ type: 'all'; limit?: number }>;

export type NotificationsCommand =
  | Readonly<{ type: 'send'; notification: NotificationDraft }>
  | Readonly<{ type: 'send-many'; notifications: readonly NotificationDraft[] }>
  | Readonly<{
      type: 'broadcast';
      title: string;
      message: string;
      targetAudience: Notification['target_audience'];
      targetId?: string | null;
      notificationType?: Notification['type'];
      isPopup?: boolean;
      priority?: number;
      createdBy?: string | null;
      expiresAt?: string | null;
    }>;

export type NotificationsExecutionResult = Readonly<{
  notifications: Notification[];
}>;

export type NotificationsModule = Readonly<{
  load(query: NotificationsQuery): Promise<Notification[]>;
  execute(command: NotificationsCommand): Promise<NotificationsExecutionResult>;
  subscribe(
    recipient: NotificationRecipient,
    listener: (notification: Notification) => void
  ): { unsubscribe(): void };
}>;

type NotificationsEnvironment = Readonly<{
  now?: () => Date;
  createId?: () => string;
  pollIntervalMs?: number;
  onSubscriptionError?: (error: unknown) => void;
}>;

type ActiveSubscription = {
  deliver(notification: Notification, force?: boolean): void;
};

const cloneNotification = (notification: Notification): Notification => ({ ...notification });

const timestamp = (notification: Notification): number => {
  const value = Date.parse(notification.created_at);
  return Number.isFinite(value) ? value : 0;
};

const newestFirst = (left: Notification, right: Notification): number =>
  timestamp(right) - timestamp(left) || right.id.localeCompare(left.id);

const oldestFirst = (left: Notification, right: Notification): number =>
  timestamp(left) - timestamp(right) || left.id.localeCompare(right.id);

const notificationMatchesStudent = (
  notification: Notification,
  studentId: string,
  className: string
): boolean =>
  notification.target_audience === 'all' ||
  (notification.target_audience === 'class' &&
    (notification.target_id === className || notification.target_id === 'all')) ||
  (notification.target_audience === 'student' && notification.target_id === studentId) ||
  (notification.target_audience === 'guardian' &&
    (!notification.target_id || notification.target_id === studentId));

const normalizeLoaded = (notifications: readonly Notification[]): Notification[] => {
  const byId = new Map<string, Notification>();
  [...notifications]
    .filter(notification => Boolean(notification?.id && notification.message))
    .sort(newestFirst)
    .forEach(notification => {
      if (!byId.has(notification.id)) byId.set(notification.id, cloneNotification(notification));
    });
  return [...byId.values()];
};

/**
 * Owns notification targeting, normalization, de-duplication and resilient delivery.
 * Storage and realtime transports stay behind NotificationsPort.
 */
export const createNotificationsModule = (
  port: NotificationsPort,
  environment: NotificationsEnvironment = {}
): NotificationsModule => {
  const now = environment.now ?? (() => new Date());
  const createId = environment.createId ?? (() => crypto.randomUUID());
  const pollIntervalMs = environment.pollIntervalMs ?? 7_000;
  const activeSubscriptions = new Set<ActiveSubscription>();

  const normalizeDraft = (draft: NotificationDraft): Notification => {
    if (!draft.message.trim()) throw new Error('Notification message cannot be empty');
    return {
      ...draft,
      id: draft.id?.trim() || createId(),
      title: draft.title?.trim() || undefined,
      message: draft.message.trim(),
      target_id: draft.target_id || undefined,
      created_at: draft.created_at || now().toISOString()
    };
  };

  const notifyLocalSubscribers = (notifications: readonly Notification[]) => {
    notifications.forEach(notification => {
      activeSubscriptions.forEach(subscription => subscription.deliver(notification, true));
    });
  };

  const persist = async (drafts: readonly NotificationDraft[]): Promise<Notification[]> => {
    const byId = new Map<string, Notification>();
    drafts.forEach(draft => {
      const notification = normalizeDraft(draft);
      if (!byId.has(notification.id)) byId.set(notification.id, notification);
    });
    const notifications = [...byId.values()];
    if (!notifications.length) return [];
    if (notifications.length === 1) {
      await port.saveNotification(notifications[0]);
    } else {
      await port.saveNotifications(notifications);
    }
    notifyLocalSubscribers(notifications);
    return notifications.map(cloneNotification);
  };

  return Object.freeze({
    async load(query) {
      if (query.type === 'student') {
        const notifications = normalizeLoaded(
          await port.loadStudentNotifications(query.studentId, query.className)
        );
        return notifications
          .filter(notification => notificationMatchesStudent(
            notification,
            query.studentId,
            query.className
          ))
          .slice(0, query.limit ?? notifications.length);
      }

      const requestedLimit = query.type === 'all' ? query.limit : undefined;
      const notifications = normalizeLoaded(await port.loadAllNotifications(requestedLimit));
      if (query.type === 'all') return notifications.slice(0, query.limit ?? notifications.length);
      return notifications
        .filter(notification => accessPolicy.notificationMatchesUser(notification, query.recipient))
        .slice(0, query.limit ?? 30);
    },

    async execute(command) {
      if (command.type === 'send') {
        return { notifications: await persist([command.notification]) };
      }
      if (command.type === 'send-many') {
        return { notifications: await persist(command.notifications) };
      }
      return {
        notifications: await persist([{
          title: command.title,
          message: command.message,
          type: command.notificationType ?? 'announcement',
          target_audience: command.targetAudience,
          target_id: command.targetId,
          is_popup: command.isPopup ?? true,
          priority: command.priority,
          created_by: command.createdBy,
          expires_at: command.expiresAt
        }])
      };
    },

    subscribe(recipient, listener) {
      let active = true;
      let ready = false;
      const seenIds = new Set<string>();
      const pending = new Map<string, Notification>();

      const reportError = (error: unknown) => environment.onSubscriptionError?.(error);
      const invoke = (notification: Notification) => {
        try {
          listener(cloneNotification(notification));
        } catch (error) {
          reportError(error);
        }
      };
      const deliver = (notification: Notification, force = false) => {
        if (!active || !notification?.id || seenIds.has(notification.id)) return;
        if (!accessPolicy.notificationMatchesUser(notification, recipient)) return;
        if (!ready && !force) {
          pending.set(notification.id, cloneNotification(notification));
          return;
        }
        seenIds.add(notification.id);
        pending.delete(notification.id);
        invoke(notification);
      };

      const subscriptionState: ActiveSubscription = { deliver };
      activeSubscriptions.add(subscriptionState);

      let transportSubscription: { unsubscribe(): void } = { unsubscribe() {} };
      try {
        transportSubscription = port.subscribeToInserts(recipient, notification => deliver(notification));
      } catch (error) {
        reportError(error);
      }

      void port.loadAllNotifications(50)
        .then(notifications => {
          if (!active) return;
          const pendingIds = new Set(pending.keys());
          normalizeLoaded(notifications).forEach(notification => {
            if (!pendingIds.has(notification.id)) seenIds.add(notification.id);
          });
          ready = true;
          [...pending.values()].sort(oldestFirst).forEach(notification => deliver(notification));
        })
        .catch(error => {
          if (!active) return;
          reportError(error);
          ready = true;
          [...pending.values()].sort(oldestFirst).forEach(notification => deliver(notification));
        });

      const pollTimer = pollIntervalMs > 0
        ? setInterval(() => {
            void port.loadAllNotifications(50)
              .then(notifications => {
                if (!active) return;
                normalizeLoaded(notifications).sort(oldestFirst).forEach(notification => deliver(notification));
              })
              .catch(reportError);
          }, pollIntervalMs)
        : null;

      return {
        unsubscribe() {
          if (!active) return;
          active = false;
          activeSubscriptions.delete(subscriptionState);
          transportSubscription.unsubscribe();
          if (pollTimer) clearInterval(pollTimer);
          pending.clear();
        }
      };
    }
  });
};

export const createInMemoryNotificationsPort = (
  initial: readonly Notification[] = []
): NotificationsPort => {
  let notifications = initial.map(cloneNotification);
  const listeners = new Set<(notification: Notification) => void>();

  const save = (notification: Notification) => {
    notifications = [
      cloneNotification(notification),
      ...notifications.filter(candidate => candidate.id !== notification.id)
    ];
    listeners.forEach(listener => listener(cloneNotification(notification)));
  };

  return Object.freeze({
    async saveNotification(notification) {
      save(notification);
    },
    async saveNotifications(next) {
      next.forEach(save);
    },
    async loadStudentNotifications(studentId, className) {
      return notifications
        .filter(notification => notificationMatchesStudent(notification, studentId, className))
        .map(cloneNotification);
    },
    async loadAllNotifications(limit) {
      const ordered = [...notifications].sort(newestFirst);
      return ordered.slice(0, limit ?? ordered.length).map(cloneNotification);
    },
    subscribeToInserts(_recipient, listener) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    }
  });
};
