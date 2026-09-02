/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Desktop Auto-Update Detection — works for the lightweight launcher too
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Even though the App-Mode wrapper always loads the live deployment, we
 *  still want to surface a friendly "newer launcher available" hint when
 *  the desktop bundle the user installed is older than what the server is
 *  currently producing. This keeps the desktop experience feeling fresh
 *  without breaking the synchronized model.
 *
 *  Source of truth: `${appUrl}/desktop/version.json` (or the existing
 *  manifest at `VITE_DESKTOP_RELEASE_URL` when configured).
 *
 *  Usage example (inside Layout.tsx or any other React component):
 *    const status = await checkDesktopAutoUpdate();
 *    if (status.hasUpdate) showToast(`نسخة سطح مكتب جديدة: ${status.latestVersion}`);
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { logger } from './logger';
import {
  APP_URL,
  APP_VERSION,
  DESKTOP_RELEASE_MANIFEST_URL,
} from './desktopBuildInfo';

export interface DesktopUpdateStatus {
  hasUpdate: boolean;
  latestVersion?: string;
  latestBuildId?: string;
  notesUrl?: string;
  manifestUrl?: string;
  reason?: 'no-source' | 'fetch-failed' | 'invalid' | 'up-to-date';
}

const CACHE_KEY = 'hader:desktop-update-check';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT = 5_000;

interface CacheEntry {
  fetchedAt: number;
  status: DesktopUpdateStatus;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.status || !parsed.fetchedAt) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(status: DesktopUpdateStatus): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), status } satisfies CacheEntry));
  } catch {
    /* storage full / disabled */
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT) : null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller?.signal,
      headers: { Accept: 'application/json' },
    });
    if (timeoutId) clearTimeout(timeoutId);
    return res;
  } catch {
    return null;
  }
}

function pickFirstSourceUrl(): string | null {
  if (DESKTOP_RELEASE_MANIFEST_URL) return DESKTOP_RELEASE_MANIFEST_URL;
  if (!APP_URL || !/^https?:\/\//i.test(APP_URL)) return null;
  return new URL('/desktop/version.json', APP_URL).toString();
}

/**
 * Check whether the live deployment is publishing a newer desktop launcher.
 * Result is cached for {@link CACHE_TTL_MS} to avoid hammering the server
 * on every page navigation.
 */
export async function checkDesktopAutoUpdate(force = false): Promise<DesktopUpdateStatus> {
  if (!force) {
    const cached = readCache();
    if (cached) return cached.status;
  }

  const manifestUrl = pickFirstSourceUrl();
  if (!manifestUrl) {
    const status: DesktopUpdateStatus = { hasUpdate: false, reason: 'no-source' };
    writeCache(status);
    return status;
  }

  const res = await fetchWithTimeout(manifestUrl);
  if (!res || !res.ok) {
    logger.warn('DesktopAutoUpdate', 'manifest fetch failed', { url: manifestUrl });
    const status: DesktopUpdateStatus = {
      hasUpdate: false,
      manifestUrl,
      reason: 'fetch-failed',
    };
    writeCache(status);
    return status;
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* fall through */
  }

  if (!json || typeof json.version !== 'string') {
    const status: DesktopUpdateStatus = {
      hasUpdate: false,
      manifestUrl,
      reason: 'invalid',
    };
    writeCache(status);
    return status;
  }

  const latest = json.version as string;
  const isNewer = compareSemver(latest, APP_VERSION) > 0;
  const status: DesktopUpdateStatus = {
    hasUpdate: isNewer,
    latestVersion: latest,
    latestBuildId: typeof json.buildId === 'string' ? json.buildId : undefined,
    notesUrl: typeof json.notesUrl === 'string' ? json.notesUrl : undefined,
    manifestUrl,
    reason: isNewer ? undefined : 'up-to-date',
  };
  writeCache(status);
  return status;
}

export function clearDesktopAutoUpdateCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
