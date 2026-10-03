/**
 * bundle-whatsapp-launcher.mjs
 * ────────────────────────────
 * Packs the Python WhatsApp bridge from /whatsapp into three ZIPs under
 * public/downloads/whatsapp/:
 *
 *   hader_whatsapp_mac.zip      — macOS/Linux-only (run_mac.sh)
 *   hader_whatsapp_windows.zip  — Windows-only     (run_windows.bat)
 *   hader_whatsapp_pro.zip      — Universal bundle  (both launchers, backward-compat)
 *
 * Each ZIP places all files in a flat folder matching the launcher's cwd
 * expectations. The ZIP itself wraps files in a "hader_whatsapp_pro/" prefix
 * so double-click extraction lands in a clean directory.
 *
 * Everything this script writes is served publicly and embedded in the web
 * app, so only source files are ever listed. Runtime data the bridge keeps
 * next to its code (see isForbiddenBundleEntry) is refused outright.
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.resolve(__dirname, '..');
const WA    = path.join(ROOT, 'whatsapp');
const OUT   = path.join(ROOT, 'public/downloads/whatsapp');
const TS_FILE = path.join(ROOT, 'constants', 'whatsappEmbeddedFiles.ts');
const ZIP_ENTRY_DATE = new Date('2026-01-01T00:00:00.000Z');

// A new file added to these lists must also be allowed in the
// public/downloads/whatsapp/ block of .gitignore, or its copy won't be committed.

/** Core files shared by both platforms */
export const SHARED = [
  'server.py',
  'whatsapp_pro_tool.py',
  'engine_controller.py',
  'sqlite_db.py',
  'scheduler.py',
  'requirements.txt',
];

/** Optional files included if they exist */
export const OPTIONAL = [
  'bridge.py',
  'INSTRUCTIONS.md',
];

export const MAC_ONLY = [
  'run_mac.sh',
];

export const WIN_ONLY = [
  'run_windows.bat',
];

/**
 * Runtime data the bridge writes into its own folder: guardian names and phone
 * numbers (contacts.csv, the contacts.db queue), the logged-in WhatsApp
 * session, logs, student photos and certificates, and secrets.
 */
const FORBIDDEN_DIRS = new Set([
  'whatsapp_session',
  'logs',
  'uploads',
  'certificates',
  '__pycache__',
  'venv',
  '.venv',
]);

const FORBIDDEN_FILE_PATTERNS = [
  /^contacts\./i,                 // contacts.csv, contacts.db, contacts.db-wal, …
  /\.csv$/i,                      // any exported contact list
  /\.(db|sqlite3?)(-[a-z]+)?$/i,  // queue databases and their -wal/-shm/-journal
  /^\.env/i,                      // .env, .env.local, …
];

// ─────────────────────────────────────────────────────────────────

/** True when a path (relative to the bridge folder) is runtime data that must never ship. */
export function isForbiddenBundleEntry(relPath) {
  const parts = String(relPath).split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.some((part) => FORBIDDEN_DIRS.has(part.toLowerCase()))) return true;
  const base = parts[parts.length - 1];
  return FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(base));
}

export function assertBundleable(fileList) {
  const forbidden = fileList.filter(isForbiddenBundleEntry);
  if (forbidden.length > 0) {
    throw new Error(
      `Refusing to bundle runtime data: ${forbidden.join(', ')}. ` +
      'It holds personal data and public/downloads/ is served publicly.'
    );
  }
}

export function getBundleFileLists() {
  return {
    mac:       [...SHARED, ...MAC_ONLY, ...OPTIONAL],
    windows:   [...SHARED, ...WIN_ONLY, ...OPTIONAL],
    universal: [...SHARED, ...MAC_ONLY, ...WIN_ONLY, ...OPTIONAL],
  };
}

/** Names of runtime data sitting in a folder (names only, contents are never read). */
export function findRuntimeData(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isForbiddenBundleEntry).sort();
}

function readIfExists(sourceDir, filename) {
  const fp = path.join(sourceDir, filename);
  if (!fs.existsSync(fp)) return null;
  return { name: filename, data: fs.readFileSync(fp) };
}

