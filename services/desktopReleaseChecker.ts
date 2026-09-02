/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Desktop Release Checker — Discover prebuilt native installers when available
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  When CI publishes signed .dmg / .exe / .AppImage installers and exposes a
 *  manifest at `VITE_DESKTOP_RELEASE_URL`, the sidebar "Download" buttons
 *  prefer those binaries over the lightweight PWA wrapper. The manifest is a
 *  small JSON file that we keep intentionally generic so it works equally
 *  well for GitHub Releases, S3, or a self-hosted CDN.
 *
 *  Manifest schema (all fields optional except `version`):
 *  ```jsonc
 *  {
 *    "version": "1.4.2",
 *    "releasedAt": "2026-04-30T10:00:00Z",
 *    "notesUrl": "https://github.com/.../releases/tag/v1.4.2",
 *    "minSupportedVersion": "1.0.0",
 *    "platforms": {
 *      "mac": {
 *        "url": "https://github.com/.../Hader-1.4.2-mac-universal.dmg",
 *        "size": 102400000,
 *        "sha256": "…",
 *        "arch": ["x64", "arm64"],
 *        "format": "dmg"
 *      },
 *      "windows": {
 *        "url": "https://github.com/.../Hader-1.4.2-Setup.exe",
 *        "size": 95000000,
 *        "sha256": "…",
 *        "arch": ["x64"],
 *        "format": "nsis"
 *      }
 *    }
 *  }
 *  ```
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { logger } from './logger';
import {
  APP_VERSION,
  DESKTOP_RELEASE_MANIFEST_URL,
} from './desktopBuildInfo';

export type Platform = 'mac' | 'windows';

export interface NativeReleaseAsset {
  url: string;
  size: number;
  sha256: string;
  arch?: string[];
  format: 'dmg' | 'nsis';
}

export interface NativeReleaseManifest {
  version: string;
  releasedAt?: string;
  notesUrl?: string;
  minSupportedVersion?: string;
  platforms: Partial<Record<Platform, NativeReleaseAsset>>;
}

export interface ReleaseLookupResult {
  available: boolean;
  manifest?: NativeReleaseManifest;
  /** Raw issue when manifest could not be loaded — never thrown. */
  reason?: 'not-configured' | 'fetch-failed' | 'invalid-shape' | 'no-platform-asset';
  /** Asset for the requested platform, when present. */
  asset?: NativeReleaseAsset;
  /** Whether the manifest's version is newer than the installed web version. */
  isUpgrade?: boolean;
}

const MANIFEST_TIMEOUT_MS = 6_000;
const MANIFEST_CACHE_KEY = 'hader:desktop-release-manifest';
const MANIFEST_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const OFFICIAL_GITHUB_RELEASE_PATH =
  /^\/HimArt-1\/HADER-SAUD-2027\/releases\/download\/[^/]+\/[^/]+$/;

interface CachedManifest {
  manifest: NativeReleaseManifest;
  fetchedAt: number;
}

