/**
 * ═══════════════════════════════════════════════════════════════
 * 🔐 SecurityService - Password Hashing & Security Utilities
 * ═══════════════════════════════════════════════════════════════
 * 
 * Features:
 * - PBKDF2-based password hashing (bcrypt alternative for browser)
 * - Secure random salt generation
 * - Constant-time comparison for timing attack prevention
 * - Password strength validation
 * - Rate limiting for brute force protection
 */

// ═══════════════════════════════════════════════════════════════
// 🔑 Password Hashing (PBKDF2 - Browser-compatible bcrypt alternative)
// ═══════════════════════════════════════════════════════════════

const isTestEnv = typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined'
  ? import.meta.env.MODE === 'test' || Boolean(import.meta.env.TEST || import.meta.env.VITEST)
  : false;

// Use 10000 iterations for mobile performance. Existing passwords with higher counts will still verify correctly.
const ITERATIONS = isTestEnv ? 20 : 10000;
const KEY_LENGTH = 256;    // 256-bit key
const SALT_LENGTH = 16;    // 128-bit salt

/**
 * Generate cryptographically secure random salt
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBuffer(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g) || [];
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

/**
 * 🔒 Hash password using PBKDF2
 * Returns format: iterations:salt:hash
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_LENGTH
  );

  const hashHex = bufferToHex(derivedBits);
  const saltHex = bufferToHex(salt.buffer as ArrayBuffer);

  return `${ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * 🔓 Verify password against hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const [iterationsStr, saltHex, originalHash] = storedHash.split(':');

    if (!iterationsStr || !saltHex || !originalHash) {
      // Legacy plain text comparison for migration
      return password === storedHash;
    }

    const iterations = parseInt(iterationsStr, 10);
    const salt = hexToBuffer(saltHex);
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as any,
        iterations: iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      KEY_LENGTH
    );

    const newHash = bufferToHex(derivedBits);

    // Constant-time comparison to prevent timing attacks
    return constantTimeCompare(newHash, originalHash);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

/**
 * ⏱️ Constant-time string comparison (prevents timing attacks)
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 🔍 Check if hash needs migration (is plain text)
 */
export function needsHashMigration(storedPassword: string): boolean {
  // If it doesn't contain the PBKDF2 format, it's plain text
  return !storedPassword.includes(':');
}

/**
 * Plain text → PBKDF2 hash for DB/Supabase; existing hashes are left unchanged.
 */
export async function ensurePasswordForCloud(password: string | undefined | null): Promise<string | undefined> {
  if (password == null || password === '') return undefined;
  if (!needsHashMigration(password)) return password;
  return hashPassword(password);
}

/**
 * 🔄 Migrate plain text password to hashed
 */
export async function migratePassword(plainPassword: string): Promise<string> {
  return await hashPassword(plainPassword);
}

// ═══════════════════════════════════════════════════════════════
// 💪 Password Strength Validation
// ═══════════════════════════════════════════════════════════════

export interface PasswordStrength {
  score: number;        // 0-100
  level: 'weak' | 'fair' | 'good' | 'strong' | 'excellent';
  feedback: string[];
  isValid: boolean;
}

export function checkPasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length < 6) {
    feedback.push('كلمة المرور قصيرة جداً (الحد الأدنى 6 أحرف)');
  } else if (password.length >= 8) {
    score += 20;
    if (password.length >= 12) score += 10;
    if (password.length >= 16) score += 10;
  } else {
    score += 10;
  }

  // Character variety checks
  if (/[a-z]/.test(password)) score += 10;
  else feedback.push('أضف حروفاً صغيرة');

  if (/[A-Z]/.test(password)) score += 15;
  else feedback.push('أضف حروفاً كبيرة');

  if (/[0-9]/.test(password)) score += 15;
  else feedback.push('أضف أرقاماً');

  if (/[^a-zA-Z0-9]/.test(password)) score += 20;
  else feedback.push('أضف رموزاً خاصة (!@#$%)');

  // Arabic characters support
  if (/[\u0600-\u06FF]/.test(password)) score += 5;

  // Penalize common patterns
  if (/(.)\1{2,}/.test(password)) {
    score -= 10;
    feedback.push('تجنب تكرار الأحرف');
  }

  if (/^(123|abc|qwerty|password)/i.test(password)) {
    score -= 20;
    feedback.push('تجنب الأنماط الشائعة');
  }

  // Normalize score
  score = Math.max(0, Math.min(100, score));

  // Determine level
  let level: PasswordStrength['level'];
  if (score < 20) level = 'weak';
  else if (score < 40) level = 'fair';
  else if (score < 60) level = 'good';
  else if (score < 80) level = 'strong';
  else level = 'excellent';

  return {
    score,
    level,
    feedback: feedback.length === 0 ? ['كلمة مرور قوية!'] : feedback,
    isValid: password.length >= 6 && score >= 30
  };
}

