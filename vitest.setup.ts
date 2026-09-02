const isStorageLike = (value: unknown): value is Storage => {
  const storage = value as Partial<Storage> | undefined;
  return Boolean(
    storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function' &&
    typeof storage.clear === 'function'
  );
};

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    }
  };
};

const getWindowStorage = (name: 'localStorage' | 'sessionStorage') => {
  try {
    return window[name];
  } catch {
    return undefined;
  }
};

const ensureStorage = (name: 'localStorage' | 'sessionStorage') => {
  const windowStorage = getWindowStorage(name);
  const globalStorage = globalThis[name];
  const storage = isStorageLike(windowStorage)
    ? windowStorage
    : isStorageLike(globalStorage)
      ? globalStorage
      : createMemoryStorage();

  Object.defineProperty(window, name, {
    configurable: true,
    value: storage
  });
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage
  });
};

ensureStorage('localStorage');
ensureStorage('sessionStorage');

// Provide a basic matchMedia mock for components that expect it
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  }) as unknown as typeof window.matchMedia;
}

if (!URL.createObjectURL) {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => 'blob://mock'
  });
}

if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: () => undefined
  });
}
