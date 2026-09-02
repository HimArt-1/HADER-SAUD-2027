import { describe, expect, it } from 'vitest';
import {
  createInMemoryIntegrationAdapter,
  createInMemoryIntegrationAuditPort,
  createInMemoryIntegrationImportPort,
  createIntegrationModule
} from '../modules/integrations';
import {
  createSafeBrowserAutomationPolicy,
  isAllowedAutomationUrl
} from '../modules/integrations/browserPolicy';

const changes = [
  {
    id: 'student-1',
    entityType: 'student-attendance',
    entityLabel: 'طالب 1',
    action: 'update' as const,
    before: { status: 'present' },
    after: { status: 'late' }
  },
  {
    id: 'student-2',
    entityType: 'student-attendance',
    entityLabel: 'طالب 2',
    action: 'update' as const,
    before: { status: 'present' },
    after: { status: 'absent' },
    blocked: true,
    warnings: ['هوية الطالب غير متطابقة']
  },
  {
    id: 'student-3',
    entityType: 'student',
    entityLabel: 'طالب مطابق',
    action: 'unchanged' as const
  },
  {
    id: 'student-4',
    entityType: 'student',
    entityLabel: 'طالب مفقود',
    action: 'delete' as const,
    before: { id: 'student-4' },
    after: null
  }
];

const createFixture = (now = new Date('2026-09-02T08:00:00.000Z')) => {
  let sequence = 0;
  let approver: { id: string; displayName: string; canApproveIntegrations: boolean } | null = {
    id: 'admin-1',
    displayName: 'مدير المدرسة',
    canApproveIntegrations: true
  };
  const audit = createInMemoryIntegrationAuditPort();
  const adapter = createInMemoryIntegrationAdapter({
    platform: 'noor',
    capabilities: [
      { operation: 'pull-roster', effect: 'read' },
      { operation: 'commit-attendance', effect: 'write' }
    ],
    inspection: {
      remoteRevision: 'layout-v1:page-7',
      changes,
      warnings: ['المراجعة مطلوبة قبل الرصد']
    }
  });
  const importer = createInMemoryIntegrationImportPort();
  const module = createIntegrationModule([adapter], audit, {
    now: () => now,
    createId: () => `id-${++sequence}`,
    reviewTtlMs: 60_000,
    importPort: importer,
    resolveApprover: () => approver
  });
  return {
    module,
    adapter,
    importer,
    audit,
    setNow: (next: Date) => { now = next; },
    setApprover: (next: typeof approver) => { approver = next; }
  };
};

