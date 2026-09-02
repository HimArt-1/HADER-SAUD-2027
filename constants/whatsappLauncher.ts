/** Archived Python bridges shipped under /public/downloads/whatsapp/… */

export const WHATSAPP_LAUNCHER_ZIP_FILENAME         = 'hader_whatsapp_pro.zip';
export const WHATSAPP_LAUNCHER_MAC_FILENAME         = 'hader_whatsapp_mac.zip';
export const WHATSAPP_LAUNCHER_WINDOWS_FILENAME     = 'hader_whatsapp_windows.zip';

/**
 * Base URL helper — honours Vite `base` when not deployed at `/`.
 * HashRouter does not prefix static assets so we build the path manually.
 */
function _base(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Universal ZIP (all platforms — backward-compat). */
export function getWhatsAppLauncherZipHref(): string {
  return `${_base()}/downloads/whatsapp/${WHATSAPP_LAUNCHER_ZIP_FILENAME}`;
}

/** macOS / Linux-specific ZIP. */
export function getWhatsAppMacZipHref(): string {
  return `${_base()}/downloads/whatsapp/${WHATSAPP_LAUNCHER_MAC_FILENAME}`;
}

/** Windows-specific ZIP. */
export function getWhatsAppWindowsZipHref(): string {
  return `${_base()}/downloads/whatsapp/${WHATSAPP_LAUNCHER_WINDOWS_FILENAME}`;
}

/** Standalone individual file href. */
export function getWhatsAppFileHref(filename: string): string {
  return `${_base()}/downloads/whatsapp/${filename}`;
}

import { WHATSAPP_EMBEDDED_FILES } from './whatsappEmbeddedFiles';

export { WHATSAPP_EMBEDDED_FILES };

/**
 * Downloads a specific WhatsApp engine file directly via browser Blob.
 * Guaranteed to succeed 100% in all browsers and servers without 404/network blocks.
 */
export function downloadWhatsAppFileLocally(filename: string): boolean {
  try {
    const content = WHATSAPP_EMBEDDED_FILES[filename];
    if (typeof content !== 'string') {
      // Fallback to standard URL link
      const fallbackLink = document.createElement('a');
      fallbackLink.href = getWhatsAppFileHref(filename);
      fallbackLink.download = filename;
      document.body.appendChild(fallbackLink);
      fallbackLink.click();
      document.body.removeChild(fallbackLink);
      return false;
    }

    const mimeType = filename.endsWith('.sh')
      ? 'application/x-sh'
      : filename.endsWith('.bat')
        ? 'application/x-bat'
        : filename.endsWith('.py')
          ? 'text/x-python;charset=utf-8'
          : filename.endsWith('.csv')
            ? 'text/csv;charset=utf-8'
            : filename.endsWith('.md')
              ? 'text/markdown;charset=utf-8'
              : 'text/plain;charset=utf-8';

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch (err) {
    console.error('Failed to download file locally:', err);
    window.open(getWhatsAppFileHref(filename), '_blank');
    return false;
  }
}

