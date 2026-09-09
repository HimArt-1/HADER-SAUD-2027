// =============================================================================
// نظام حاضر (Hader) - Time Synchronization Service
// =============================================================================
// Responsible for acquiring authoritative server time to prevent clock skew/tampering vulnerabilities.
// Browser: only Supabase PostgREST `Date` header (CORS-safe). Public time APIs are not used — they
// typically block cross-origin browser fetches (no ACAO), which spams the console with CORS errors.

import { logger } from './logger';
import { supabaseCredentials } from './supabase';

let timeOffset = 0; // The delta in milliseconds between local clock and server clock
let isTimeSynced = false;

function applyOffsetFromHttpDate(dateHeader: string | null, start: number, end: number): boolean {
    if (!dateHeader) return false;
    const serverTime = new Date(dateHeader).getTime();
    if (Number.isNaN(serverTime)) return false;
    const latency = (end - start) / 2;
    const localTime = start + latency;
    timeOffset = serverTime - localTime;
    isTimeSynced = true;
    logger.debug('TimeSync', `Synchronized. Offset: ${timeOffset}ms | Local was ${timeOffset > 0 ? 'behind' : 'ahead'}`);
    return true;
}

/**
 * Probe endpoint for the server clock.
 *
 * Must be a real table route, NOT the PostgREST root (`/rest/v1/`): the root is the
 * schema-introspection endpoint, which answers 401 to the `anon` key and — because it
 * sends no `Access-Control-Expose-Headers` — hides its `Date` header from browser JS.
 * A table route answers 200 and explicitly exposes `Date`, so the offset is readable.
 * `limit=0` returns an empty array, so no row data crosses the wire.
 */
const TIME_PROBE_PATH = '/rest/v1/students?select=id&limit=0';

/** PostgREST returns a reliable `Date` header; CORS exposes it on table routes. */
async function trySyncFromSupabase(): Promise<boolean> {
    const { url: supabaseUrl, anonKey: supabaseKey } = supabaseCredentials;
    if (!supabaseUrl || !supabaseKey) {
        logger.warn('TimeSync', 'Supabase is not configured — falling back to the device clock.');
        return false;
    }
    try {
        const start = Date.now();
        const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}${TIME_PROBE_PATH}`, {
            method: 'GET',
            headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
            },
            cache: 'no-store',
            signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
        });
        const end = Date.now();
        if (!response.ok) {
            logger.warn('TimeSync', `Clock probe rejected (HTTP ${response.status}) — falling back to the device clock.`);
            return false;
        }
        const applied = applyOffsetFromHttpDate(response.headers.get('date'), start, end);
        if (!applied) {
            logger.warn('TimeSync', 'Server sent no readable Date header — falling back to the device clock.');
        }
        return applied;
    } catch (error) {
        logger.warn('TimeSync', `Clock probe failed (${error instanceof Error ? error.message : 'network error'}) — falling back to the device clock.`);
        return false;
    }
}

/**
 * Initializes time sync using Supabase project time only; falls back to local clock (no third-party fetch in browser).
 */
export const initializeTimeSync = async (): Promise<void> => {
    if (isTimeSynced) return;

    if (await trySyncFromSupabase()) {
        return;
    }

    timeOffset = 0;
    isTimeSynced = false;
    logger.debug(
        'TimeSync',
        'Using local device clock (Supabase Date header unavailable — e.g. offline or timeout).'
    );
};

/**
 * Gets the current synchronized time in milliseconds.
 */
export const getSyncedNow = (): number => {
    return Date.now() + timeOffset;
};

/**
 * Gets the current synchronized Date object.
 */
export const getSyncedDate = (): Date => {
    return new Date(getSyncedNow());
};

/**
 * Gets the strictly uniform ISO Date string (YYYY-MM-DD) synced with reality.
 * Automatically aligns with the local timezone bounds but rooted in actual synchronized time.
 */
export const getSyncedISODate = (): string => {
    const now = getSyncedDate();
    const tzOffsetMs = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffsetMs).toISOString().split('T')[0];
};

/**
 * Gets the current synchronized ISO String representing exactly right now.
 */
export const getSyncedISOString = (): string => {
    return getSyncedDate().toISOString();
};

/**
 * Re-trigger sync in the background. Useful if device wakes up from deep sleep.
 */
export const resyncBackgroundTime = (): void => {
    isTimeSynced = false;
    initializeTimeSync().catch(() => {});
};
