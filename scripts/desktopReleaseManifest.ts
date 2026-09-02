import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseAssetInput {
  name: string;
  size: number;
  sha256: string;
}

export interface DesktopReleaseManifest {
  version: string;
  releasedAt: string;
  notesUrl: string;
  minSupportedVersion: string;
  platforms: {
    mac: {
      url: string;
      size: number;
      sha256: string;
      arch: ['x64', 'arm64'];
      format: 'dmg';
    };
    windows: {
      url: string;
      size: number;
      sha256: string;
      arch: ['x64'];
      format: 'nsis';
    };
  };
}

interface BuildManifestInput {
  repository: string;
  tag: string;
  releasedAt: string;
  assets: readonly ReleaseAssetInput[];
}

const findFiles = (directory: string): string[] => fs
  .readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? findFiles(fullPath) : [fullPath];
  });

const selectOne = (
  assets: readonly ReleaseAssetInput[],
  predicate: (name: string) => boolean,
  label: string
): ReleaseAssetInput => {
  const matches = assets.filter(asset => predicate(asset.name));
  if (matches.length !== 1) {
    throw new Error(`${label} release requires exactly one matching asset; found ${matches.length}`);
  }
  return matches[0];
};

const releaseAssetUrl = (repository: string, tag: string, name: string): string => (
  `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
);

const assertValidFingerprint = (asset: ReleaseAssetInput): void => {
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`${asset.name} has an invalid file size`);
  }
  if (!/^[a-f0-9]{64}$/i.test(asset.sha256)) {
    throw new Error(`${asset.name} has an invalid SHA-256 fingerprint`);
  }
};

/** Validate a complete tagged desktop release and produce its public download manifest. */
export const buildReleaseManifest = ({
  repository,
  tag,
  releasedAt,
  assets,
}: BuildManifestInput): DesktopReleaseManifest => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GitHub repository must use owner/name format');
  }
  if (!/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(tag)) {
    throw new Error('Desktop release tag must use semantic version format such as v1.0.0');
  }
  if (!Number.isFinite(Date.parse(releasedAt))) {
    throw new Error('Desktop release timestamp is invalid');
  }

  const version = tag.slice(1);
  const expectedMacName = `Hader-${version}-mac-universal.dmg`;
  const expectedWindowsName = `Hader-${version}-windows-x64-Setup.exe`;
  const mac = selectOne(assets, name => name === expectedMacName, `macOS ${tag}`);
  const windows = selectOne(assets, name => name === expectedWindowsName, `Windows ${tag}`);
  assertValidFingerprint(mac);
  assertValidFingerprint(windows);

  return {
    version,
    releasedAt,
    notesUrl: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`,
    minSupportedVersion: version,
    platforms: {
      mac: {
        url: releaseAssetUrl(repository, tag, mac.name),
        size: mac.size,
        sha256: mac.sha256,
        arch: ['x64', 'arm64'],
        format: 'dmg',
      },
      windows: {
        url: releaseAssetUrl(repository, tag, windows.name),
        size: windows.size,
        sha256: windows.sha256,
        arch: ['x64'],
        format: 'nsis',
      },
    },
  };
};

/** Recursively read installer files and return their sizes and SHA-256 fingerprints. */
export const collectReleaseAssets = (directory: string): ReleaseAssetInput[] => findFiles(directory)
  .filter(filePath => /\.(?:dmg|exe)$/i.test(filePath))
  .map(filePath => {
    const bytes = fs.readFileSync(filePath);
    return {
      name: path.basename(filePath),
      size: bytes.byteLength,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });

const run = (): void => {
  const [assetsDirectory, repository, tag, outputFile] = process.argv.slice(2);
  if (!assetsDirectory || !repository || !tag || !outputFile) {
    throw new Error('Usage: desktopReleaseManifest.ts <assets-dir> <owner/repo> <tag> <output-file>');
  }
  const manifest = buildReleaseManifest({
    repository,
    tag,
    releasedAt: new Date().toISOString(),
    assets: collectReleaseAssets(assetsDirectory),
  });
  fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`Desktop manifest written to ${outputFile}\n`);
};

const isCliEntry = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isCliEntry) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
