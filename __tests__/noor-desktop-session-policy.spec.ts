import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertSafeCapturePolicy,
  isAllowedNoorResourceUrl,
  isAllowedNoorSessionUrl,
  NOOR_SESSION_HOSTS
} = require('../electron/noor-session-policy.cjs') as {
  assertSafeCapturePolicy: (policy: unknown) => void;
  isAllowedNoorResourceUrl: (url: string) => boolean;
  isAllowedNoorSessionUrl: (url: string) => boolean;
  NOOR_SESSION_HOSTS: readonly string[];
};

describe('Noor desktop session policy', () => {
  it('allows only the exact official HTTPS Noor and Ministry SSO hosts', () => {
    expect(NOOR_SESSION_HOSTS).toEqual(['noor.moe.gov.sa', 'mip.moe.gov.sa']);
    expect(isAllowedNoorSessionUrl('https://noor.moe.gov.sa/Noor/Login.aspx')).toBe(true);
    expect(isAllowedNoorSessionUrl('https://mip.moe.gov.sa/noor/account/signin')).toBe(true);
    expect(isAllowedNoorSessionUrl('http://noor.moe.gov.sa/Noor/Login.aspx')).toBe(false);
    expect(isAllowedNoorSessionUrl('https://noor.moe.gov.sa.evil.example/Login')).toBe(false);
    expect(isAllowedNoorSessionUrl('https://evil.example/')).toBe(false);
    expect(isAllowedNoorResourceUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isAllowedNoorResourceUrl('blob:https://noor.moe.gov.sa/example')).toBe(true);
    expect(isAllowedNoorResourceUrl('https://cdn.evil.example/script.js')).toBe(false);
  });

  it('rejects any renderer request that weakens visible manual operation', () => {
    expect(() => assertSafeCapturePolicy({
      allowedHosts: ['noor.moe.gov.sa'],
      visibleBrowser: true,
      credentialEntry: 'manual-only',
      challengeHandling: 'manual-only'
    })).not.toThrow();
    expect(() => assertSafeCapturePolicy({
      allowedHosts: ['noor.moe.gov.sa', 'evil.example'],
      visibleBrowser: true,
      credentialEntry: 'manual-only',
      challengeHandling: 'manual-only'
    })).toThrow('unsupported host');
    expect(() => assertSafeCapturePolicy({
      allowedHosts: ['noor.moe.gov.sa'],
      visibleBrowser: false,
      credentialEntry: 'automated',
      challengeHandling: 'bypass'
    })).toThrow('visible and manual');
  });

  it('contains no browser-fingerprint masking or headless automation', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'electron/main.js'), 'utf8');
    const appSource = readFileSync(resolve(process.cwd(), 'App.tsx'), 'utf8');
    const forbiddenPatterns = [
      /navigator\.webdriver/i,
      /setUserAgent/i,
      /userAgent\s*:/i,
      /disable-blink-features/i,
      /headless\s*:/i,
      /captcha.{0,30}(?:bypass|solve)/i
    ];

    forbiddenPatterns.forEach((pattern) => {
      expect(mainSource).not.toMatch(pattern);
    });
    expect(mainSource).not.toContain('document.documentElement.outerHTML');
    expect(mainSource).not.toContain("partition: 'persist:");
    expect(mainSource).toContain("{ urls: ['<all_urls>'] }");
    expect(mainSource).toContain('setPermissionRequestHandler');
    expect(mainSource).toContain("isolatedSession.on('will-download'");
    expect(mainSource).toContain("const NOOR_CAPTURE_HOST = 'noor.moe.gov.sa'");
    expect(mainSource).toContain('isTrustedAppUrl(event.senderFrame.url)');
    expect(mainSource).toContain("ipcMain.handle('noor-close-session'");
    expect(appSource).toContain('window.electronAPI?.closeNoorSession?.()');
    expect(mainSource).toContain("'script,style,link,iframe,object,embed,form,input,button,select,textarea,img,svg'");
  });
});
