import { useEffect, useRef } from 'react';
import { syncService } from '../services/syncService';

/**
 * Unified post-sync refresh trigger.
 * Runs callback when sync completes with simple cooldown to reduce request storms.
 */
export function useSyncRefresh(callback: () => void, cooldownMs = 2000) {
  const callbackRef = useRef(callback);
  const lastRunRef = useRef(0);

  callbackRef.current = callback;

  useEffect(() => {
    const unsubscribe = syncService.on((event) => {
      if (event.type !== 'sync:completed') return;

      const now = Date.now();
      if (now - lastRunRef.current < cooldownMs) return;
      lastRunRef.current = now;

      callbackRef.current();
    });

    return unsubscribe;
  }, [cooldownMs]);
}
