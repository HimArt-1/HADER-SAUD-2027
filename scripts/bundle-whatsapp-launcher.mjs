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
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.resolve(__dirname, '..');
const WA    = path.join(ROOT, 'whatsapp');
const OUT   = path.join(ROOT, 'public/downloads/whatsapp');
const ZIP_ENTRY_DATE = new Date('2026-01-01T00:00:00.000Z');

/** Core files shared by both platforms */
const SHARED = [
  'server.py',
  'whatsapp_pro_tool.py',
  'sqlite_db.py',
  'requirements.txt',
];

/** Optional files included if they exist */
const OPTIONAL = [
  'bridge.py',
  'contacts.csv',
  'INSTRUCTIONS.md',
];

const MAC_ONLY = [
  'run_mac.sh',
];

const WIN_ONLY = [
  'run_windows.bat',
];

// ─────────────────────────────────────────────────────────────────

function readIfExists(filename) {
  const fp = path.join(WA, filename);
  if (!fs.existsSync(fp)) return null;
  return { name: filename, data: fs.readFileSync(fp) };
}

async function buildZip(label, fileList, prefix = '') {
  const zip = new JSZip();
  const rootPrefix = prefix ? prefix.replace(/\/?$/, '/') : '';
  let added = 0;

  for (const name of fileList) {
    const entry = readIfExists(name);
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
    console.error(`[bundle:whatsapp:${label}] No files to pack — aborting.`);
    process.exit(1);
  }

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return { buf, added };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const allFiles       = [...SHARED, ...MAC_ONLY, ...WIN_ONLY, ...OPTIONAL];
  const macFiles       = [...SHARED, ...MAC_ONLY, ...OPTIONAL];
  const winFiles       = [...SHARED, ...WIN_ONLY, ...OPTIONAL];

  // ── macOS bundle ─────────────────────────────────────────────────
  {
    const { buf, added } = await buildZip('mac', macFiles);
    const outFile = path.join(OUT, 'hader_whatsapp_mac.zip');
    fs.writeFileSync(outFile, buf);
    console.log(
      `[bundle:whatsapp] ✅ hader_whatsapp_mac.zip` +
      ` (${added} files, ${(buf.length / 1024).toFixed(1)} KB)`
    );
  }

  // ── Windows bundle ────────────────────────────────────────────────
  {
    const { buf, added } = await buildZip('windows', winFiles);
    const outFile = path.join(OUT, 'hader_whatsapp_windows.zip');
    fs.writeFileSync(outFile, buf);
    console.log(
      `[bundle:whatsapp] ✅ hader_whatsapp_windows.zip` +
      ` (${added} files, ${(buf.length / 1024).toFixed(1)} KB)`
    );
  }

  // ── Universal bundle (backward-compat) ───────────────────────────
  {
    const { buf, added } = await buildZip('universal', allFiles);
    const outFile = path.join(OUT, 'hader_whatsapp_pro.zip');
    fs.writeFileSync(outFile, buf);
    console.log(
      `[bundle:whatsapp] ✅ hader_whatsapp_pro.zip (universal)` +
      ` (${added} files, ${(buf.length / 1024).toFixed(1)} KB)`
    );
  }
}

main().catch((e) => {
  console.error('[bundle:whatsapp] Fatal error:', e);
  process.exit(1);
});
