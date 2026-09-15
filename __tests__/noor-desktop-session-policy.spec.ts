import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertSafeCapturePolicy,
  isAllowedNoorResourceUrl,
  isAllowedNoorRequest,
  isAllowedNoorSessionUrl,
  NOOR_SESSION_HOSTS
} = require('../electron/noor-session-policy.cjs') as {
  assertSafeCapturePolicy: (policy: unknown) => void;
  isAllowedNoorResourceUrl: (url: string) => boolean;
  isAllowedNoorRequest: (request: { url: string; resourceType: string }) => boolean;
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

  it('allows the actual Ministry SSO and Nafath redirects without allowing capture there', () => {
    for (const url of [
      'https://iam.moe.gov.sa/mga/sps/oauth/oauth20/authorize',
      'https://www.iam.gov.sa/samlsso',
      'https://moe.queue-it.net/?c=moe&e=noorproduction'
    ]) {
      expect(isAllowedNoorSessionUrl(url)).toBe(true);
      expect(isAllowedNoorRequest({ url, resourceType: 'mainFrame' })).toBe(true);
      expect(() => assertSafeCapturePolicy({
        allowedHosts: [new URL(url).hostname],
        visibleBrowser: true,
        credentialEntry: 'manual-only',
        challengeHandling: 'manual-only'
      })).toThrow('unsupported host');
    }
  });

  it('loads Noor interface dependencies while keeping CDN navigation blocked', () => {
    for (const url of [
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/js/all.min.js',
      'https://ajax.cloudflare.com/cdn-cgi/scripts/95c75768/cloudflare-static/rocket-loader.min.js',
      'https://object.moe.gov.sa/noor/AdvertisementImages/example.png',
      'https://static.queue-it.net/script/queueclient.min.js',
      'https://seal.digicert.com/seals/cascade/seal.min.js',
      'https://assets.queue-it.net/moe/integrationconfig/javascript/queueclientConfig.js',
      'https://iamall.pages.dev/index-DDF8t5Va.js',
      'https://iamall.pages.dev/index-BFx7Zyjl.css',
      'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic',
      'https://fonts.gstatic.com/s/ibmplexsansarabic/v14/example.woff2',
      'https://dga.gov.sa/themes/custom/dga/Images/NDS/CountryFlags.svg',
      'https://imagedelivery.net/KWAEkiRrki3UKDjjaDt6mA/example/public'
    ]) {
      expect(isAllowedNoorResourceUrl(url)).toBe(true);
      expect(isAllowedNoorRequest({ url, resourceType: 'script' })).toBe(true);
      expect(isAllowedNoorRequest({ url, resourceType: 'mainFrame' })).toBe(false);
      expect(isAllowedNoorSessionUrl(url)).toBe(false);
    }
  });

  it('rejects lookalike hosts, unapproved CDN paths and unsafe authentication URLs', () => {
    for (const url of [
      'http://www.iam.gov.sa/samlsso',
      'https://www.iam.gov.sa.evil.example/samlsso',
      'https://iam.moe.gov.sa@evil.example/',
      'https://evil.example@iam.moe.gov.sa/',
      'https://iam.moe.gov.sa:8443/',
      'https://cdnjs.cloudflare.com/ajax/libs/unapproved/script.js',
      'https://static.queue-it.net/script/../unapproved.js',
      'https://object.moe.gov.sa/another-service/script.js',
      'https://assets.queue-it.net/another-customer/script.js',
      'https://iamall.pages.dev/unapproved.js',
      'https://another.pages.dev/index-DDF8t5Va.js',
      'javascript:alert(1)',
      'file:///etc/passwd'
    ]) {
      expect(isAllowedNoorResourceUrl(url)).toBe(false);
      expect(isAllowedNoorSessionUrl(url)).toBe(false);
    }
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