function readCachedManifest(): CachedManifest | null {
  try {
    const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedManifest;
    if (!parsed?.manifest || !parsed.fetchedAt) return null;
    if (Date.now() - parsed.fetchedAt > MANIFEST_CACHE_TTL) return null;
    if (!isValidManifest(parsed.manifest)) {
      localStorage.removeItem(MANIFEST_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedManifest(manifest: NativeReleaseManifest): void {
  try {
    localStorage.setItem(
      MANIFEST_CACHE_KEY,
      JSON.stringify({ manifest, fetchedAt: Date.now() } satisfies CachedManifest)
    );
  } catch {
    // Storage may be full or disabled — non-fatal.
  }
}

const isTrustedInstallerOrigin = (assetUrl: URL, manifestUrl: URL): boolean => {
  if (assetUrl.origin === manifestUrl.origin) return true;

  return assetUrl.hostname === 'github.com'
    && assetUrl.port === ''
    && assetUrl.username === ''
    && assetUrl.password === ''
    && assetUrl.search === ''
    && assetUrl.hash === ''
    && OFFICIAL_GITHUB_RELEASE_PATH.test(assetUrl.pathname);
};

function isValidAsset(platform: Platform, value: unknown): value is NativeReleaseAsset {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Partial<NativeReleaseAsset>;
  if (typeof asset.url !== 'string') return false;

  try {
    const assetUrl = new URL(asset.url);
    const manifestUrl = new URL(DESKTOP_RELEASE_MANIFEST_URL);
    if (assetUrl.protocol !== 'https:' || !isTrustedInstallerOrigin(assetUrl, manifestUrl)) return false;
    const expectedExtension = platform === 'mac' ? '.dmg' : '.exe';
    if (!assetUrl.pathname.toLowerCase().endsWith(expectedExtension)) return false;
  } catch {
    return false;
  }

  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) return false;
  if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.sha256)) return false;
  if (asset.arch !== undefined && (!Array.isArray(asset.arch) || asset.arch.some(item => typeof item !== 'string'))) {
    return false;
  }
  const expectedFormat = platform === 'mac' ? 'dmg' : 'nsis';
  if (asset.format !== expectedFormat) return false;
  return true;
}

function isValidManifest(value: unknown): value is NativeReleaseManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<NativeReleaseManifest>;
  if (typeof m.version !== 'string' || m.version.length === 0) return false;
  if (!m.platforms || typeof m.platforms !== 'object') return false;
  for (const platform of ['mac', 'windows'] as const) {
    const asset = m.platforms[platform];
    if (asset !== undefined && !isValidAsset(platform, asset)) return false;
  }
  return true;
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

async function fetchManifest(): Promise<NativeReleaseManifest | null> {
  if (!DESKTOP_RELEASE_MANIFEST_URL) return null;

  const cached = readCachedManifest();
  if (cached) return cached.manifest;

  try {
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
      : null;

    const response = await fetch(DESKTOP_RELEASE_MANIFEST_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller?.signal,
      headers: { Accept: 'application/json' },
    });

    if (timeoutId) clearTimeout(timeoutId);
    if (!response.ok) {
      logger.warn('DesktopRelease', 'manifest fetch failed', { status: response.status });
      return null;
    }

    const json = (await response.json()) as unknown;
    if (!isValidManifest(json)) {
      logger.warn('DesktopRelease', 'manifest invalid shape');
      return null;
    }
    writeCachedManifest(json);
    return json;
  } catch (err) {
    logger.warn('DesktopRelease', 'manifest fetch error', err);
    return null;
  }
}

/**
 * Discover the native release for the requested platform. Always resolves —
 * a missing manifest or a missing platform asset is reported as `available:
 * false` rather than thrown.
 */
export async function lookupNativeRelease(platform: Platform): Promise<ReleaseLookupResult> {
  if (!DESKTOP_RELEASE_MANIFEST_URL) {
    return { available: false, reason: 'not-configured' };
  }

  const manifest = await fetchManifest();
  if (!manifest) return { available: false, reason: 'fetch-failed' };

  const asset = manifest.platforms?.[platform];
  if (!asset || !asset.url) {
    return { available: false, manifest, reason: 'no-platform-asset' };
  }

  const isUpgrade = compareSemver(manifest.version, APP_VERSION) > 0;
  return { available: true, manifest, asset, isUpgrade };
}

/** Trigger a download for the asset URL using a normal anchor click. */
export function startNativeReleaseDownload(asset: NativeReleaseAsset): void {
  const link = document.createElement('a');
  link.href = asset.url;
  link.rel = 'noopener';
  link.target = '_self';
  // Hint the browser to download instead of navigating
  const filename = decodeURIComponent(asset.url.split('/').pop() || 'Hader-Setup');
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function clearReleaseManifestCache(): void {
  try {
    localStorage.removeItem(MANIFEST_CACHE_KEY);
  } catch {
    // ignore
  }
}
