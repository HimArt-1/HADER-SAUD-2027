// =============================================================================
// Remote `settings` row primary key (INTEGER id=1 vs UUID) — detect & cache
// =============================================================================

import { supabase } from './supabase';
import { logger } from './logger';

const LS_KEY = 'hader:settings_remote_pk';

let memoryPk: string | number | null | undefined;

export function getCachedRemoteSettingsPk(): string | number | null {
    if (memoryPk !== undefined) return memoryPk ?? null;
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw == null) return null;
        memoryPk = JSON.parse(raw) as string | number;
        return memoryPk ?? null;
    } catch {
        return null;
    }
}

/** Call when a full settings row is loaded from Supabase (pull / getSettings). */
export function rememberRemoteSettingsPk(id: string | number | null | undefined): void {
    if (id === undefined || id === null) return;
    memoryPk = id;
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(id));
    } catch {
        /* ignore */
    }
}

export function forgetRemoteSettingsPk(): void {
    memoryPk = undefined;
    try {
        localStorage.removeItem(LS_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Read actual PK from DB (no `id` filter — avoids 400 when column is int vs uuid).
 */
export async function fetchRemoteSettingsPrimaryKey(): Promise<string | number | null> {
    const { data, error } = await supabase.from('settings').select('id').limit(1).maybeSingle();
    if (!error && data && data.id != null) {
        rememberRemoteSettingsPk(data.id as string | number);
        return data.id as string | number;
    }
    return getCachedRemoteSettingsPk();
}

/** Value to use on UPSERT: existing row id, else nil UUID for new uuid-typed tables. */
export async function resolveSettingsUpsertId(): Promise<string | number> {
    const pk = await fetchRemoteSettingsPrimaryKey();
    if (pk != null) return pk;
    return '00000000-0000-0000-0000-000000000000';
}

function omitUndefinedDeep(value: unknown): unknown {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return (value.map(omitUndefinedDeep) as unknown[]).filter((v) => v !== undefined);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        const next = omitUndefinedDeep(v);
        if (next !== undefined) out[k] = next;
    }
    return out;
}

/**
 * Writes settings row: UPDATE when a row already exists (avoids PostgREST UPSERT 500s on some DBs),
 * else INSERT / upsert fallback for first row.
 */
export async function applySettingsRowToCloud(
    row: Record<string, unknown>
): Promise<{ error: { message: string; code?: string; details?: string; hint?: string } | null }> {
    const sanitized = omitUndefinedDeep(row) as Record<string, unknown>;

    let pk =
        getCachedRemoteSettingsPk() ??
        (await fetchRemoteSettingsPrimaryKey());

    if (pk != null) {
        const { id: _id, ...rest } = sanitized;
        const { error } = await supabase.from('settings').update(rest).eq('id', pk);
        if (error) {
            logger.warn('Settings', `UPDATE failed: ${error.message}`, error);
            return { error };
        }
        return { error: null };
    }

    const insertId = sanitized.id ?? '00000000-0000-0000-0000-000000000000';
    const insertPayload = { ...sanitized, id: insertId };

    const { error: insErr } = await supabase.from('settings').insert(insertPayload);
    if (!insErr) {
        rememberRemoteSettingsPk(insertId as string | number);
        return { error: null };
    }
    logger.warn('Settings', `INSERT failed (${insErr.message}), trying upsert`, insErr);

    const { error: upErr } = await supabase
        .from('settings')
        .upsert(insertPayload, { onConflict: 'id' });
    if (!upErr) {
        rememberRemoteSettingsPk(insertId as string | number);
    } else {
        logger.warn('Settings', `UPSERT failed: ${upErr.message}`, upErr);
    }
    return { error: upErr ?? null };
}
