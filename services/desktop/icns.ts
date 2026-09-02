/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ICNS Builder — Generate macOS icon files from PNG bytes in the browser
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  macOS uses the `icns` format for application icons. The format is a
 *  simple TLV container: a header followed by typed entries, each carrying
 *  a PNG (or raw bitmap) blob. Modern macOS (10.7+) accepts PNG-encoded
 *  entries directly, so we can produce a fully native icon by wrapping the
 *  same PNG that ships with the web app — no native tooling required.
 *
 *  We embed multiple sizes so Finder, Dock, and Mission Control all render
 *  crisply at any zoom level. Sizes that are not provided fall back to the
 *  largest available image, which macOS down-samples with bilinear filter.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ICNS_MAGIC = new Uint8Array([0x69, 0x63, 0x6e, 0x73]); // 'icns'

/** OS Type codes for ICNS entries (PNG variants). */
const ICON_TYPES = {
  /** 16x16 */
  ICP4: new Uint8Array([0x69, 0x63, 0x70, 0x34]), // 'icp4'
  /** 32x32 */
  ICP5: new Uint8Array([0x69, 0x63, 0x70, 0x35]), // 'icp5'
  /** 64x64 */
  ICP6: new Uint8Array([0x69, 0x63, 0x70, 0x36]), // 'icp6'
  /** 128x128 */
  IC07: new Uint8Array([0x69, 0x63, 0x30, 0x37]), // 'ic07'
  /** 256x256 */
  IC08: new Uint8Array([0x69, 0x63, 0x30, 0x38]), // 'ic08'
  /** 512x512 */
  IC09: new Uint8Array([0x69, 0x63, 0x30, 0x39]), // 'ic09'
  /** 1024x1024 (a.k.a. 512@2x) */
  IC10: new Uint8Array([0x69, 0x63, 0x31, 0x30]), // 'ic10'
} as const;

export interface IcnsSource {
  /** Image side length in pixels (128, 256, 512, 1024). */
  size: 16 | 32 | 64 | 128 | 256 | 512 | 1024;
  /** Raw PNG bytes for the source image. */
  png: Uint8Array;
}

function pickType(size: number): Uint8Array | null {
  switch (size) {
    case 16:
      return ICON_TYPES.ICP4;
    case 32:
      return ICON_TYPES.ICP5;
    case 64:
      return ICON_TYPES.ICP6;
    case 128:
      return ICON_TYPES.IC07;
    case 256:
      return ICON_TYPES.IC08;
    case 512:
      return ICON_TYPES.IC09;
    case 1024:
      return ICON_TYPES.IC10;
    default:
      return null;
  }
}

/**
 * Build an `.icns` blob from a list of PNG sources. The output is a valid
 * Apple Icon Image file that can be dropped into `Hader.app/Contents/Resources`.
 */
export function buildIcns(sources: IcnsSource[]): Uint8Array {
  if (sources.length === 0) {
    throw new Error('buildIcns requires at least one PNG source');
  }

  // Compute total size: 8-byte header + Σ (8-byte entry header + PNG length)
  const entries: Array<{ type: Uint8Array; png: Uint8Array }> = [];
  for (const src of sources) {
    const type = pickType(src.size);
    if (!type) continue;
    entries.push({ type, png: src.png });
  }

  if (entries.length === 0) {
    throw new Error('buildIcns: no usable sizes provided (use 16/32/64/128/256/512/1024)');
  }

  let totalLength = 8; // file header
  for (const entry of entries) {
    totalLength += 8 + entry.png.length;
  }

  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  let offset = 0;

  // Header: 'icns' + total length (big-endian uint32)
  out.set(ICNS_MAGIC, offset);
  offset += 4;
  view.setUint32(offset, totalLength, false);
  offset += 4;

  // Entries
  for (const entry of entries) {
    out.set(entry.type, offset);
    offset += 4;
    view.setUint32(offset, 8 + entry.png.length, false);
    offset += 4;
    out.set(entry.png, offset);
    offset += entry.png.length;
  }

  return out;
}

/**
 * Resize a PNG image client-side using a Canvas. Returns the resized PNG
 * bytes. Falls back to the input bytes if Canvas/ImageBitmap are not
 * available (e.g. server-side rendering).
 */
export async function resizePng(input: Uint8Array, targetSize: number): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return input;
  }
  try {
    const blob = new Blob([input as BlobPart], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return input;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetSize, targetSize);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return input;
  }
}

/**
 * Convenience: fetch a PNG from a URL and produce a multi-resolution `.icns`.
 * Used by the desktop bundler to generate a fresh icon on every download.
 */
export async function buildIcnsFromUrl(pngUrl: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(pngUrl, { cache: 'force-cache' });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const original = new Uint8Array(buffer);

    const sizes: Array<IcnsSource['size']> = [128, 256, 512, 1024];
    const sources = await Promise.all(
      sizes.map(async (size) => ({ size, png: await resizePng(original, size) }))
    );
    return buildIcns(sources);
  } catch {
    return null;
  }
}

/**
 * Build a Windows `.ico` file (multi-resolution) from the same PNG. ICO is
 * a simple TLV container too, and modern Windows accepts PNG-compressed
 * entries.
 */
export async function buildIcoFromUrl(pngUrl: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(pngUrl, { cache: 'force-cache' });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const original = new Uint8Array(buffer);

    const sizes = [16, 32, 48, 64, 128, 256] as const;
    const variants = await Promise.all(
      sizes.map(async (size) => ({ size, png: await resizePng(original, size) }))
    );

    // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes per image) + image data
    const headerSize = 6 + 16 * variants.length;
    const totalSize = headerSize + variants.reduce((acc, v) => acc + v.png.length, 0);
    const out = new Uint8Array(totalSize);
    const view = new DataView(out.buffer);

    // ICONDIR
    view.setUint16(0, 0, true); // reserved
    view.setUint16(2, 1, true); // type = 1 (icon)
    view.setUint16(4, variants.length, true); // count

    let dirOffset = 6;
    let dataOffset = headerSize;
    for (const v of variants) {
      const dim = v.size === 256 ? 0 : v.size; // 256 is encoded as 0
      out[dirOffset] = dim; // width
      out[dirOffset + 1] = dim; // height
      out[dirOffset + 2] = 0; // colors (0 = >256)
      out[dirOffset + 3] = 0; // reserved
      view.setUint16(dirOffset + 4, 1, true); // planes
      view.setUint16(dirOffset + 6, 32, true); // bitcount
      view.setUint32(dirOffset + 8, v.png.length, true); // bytes in res
      view.setUint32(dirOffset + 12, dataOffset, true); // image offset

      out.set(v.png, dataOffset);
      dataOffset += v.png.length;
      dirOffset += 16;
    }

    return out;
  } catch {
    return null;
  }
}
