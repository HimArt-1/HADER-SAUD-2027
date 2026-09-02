import { useEffect, useRef } from 'react';
import type { WhatsAppQueueUpdate, WhatsAppStatus } from '../modules/whatsapp';
import { whatsappGateway } from '../services/whatsappGateway';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type WhatsAppSSEStatus = WhatsAppStatus;
export type WhatsAppSSEQueueUpdate = WhatsAppQueueUpdate;

export interface UseWhatsAppSSEOptions {
    /** Fired on every 'status' event push from the server */
    onStatus?: (status: WhatsAppSSEStatus) => void;
    /** Fired on every 'queue_update' event push from the server */
    onQueueUpdate?: (update: WhatsAppSSEQueueUpdate) => void;
    /** Fired when the authenticated event stream opens (or re-opens after retry) */
    onOpen?: () => void;
    /** Fired when the event stream fails and a retry is scheduled */
    onError?: () => void;
    /** Set to false to disable the hook entirely (useful for conditional use) */
    enabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useWhatsAppSSE(options: UseWhatsAppSSEOptions = {}) {
    // Keep latest handlers without reopening the authenticated stream.
    const optsRef = useRef(options);
    optsRef.current = options;

    useEffect(() => {
        if (options.enabled === false) return;
        return whatsappGateway.subscribe({
            onOpen: () => optsRef.current.onOpen?.(),
            onStatus: status => optsRef.current.onStatus?.(status),
            onQueueUpdate: update => optsRef.current.onQueueUpdate?.(update),
            onError: () => optsRef.current.onError?.()
        });
    }, [options.enabled]);
}
