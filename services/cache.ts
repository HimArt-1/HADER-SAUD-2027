/**
 * ═══════════════════════════════════════════════════════════════
 * 🚀 CacheService - Advanced Caching System for Hader
 * ═══════════════════════════════════════════════════════════════
 * 
 * Features:
 * - In-memory caching with TTL (Time To Live)
 * - LocalStorage persistence for offline support
 * - Automatic cache invalidation
 * - Cache statistics and monitoring
 * - LRU (Least Recently Used) eviction
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  key: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
  memoryUsage: string;
}

export interface CacheConfig {
  maxSize: number;           // Maximum number of entries
  defaultTTL: number;        // Default TTL in milliseconds
  persistToStorage: boolean; // Whether to persist to localStorage
  storagePrefix: string;     // Prefix for localStorage keys
}

const DEFAULT_CONFIG: CacheConfig = {
  maxSize: 500,
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  persistToStorage: true,
  storagePrefix: 'hader_cache:'
};

class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private config: CacheConfig;
  private stats = { hits: 0, misses: 0 };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadFromStorage();
  }

  /**
   * 📥 Get item from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update hit count and access time
    entry.hits++;
    this.stats.hits++;
    
    return entry.data as T;
  }

  /**
   * 📤 Set item in cache
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // Evict if at max capacity
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL,
      hits: 0,
      key
    };

    this.cache.set(key, entry);

    // Persist to localStorage if enabled
    if (this.config.persistToStorage) {
      this.persistEntry(key, entry);
    }
  }

  /**
   * 🔄 Get or set with callback (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string, 
    fetchFn: () => Promise<T>, 
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    this.set(key, data, ttl);
    return data;
  }

  /**
   * 🗑️ Delete item from cache
   */
  delete(key: string): boolean {
    if (this.config.persistToStorage) {
      try {
        localStorage.removeItem(this.config.storagePrefix + key);
      } catch (e) {
        console.warn('Failed to remove from localStorage', e);
      }
    }
    return this.cache.delete(key);
  }

  /**
   * 🧹 Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };

    if (this.config.persistToStorage) {
      this.clearStorage();
    }
  }

  /**
   * 🏷️ Invalidate by pattern (prefix matching)
   */
  invalidatePattern(pattern: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    this.cache.forEach((_, key) => {
      if (key.startsWith(pattern) || key.includes(pattern)) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => {
      this.delete(key);
      count++;
    });

    return count;
  }

  /**
   * 📊 Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) : 0,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * 🔍 Check if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 📋 Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * ⏰ Get remaining TTL for a key
   */
  getTTL(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const elapsed = Date.now() - entry.timestamp;
    const remaining = entry.ttl - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * 🔄 Refresh TTL for a key
   */
  touch(key: string, newTTL?: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    entry.timestamp = Date.now();
    if (newTTL) {
      entry.ttl = newTTL;
    }

    if (this.config.persistToStorage) {
      this.persistEntry(key, entry);
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════

  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    this.cache.forEach((entry, key) => {
      if (entry.timestamp < lruTime) {
        lruTime = entry.timestamp;
        lruKey = key;
      }
    });

    if (lruKey) {
      this.delete(lruKey);
    }
  }

  private persistEntry(key: string, entry: CacheEntry<any>): void {
    try {
      const storageKey = this.config.storagePrefix + key;
      localStorage.setItem(storageKey, JSON.stringify(entry));
    } catch (e) {
      // Storage might be full, evict oldest entries
      console.warn('Cache storage full, clearing old entries');
      this.clearOldStorageEntries();
    }
  }

  private loadFromStorage(): void {
    if (!this.config.persistToStorage) return;

    try {
      const prefix = this.config.storagePrefix;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const rawEntry = localStorage.getItem(key);
          if (rawEntry) {
            const entry: CacheEntry<any> = JSON.parse(rawEntry);
            const cacheKey = key.substring(prefix.length);
            
            // Only load if not expired
            if (!this.isExpired(entry)) {
              this.cache.set(cacheKey, entry);
            } else {
              localStorage.removeItem(key);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load cache from storage', e);
    }
  }

  private clearStorage(): void {
    try {
      const prefix = this.config.storagePrefix;
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      console.warn('Failed to clear storage', e);
    }
  }

  private clearOldStorageEntries(): void {
    try {
      const prefix = this.config.storagePrefix;
      const entries: { key: string; timestamp: number }[] = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const rawEntry = localStorage.getItem(key);
          if (rawEntry) {
            const entry = JSON.parse(rawEntry);
            entries.push({ key, timestamp: entry.timestamp });
          }
        }
      }
      
      // Sort by timestamp and remove oldest 20%
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = Math.ceil(entries.length * 0.2);
      
      for (let i = 0; i < toRemove; i++) {
        localStorage.removeItem(entries[i].key);
      }
    } catch (e) {
      console.warn('Failed to clear old storage entries', e);
    }
  }

  private estimateMemoryUsage(): string {
    let bytes = 0;
    this.cache.forEach((entry) => {
      bytes += JSON.stringify(entry).length * 2; // UTF-16 encoding
    });
    
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

// ═══════════════════════════════════════════════════════════════
// 🏭 Cache Instances for Different Data Types
// ═══════════════════════════════════════════════════════════════

// Main application cache
export const appCache = new CacheService({
  maxSize: 500,
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  persistToStorage: true,
  storagePrefix: 'hader_cache:'
});

// Short-lived cache for real-time data (attendance, stats)
export const realtimeCache = new CacheService({
  maxSize: 100,
  defaultTTL: 30 * 1000, // 30 seconds
  persistToStorage: false,
  storagePrefix: 'hader_rt:'
});

// Long-lived cache for static data (classes, settings)
export const staticCache = new CacheService({
  maxSize: 200,
  defaultTTL: 30 * 60 * 1000, // 30 minutes
  persistToStorage: true,
  storagePrefix: 'hader_static:'
});

// Image cache for optimized image loading
export const imageCache = new CacheService({
  maxSize: 50,
  defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
  persistToStorage: true,
  storagePrefix: 'hader_img:'
});

// ═══════════════════════════════════════════════════════════════
// 🔧 Cache Keys Constants
// ═══════════════════════════════════════════════════════════════

export const CACHE_KEYS = {
  STUDENTS: 'students',
  CLASSES: 'classes',
  USERS: 'users',
  SETTINGS: 'settings',
  ATTENDANCE_TODAY: 'attendance_today',
  STATS_DASHBOARD: 'stats_dashboard',
  WEEKLY_STATS: 'weekly_stats',
  CLASS_STATS: 'class_stats',
  NOTIFICATIONS: 'notifications',
  VIOLATIONS: 'violations',
  EXITS: 'exits',
} as const;

export default CacheService;