describe('integration module safety invariants', () => {
  it('inspects a platform through one interface and records an audit event', async () => {
    const { module, audit } = createFixture();
    const review = await module.inspect({
      platform: 'noor',
      operation: 'commit-attendance',
      input: { date: '2026-09-02' }
    });

    expect(review).toMatchObject({
      platform: 'noor',
      operation: 'commit-attendance',
      effect: 'write',
      remoteRevision: 'layout-v1:page-7'
    });
    expect(review.changes).toHaveLength(4);
    expect(audit.events()).toHaveLength(1);
    expect(audit.events()[0]).toMatchObject({ action: 'inspected', reviewId: review.id });
  });

  it('requires a named human approval and applies only explicitly selected changes', async () => {
    const fixture = createFixture();
    const review = await fixture.module.inspect({ platform: 'noor', operation: 'commit-attendance' });
    fixture.setApprover(null);
    await expect(fixture.module.apply({
      reviewId: review.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    })).rejects.toThrow('authenticated human approver');
    fixture.setApprover({ id: 'admin-1', displayName: 'مدير المدرسة', canApproveIntegrations: true });

    const receipt = await fixture.module.apply({
      reviewId: review.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    });

    expect(receipt.appliedChangeIds).toEqual(['student-1']);
    expect(fixture.adapter.applied()[0].approvedChanges.map(change => change.id)).toEqual(['student-1']);
    expect(fixture.audit.events().map(event => event.action)).toEqual([
      'inspected',
      'apply-started',
      'apply-succeeded'
    ]);
  });

  it('fails closed for blocked, unknown, expired, read-only, and reused reviews', async () => {
    const fixture = createFixture();
    const blockedReview = await fixture.module.inspect({ platform: 'noor', operation: 'commit-attendance' });
    await expect(fixture.module.apply({
      reviewId: blockedReview.id,
      approvedChangeIds: ['student-2'],
      approval: {}
    })).rejects.toThrow('Blocked change');

    const unknownReview = await fixture.module.inspect({ platform: 'noor', operation: 'commit-attendance' });
    await expect(fixture.module.apply({
      reviewId: unknownReview.id,
      approvedChangeIds: ['not-in-review'],
      approval: {}
    })).rejects.toThrow('does not belong');

    const readReview = await fixture.module.inspect({ platform: 'noor', operation: 'pull-roster' });
    await expect(fixture.module.apply({
      reviewId: readReview.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    })).rejects.toThrow('Read-only');

    const expiredReview = await fixture.module.inspect({ platform: 'noor', operation: 'commit-attendance' });
    fixture.setNow(new Date('2026-09-02T08:02:00.000Z'));
    await expect(fixture.module.apply({
      reviewId: expiredReview.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    })).rejects.toThrow('expired');

    const freshFixture = createFixture();
    const consumedReview = await freshFixture.module.inspect({ platform: 'noor', operation: 'commit-attendance' });
    const request = {
      reviewId: consumedReview.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    } as const;
    await freshFixture.module.apply(request);
    await expect(freshFixture.module.apply(request)).rejects.toThrow('already consumed');
  });

  it('commits a reviewed read operation locally without writing to Noor', async () => {
    const { module, adapter, importer, audit } = createFixture();
    const review = await module.inspect({ platform: 'noor', operation: 'pull-roster' });

    const receipt = await module.commitImport({
      reviewId: review.id,
      approvedChangeIds: ['student-1'],
      approval: { reason: 'اعتماد تحديث الكشف' }
    });

    expect(receipt.appliedChangeIds).toEqual(['student-1']);
    expect(importer.imported()[0]).toMatchObject({
      platform: 'noor',
      operation: 'pull-roster',
      approvedBy: 'admin-1'
    });
    expect(importer.imported()[0].approvedChanges.map(change => change.id)).toEqual(['student-1']);
    expect(adapter.applied()).toHaveLength(0);
    expect(audit.events().map(event => event.action)).toEqual([
      'inspected',
      'import-started',
      'import-succeeded'
    ]);
  });

  it('never imports blocked, unchanged, delete, write-mode, expired, or reused changes', async () => {
    const fixture = createFixture();
    const blocked = await fixture.module.inspect({ platform: 'noor', operation: 'pull-roster' });
    await expect(fixture.module.commitImport({
      reviewId: blocked.id,
      approvedChangeIds: ['student-2'],
      approval: {}
    })).rejects.toThrow('Blocked change');

    const unchanged = await fixture.module.inspect({ platform: 'noor', operation: 'pull-roster' });
    await expect(fixture.module.commitImport({
      reviewId: unchanged.id,
      approvedChangeIds: ['student-3'],
      approval: {}
    })).rejects.toThrow('Unchanged item');

    const deletion = await fixture.module.inspect({ platform: 'noor', operation: 'pull-roster' });
    await expect(fixture.module.commitImport({
      reviewId: deletion.id,
      approvedChangeIds: ['student-4'],
      approval: {}
    })).rejects.toThrow('Delete changes cannot be imported');

    const writeReview = await fixture.module.inspect({ platform: 'noor', operation: 'commit-attendance' });
    await expect(fixture.module.commitImport({
      reviewId: writeReview.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    })).rejects.toThrow('Write operations cannot be imported');

    const expired = await fixture.module.inspect({ platform: 'noor', operation: 'pull-roster' });
    fixture.setNow(new Date('2026-09-02T08:02:00.000Z'));
    await expect(fixture.module.commitImport({
      reviewId: expired.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    })).rejects.toThrow('expired');

    const fresh = createFixture();
    const consumed = await fresh.module.inspect({ platform: 'noor', operation: 'pull-roster' });
    const request = {
      reviewId: consumed.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    } as const;
    await fresh.module.commitImport(request);
    await expect(fresh.module.commitImport(request)).rejects.toThrow('already consumed');
  });

  it('keeps the stored review immutable when a caller tries to alter nested values', async () => {
    const { module, importer } = createFixture();
    const review = await module.inspect({ platform: 'noor', operation: 'pull-roster' });

    expect(() => {
      (review.changes[0].after as Record<string, unknown>).status = 'absent';
    }).toThrow();
    await module.commitImport({
      reviewId: review.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    });
    expect(importer.imported()[0].approvedChanges[0].after).toEqual({ status: 'late' });
  });

  it('rejects a receipt that does not exactly match the approved changes', async () => {
    const audit = createInMemoryIntegrationAuditPort();
    const adapter = createInMemoryIntegrationAdapter({
      platform: 'noor',
      capabilities: [{ operation: 'commit-attendance', effect: 'write' }],
      inspection: { remoteRevision: 'r1', changes: [changes[0]] },
      receiptAppliedChangeIds: []
    });
    const module = createIntegrationModule([adapter], audit, {
      resolveApprover: () => ({
        id: 'admin-1',
        displayName: 'مدير المدرسة',
        canApproveIntegrations: true
      })
    });
    const review = await module.inspect({ platform: 'noor', operation: 'commit-attendance' });

    await expect(module.apply({
      reviewId: review.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    })).rejects.toThrow('receipt does not match');
    expect(audit.events().at(-1)?.action).toBe('apply-outcome-unknown');
  });

  it('returns a successful external receipt even if recording the terminal audit event fails', async () => {
    const auditErrors: unknown[] = [];
    const adapter = createInMemoryIntegrationAdapter({
      platform: 'noor',
      capabilities: [{ operation: 'commit-attendance', effect: 'write' }],
      inspection: { remoteRevision: 'r1', changes: [changes[0]] }
    });
    const audit = {
      async append(event: { action: string }) {
        if (event.action === 'apply-succeeded') throw new Error('audit storage unavailable');
      }
    };
    const module = createIntegrationModule([adapter], audit, {
      resolveApprover: () => ({
        id: 'admin-1',
        displayName: 'مدير المدرسة',
        canApproveIntegrations: true
      }),
      onAuditError: error => {
        auditErrors.push(error);
        throw new Error('observer failed too');
      }
    });
    const review = await module.inspect({ platform: 'noor', operation: 'commit-attendance' });

    const receipt = await module.apply({
      reviewId: review.id,
      approvedChangeIds: ['student-1'],
      approval: {}
    });
    expect(receipt.appliedChangeIds).toEqual(['student-1']);
    expect(auditErrors).toHaveLength(1);
  });

  it('rejects empty or duplicate change identifiers before creating a review', async () => {
    const adapter = createInMemoryIntegrationAdapter({
      platform: 'noor',
      capabilities: [{ operation: 'pull-roster', effect: 'read' }],
      inspection: {
        remoteRevision: 'r1',
        changes: [changes[0], { ...changes[0] }]
      }
    });
    const module = createIntegrationModule([adapter], createInMemoryIntegrationAuditPort());

    await expect(module.inspect({
      platform: 'noor', operation: 'pull-roster'
    })).rejects.toThrow('unique non-empty identifiers');
  });
});

