import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalIntegrationAuditPort } from '../modules/integrations/localAuditPort';
import type { IntegrationAuditEvent } from '../modules/integrations';

const event = (id: string): IntegrationAuditEvent => ({
  id,
  platform: 'noor',
  operation: 'pull-roster',
  action: 'inspected',
  occurredAt: `2026-09-02T10:00:0${id}.000Z`,
  details: { changeCount: Number(id) }
});

describe('local integration audit port', () => {
  beforeEach(() => localStorage.clear());

  it('persists audit metadata without platform page content and keeps a bounded history', async () => {
    const audit = createLocalIntegrationAuditPort({ storage: localStorage, maxEvents: 2 });
    await audit.append(event('1'));
    await audit.append(event('2'));
    await audit.append(event('3'));

    const reloaded = createLocalIntegrationAuditPort({ storage: localStorage, maxEvents: 2 });
    expect(reloaded.events().map(item => item.id)).toEqual(['2', '3']);
    expect(localStorage.getItem('hader:integrations:audit')).not.toContain('<html');
  });

  it('recovers safely from malformed local storage', async () => {
    localStorage.setItem('hader:integrations:audit', '{broken');
    const audit = createLocalIntegrationAuditPort({ storage: localStorage });

    expect(audit.events()).toEqual([]);
    await audit.append(event('1'));
    expect(audit.events()).toEqual([event('1')]);
  });

  it('does not persist raw external error messages or student change identifiers', async () => {
    const audit = createLocalIntegrationAuditPort({ storage: localStorage });
    await audit.append({
      ...event('1'),
      action: 'import-failed',
      details: {
        message: '<html>token=secret-cookie</html>',
        approvedChangeIds: ['noor-student-1234567890'],
        errorType: 'ExternalPlatformError'
      }
    });

    const stored = localStorage.getItem('hader:integrations:audit') ?? '';
    expect(stored).not.toContain('secret-cookie');
    expect(stored).not.toContain('1234567890');
    expect(audit.events()[0].details).toEqual({ errorType: 'ExternalPlatformError' });
  });

  it('drops one malformed event without hiding the valid audit history', () => {
    localStorage.setItem('hader:integrations:audit', JSON.stringify([
      event('1'),
      { ...event('2'), reviewId: 123 }
    ]));

    const audit = createLocalIntegrationAuditPort({ storage: localStorage });
    expect(audit.events()).toEqual([event('1')]);
  });
});
