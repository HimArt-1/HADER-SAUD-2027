import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');

describe('authenticated route redirects', () => {
  it('redirects an authenticated user away from the login route', () => {
    const authenticatedRoutes = appSource.slice(appSource.indexOf(') : ('));

    expect(authenticatedRoutes).toContain(
      '<Route path="/login" element={<Navigate to="/" replace />} />'
    );
  });
});
