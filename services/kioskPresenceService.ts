import { supabase, supabaseStatus } from './supabase';
import { logger } from './logger';

export interface KioskStatus {
    kioskId: string;
    kioskName: string;
    status: 'online' | 'offline' | 'emergency';
    lastSeen: number;
    batteryLevel?: number;
    cameraReady: boolean;
    syncPending: number;
}

class KioskPresenceService {
    private channel: any = null;
    private heartbeatInterval: any = null;
    private currentStatus: Partial<KioskStatus> = {};
    private listeners: Set<(kiosks: KioskStatus[]) => void> = new Set();
    private kiosks: Map<string, KioskStatus> = new Map();

    private readonly PRESENCE_TIMEOUT = 15000; // 15 seconds

    /**
     * Start broadcasting presence as a Kiosk
     */
    startBroadcasting(kioskId: string, kioskName: string, getStatus: () => Partial<KioskStatus>) {
        if (!supabaseStatus.isConfigured) {
            logger.warn('KioskPresence', 'Supabase not configured, presence disabled');
            return;
        }

        this.currentStatus = { kioskId, kioskName };
        
        if (!this.channel) {
            this.channel = supabase.channel('kiosk_presence');
            
            this.channel.subscribe((status: string) => {
                if (status === 'SUBSCRIBED') {
                    logger.debug('KioskPresence', 'Started broadcasting heartbeat');
                    this.sendHeartbeat(getStatus);
                }
            });
        }

        // Send heartbeat every 5 seconds
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat(getStatus);
        }, 5000);
    }

    private sendHeartbeat(getStatus: () => Partial<KioskStatus>) {
        if (!this.channel) return;
        
        const status = getStatus();
        this.channel.send({
            type: 'broadcast',
            event: 'heartbeat',
            payload: {
                ...this.currentStatus,
                ...status,
                lastSeen: Date.now()
            }
        }).catch((e: any) => logger.warn('KioskPresence', 'Failed to send heartbeat', e));
    }

    /**
     * Stop broadcasting presence
     */
    stopBroadcasting() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.channel) {
            supabase.removeChannel(this.channel);
            this.channel = null;
        }
    }

    /**
     * Listen for kiosk presences (For Supervision Dashboard)
     */
    listenForPresence(callback: (kiosks: KioskStatus[]) => void) {
        if (!supabaseStatus.isConfigured) return () => {};

        this.listeners.add(callback);

        if (!this.channel) {
            this.channel = supabase.channel('kiosk_presence');
            
            this.channel.on('broadcast', { event: 'heartbeat' }, (payload: { payload: KioskStatus }) => {
                this.kiosks.set(payload.payload.kioskId, payload.payload);
                this.cleanupStaleKiosks();
                this.notifyListeners();
            });

            this.channel.subscribe();
        }

        // Check for stale kiosks periodically
        const cleanupInterval = setInterval(() => {
            if (this.cleanupStaleKiosks()) {
                this.notifyListeners();
            }
        }, 5000);

        return () => {
            this.listeners.delete(callback);
            clearInterval(cleanupInterval);
            if (this.listeners.size === 0 && this.channel) {
                supabase.removeChannel(this.channel);
                this.channel = null;
            }
        };
    }

    private cleanupStaleKiosks(): boolean {
        const now = Date.now();
        let changed = false;

        for (const [id, kiosk] of this.kiosks.entries()) {
            if (now - kiosk.lastSeen > this.PRESENCE_TIMEOUT) {
                kiosk.status = 'offline';
                changed = true;
            }
        }

        return changed;
    }

    private notifyListeners() {
        const kiosksArray = Array.from(this.kiosks.values());
        this.listeners.forEach(listener => listener(kiosksArray));
    }
}

export const kioskPresenceService = new KioskPresenceService();
