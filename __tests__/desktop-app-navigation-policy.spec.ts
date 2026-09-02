import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isTrustedAppNavigation } = require('../electron/appNavigationPolicy.cjs') as {
  isTrustedAppNavigation: (url: string, options: {
    isDevelopment: boolean;
    developmentOrigin: string;
    productionOrigin: string;
    localEntryFile: string;
  }) => boolean;
};

const options = {
  isDevelopment: false,
  developmentOrigin: 'http://localhost:5173',
  productionOrigin: 'https://hader-saud-2027.vercel.app',
  localEntryFile: resolve('/app/dist/index.html'),
};

describe('desktop app navigation policy', () => {
  it('trusts only the official deployed Hader origin in production', () => {
    expect(isTrustedAppNavigation('https://hader-saud-2027.vercel.app/', options)).toBe(true);
    expect(isTrustedAppNavigation('https://hader-saud-2027.vercel.app/#/admin', options)).toBe(true);
    expect(isTrustedAppNavigation('https://hader-saud-2027.vercel.app.evil.example/', options)).toBe(false);
    expect(isTrustedAppNavigation('http://hader-saud-2027.vercel.app/', options)).toBe(false);
  });

  it('allows only the exact packaged fallback file', () => {
    expect(isTrustedAppNavigation(pathToFileURL(options.localEntryFile).toString(), options)).toBe(true);
    expect(isTrustedAppNavigation('file:///app/dist/other.html', options)).toBe(false);
  });

  it('applies the navigation policy to direct navigation and HTTP redirects', () => {
    const mainSource = readFileSync(resolve(process.cwd(), 'electron/main.js'), 'utf8');
    expect(mainSource).toContain("contents.on('will-navigate'");
    expect(mainSource).toContain("contents.on('will-redirect'");
    expect(mainSource).toContain('enforceNavigationPolicy(navigationEvent, navigationUrl, false)');
  });
});
