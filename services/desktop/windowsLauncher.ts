/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Windows Launcher Generator — silent App-Mode startup with native polish
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Bundle layout:
 *
 *    Hader.bat              – kept for power users who want to see logs
 *    Hader.vbs              – default double-click target (silent: no cmd window)
 *    Install-Shortcut.bat   – creates a Start-menu / Desktop shortcut with the
 *                             real .ico icon, executing Hader.vbs
 *    Hader.ico              – multi-resolution icon
 *
 *  The VBS wrapper executes the BAT file with `0` (hidden) and `True`
 *  (wait), so users see the App-Mode browser window directly without any
 *  cmd flash. Diagnostic logs are appended to `%LOCALAPPDATA%\\Hader\\
 *  launcher.log` regardless.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type JSZip from 'jszip';

export interface WindowsLauncherOptions {
  appUrl: string;
  appLaunchUrl: string;
  productName: string;
  version: string;
  buildId: string;
  /** Optional pre-built `.ico` blob (multi-resolution). */
  icoBytes?: Uint8Array | null;
  /** Filename used for the shortcut and window title. */
  shortcutName?: string;
}

const WINDOWS_FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

const escapeBatchPathSegment = (value: string): string =>
  Array.from(value)
    .filter((char) => char.charCodeAt(0) >= 32 && !WINDOWS_FORBIDDEN_FILENAME_CHARS.has(char))
    .join('')
    .trim();

function buildBat(opts: WindowsLauncherOptions): string {
  return `@echo off
chcp 65001 > nul 2>&1
title ${opts.productName} (build ${opts.buildId})
setlocal EnableExtensions DisableDelayedExpansion

set "APP_URL_FILE=%~dp0app.url"
if exist "%APP_URL_FILE%" (
  set /p APP_URL=<"%APP_URL_FILE%"
) else (
  set "APP_URL=${opts.appLaunchUrl.replace(/%/g, '%%').replace(/"/g, '')}"
)
set "PROFILE_DIR=%LOCALAPPDATA%\\Hader\\AppMode"
set "LOG_DIR=%LOCALAPPDATA%\\Hader"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%" >nul 2>&1

(>> "%LOG_DIR%\\launcher.log" echo [%date% %time%] boot pid=%RANDOM%) 2>nul

set "LAUNCHER="
for %%P in (
  "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"
  "%PROGRAMFILES%\\Google\\Chrome\\Application\\chrome.exe"
  "%PROGRAMFILES(X86)%\\Google\\Chrome\\Application\\chrome.exe"
  "%PROGRAMFILES%\\Microsoft\\Edge\\Application\\msedge.exe"
  "%PROGRAMFILES(X86)%\\Microsoft\\Edge\\Application\\msedge.exe"
  "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
  "%PROGRAMFILES%\\Vivaldi\\Application\\vivaldi.exe"
) do (
  if exist %%P (
    if not defined LAUNCHER set "LAUNCHER=%%~P"
  )
)

if defined LAUNCHER (
  (>> "%LOG_DIR%\\launcher.log" echo [%date% %time%] browser=%LAUNCHER%) 2>nul
  start "" "%LAUNCHER%" "--app=%APP_URL%" --user-data-dir="%PROFILE_DIR%" --no-first-run --no-default-browser-check --disable-features=TranslateUI --window-size=1400,900
  exit /b 0
)

(>> "%LOG_DIR%\\launcher.log" echo [%date% %time%] fallback=default-browser) 2>nul
start "" "%APP_URL%"
exit /b 0
`;
}

/** Silent wrapper — runs the BAT file with no visible console window. */
function buildVbs(): string {
  return `' Hader Desktop launcher (silent wrapper)
Set objShell = CreateObject("WScript.Shell")
strScript = WScript.ScriptFullName
strDir = Left(strScript, InStrRev(strScript, "\\"))
objShell.Run Chr(34) & strDir & "Hader.bat" & Chr(34), 0, False
`;
}

/**
 * Removes the "Mark of the Web" (Zone.Identifier NTFS stream) from all
 * files in the bundle folder.  Windows SmartScreen and UAC block files that
 * carry this flag when they are downloaded from the Internet.
 * Running this script once after extraction makes the VBS, BAT, and ICO
 * fully trusted on the local machine.
 */
