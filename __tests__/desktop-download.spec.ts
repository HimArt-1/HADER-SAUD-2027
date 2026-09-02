/**
 * Desktop download bundle tests
 *
 * Validates the lightweight launcher bundle that the sidebar's "Download
 * desktop app" buttons produce. Verifies:
 *   • The bundle does not embed any Supabase or other secret credential.
 *   • The macOS payload is a real `.app` bundle (Info.plist + executable
 *     + Resources/icon.icns).
 *   • The Windows payload uses a silent VBScript wrapper plus a one-click
 *     shortcut installer.
 *   • The version manifest carries a stable build fingerprint and the
 *     embedded-icon flag.
 *   • The native release fallback gracefully reports "not available" when
 *     no manifest URL is configured.
 *   • The desktop auto-update probe handles missing/older/newer manifests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const ORIGIN = 'https://hader.example.com';

function pinOrigin(origin = ORIGIN): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin, href: `${origin}/`, hostname: new URL(origin).hostname },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Desktop download — lightweight bundle', () => {
  beforeEach(() => {
    pinOrigin();
    localStorage.clear();
  });

  it('produces a launcher target rooted at the live origin', async () => {
    const { hasValidLauncherTarget, getLauncherTargetInfo, getMaskedCredentials } = await import('../services/downloadService');
    expect(hasValidLauncherTarget()).toBe(true);
    expect(getLauncherTargetInfo()).toMatchObject({
      appUrl: ORIGIN,
      launchUrl: `${ORIGIN}/`,
      valid: true,
      isLocal: false,
      isSecureContext: true,
    });
    expect(getMaskedCredentials().url).toContain('hader.example.com');
    expect(getMaskedCredentials().key).toMatch(/^build:[0-9a-f]{8}$/);
  });

  it('prefers VITE_APP_URL over the current browser origin for desktop bundles', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_APP_URL', 'https://production.hader.example/school');
    pinOrigin('http://127.0.0.1:5173');

    const { APP_URL } = await import('../services/desktopBuildInfo');
    const { getLauncherTargetInfo } = await import('../services/downloadService');

    expect(APP_URL).toBe('https://production.hader.example');
    expect(getLauncherTargetInfo()).toMatchObject({
      appUrl: 'https://production.hader.example',
      isLocal: false,
      isSecureContext: true,
    });
    vi.unstubAllEnvs();
  });

  it('rejects launcher targets that are not http(s)', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'about:blank', href: 'about:blank', hostname: '' },
    });
    vi.resetModules();
    const { hasValidLauncherTarget } = await import('../services/downloadService');
    expect(hasValidLauncherTarget()).toBe(false);
  });

  it('returns a stable, deterministic build id for a fixed origin & day', async () => {
    vi.resetModules();
    pinOrigin();
    const { getBuildId } = await import('../services/desktopBuildInfo');
    const a = getBuildId();
    const b = getBuildId();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('Desktop download — native release lookup', () => {
  beforeEach(() => {
    pinOrigin();
    localStorage.clear();
  });

  it('uses the official GitHub latest-release manifest when no override is configured', async () => {
    vi.resetModules();
    const { DESKTOP_RELEASE_MANIFEST_URL } = await import('../services/desktopBuildInfo');
    expect(DESKTOP_RELEASE_MANIFEST_URL).toBe(
      'https://github.com/HimArt-1/HADER-SAUD-2027/releases/latest/download/desktop-manifest.json'
    );
  });

  it('caches manifest fetches in localStorage with a TTL', async () => {
    vi.resetModules();
    const manifest = {
      version: '2.0.0',
      releasedAt: '2026-01-01T00:00:00Z',
      platforms: {
        mac: { url: 'https://cdn.example.com/Hader-2.0.0.dmg', size: 100, sha256: 'a'.repeat(64), format: 'dmg' },
        windows: { url: 'https://cdn.example.com/Hader-2.0.0-Setup.exe', size: 100, sha256: 'b'.repeat(64), format: 'nsis' },
      },
    };
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => manifest }));
    (globalThis as any).fetch = fetchSpy;

    vi.stubEnv('VITE_DESKTOP_RELEASE_URL', 'https://cdn.example.com/desktop/manifest.json');

    const { lookupNativeRelease } = await import('../services/desktopReleaseChecker');
    const first = await lookupNativeRelease('mac');
    expect(first.available).toBe(true);
    expect(first.asset?.url).toContain('Hader-2.0.0.dmg');

    const second = await lookupNativeRelease('windows');
    expect(second.available).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('downloads the native installer directly when the manifest exposes one', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DESKTOP_RELEASE_URL', 'https://cdn.example.com/desktop/manifest.json');
    const manifest = {
      version: '2.0.0',
      platforms: { mac: { url: 'https://cdn.example.com/Hader-2.0.0.dmg', size: 100, sha256: 'a'.repeat(64), format: 'dmg' } }
    };
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, json: async () => manifest }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const { downloadDesktopApp } = await import('../services/downloadService');
    const result = await downloadDesktopApp('mac');

    expect(result).toMatchObject({ channel: 'native', filename: 'Hader-2.0.0.dmg', releaseManifestUsed: true });
    expect(click).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('rejects non-HTTPS installer URLs from a release manifest', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DESKTOP_RELEASE_URL', 'https://cdn.example.com/desktop/manifest.json');
    const manifest = {
      version: '2.0.0',
      platforms: { mac: { url: 'javascript:alert(1)', size: 100, sha256: 'a'.repeat(64), format: 'dmg' } }
    };
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, json: async () => manifest }));

    const { lookupNativeRelease } = await import('../services/desktopReleaseChecker');
    await expect(lookupNativeRelease('mac')).resolves.toMatchObject({ available: false });
    vi.unstubAllEnvs();
  });

  it('discards an unsafe cached manifest before resolving a native installer', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DESKTOP_RELEASE_URL', 'https://cdn.example.com/desktop/manifest.json');
    localStorage.setItem('hader:desktop-release-manifest', JSON.stringify({
      fetchedAt: Date.now(),
      manifest: {
        version: '1.0.0',
        platforms: { mac: { url: 'javascript:alert(1)', size: 100, sha256: 'a'.repeat(64), format: 'dmg' } }
      }
    }));
    const safeManifest = {
      version: '2.0.0',
      platforms: {
        mac: {
          url: 'https://cdn.example.com/Hader-2.0.0.dmg',
          size: 100,
          sha256: 'b'.repeat(64),
          format: 'dmg'
        }
      }
    };
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => safeManifest }));
    (globalThis as any).fetch = fetchSpy;

    const { lookupNativeRelease } = await import('../services/desktopReleaseChecker');
    await expect(lookupNativeRelease('mac')).resolves.toMatchObject({
      available: true,
      asset: { url: safeManifest.platforms.mac.url }
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('does not silently replace a missing native installer with the Noor-incompatible wrapper', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DESKTOP_RELEASE_URL', 'https://cdn.example.com/desktop/manifest.json');
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    const { downloadDesktopApp } = await import('../services/downloadService');
    await expect(downloadDesktopApp('mac')).rejects.toThrow('Electron');
    vi.unstubAllEnvs();
  });
});

describe('Desktop download — bundle contents', () => {
  beforeEach(() => {
    pinOrigin();
    document.body.innerHTML = '';
    // jsdom does not implement createObjectURL — provide a stub.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob://test')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined)
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  async function readBundle(platform: 'mac' | 'windows') {
    vi.resetModules();
    pinOrigin();

    // Stub fetch so the icon-asset probe resolves without network noise.
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    let capturedBlob: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        capturedBlob = blob;
        return 'blob://test';
      })
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(() => undefined)
    });

    const { downloadDesktopApp } = await import('../services/downloadService');
    await downloadDesktopApp(platform, { preferredChannel: 'lightweight' });

    expect(capturedBlob).toBeTruthy();

    const { default: JSZip } = await import('jszip');
    // jsdom's Blob may not implement arrayBuffer(); read via FileReader instead.
    const buf: ArrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(capturedBlob!);
    });
    const zip = await JSZip.loadAsync(buf);
    return zip;
  }

  it('mac bundle ships a real Hader.app with Info.plist + executable + readme', async () => {
    const zip = await readBundle('mac');
    const folder = zip.folder('Hader-Desktop-Mac')!;

    const plist = await folder.file('Hader.app/Contents/Info.plist')!.async('string');
    const launcher = await folder.file('Hader.app/Contents/MacOS/Hader')!.async('string');
    const pkgInfo = await folder.file('Hader.app/Contents/PkgInfo')!.async('string');
    const fallback = await folder.file('Hader.app/Contents/Resources/launch.command')!.async('string');
    const version = await folder.file('version.json')!.async('string');
    const readme = await folder.file('README.md')!.async('string');

    expect(plist).toContain('<key>CFBundleIdentifier</key>');
    expect(plist).toContain('sa.hader.lightweight');
    expect(plist).toContain('<key>CFBundleExecutable</key>');
    expect(plist).toContain('<string>Hader</string>');
    expect(plist).toContain('NSHighResolutionCapable');

    expect(launcher).toContain('#!/bin/bash');
    expect(launcher).toContain('--app=');
    expect(launcher).toContain(ORIGIN);
    expect(launcher).toContain('Library/Application Support/Hader');
    expect(launcher).toContain('Google Chrome');
    expect(launcher).toContain('Microsoft Edge');

    expect(pkgInfo).toBe('APPL????');
    expect(fallback).toContain('#!/bin/bash');

    const v = JSON.parse(version);
    expect(v.version).toBeDefined();
    expect(v.appUrl).toContain('hader.example.com');
    expect(v.target).toBe('mac');
    expect(v.channel).toBe('lightweight');
    expect(v.bundleStructure).toBe('app-bundle');
    expect(typeof v.iconEmbedded).toBe('boolean');

    expect(readme).toContain('macOS');
    expect(readme).toContain('Hader.app');
    expect(readme).toContain(ORIGIN);
  });

  it('windows bundle ships silent VBS wrapper + BAT engine + shortcut installer', async () => {
    const zip = await readBundle('windows');
    const folder = zip.folder('Hader-Desktop-Windows')!;

    const vbs = await folder.file('Hader.vbs')!.async('string');
    const bat = await folder.file('Hader.bat')!.async('string');
    const appUrl = await folder.file('app.url')!.async('string');
    const unblock = await folder.file('1-Unblock-Files.bat')!.async('string');
    const shortcutInstaller = await folder.file('Install-Shortcut.bat')!.async('string');
    const version = await folder.file('version.json')!.async('string');

    // Silent wrapper: must invoke Hader.bat with the hidden-window flag (`0`)
    expect(vbs).toContain('Hader.bat');
    expect(vbs).toContain('strDir');
    expect(vbs).toMatch(/objShell\.Run[\s\S]*Hader\.bat[\s\S]*,\s*0/);

    expect(bat).toContain('chcp 65001');
    expect(bat).toContain('set /p APP_URL=<"%APP_URL_FILE%"');
    expect(bat).toContain('--app=');
    expect(bat).toContain('chrome.exe');
    expect(bat).toContain('msedge.exe');
    expect(bat).toContain('LOCALAPPDATA');
    expect(appUrl).toBe(`${ORIGIN}/`);
    expect(unblock).toContain('$env:HADER_BUNDLE_DIR');

    expect(shortcutInstaller).toContain('CreateShortcut');
    expect(shortcutInstaller).toContain('Hader.vbs');
    expect(shortcutInstaller).toContain('IconLocation');
    expect(shortcutInstaller).toContain('$env:HADER_DESKTOP');
    expect(shortcutInstaller).toContain('$env:HADER_STARTMENU');

    const v = JSON.parse(version);
    expect(v.target).toBe('windows');
    expect(v.bundleStructure).toBe('vbs+bat');
  });

  it('does NOT embed Supabase credentials anywhere in the bundle', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://fake-supabase.example.com');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SECRET-TOKEN.signature');

    const zip = await readBundle('mac');
    const folder = zip.folder('Hader-Desktop-Mac')!;

    const filesToCheck: string[] = [];
    folder.forEach((relPath) => filesToCheck.push(relPath));

    for (const relPath of filesToCheck) {
      const f = folder.file(relPath);
      if (!f || f.dir) continue;
      // Skip binary files (icons) — they cannot contain text secrets anyway.
      if (relPath.endsWith('.icns') || relPath.endsWith('.ico')) continue;
      const content = await f.async('string');
      expect(content).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SECRET-TOKEN.signature');
      expect(content).not.toContain('fake-supabase.example.com');
      expect(content.toLowerCase()).not.toContain('supabase_anon_key');
      expect(content.toLowerCase()).not.toContain('vite_supabase_url=');
    }

    vi.unstubAllEnvs();
  });

  it('welcome HTML redirects to the live deployment URL with build banner', async () => {
    const zip = await readBundle('mac');
    const html = await zip.folder('Hader-Desktop-Mac')!.file('Open-In-Browser.html')!.async('string');
    expect(html).toContain(`url=${ORIGIN}`);
    expect(html).toMatch(/href="https:\/\/hader\.example\.com\//);
    expect(html).toContain('App-Mode');
  });
});

describe('Desktop auto-update probe', () => {
  beforeEach(() => {
    pinOrigin();
    localStorage.clear();
  });

  it('returns no-source when no manifest URL is reachable', async () => {
    vi.resetModules();
    pinOrigin();
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    const { checkDesktopAutoUpdate } = await import('../services/desktopAutoUpdate');
    const status = await checkDesktopAutoUpdate(true);
    expect(status.hasUpdate).toBe(false);
    expect(['fetch-failed', 'no-source', 'invalid']).toContain(status.reason);
  });

  it('reports up-to-date when manifest version matches local version', async () => {
    vi.resetModules();
    pinOrigin();
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '1.0.0', buildId: 'abcdef12' }),
    }));
    const { checkDesktopAutoUpdate } = await import('../services/desktopAutoUpdate');
    const status = await checkDesktopAutoUpdate(true);
    expect(status.hasUpdate).toBe(false);
    expect(status.reason).toBe('up-to-date');
  });

  it('flags hasUpdate=true when manifest reports a newer version', async () => {
    vi.resetModules();
    pinOrigin();
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '99.0.0', buildId: 'newer123' }),
    }));
    const { checkDesktopAutoUpdate } = await import('../services/desktopAutoUpdate');
    const status = await checkDesktopAutoUpdate(true);
    expect(status.hasUpdate).toBe(true);
    expect(status.latestVersion).toBe('99.0.0');
    expect(status.latestBuildId).toBe('newer123');
  });
});

describe('Desktop ICNS / ICO builders', () => {
  it('builds a valid `icns` magic header', async () => {
    const { buildIcns } = await import('../services/desktop/icns');
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const out = buildIcns([{ size: 512, png: fakePng }]);
    // 'icns'
    expect(out[0]).toBe(0x69);
    expect(out[1]).toBe(0x63);
    expect(out[2]).toBe(0x6e);
    expect(out[3]).toBe(0x73);
    // total length: 8 (header) + 8 (entry header) + fakePng.length
    const view = new DataView(out.buffer);
    expect(view.getUint32(4, false)).toBe(8 + 8 + fakePng.length);
    // entry type ('ic09' = 512x512)
    expect(out[8]).toBe(0x69);
    expect(out[9]).toBe(0x63);
    expect(out[10]).toBe(0x30);
    expect(out[11]).toBe(0x39);
  });
});
