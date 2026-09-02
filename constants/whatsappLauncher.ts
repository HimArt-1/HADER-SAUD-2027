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

