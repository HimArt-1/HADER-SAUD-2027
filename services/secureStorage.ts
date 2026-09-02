import CryptoJS from 'crypto-js';
import { STORAGE_KEYS, User } from '../types';

const SECRET_PHRASE = 'HADER_SESSION_SHIELD_v1';
const DEVICE_ID_KEY = 'hader:device-id';
const SESSION_VERSION = 1;
type SessionChangeEvent = 'updated' | 'cleared' | 'invalidated';

export interface SecureSessionPayload {
  user: User;
  token: string;
  expiresAt: number;
  createdAt: number;
  sessionId?: string;
  surveyAdminToken?: string;
  surveyAdminExpiresAt?: number;
  guardian?: {
    children: Array<{
      id: string;
      name: string;
      grade?: string;
      class?: string;
    }>;
    activeStudentId?: string;
  };
}

interface StoredSession {
  version: number;
  salt: string;
  iv: string;
  cipher: string;
  mac: string;
}

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const getFingerprint = () => {
  if (!isBrowser) return 'server';
  const nav = window.navigator;
  const screenInfo = window.screen;
  return [
    nav.userAgent,
    nav.language,
    screenInfo?.width || 0,
    screenInfo?.height || 0,
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'utc'
  ].join('|');
};

const getDeviceId = (): string => {
  if (!isBrowser) return 'server-device';
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

const deriveKey = (saltWordArray: CryptoJS.lib.WordArray, deviceId: string) => {
  return CryptoJS.PBKDF2(`${SECRET_PHRASE}:${deviceId}`, saltWordArray, {
    keySize: 256 / 32,
    iterations: 120000,
    hasher: CryptoJS.algo.SHA256
  });
};

const wordArrayFromBase64 = (value: string) => CryptoJS.enc.Base64.parse(value);
const wordArrayToBase64 = (value: CryptoJS.lib.WordArray) => CryptoJS.enc.Base64.stringify(value);

class SecureSessionStorage {
  private cache: SecureSessionPayload | null = null;
  private memorySession: SecureSessionPayload | null = null;
  private listeners = new Set<(event: SessionChangeEvent) => void>();
  private storageHandler: ((event: StorageEvent) => void) | null = null;

  constructor() {
    if (isBrowser) {
      // Store handler reference for cleanup
      this.storageHandler = (event: StorageEvent) => {
        if (event.key === STORAGE_KEYS.SESSION) {
          this.cache = null;
          if (!event.newValue) {
            this.emit('cleared');
          } else {
            this.emit('updated');
          }
        }
      };
      window.addEventListener('storage', this.storageHandler);
    }
  }

  /**
   * Cleanup method to prevent memory leaks
   */
  cleanup(): void {
    if (isBrowser && this.storageHandler) {
      window.removeEventListener('storage', this.storageHandler);
      this.storageHandler = null;
    }
    this.listeners.clear();
    this.cache = null;
    this.memorySession = null;
  }

  onChange(listener: (event: SessionChangeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SessionChangeEvent) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.warn('[SecureSession] listener error', error);
      }
    });
  }

  save(session: SecureSessionPayload) {
    if (!isBrowser) return;
    try {
      const deviceId = getDeviceId();
      const salt = CryptoJS.lib.WordArray.random(16);
      const iv = CryptoJS.lib.WordArray.random(12);
      const key = deriveKey(salt, deviceId);
      const fingerprint = getFingerprint();
      const sessionId = session.sessionId || crypto.randomUUID();
      const fingerprintHash = CryptoJS.SHA256(fingerprint).toString(CryptoJS.enc.Hex);

      const payload = JSON.stringify({
        version: SESSION_VERSION,
        session: { ...session, sessionId },
        deviceId,
        fingerprint: fingerprintHash,
        timestamp: Date.now()
      });

      const encrypted = CryptoJS.AES.encrypt(payload, key, { iv });
      const cipherBase64 = wordArrayToBase64(encrypted.ciphertext);
      const mac = CryptoJS.HmacSHA256(encrypted.ciphertext, key).toString(CryptoJS.enc.Base64);

      const stored: StoredSession = {
        version: SESSION_VERSION,
        salt: wordArrayToBase64(salt),
        iv: wordArrayToBase64(iv),
        cipher: cipherBase64,
        mac
      };

      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(stored));
      this.cache = session;
      this.memorySession = null;
      this.emit('updated');
    } catch (error) {
      console.error('[SecureSession] Failed to store secure session', error);
      try {
        localStorage.removeItem(STORAGE_KEYS.SESSION);
      } catch (cleanupError) {
        console.warn('[SecureSession] Failed to cleanup session key after storage error', cleanupError);
      }
      this.cache = session;
      this.memorySession = session;
      this.emit('invalidated');
    }
  }

  get(): SecureSessionPayload | null {
    if (!isBrowser) return this.memorySession;
    if (this.cache) return this.cache;
    if (this.memorySession) return this.memorySession;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEYS.SESSION);
    } catch (error) {
      console.warn('[SecureSession] Failed to read session from storage', error);
      return this.memorySession;
    }
    if (!raw) return null;

    try {
      const stored: StoredSession = JSON.parse(raw);
      if (!stored || !stored.cipher || !stored.salt || !stored.iv) {
        throw new Error('Invalid session format');
      }

      const deviceId = getDeviceId();
      const salt = wordArrayFromBase64(stored.salt);
      const iv = wordArrayFromBase64(stored.iv);
      const ciphertext = wordArrayFromBase64(stored.cipher);
      const key = deriveKey(salt, deviceId);
      const expectedMac = CryptoJS.HmacSHA256(ciphertext, key).toString(CryptoJS.enc.Base64);

      if (stored.mac !== expectedMac) {
        throw new Error('Session MAC mismatch');
      }

      const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext });
      const decrypted = CryptoJS.AES.decrypt(cipherParams, key, { iv });
      const json = decrypted.toString(CryptoJS.enc.Utf8);
      if (!json) throw new Error('Unable to decode session');

      const parsed = JSON.parse(json);
      if (parsed.deviceId !== deviceId) {
        throw new Error('Device mismatch');
      }

      const fingerprintHash = CryptoJS.SHA256(getFingerprint()).toString(CryptoJS.enc.Hex);
      if (parsed.fingerprint !== fingerprintHash) {
        throw new Error('Fingerprint mismatch');
      }

      this.cache = parsed.session as SecureSessionPayload;
      this.memorySession = null;
      return this.cache;
    } catch (error) {
      console.warn('[SecureSession] Session corrupted, clearing...', error);
      this.clear();
      this.emit('invalidated');
      return null;
    }
  }

  clear() {
    if (!isBrowser) {
      this.cache = null;
      this.memorySession = null;
      return;
    }
    this.cache = null;
    this.memorySession = null;
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSION);
    } catch (error) {
      console.warn('[SecureSession] Failed to clear session from storage', error);
    }
    this.emit('cleared');
  }
}

export const secureSessionStorage = new SecureSessionStorage();
