/**
 * ═══════════════════════════════════════════════════════════════
 * 🔄 Async Utilities - Retry Logic, Timeout, Cancellation
 * ═══════════════════════════════════════════════════════════════
 */

import { NetworkError, SyncError, getErrorMessage, shouldRetryError, logError } from '../types/errors';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

export interface TimeoutOptions {
  timeoutMs: number;
  timeoutError?: Error;
}

export interface AbortablePromise<T> {
  promise: Promise<T>;
  abort: () => void;
}

// ═══════════════════════════════════════════════════════════════
// Retry Logic with Exponential Backoff
// ═══════════════════════════════════════════════════════════════

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  shouldRetry: shouldRetryError,
  onRetry: (error, attempt) => {
    console.log(`[Retry] Attempt ${attempt} failed:`, getErrorMessage(error));
  }
};

/**
 * Execute async function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry if we've exhausted attempts
      if (attempt >= opts.maxRetries) {
        break;
      }
      
      // Don't retry if error is not retryable
      if (!opts.shouldRetry(error, attempt)) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelayMs
      );
      
      // Call retry callback
      opts.onRetry(error, attempt + 1);
      
      // Wait before retrying
      await sleep(delay);
    }
  }
  
  // All retries exhausted
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════
// Timeout Handling
// ═══════════════════════════════════════════════════════════════

/**
 * Execute async function with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, timeoutError } = options;
  
  return Promise.race([
    fn(),
    sleep(timeoutMs).then(() => {
      throw timeoutError || new NetworkError(
        `العملية تجاوزت الوقت المحدد (${timeoutMs}ms)`,
        'TIMEOUT'
      );
    })
  ]);
}

// ═══════════════════════════════════════════════════════════════
// Cancellable Promises
// ═══════════════════════════════════════════════════════════════

/**
 * Create an abortable promise using AbortController
 */
export function createAbortablePromise<T>(
  fn: (signal: AbortSignal) => Promise<T>
): AbortablePromise<T> {
  const controller = new AbortController();
  
  const promise = fn(controller.signal).catch(error => {
    if (error.name === 'AbortError') {
      throw new NetworkError('تم إلغاء العملية', 'ABORTED', { aborted: true });
    }
    throw error;
  });
  
  return {
    promise,
    abort: () => controller.abort()
  };
}

/**
 * Create cancellable fetch request
 */
export function createAbortableFetch(
  url: string,
  options?: RequestInit
): AbortablePromise<Response> {
  const controller = new AbortController();
  
  const promise = fetch(url, {
    ...options,
    signal: controller.signal
  }).catch(error => {
    if (error.name === 'AbortError') {
      throw new NetworkError('تم إلغاء الطلب', 'ABORTED', { url });
    }
    throw new NetworkError(
      `فشل الطلب: ${getErrorMessage(error)}`,
      'FETCH_ERROR',
      { url, originalError: error }
    );
  });
  
  return {
    promise,
    abort: () => controller.abort()
  };
}

// ═══════════════════════════════════════════════════════════════
// Batch Processing
// ═══════════════════════════════════════════════════════════════

export interface BatchOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  continueOnError?: boolean;
  onBatchComplete?: (batchIndex: number, results: unknown[]) => void;
}

/**
 * Process items in batches
 */
export async function processBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: BatchOptions = {}
): Promise<R[]> {
  const {
    batchSize = 10,
    delayBetweenBatches = 0,
    continueOnError = false,
    onBatchComplete
  } = options;
  
  const results: R[] = [];
  const errors: Array<{ item: T; error: unknown }> = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);
    
    const batchPromises = batch.map(async (item) => {
      try {
        return await processor(item);
      } catch (error) {
        if (continueOnError) {
          errors.push({ item, error });
          logError(error, `Batch processing item ${i}`);
          return null;
        }
        throw error;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter((r): r is Exclude<typeof r, null> => r !== null));
    
    if (onBatchComplete) {
      onBatchComplete(batchIndex, batchResults);
    }
    
    // Delay between batches
    if (delayBetweenBatches > 0 && i + batchSize < items.length) {
      await sleep(delayBetweenBatches);
    }
  }
  
  if (errors.length > 0 && !continueOnError) {
    throw new SyncError(
      `فشلت معالجة ${errors.length} عنصر من أصل ${items.length}`,
      'BATCH_ERROR',
      { errors }
    );
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════

export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  
  constructor(
    private maxConcurrent: number,
    private minInterval: number = 0
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for available slot
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    
    this.running++;
    
    try {
      const result = await fn();
      
      // Enforce minimum interval
      if (this.minInterval > 0) {
        await sleep(this.minInterval);
      }
      
      return result;
    } finally {
      this.running--;
      
      // Process next in queue
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Debounce and Throttle
// ═══════════════════════════════════════════════════════════════

/**
 * Debounce async function
 */
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingPromise: Promise<ReturnType<T>> | null = null;
  
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    if (!pendingPromise) {
      pendingPromise = new Promise((resolve, reject) => {
        timeoutId = setTimeout(async () => {
          try {
            const result = await fn(...args);
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            pendingPromise = null;
            timeoutId = null;
          }
        }, delayMs);
      });
    }
    
    return pendingPromise;
  };
}

/**
 * Throttle async function
 */
export function throttleAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  intervalMs: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let lastCall = 0;
  let pendingPromise: Promise<ReturnType<T>> | null = null;
  
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    
    if (timeSinceLastCall >= intervalMs) {
      lastCall = now;
      return fn(...args);
    }
    
    if (!pendingPromise) {
      const delay = intervalMs - timeSinceLastCall;
      pendingPromise = sleep(delay).then(async () => {
        lastCall = Date.now();
        try {
          return await fn(...args);
        } finally {
          pendingPromise = null;
        }
      });
    }
    
    return pendingPromise;
  };
}

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create promise that never resolves (useful for testing)
 */
export function never(): Promise<never> {
  return new Promise(() => {});
}

/**
 * Safe promise wrapper that catches and logs errors
 */
export async function safePromise<T>(
  promise: Promise<T>,
  defaultValue: T,
  context?: string
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    logError(error, context);
    return defaultValue;
  }
}

/**
 * Execute promises in sequence
 */
export async function sequence<T>(
  promises: Array<() => Promise<T>>
): Promise<T[]> {
  const results: T[] = [];
  
  for (const promiseFn of promises) {
    results.push(await promiseFn());
  }
  
  return results;
}

/**
 * Execute promises with limited concurrency
 */
export async function parallelLimit<T>(
  promises: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const limiter = new RateLimiter(limit);
  return Promise.all(promises.map(fn => limiter.execute(fn)));
}
