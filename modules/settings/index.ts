import type { SystemSettings } from '../../types';

export type SettingsPort = Readonly<{
  loadSettings(): Promise<SystemSettings>;
  saveSettings(settings: SystemSettings): Promise<void>;
  subscribeToUpdates(listener: (settings: SystemSettings) => void): () => void;
  invalidateCaches(): void;
  applyAppearance(settings: SystemSettings): void;
}>;

export type SettingsCommand =
  | Readonly<{ type: 'patch'; changes: Partial<SystemSettings> }>
  | Readonly<{ type: 'replace'; settings: SystemSettings }>;

export type SettingsModule = Readonly<{
  load(options?: Readonly<{ refresh?: boolean }>): Promise<SystemSettings>;
  execute(command: SettingsCommand): Promise<SystemSettings>;
  subscribe(listener: (settings: SystemSettings) => void): () => void;
}>;

const cloneSettings = (settings: SystemSettings): SystemSettings => {
  if (typeof structuredClone === 'function') return structuredClone(settings);
  return JSON.parse(JSON.stringify(settings)) as SystemSettings;
};

const fingerprint = (settings: SystemSettings): string => JSON.stringify(settings);

const normalizeSettings = (settings: SystemSettings): SystemSettings => {
  const cloned = cloneSettings(settings);
  return {
    ...cloned,
    kiosk_settings: cloned.kiosk_settings ?? {}
  };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const mergeValues = (current: unknown, changes: unknown): unknown => {
  if (!isPlainObject(current) || !isPlainObject(changes)) return changes;
  const merged: Record<string, unknown> = { ...current };
  Object.entries(changes).forEach(([key, value]) => {
    merged[key] = mergeValues(current[key], value);
  });
  return merged;
};

const mergeSettings = (
  current: SystemSettings,
  changes: Partial<SystemSettings>
): SystemSettings => mergeValues(current, changes) as SystemSettings;

/**
 * Owns settings consistency: read coalescing, serialized patch writes,
 * same-tab/cross-tab delivery, cache invalidation and appearance updates.
 */
export const createSettingsModule = (port: SettingsPort): SettingsModule => {
  let snapshot: SystemSettings | null = null;
  let snapshotFingerprint = '';
  let loadPromise: Promise<SystemSettings> | null = null;
  let writeTail: Promise<void> = Promise.resolve();
  let version = 0;
  let listening = false;
  const listeners = new Set<(settings: SystemSettings) => void>();

  const notify = (settings: SystemSettings) => {
    listeners.forEach(listener => listener(cloneSettings(settings)));
  };

  const adopt = (
    settings: SystemSettings,
    options: Readonly<{ invalidate: boolean; notify: boolean }>
  ): SystemSettings => {
    const next = normalizeSettings(settings);
    const nextFingerprint = fingerprint(next);
    const changed = nextFingerprint !== snapshotFingerprint;
    if (!changed && snapshot) return cloneSettings(snapshot);
    snapshot = next;
    snapshotFingerprint = nextFingerprint;
    version += 1;
    if (options.invalidate) port.invalidateCaches();
    port.applyAppearance(next);
    if (options.notify && changed) notify(next);
    return cloneSettings(next);
  };

  const ensureListening = () => {
    if (listening) return;
    listening = true;
    port.subscribeToUpdates(settings => {
      adopt(settings, { invalidate: true, notify: true });
    });
  };

  const load = async (options: Readonly<{ refresh?: boolean }> = {}): Promise<SystemSettings> => {
    ensureListening();
    if (snapshot && !options.refresh) return cloneSettings(snapshot);
    if (!loadPromise) {
      const expectedVersion = version;
      const hadSnapshot = snapshot !== null;
      loadPromise = port.loadSettings().then(settings => {
        if (version !== expectedVersion && snapshot) return cloneSettings(snapshot);
        return adopt(settings, { invalidate: hadSnapshot, notify: hadSnapshot });
      }).finally(() => {
        loadPromise = null;
      });
    }
    return cloneSettings(await loadPromise);
  };

  return Object.freeze({
    load,

    execute(command) {
      ensureListening();
      const operation = writeTail.then(async () => {
        const next = command.type === 'patch'
          ? normalizeSettings(mergeSettings(
              await load({ refresh: true }),
              cloneSettings(command.changes)
            ))
          : normalizeSettings(command.settings);
        await port.saveSettings(next);
        return adopt(next, { invalidate: true, notify: true });
      });
      writeTail = operation.then(() => undefined, () => undefined);
      return operation;
    },

    subscribe(listener) {
      ensureListening();
      listeners.add(listener);
      if (snapshot) listener(cloneSettings(snapshot));
      return () => listeners.delete(listener);
    }
  });
};

export const createInMemorySettingsPort = (
  initial: SystemSettings = {}
): SettingsPort => {
  let settings = normalizeSettings(initial);
  const listeners = new Set<(settings: SystemSettings) => void>();

  return Object.freeze({
    async loadSettings() {
      return cloneSettings(settings);
    },
    async saveSettings(next) {
      settings = normalizeSettings(next);
      listeners.forEach(listener => listener(cloneSettings(settings)));
    },
    subscribeToUpdates(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidateCaches() {
      // The memory adapter has no storage caches.
    },
    applyAppearance() {
      // The memory adapter has no document to update.
    }
  });
};
