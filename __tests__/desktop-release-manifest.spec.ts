import { describe, expect, it } from 'vitest';
import { buildReleaseManifest } from '../scripts/desktopReleaseManifest';

describe('desktop release manifest', () => {
  it('publishes one native macOS DMG and one Windows installer from a tagged release', () => {
    const manifest = buildReleaseManifest({
      repository: 'HimArt-1/HADER-SAUD-2027',
      tag: 'v1.0.0',
      releasedAt: '2026-09-02T10:00:00.000Z',
      assets: [
        { name: 'Hader-1.0.0-mac-universal.dmg', size: 120_000_000, sha256: 'a'.repeat(64) },
        { name: 'Hader-1.0.0-windows-x64-Setup.exe', size: 95_000_000, sha256: 'b'.repeat(64) }
      ]
    });

    expect(manifest).toEqual({
      version: '1.0.0',
      releasedAt: '2026-09-02T10:00:00.000Z',
      notesUrl: 'https://github.com/HimArt-1/HADER-SAUD-2027/releases/tag/v1.0.0',
      minSupportedVersion: '1.0.0',
      platforms: {
        mac: {
          url: 'https://github.com/HimArt-1/HADER-SAUD-2027/releases/download/v1.0.0/Hader-1.0.0-mac-universal.dmg',
          size: 120_000_000,
          sha256: 'a'.repeat(64),
          arch: ['x64', 'arm64'],
          format: 'dmg'
        },
        windows: {
          url: 'https://github.com/HimArt-1/HADER-SAUD-2027/releases/download/v1.0.0/Hader-1.0.0-windows-x64-Setup.exe',
          size: 95_000_000,
          sha256: 'b'.repeat(64),
          arch: ['x64'],
          format: 'nsis'
        }
      }
    });
  });

  it('refuses to publish a partial native release', () => {
    expect(() => buildReleaseManifest({
      repository: 'HimArt-1/HADER-SAUD-2027',
      tag: 'v1.0.0',
      releasedAt: '2026-09-02T10:00:00.000Z',
      assets: [{ name: 'Hader-1.0.0-mac-universal.dmg', size: 1, sha256: 'a'.repeat(64) }]
    })).toThrow('Windows');
  });

  it('refuses assets whose embedded version does not match the release tag', () => {
    expect(() => buildReleaseManifest({
      repository: 'HimArt-1/HADER-SAUD-2027',
      tag: 'v1.0.0',
      releasedAt: '2026-09-02T10:00:00.000Z',
      assets: [
        { name: 'Hader-1.0.1-mac-universal.dmg', size: 1, sha256: 'a'.repeat(64) },
        { name: 'Hader-1.0.1-windows-x64-Setup.exe', size: 1, sha256: 'b'.repeat(64) }
      ]
    })).toThrow('v1.0.0');
  });

  it('refuses an invalid installer fingerprint', () => {
    expect(() => buildReleaseManifest({
      repository: 'HimArt-1/HADER-SAUD-2027',
      tag: 'v1.0.0',
      releasedAt: '2026-09-02T10:00:00.000Z',
      assets: [
        { name: 'Hader-1.0.0-mac-universal.dmg', size: 1, sha256: 'invalid' },
        { name: 'Hader-1.0.0-windows-x64-Setup.exe', size: 1, sha256: 'b'.repeat(64) }
      ]
    })).toThrow('SHA-256');
  });
});