// ═══════════════════════════════════════════════════════════════
// 🚧 Rate Limiting
// ═══════════════════════════════════════════════════════════════

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  lastAttempt: number;
  blocked: boolean;
  blockUntil: number;
}

class RateLimiter {
  private entries: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private config = {
    maxAttempts: 5,          // Max attempts before blocking
    windowMs: 15 * 60 * 1000, // 15 minute window
    blockDurationMs: 30 * 60 * 1000, // 30 minute block
    cleanupIntervalMs: 5 * 60 * 1000 // Cleanup every 5 minutes
  };

  constructor() {
    // Periodic cleanup - store interval ID for cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs);
  }

  /**
   * Destroy the rate limiter and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.entries.clear();
  }

  /**
   * 🔍 Check if request is allowed
   */
  isAllowed(identifier: string): { allowed: boolean; retryAfter?: number; remainingAttempts?: number } {
    const now = Date.now();
    let entry = this.entries.get(identifier);

    // New entry
    if (!entry) {
      this.entries.set(identifier, {
        attempts: 1,
        firstAttempt: now,
        lastAttempt: now,
        blocked: false,
        blockUntil: 0
      });
      return { allowed: true, remainingAttempts: this.config.maxAttempts - 1 };
    }

    // Check if blocked
    if (entry.blocked && now < entry.blockUntil) {
      return {
        allowed: false,
        retryAfter: Math.ceil((entry.blockUntil - now) / 1000)
      };
    }

    // Reset if block expired
    if (entry.blocked && now >= entry.blockUntil) {
      entry = {
        attempts: 1,
        firstAttempt: now,
        lastAttempt: now,
        blocked: false,
        blockUntil: 0
      };
      this.entries.set(identifier, entry);
      return { allowed: true, remainingAttempts: this.config.maxAttempts - 1 };
    }

    // Check if window expired
    if (now - entry.firstAttempt > this.config.windowMs) {
      entry = {
        attempts: 1,
        firstAttempt: now,
        lastAttempt: now,
        blocked: false,
        blockUntil: 0
      };
      this.entries.set(identifier, entry);
      return { allowed: true, remainingAttempts: this.config.maxAttempts - 1 };
    }

    // Increment attempts
    entry.attempts++;
    entry.lastAttempt = now;

    // Check if should block
    if (entry.attempts >= this.config.maxAttempts) {
      entry.blocked = true;
      entry.blockUntil = now + this.config.blockDurationMs;
      this.entries.set(identifier, entry);
      return {
        allowed: false,
        retryAfter: Math.ceil(this.config.blockDurationMs / 1000)
      };
    }

    this.entries.set(identifier, entry);
    return { allowed: true, remainingAttempts: this.config.maxAttempts - entry.attempts };
  }

  /**
   * ✅ Record successful attempt (reset counter)
   */
  recordSuccess(identifier: string): void {
    this.entries.delete(identifier);
  }

  /**
   * 🧹 Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    this.entries.forEach((entry, key) => {
      // Remove unblocked entries older than window
      if (!entry.blocked && now - entry.lastAttempt > this.config.windowMs) {
        toDelete.push(key);
      }
      // Remove expired blocks
      if (entry.blocked && now > entry.blockUntil + this.config.windowMs) {
        toDelete.push(key);
      }
    });

    toDelete.forEach(key => this.entries.delete(key));
  }

  /**
   * 📊 Get rate limit stats
   */
  getStats(): { totalEntries: number; blockedCount: number } {
    let blockedCount = 0;
    this.entries.forEach(entry => {
      if (entry.blocked && Date.now() < entry.blockUntil) {
        blockedCount++;
      }
    });
    return {
      totalEntries: this.entries.size,
      blockedCount
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔐 Session Security
// ═══════════════════════════════════════════════════════════════

/**
 * Generate secure session token
 */
export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return bufferToHex(array.buffer as ArrayBuffer);
}

/**
 * Generate CSRF token
 */
export function generateCSRFToken(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return bufferToHex(array.buffer as ArrayBuffer);
}

// ═══════════════════════════════════════════════════════════════
// 🏭 Singleton Instances
// ═══════════════════════════════════════════════════════════════

export const loginRateLimiter = new RateLimiter();
export const apiRateLimiter = new RateLimiter();

// ═══════════════════════════════════════════════════════════════
// 📦 Export
// ═══════════════════════════════════════════════════════════════

export const security = {
  hashPassword,
  verifyPassword,
  needsHashMigration,
  ensurePasswordForCloud,
  migratePassword,
  checkPasswordStrength,
  generateSessionToken,
  generateCSRFToken,
  loginRateLimiter,
  apiRateLimiter
};

export default security;

