// =============================================================================
// نظام حاضر (Hader) - Settings Broadcast Service
// =============================================================================
// Cross-tab communication for settings updates using BroadcastChannel API

import { SystemSettings } from '../types';
import { supabase, supabaseStatus } from './supabase';

const SETTINGS_CHANNEL_NAME = 'hader:settings:channel';

// Listeners for settings updates
type SettingsListener = (settings: SystemSettings) => void;

type SettingsBroadcastState = {
    listeners: Set<SettingsListener>;
    channel: BroadcastChannel | null;
    realtimeChannel: any;
    broadcastInitialized: boolean;
    realtimeInitialized: boolean;
    realtimeActive: boolean;
};

declare global {
    interface Window {
        __haderSettingsBroadcastState?: SettingsBroadcastState;
    }
}

const createState = (): SettingsBroadcastState => ({
    listeners: new Set(),
    channel: null,
    realtimeChannel: null,
    broadcastInitialized: false,
    realtimeInitialized: false,
    realtimeActive: false
});

const state: SettingsBroadcastState = typeof window !== 'undefined'
    ? (window.__haderSettingsBroadcastState ??= createState())
    : createState();

const listeners = state.listeners;

const debugLog = (...args: unknown[]) => {
    try {
        if (import.meta.env.DEV && localStorage.getItem('hader:debug') === 'true') {
            console.log(...args);
        }
    } catch {
        // Debug logging is optional.
    }
};

function notifyListeners(settings: SystemSettings, source: 'tab' | 'realtime') {
    listeners.forEach(listener => {
        try {
            listener(settings);
        } catch (e) {
            console.error(
                source === 'tab'
                    ? '[SettingsBroadcast] Listener error:'
                    : '[SettingsBroadcast] Realtime listener error:',
                e
            );
        }
    });
}

// Initialize the broadcast channel
if (typeof window !== 'undefined' && 'BroadcastChannel' in window && !state.broadcastInitialized) {
    state.broadcastInitialized = true;
    try {
        state.channel = new BroadcastChannel(SETTINGS_CHANNEL_NAME);
        state.channel.onmessage = (event) => {
            if (event.data?.type === 'settings-updated' && event.data?.settings) {
                debugLog('[SettingsBroadcast] Received settings update from another tab');
                notifyListeners(event.data.settings, 'tab');
            }
        };
        debugLog('[SettingsBroadcast] Cross-tab broadcast channel initialized');
    } catch (e) {
        state.broadcastInitialized = false;
        console.warn('[SettingsBroadcast] BroadcastChannel not available:', e);
    }
}

// Initialize Supabase Realtime for cross-device sync
if (typeof window !== 'undefined' && supabaseStatus.isConfigured && !state.realtimeInitialized) {
    state.realtimeInitialized = true;
    try {
        state.realtimeChannel = supabase.channel('settings-cross-device')
            .on('postgres_changes', { 
                event: 'UPDATE', 
                schema: 'public', 
                table: 'settings' 
            }, (payload: any) => {
                if (payload.new) {
                    debugLog('[SettingsBroadcast] Received cross-device settings update');
                    const updatedSettings = payload.new as SystemSettings;
                    notifyListeners(updatedSettings, 'realtime');
                    
                    // Also dispatch local event for other tabs on THIS device if needed
                    // (Though they might have their own realtime connection, 
                    // this ensures sync if one tab's realtime is faster)
                    window.dispatchEvent(new CustomEvent('hader:settings-updated', { detail: updatedSettings }));
                }
            })
            .subscribe((status: string) => {
                if (status === 'SUBSCRIBED') {
                    if (!state.realtimeActive) {
                        debugLog('[SettingsBroadcast] Cross-device realtime channel active');
                    }
                    state.realtimeActive = true;
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    state.realtimeActive = false;
                }
            });
    } catch (e) {
        state.realtimeInitialized = false;
        console.error('[SettingsBroadcast] Failed to init Supabase realtime:', e);
    }
}

/**
 * Broadcast settings update to other browser tabs
 * @param settings The updated settings object
 */
export function broadcastSettingsUpdate(settings: SystemSettings): void {
    if (state.channel) {
        try {
            state.channel.postMessage({ type: 'settings-updated', settings });
            debugLog('[SettingsBroadcast] Settings update broadcasted to other tabs');
        } catch (e) {
            console.warn('[SettingsBroadcast] Failed to broadcast:', e);
        }
    }

    // Also dispatch local event for same-tab listeners
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hader:settings-updated', { detail: settings }));
    }
}

/**
 * Subscribe to settings updates from other tabs
 * @param callback Function to call when settings are updated
 * @returns Unsubscribe function
 */
export function subscribeToSettingsUpdates(callback: SettingsListener): () => void {
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}

/**
 * Check if cross-tab broadcasting is available
 */
export function isBroadcastAvailable(): boolean {
    return state.channel !== null;
}