export async function buildZip(label, fileList, { sourceDir = WA, prefix = '' } = {}) {
  assertBundleable(fileList);

  const zip = new JSZip();
  const rootPrefix = prefix ? prefix.replace(/\/?$/, '/') : '';
  let added = 0;

  for (const name of fileList) {
    const entry = readIfExists(sourceDir, name);
    if (!entry) {
      console.warn(`[bundle:whatsapp:${label}] skip missing: ${name}`);
      continue;
    }
    const isExecutable = entry.name.endsWith('.sh');
    zip.file(`${rootPrefix}${entry.name}`, entry.data, {
      date: ZIP_ENTRY_DATE,
      unixPermissions: isExecutable ? "755" : "644",
    });
    added++;
  }

  if (added === 0) {
    throw new Error(`[bundle:whatsapp:${label}] No files to pack — aborting.`);
  }

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return { buf, added };
}

export async function main({ sourceDir = WA, outDir = OUT, tsFile = TS_FILE } = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const { mac: macFiles, windows: winFiles, universal: allFiles } = getBundleFileLists();

  // ── macOS bundle ─────────────────────────────────────────────────
  {
    const { buf, added } = await buildZip('mac', macFiles, { sourceDir });
    const outFile = path.join(outDir, 'hader_whatsapp_mac.zip');
    fs.writeFileSync(outFile, buf);
    console.log(
      `[bundle:whatsapp] ✅ hader_whatsapp_mac.zip` +
      ` (${added} files, ${(buf.length / 1024).toFixed(1)} KB)`
    );
  }

  // ── Windows bundle ────────────────────────────────────────────────
  {
    const { buf, added } = await buildZip('windows', winFiles, { sourceDir });
    const outFile = path.join(outDir, 'hader_whatsapp_windows.zip');
    fs.writeFileSync(outFile, buf);
    console.log(
      `[bundle:whatsapp] ✅ hader_whatsapp_windows.zip` +
      ` (${added} files, ${(buf.length / 1024).toFixed(1)} KB)`
    );
  }

  // ── Universal bundle (backward-compat) ───────────────────────────
  {
    const { buf, added } = await buildZip('universal', allFiles, { sourceDir });
    const outFile = path.join(outDir, 'hader_whatsapp_pro.zip');
    fs.writeFileSync(outFile, buf);
    console.log(
      `[bundle:whatsapp] ✅ hader_whatsapp_pro.zip (universal)` +
      ` (${added} files, ${(buf.length / 1024).toFixed(1)} KB)`
    );
  }

  // ── Standalone individual files ──────────────────────────────────
  assertBundleable(allFiles);
  const embedded = {};
  for (const filename of allFiles) {
    const src = path.join(sourceDir, filename);
    const dest = path.join(outDir, filename);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      embedded[filename] = fs.readFileSync(src, 'utf8');
      console.log(`[bundle:whatsapp] 📄 copied standalone: ${filename}`);
    }
  }

  // ── Generate embedded TypeScript map for client-side Blob downloads ──
  const tsContent = `// Auto-generated by scripts/bundle-whatsapp-launcher.mjs - DO NOT EDIT MANUALLY\n` +
    `export const WHATSAPP_EMBEDDED_FILES: Record<string, string> = ${JSON.stringify(embedded, null, 2)};\n`;
  fs.writeFileSync(tsFile, tsContent, 'utf8');
  console.log(`[bundle:whatsapp] ⚡ Generated constants/whatsappEmbeddedFiles.ts (${Object.keys(embedded).length} files embedded)`);

  // ── Warn about runtime data a bridge run left in the public folder ──
  // Vite copies public/ into dist/ as-is, so it would ship with the build.
  const stray = findRuntimeData(outDir);
  if (stray.length > 0) {
    console.warn(
      `[bundle:whatsapp] ⚠️  ${path.relative(ROOT, outDir) || outDir} holds runtime data ` +
      `(${stray.join(', ')}). Vite will copy it into dist/ — move it out before building.`
    );
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((e) => {
    console.error('[bundle:whatsapp] Fatal error:', e);
    process.exit(1);
  });
}