function buildUnblockScript(): string {
  return `@echo off
chcp 65001 > nul 2>&1
title Hader — Remove Internet Block (One-time setup)
set "HADER_BUNDLE_DIR=%~dp0"
echo.
echo  ============================================================
echo   Hader Desktop — Unblock downloaded files (one-time setup)
echo  ============================================================
echo.
echo  Windows adds a security block to files downloaded from the
echo  Internet. This script removes that block so the launcher
echo  can run without SmartScreen warnings.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath $env:HADER_BUNDLE_DIR -Recurse | Unblock-File; Write-Host 'Done.'"
echo.
if %errorlevel% == 0 (
  echo  [OK] Files unblocked successfully.
  echo       You can now double-click Hader.vbs to launch the app.
) else (
  echo  [WARN] PowerShell could not unblock files automatically.
  echo         Right-click Hader.vbs, choose Properties, and check
  echo         "Unblock" at the bottom of the General tab.
)
echo.
pause
`;
}

/** Creates a Start-menu / Desktop shortcut whose target is the silent VBS. */
function buildShortcutInstaller(opts: WindowsLauncherOptions): string {
  const name = escapeBatchPathSegment(opts.shortcutName || opts.productName) || 'Hader';
  return `@echo off
chcp 65001 > nul 2>&1
title Install ${name} shortcut
setlocal EnableExtensions DisableDelayedExpansion

set "HADER_TARGET=%~dp0Hader.vbs"
set "HADER_WORKDIR=%~dp0"
set "HADER_ICON=%~dp0Hader.ico"
if not exist "%HADER_ICON%" set "HADER_ICON=%SystemRoot%\\System32\\shell32.dll,220"
set "HADER_DESKTOP=%USERPROFILE%\\Desktop\\${name}.lnk"
set "HADER_STARTMENU=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\${name}.lnk"
set "HADER_DESCRIPTION=${name} Desktop"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$desk = $ws.CreateShortcut($env:HADER_DESKTOP);" ^
  "$desk.TargetPath = $env:HADER_TARGET;" ^
  "$desk.WorkingDirectory = $env:HADER_WORKDIR;" ^
  "$desk.IconLocation = $env:HADER_ICON;" ^
  "$desk.Description = $env:HADER_DESCRIPTION;" ^
  "$desk.Save();" ^
  "$start = $ws.CreateShortcut($env:HADER_STARTMENU);" ^
  "$start.TargetPath = $env:HADER_TARGET;" ^
  "$start.WorkingDirectory = $env:HADER_WORKDIR;" ^
  "$start.IconLocation = $env:HADER_ICON;" ^
  "$start.Description = $env:HADER_DESCRIPTION;" ^
  "$start.Save();"

if exist "%HADER_DESKTOP%" (
  echo [OK] Desktop shortcut: %HADER_DESKTOP%
) else (
  echo [WARN] Could not create Desktop shortcut.
)
if exist "%HADER_STARTMENU%" (
  echo [OK] Start menu shortcut: %HADER_STARTMENU%
)
echo.
echo Installation complete. You can pin the shortcut to the taskbar.
pause
`;
}

export function injectWindowsLauncher(
  rootFolder: JSZip,
  opts: WindowsLauncherOptions
): void {
  const shortcutInstaller = buildShortcutInstaller(opts);

  rootFolder.file('app.url', opts.appLaunchUrl);
  rootFolder.file('Hader.bat', buildBat(opts));
  rootFolder.file('Hader.vbs', buildVbs());
  // Step 1: Run this FIRST after extraction to remove the Internet Zone block.
  rootFolder.file('1-Unblock-Files.bat', buildUnblockScript());
  // Keep the public filename aligned with the README/UI, plus the numbered helper.
  rootFolder.file('Install-Shortcut.bat', shortcutInstaller);
  rootFolder.file('2-Install-Shortcut.bat', shortcutInstaller);
  if (opts.icoBytes && opts.icoBytes.byteLength > 0) {
    rootFolder.file('Hader.ico', opts.icoBytes);
  }
}
