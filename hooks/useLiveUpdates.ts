import { useEffect, useRef } from 'react';

/**
 * Hook to listen for database real-time updates and refresh local data.
 * Listens for:
 * 1. internal `hader:sync-queue-change` (local mutations)
 * 2. global `hader:realtime-update` (Supabase mutations via hybridProvider)
 * 3. cross-tab `hader:sync:channel` (BroadcastChannel for multi-tab sync)
 *
 * Uses a ref to hold the latest callback so the effect only runs once
 * (mount/unmount), preventing constant listener teardown/re-registration
 * when callers pass inline arrow functions.
 *
 * @param refreshCallback Function to call when an update is detected to reload data
 */
export function useLiveUpdates(refreshCallback: () => void) {
    const callbackRef = useRef(refreshCallback);
    callbackRef.current = refreshCallback;

    useEffect(() => {
        // Shared handler with debounce to avoid rapid re-fetches
        let debounceTimer: ReturnType<typeof setTimeout>;
        const handleUpdate = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                callbackRef.current();
            }, 500); // 500ms debounce
        };

        // 1. Local Database Changes (from useQueue persistence/offline actions)
        window.addEventListener('hader:sync-queue-change', handleUpdate);

        // 2. Cloud Database Changes (from Supabase Realtime in HybridProvider)
        window.addEventListener('hader:realtime-update', handleUpdate);

        // 3. Cross-tab synchronization via BroadcastChannel
        let bc: BroadcastChannel | null = null;
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                bc = new BroadcastChannel('hader:sync:channel');
                bc.onmessage = (event) => {
                    if (event.data?.type === 'realtime-update') {
                        handleUpdate();
                    }
                };
            }
        } catch (err) {
            console.warn('BroadcastChannel not supported or failed to initialize', err);
        }

        // Cleanup
        return () => {
            clearTimeout(debounceTimer);
            window.removeEventListener('hader:sync-queue-change', handleUpdate);
            window.removeEventListener('hader:realtime-update', handleUpdate);
            if (bc) {
                bc.close();
            }
        };
    }, []); // Stable — callbackRef.current always points to the latest callback
}
