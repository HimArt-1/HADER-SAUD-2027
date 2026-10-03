import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHATSAPP_EMBEDDED_FILES } from '../constants/whatsappEmbeddedFiles';
import {
  assertBundleable,
  buildZip,
  findRuntimeData,
  getBundleFileLists,
  isForbiddenBundleEntry,
  main
} from '../scripts/bundle-whatsapp-launcher.mjs';

const DOWNLOADS_DIR = path.resolve(__dirname, '../public/downloads/whatsapp');
const SHIPPED_ZIPS = ['hader_whatsapp_mac.zip', 'hader_whatsapp_windows.zip', 'hader_whatsapp_pro.zip'];
const DECOY_MARKER = 'DECOY-GUARDIAN-DATA';

// What a real bridge run leaves next to the source files.
const RUNTIME_DATA = [
  'contacts.csv',
  'contacts.db',
  'contacts.db-wal',
  'contacts.db-shm',
  'contacts.db-journal',
  '.env',
  '.env.local',
  'whatsapp_session/Default/Cookies',
  'logs/server.log',
  'uploads/student.jpg',
  'certificates/certificate.pdf'
];

const zipEntryNames = async (buf: Buffer) =>
  Object.values((await JSZip.loadAsync(buf)).files)
    .filter(entry => !entry.dir)
    .map(entry => entry.name);

describe('WhatsApp bundle denylist', () => {
  it.each(RUNTIME_DATA)('refuses %s', relPath => {
    expect(isForbiddenBundleEntry(relPath)).toBe(true);
  });

  it.each(['whatsapp_session', 'logs', 'uploads', 'certificates', 'export.csv', 'queue.sqlite3', '.env.production'])(
    'refuses %s',
    relPath => {
      expect(isForbiddenBundleEntry(relPath)).toBe(true);
    }
  );

  it('allows every file the bundles list, and none of them is runtime data', () => {
    const lists = getBundleFileLists();
    for (const files of Object.values(lists)) {
      expect(files.filter(isForbiddenBundleEntry)).toEqual([]);
      expect(files).not.toContain('contacts.csv');
    }
    expect(isForbiddenBundleEntry('sqlite_db.py')).toBe(false);
  });

  it('throws instead of packing a forbidden file someone adds to a list', async () => {
    expect(() => assertBundleable(['server.py', 'contacts.csv'])).toThrow(/contacts\.csv/);
    await expect(buildZip('test', ['server.py', 'contacts.db'])).rejects.toThrow(/contacts\.db/);
  });
});

describe('WhatsApp bundle output', () => {
  let tmp: string;
  let sourceDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hader-wa-bundle-'));
    sourceDir = path.join(tmp, 'whatsapp');
    fs.mkdirSync(sourceDir);
    for (const name of getBundleFileLists().universal) {
      fs.writeFileSync(path.join(sourceDir, name), `# ${name}\n`);
    }
    for (const relPath of RUNTIME_DATA) {
      const fp = path.join(sourceDir, relPath);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, `${DECOY_MARKER} ${relPath}\n`);
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('packs only the listed source files when runtime data sits next to them', async () => {
    const { mac } = getBundleFileLists();
    const { buf, added } = await buildZip('mac', mac, { sourceDir });

    expect(added).toBe(mac.length);
    expect((await zipEntryNames(buf)).sort()).toEqual([...mac].sort());
    expect(buf.includes(DECOY_MARKER)).toBe(false);
  });

  it('keeps runtime data out of the zips, standalone copies and embedded map', async () => {
    const outDir = path.join(tmp, 'out');
    const tsFile = path.join(tmp, 'whatsappEmbeddedFiles.ts');

    await main({ sourceDir, outDir, tsFile });

    for (const zipName of SHIPPED_ZIPS) {
      const names = await zipEntryNames(fs.readFileSync(path.join(outDir, zipName)));
      expect(names.filter(isForbiddenBundleEntry)).toEqual([]);
    }
    expect(findRuntimeData(outDir)).toEqual([]);

    const tsContent = fs.readFileSync(tsFile, 'utf8');
    expect(tsContent).not.toContain(DECOY_MARKER);
    expect(tsContent).not.toContain('contacts.csv');
  });

  it('warns when a bridge run left runtime data in the output folder', async () => {
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(path.join(outDir, 'whatsapp_session'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'contacts.db'), DECOY_MARKER);

    await main({ sourceDir, outDir, tsFile: path.join(tmp, 'whatsappEmbeddedFiles.ts') });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('contacts.db, whatsapp_session'));
  });
});

describe('Shipped WhatsApp downloads', () => {
  it.each(SHIPPED_ZIPS)('%s contains no runtime data', async zipName => {
    const names = await zipEntryNames(fs.readFileSync(path.join(DOWNLOADS_DIR, zipName)));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter(isForbiddenBundleEntry)).toEqual([]);
  });

  it('embeds no runtime data in the web app', () => {
    expect(Object.keys(WHATSAPP_EMBEDDED_FILES).filter(isForbiddenBundleEntry)).toEqual([]);
  });
});
