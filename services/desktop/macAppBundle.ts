/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  macOS .app Bundle Generator — chromeless desktop wrapper for the live app
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  We assemble a fully-formed Apple application bundle entirely on the
 *  client. The structure is:
 *
 *    Hader.app/
 *      Contents/
 *        Info.plist          – descriptor consumed by Launch Services
 *        MacOS/
 *          Hader             – POSIX-executable launcher (shell script)
 *        Resources/
 *          icon.icns         – multi-resolution icon
 *          launch.command    – fallback double-clickable script
 *
 *  The user can drag `Hader.app` straight into `/Applications`. macOS
 *  treats it like any signed app: it sits in Spotlight, Dock, and Mission
 *  Control. The actual binary is a shell script that boots Chrome / Edge
 *  / Brave in `--app=` mode pointing at the live deployment URL.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type JSZip from 'jszip';

export interface MacBundleOptions {
  appUrl: string;
  appLaunchUrl: string;
  productName: string; // "نظام حاضر"
  bundleIdentifier: string; // "sa.hader.lightweight"
  version: string;
  buildId: string;
  /** Pre-generated multi-resolution icns blob (optional). */
  icnsBytes?: Uint8Array | null;
  /** When true, the launcher runs verbose diagnostics on every boot. */
  diagnosticsEnabled?: boolean;
}

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function buildInfoPlist(opts: MacBundleOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>ar</string>
  <key>CFBundleDisplayName</key>
  <string>${xmlEscape(opts.productName)}</string>
  <key>CFBundleExecutable</key>
  <string>Hader</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundleIdentifier</key>
  <string>${xmlEscape(opts.bundleIdentifier)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Hader</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${xmlEscape(opts.version)}</string>
  <key>CFBundleVersion</key>
  <string>${xmlEscape(opts.version)}.${xmlEscape(opts.buildId)}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.education</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>LSUIElement</key>
  <false/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSRequiresAquaSystemAppearance</key>
  <false/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>© Hader Team</string>
</dict>
</plist>
`;
}

/**
 * Shell-script launcher that ships at `Contents/MacOS/Hader`.
 * Detects a Chromium-based browser, opens the live URL in App Mode, and
 * persists profile data inside `~/Library/Application Support/Hader/AppMode`.
 *
 * The script never opens a Terminal window because macOS executes it
 * directly via Launch Services (no shell).
 */
function buildMainExecutable(opts: MacBundleOptions): string {
  const url = opts.appLaunchUrl.replace(/'/g, "'\\''");
  return `#!/bin/bash
# Hader Desktop launcher — build ${opts.buildId} • v${opts.version}
set -u

APP_URL='${url}'
APP_NAME='Hader'
SUPPORT_DIR="$HOME/Library/Application Support/Hader"
PROFILE_DIR="$SUPPORT_DIR/AppMode"
LOG_FILE="$SUPPORT_DIR/launcher.log"
mkdir -p "$PROFILE_DIR"

log() {
  printf '%s  %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

log "boot pid=$$"

CHROME_PATHS=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"
  "/Applications/Arc.app/Contents/MacOS/Arc"
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)

LAUNCHER=""
for candidate in "\${CHROME_PATHS[@]}"; do
  if [ -x "$candidate" ]; then
    LAUNCHER="$candidate"
    log "browser=$candidate"
    break
  fi
done

if [ -n "$LAUNCHER" ]; then
  exec "$LAUNCHER" \\
    --app="$APP_URL" \\
    --user-data-dir="$PROFILE_DIR" \\
    --no-first-run \\
    --no-default-browser-check \\
    --disable-features=TranslateUI \\
    --window-size=1400,900 \\
    > /dev/null 2>&1
fi

# Fallback: open in default browser via Launch Services
log "fallback=open"
osascript -e 'display notification "تم فتح التطبيق في المتصفح الافتراضي. ثبّت Chrome أو Edge للحصول على نافذة مستقلة." with title "نظام حاضر"' >/dev/null 2>&1
exec /usr/bin/open "$APP_URL"
`;
}

/**
 * Fallback double-clickable script placed in Resources/.
 * Also attempts to remove the quarantine flag that macOS adds to files
 * downloaded from the Internet before launching the main binary.
 */
function buildFallbackCommand(opts: MacBundleOptions): string {
  void opts; // kept for future use
  return `#!/bin/bash
# launch.command — manual launcher for Hader.app
# Run this if macOS Gatekeeper blocks Hader.app on first launch.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"   # Hader.app directory

# Attempt to remove quarantine flag (requires no special permissions)
echo "Removing quarantine flag from \${APP_DIR}…"
xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null && \\
  echo "Done — quarantine removed." || \\
  echo "Note: could not remove quarantine automatically. See instructions."

# Launch the main binary
exec "$SCRIPT_DIR/../MacOS/Hader"
`;
}

/**
 * Standalone helper script placed next to the .app (in the parent ZIP folder).
 * Users can double-click this in Terminal to unquarantine and launch.
 */
export function buildRemoveQuarantineScript(appName: string): string {
  return `#!/bin/bash
# Remove-Quarantine.command
# ─────────────────────────────────────────────────────────
# macOS adds a "quarantine" flag to files downloaded from
# the Internet. This script removes it so Gatekeeper stops
# blocking ${appName}.app.
#
# HOW TO USE:
#   Double-click this file in Finder — Terminal will open
#   automatically and remove the quarantine flag.
# ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$SCRIPT_DIR/${appName}.app"

if [ ! -d "$APP" ]; then
  echo "❌  ${appName}.app not found in: $SCRIPT_DIR"
  echo "    Make sure this script is in the same folder as the .app"
  read -p "Press Enter to exit…"
  exit 1
fi

echo "🔓  Removing quarantine from ${appName}.app…"
xattr -dr com.apple.quarantine "$APP"

if [ $? -eq 0 ]; then
  echo "✅  Done! You can now double-click ${appName}.app to launch."
  echo "    Opening now…"
  sleep 1
  open "$APP"
else
  echo "⚠️  xattr command failed."
  echo "    Alternative: System Settings → Privacy & Security → Open Anyway"
fi
`;
}

/**
 * Inserts the .app bundle into a JSZip folder under `Hader.app/`.
 * Files that need POSIX execute permissions get \`unixPermissions: 0o755\`
 * so macOS treats the binary as runnable when the archive is unpacked.
 */
export function injectMacAppBundle(
  rootFolder: JSZip,
  appName: string,
  opts: MacBundleOptions
): void {
  const app = rootFolder.folder(`${appName}.app`)!;
  const contents = app.folder('Contents')!;
  const macos = contents.folder('MacOS')!;
  const resources = contents.folder('Resources')!;

  contents.file('Info.plist', buildInfoPlist(opts));

  // POSIX executable — must have +x bit preserved in ZIP
  macos.file('Hader', buildMainExecutable(opts), { unixPermissions: 0o755 });

  if (opts.icnsBytes && opts.icnsBytes.byteLength > 0) {
    resources.file('icon.icns', opts.icnsBytes);
  }
  // launch.command: fallback launcher inside the .app that also removes quarantine
  resources.file('launch.command', buildFallbackCommand(opts), { unixPermissions: 0o755 });

  // PkgInfo — historical Launch Services hint (still respected)
  contents.file('PkgInfo', 'APPL????');

  // Place Remove-Quarantine.command next to the .app (in the outer folder)
  // so users can easily unblock the .app after extracting the ZIP.
  rootFolder.file(
    'Remove-Quarantine.command',
    buildRemoveQuarantineScript(appName),
    { unixPermissions: 0o755 }
  );
}
