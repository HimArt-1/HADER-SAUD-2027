import { supabase, supabaseStatus } from './supabase';
import { logger } from './logger';

const LOCAL_LOCK_PREFIX = 'hader:distributed-lock:';
const LOCK_ACTION = 'distributed_lock';

function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function keyToDeterministicUuid(key: string): string {
  const p1 = fnv1a(`a:${key}`, 0x811c9dc5);
  const p2 = fnv1a(`b:${key}`, 0x9e3779b9);
  const p3 = fnv1a(`c:${key}`, 0x85ebca6b);
  const p4 = fnv1a(`d:${key}`, 0xc2b2ae35);
  const hex = `${toHex32(p1)}${toHex32(p2)}${toHex32(p3)}${toHex32(p4)}`;

  const versionNibble = '4';
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `${versionNibble}${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-');
}

function acquireLocalLock(key: string): boolean {
  try {
    const storageKey = `${LOCAL_LOCK_PREFIX}${key}`;
    const existing = localStorage.getItem(storageKey);
    if (existing === '1') return false;
    localStorage.setItem(storageKey, '1');
    return true;
  } catch {
    return true;
  }
}

function isDuplicateKeyError(error: any): boolean {
  const code = String(error?.code || '');
  const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
  const msg = `${error?.message || ''}${error?.details || ''}${error?.hint || ''}`.toLowerCase();
  return (
    code === '23505' ||
    status === 409 ||
    msg.includes('duplicate key') ||
    msg.includes('already exists') ||
    msg.includes('unique constraint')
  );
}

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('relation') && msg.includes('does not exist')
  );
}

export async function acquireDistributedLock(key: string): Promise<boolean> {
  const normalizedKey = key.trim();
  if (!normalizedKey) return false;

  if (!supabaseStatus.isConfigured || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return acquireLocalLock(normalizedKey);
  }

  const lockId = keyToDeterministicUuid(normalizedKey);
  const now = new Date().toISOString();

  // Fast path avoids a noisy 409 Conflict in DevTools when the lock row already
  // exists (same browser session re-entry, StrictMode double-mount, or another tab).
  const { data: existingRow, error: selectError } = await supabase
    .from('activity_logs')
    .select('id')
    .eq('id', lockId)
    .maybeSingle();

  if (!selectError && existingRow) {
    return false;
  }

  const { error } = await supabase.from('activity_logs').insert({
    id: lockId,
    action: LOCK_ACTION,
    target_id: normalizedKey,
    description: 'Distributed idempotency lock',
    metadata: { source: 'web-client', key: normalizedKey },
    created_at: now
  });

  if (!error) return true;
  if (isDuplicateKeyError(error)) return false;

  if (isMissingTableError(error)) {
    logger.warn('DistributedLock', 'activity_logs table missing; using local lock fallback');
    return acquireLocalLock(normalizedKey);
  }

  logger.warn('DistributedLock', 'Cloud lock acquisition failed; using local lock fallback', error);
  return acquireLocalLock(normalizedKey);
}
