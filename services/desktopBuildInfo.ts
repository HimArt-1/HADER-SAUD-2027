/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Desktop Build Info — Stable, deterministic build fingerprint for desktop bundles
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  This module provides a single source of truth for what each desktop
 *  download contains: the host URL it will connect to, the application
 *  version, the build timestamp, a stable hash that identifies the binary
 *  bundle, and the connectivity profile.
 *
 *  The fingerprint allows the launcher (and the diagnostics page) to
 *  reliably detect drift between desktop installs and the live web app.
 *  When the live app advances to a newer version the desktop launcher can
 *  show an "update available" hint without forcing a full reinstall — the
 *  Chrome/Edge App-Mode wrappers will already be auto-updated by the
 *  browser pipeline.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Stable application version. Vite injects the value at build time via the
 * `define` block in `vite.config.ts` (`__APP_VERSION__`). When TypeScript is
 * unable to read that constant (e.g. during unit tests or initial type
 * checking), we fall back to a sensible default.
 */
declare const __APP_VERSION__: string | undefined;

const FALLBACK_APP_VERSION = '1.0.0';

export const APP_VERSION: string =
  (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) ||
  (import.meta.env?.VITE_APP_VERSION as string | undefined) ||
  FALLBACK_APP_VERSION;

function normalizeHttpOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const configuredAppUrl = normalizeHttpOrigin(import.meta.env.VITE_APP_URL as string | undefined);
const hasBrowserWindow = typeof window !== 'undefined';
const runtimeAppUrl = normalizeHttpOrigin(
  hasBrowserWindow ? window.location?.origin : undefined
);

/** The URL the desktop launcher will open. `VITE_APP_URL` wins over localhost/dev origins. */
export const APP_URL: string = configuredAppUrl || runtimeAppUrl || (hasBrowserWindow ? '' : 'https://hader.sa');

/** Optional deep-link path appended after origin (kept blank by default). */
export const APP_LAUNCH_PATH = '/';

/**
 * Optional pre-built Electron release endpoint.
 * If your CI publishes `.dmg` and `.exe` artifacts, point this to a JSON
 * endpoint that follows the schema in `desktopReleaseChecker.ts`.
 */
export const DESKTOP_RELEASE_MANIFEST_URL: string =
  (import.meta.env.VITE_DESKTOP_RELEASE_URL as string | undefined) || '';

/** FNV-1a 32-bit hash, deterministic across browsers. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Generate a deterministic build identifier per (URL × version × build-day).
 * The build day acts as a coarse cache buster so re-downloads on the same
 * day reuse the same identifier, while a different day produces a fresh ID.
 */
export function getBuildId(): string {
  const buildDay = new Date().toISOString().slice(0, 10);
  return fnv1a(`${APP_URL}|${APP_VERSION}|${buildDay}`);
}

/** Fingerprint exposed in `version.json` and inside the Diagnostics page. */
export interface DesktopBuildFingerprint {
  appName: string;
  productName: string;
  version: string;
  appUrl: string;
  launchPath: string;
  buildId: string;
  buildTime: string;
  generatedFromUserAgent: string;
  features: string[];
  channel: 'lightweight' | 'native';
}

export function createBuildFingerprint(
  channel: DesktopBuildFingerprint['channel'] = 'lightweight'
): DesktopBuildFingerprint {
  return {
    appName: 'hader-system',
    productName: 'نظام حاضر',
    version: APP_VERSION,
    appUrl: APP_URL,
    launchPath: APP_LAUNCH_PATH,
    buildId: getBuildId(),
    buildTime: new Date().toISOString(),
    generatedFromUserAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    features: ['offline-pwa', 'auto-update', 'sync-supabase', 'native-shortcut'],
    channel,
  };
}

/**
 * Compact ASCII line shown inside generated launcher scripts.
 * Used by support engineers to quickly identify which build a user is running.
 */
export function getBuildBanner(channel: DesktopBuildFingerprint['channel'] = 'lightweight'): string {
  return `Hader ${APP_VERSION} • build ${getBuildId()} • ${channel} • ${APP_URL}`;
}
