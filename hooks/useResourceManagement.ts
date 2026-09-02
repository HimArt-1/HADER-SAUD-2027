/**
 * ═══════════════════════════════════════════════════════════════
 * 🪝 Custom Hooks - Resource Management & Cleanup
 * ═══════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useCallback, DependencyList } from 'react';
import { AbortablePromise } from '../utils/async';

// ═══════════════════════════════════════════════════════════════
// useCleanup - Automatic Resource Cleanup
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to manage cleanup functions that should run on unmount
 */
export function useCleanup() {
  const cleanupFns = useRef<Array<() => void>>([]);
  
  const addCleanup = useCallback((fn: () => void) => {
    cleanupFns.current.push(fn);
  }, []);
  
  const runCleanup = useCallback(() => {
    cleanupFns.current.forEach(fn => {
      try {
        fn();
      } catch (error) {
        console.warn('[useCleanup] Cleanup function failed:', error);
      }
    });
    cleanupFns.current = [];
  }, []);
  
  useEffect(() => {
    return runCleanup;
  }, [runCleanup]);
  
  return { addCleanup, runCleanup };
}

// ═══════════════════════════════════════════════════════════════
// useAbortable - Abortable Promises
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to manage abortable promises with automatic cleanup
 */
export function useAbortable() {
  const abortControllers = useRef<AbortController[]>([]);
  
  const createAbortSignal = useCallback((): AbortSignal => {
    const controller = new AbortController();
    abortControllers.current.push(controller);
    return controller.signal;
  }, []);
  
  const abortAll = useCallback(() => {
    abortControllers.current.forEach(controller => {
      try {
        controller.abort();
      } catch (error) {
        console.warn('[useAbortable] Failed to abort controller:', error);
      }
    });
    abortControllers.current = [];
  }, []);
  
  useEffect(() => {
    return abortAll;
  }, [abortAll]);
  
  return { createAbortSignal, abortAll };
}

// ═══════════════════════════════════════════════════════════════
// useEventListener - Event Listener with Cleanup
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to add event listeners with automatic cleanup
 */
export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  element: Window | HTMLElement | null = window,
  options?: boolean | AddEventListenerOptions
) {
  const savedHandler = useRef(handler);
  
  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);
  
  useEffect(() => {
    if (!element || !element.addEventListener) {
      return;
    }
    
    const eventListener = (event: Event) => savedHandler.current(event as WindowEventMap[K]);
    
    element.addEventListener(eventName, eventListener, options);
    
    return () => {
      element.removeEventListener(eventName, eventListener, options);
    };
  }, [eventName, element, options]);
}

// ═══════════════════════════════════════════════════════════════
// useInterval - Interval with Cleanup
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to create intervals with automatic cleanup
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);
  
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);
  
  useEffect(() => {
    if (delay === null) {
      return;
    }
    
    const id = setInterval(() => savedCallback.current(), delay);
    
    return () => clearInterval(id);
  }, [delay]);
}

// ═══════════════════════════════════════════════════════════════
// useTimeout - Timeout with Cleanup
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to create timeouts with automatic cleanup
 */
export function useTimeout(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);
  
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);
  
  useEffect(() => {
    if (delay === null) {
      return;
    }
    
    const id = setTimeout(() => savedCallback.current(), delay);
    
    return () => clearTimeout(id);
  }, [delay]);
}

// ═══════════════════════════════════════════════════════════════
// useSafeAsync - Safe Async Operations
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to safely execute async operations with automatic cancellation
 */
export function useSafeAsync() {
  const isMounted = useRef(true);
  const abortControllers = useRef<AbortController[]>([]);
  
  useEffect(() => {
    isMounted.current = true;
    
    return () => {
      isMounted.current = false;
      abortControllers.current.forEach(controller => {
        try {
          controller.abort();
        } catch (error) {
          console.warn('[useSafeAsync] Failed to abort controller:', error);
        }
      });
      abortControllers.current = [];
    };
  }, []);
  
  const safeAsync = useCallback(async <T>(
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T | null> => {
    const controller = new AbortController();
    abortControllers.current.push(controller);
    
    try {
      const result = await fn(controller.signal);
      
      if (!isMounted.current) {
        return null;
      }
      
      return result;
    } catch (error) {
      if (!isMounted.current) {
        return null;
      }
      throw error;
    } finally {
      const index = abortControllers.current.indexOf(controller);
      if (index > -1) {
        abortControllers.current.splice(index, 1);
      }
    }
  }, []);
  
  return safeAsync;
}

// ═══════════════════════════════════════════════════════════════
// useDebounce - Debounced Value
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to debounce a value
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  
  return debouncedValue;
}

// ═══════════════════════════════════════════════════════════════
// useThrottle - Throttled Value
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to throttle a value
 */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = React.useState(value);
  const lastUpdated = useRef<number>(0);
  
  useEffect(() => {
    const now = Date.now();
    
    if (now - lastUpdated.current >= interval) {
      lastUpdated.current = now;
      setThrottledValue(value);
    } else {
      const id = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottledValue(value);
      }, interval - (now - lastUpdated.current));
      
      return () => clearTimeout(id);
    }
  }, [value, interval]);
  
  return throttledValue;
}

// ═══════════════════════════════════════════════════════════════
// usePrevious - Previous Value
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to get previous value
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  
  useEffect(() => {
    ref.current = value;
  }, [value]);
  
  return ref.current;
}

// ═══════════════════════════════════════════════════════════════
// useMountedState - Check if Component is Mounted
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to check if component is still mounted
 */
export function useMountedState(): () => boolean {
  const mountedRef = useRef(false);
  const isMounted = useCallback(() => mountedRef.current, []);
  
  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
    };
  }, []);
  
  return isMounted;
}

// ═══════════════════════════════════════════════════════════════
// useUnmount - Run Callback on Unmount
// ═══════════════════════════════════════════════════════════════

/**
 * Hook to run callback on unmount
 */
export function useUnmount(fn: () => void) {
  const fnRef = useRef(fn);
  
  fnRef.current = fn;
  
  useEffect(() => {
    return () => {
      fnRef.current();
    };
  }, []);
}

// Fix: Import React at the top
import React from 'react';