describe('government browser automation policy', () => {
  it('allows only explicit HTTPS hosts and conservative action rates', () => {
    const policy = createSafeBrowserAutomationPolicy({
      allowedHosts: ['noor.moe.gov.sa'],
      writeMode: 'disabled'
    });

    expect(policy).toMatchObject({
      visibleBrowser: true,
      credentialEntry: 'manual-only',
      challengeHandling: 'manual-only',
      requireReviewBeforeWrite: true,
      maxActionsPerMinute: 12
    });
    expect(isAllowedAutomationUrl(policy, 'https://noor.moe.gov.sa/Noor/Login.aspx')).toBe(true);
    expect(isAllowedAutomationUrl(policy, 'http://noor.moe.gov.sa/Noor/Login.aspx')).toBe(false);
    expect(isAllowedAutomationUrl(policy, 'https://evil.example/noor')).toBe(false);
  });

  it('rejects hidden browsers, automated challenges, disabled review, and aggressive rates', () => {
    expect(() => createSafeBrowserAutomationPolicy({
      allowedHosts: ['noor.moe.gov.sa'],
      visibleBrowser: false
    })).toThrow('visible browser');
    expect(() => createSafeBrowserAutomationPolicy({
      allowedHosts: ['noor.moe.gov.sa'],
      challengeHandling: 'bypass'
    })).toThrow('must remain manual');
    expect(() => createSafeBrowserAutomationPolicy({
      allowedHosts: ['noor.moe.gov.sa'],
      requireReviewBeforeWrite: false
    })).toThrow('cannot be disabled');
    expect(() => createSafeBrowserAutomationPolicy({
      allowedHosts: ['noor.moe.gov.sa'],
      maxActionsPerMinute: 60
    })).toThrow('between 1 and 30');
  });
});
