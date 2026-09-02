export type IntegrationPlatform = 'noor' | 'madrasati' | 'huduri';
export type IntegrationEffect = 'read' | 'write';
export type IntegrationChangeAction = 'create' | 'update' | 'delete' | 'unchanged';

export type IntegrationCapability = Readonly<{
  operation: string;
  effect: IntegrationEffect;
}>;

export type IntegrationChange = Readonly<{
  id: string;
  entityType: string;
  entityLabel: string;
  action: IntegrationChangeAction;
  before?: Readonly<Record<string, unknown>> | null;
  after?: Readonly<Record<string, unknown>> | null;
  warnings?: readonly string[];
  blocked?: boolean;
}>;

export type IntegrationInspectRequest = Readonly<{
  platform: IntegrationPlatform;
  operation: string;
  input?: Readonly<Record<string, unknown>>;
}>;

export type IntegrationAdapterInspection = Readonly<{
  remoteRevision: string;
  changes: readonly IntegrationChange[];
  warnings?: readonly string[];
}>;

export type IntegrationAdapterApplyRequest = Readonly<{
  operation: string;
  remoteRevision: string;
  approvedChanges: readonly IntegrationChange[];
  idempotencyKey: string;
}>;

export type IntegrationApplyReceipt = Readonly<{
  reference: string;
  appliedChangeIds: readonly string[];
  completedAt: string;
}>;

export type IntegrationAdapter = Readonly<{
  platform: IntegrationPlatform;
  capabilities: readonly IntegrationCapability[];
  inspect(request: IntegrationInspectRequest): Promise<IntegrationAdapterInspection>;
  apply(request: IntegrationAdapterApplyRequest): Promise<IntegrationApplyReceipt>;
}>;

export type IntegrationReview = Readonly<{
  id: string;
  platform: IntegrationPlatform;
  operation: string;
  effect: IntegrationEffect;
  remoteRevision: string;
  changes: readonly IntegrationChange[];
  warnings: readonly string[];
  createdAt: string;
  expiresAt: string;
}>;

export type IntegrationApproval = Readonly<{
  reason?: string;
}>;

export type IntegrationApprover = Readonly<{
  id: string;
  displayName: string;
  canApproveIntegrations: boolean;
}>;

export type IntegrationApplyRequest = Readonly<{
  reviewId: string;
  approvedChangeIds: readonly string[];
  approval: IntegrationApproval;
}>;

export type IntegrationImportExecutionRequest = Readonly<{
  platform: IntegrationPlatform;
  operation: string;
  remoteRevision: string;
  approvedChanges: readonly IntegrationChange[];
  approvedBy: string;
  approvalReason?: string;
  idempotencyKey: string;
}>;

export type IntegrationImportPort = Readonly<{
  import(request: IntegrationImportExecutionRequest): Promise<IntegrationApplyReceipt>;
}>;

export type IntegrationAuditEvent = Readonly<{
  id: string;
  reviewId?: string;
  platform: IntegrationPlatform;
  operation: string;
  action:
    | 'inspected'
    | 'inspect-failed'
    | 'apply-started'
    | 'apply-succeeded'
    | 'apply-failed'
    | 'apply-outcome-unknown'
    | 'import-started'
    | 'import-succeeded'
    | 'import-failed'
    | 'import-outcome-unknown';
  actor?: string;
  occurredAt: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export type IntegrationAuditPort = Readonly<{
  append(event: IntegrationAuditEvent): Promise<void>;
}>;

export type IntegrationModule = Readonly<{
  inspect(request: IntegrationInspectRequest): Promise<IntegrationReview>;
  apply(request: IntegrationApplyRequest): Promise<IntegrationApplyReceipt>;
  commitImport(request: IntegrationApplyRequest): Promise<IntegrationApplyReceipt>;
}>;

export type IntegrationEnvironment = Readonly<{
  now?: () => Date;
  createId?: () => string;
  reviewTtlMs?: number;
  importPort?: IntegrationImportPort;
  resolveApprover?: () => IntegrationApprover | null;
  onAuditError?: (error: unknown, event: Omit<IntegrationAuditEvent, 'id' | 'occurredAt'>) => void;
}>;

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const cloneRecord = (
  value: Readonly<Record<string, unknown>> | null | undefined
): Readonly<Record<string, unknown>> | null | undefined => {
  if (value == null) return value;
  const cloned = typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return deepFreeze(cloned);
};

const cloneChange = (change: IntegrationChange): IntegrationChange => Object.freeze({
  ...change,
  before: cloneRecord(change.before),
  after: cloneRecord(change.after),
  warnings: Object.freeze([...(change.warnings ?? [])])
});

const receiptMatches = (
  receipt: IntegrationApplyReceipt,
  approvedChangeIds: readonly string[]
): boolean => {
  const expected = new Set(approvedChangeIds);
  const actual = new Set(receipt.appliedChangeIds);
  return expected.size === approvedChangeIds.length
    && actual.size === receipt.appliedChangeIds.length
    && expected.size === actual.size
    && [...expected].every(id => actual.has(id));
};

const toSafeErrorType = (_error: unknown): string => 'IntegrationOperationError';

const assertValidChangeIds = (changes: readonly IntegrationChange[]): void => {
  const ids = changes.map(change => change.id.trim());
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new Error('Integration changes must have unique non-empty identifiers');
  }
};

const findCapability = (
  adapter: IntegrationAdapter,
  operation: string
): IntegrationCapability => {
  const capability = adapter.capabilities.find(candidate => candidate.operation === operation);
  if (!capability) {
    throw new Error(`${adapter.platform} does not support operation: ${operation}`);
  }
  return capability;
};

/**
 * Owns the review-before-write invariant for every external platform.
 * Adapters understand page layouts; callers only understand reviews and receipts.
 */
export const createIntegrationModule = (
  adapters: readonly IntegrationAdapter[],
  audit: IntegrationAuditPort,
  environment: IntegrationEnvironment = {}
): IntegrationModule => {
  const now = environment.now ?? (() => new Date());
  const createId = environment.createId ?? (() => crypto.randomUUID());
  const reviewTtlMs = environment.reviewTtlMs ?? 15 * 60 * 1000;
  if (!Number.isFinite(reviewTtlMs) || reviewTtlMs < 30_000) {
    throw new Error('Review TTL must be at least 30 seconds');
  }

  const adapterByPlatform = new Map<IntegrationPlatform, IntegrationAdapter>();
  adapters.forEach(adapter => {
    if (adapterByPlatform.has(adapter.platform)) {
      throw new Error(`Duplicate integration adapter: ${adapter.platform}`);
    }
    adapterByPlatform.set(adapter.platform, adapter);
  });

  const reviews = new Map<string, IntegrationReview>();
  const consumedReviews = new Set<string>();

  const getAdapter = (platform: IntegrationPlatform): IntegrationAdapter => {
    const adapter = adapterByPlatform.get(platform);
    if (!adapter) throw new Error(`Integration adapter is not configured: ${platform}`);
    return adapter;
  };

  const appendAudit = async (
    event: Omit<IntegrationAuditEvent, 'id' | 'occurredAt'>
  ): Promise<void> => {
    await audit.append(Object.freeze({
      ...event,
      id: createId(),
      occurredAt: now().toISOString()
    }));
  };

  const appendAuditSafely = async (
    event: Omit<IntegrationAuditEvent, 'id' | 'occurredAt'>
  ): Promise<void> => {
    try {
      await appendAudit(event);
    } catch (error) {
      try {
        environment.onAuditError?.(error, event);
      } catch {
        // Reporting an audit failure must never change the already-completed outcome.
      }
    }
  };

  /** Resolves the trusted approver and revalidates every selected review change. */
  const getApprovedReviewChanges = (
    request: IntegrationApplyRequest
  ): Readonly<{
    review: IntegrationReview;
    approvedBy: string;
    approvedChanges: readonly IntegrationChange[];
    requestedIds: readonly string[];
  }> => {
    const review = reviews.get(request.reviewId);
    if (!review) throw new Error('Integration review was not found');
    if (consumedReviews.has(review.id)) throw new Error('Integration review was already consumed');
    if (Date.parse(review.expiresAt) <= now().getTime()) throw new Error('Integration review has expired');

    const approver = environment.resolveApprover?.() ?? null;
    if (!approver?.id.trim() || !approver.canApproveIntegrations) {
      throw new Error('An authenticated human approver with integration permission is required');
    }
    const requestedIds = Object.freeze([...new Set(request.approvedChangeIds)]);
    if (requestedIds.length === 0) throw new Error('At least one change must be approved');

    const changeById = new Map(review.changes.map(change => [change.id, change]));
    const approvedChanges = Object.freeze(requestedIds.map(id => {
      const change = changeById.get(id);
      if (!change) throw new Error(`Approved change does not belong to review: ${id}`);
      if (change.blocked) throw new Error(`Blocked change cannot be applied: ${id}`);
      if (change.action === 'unchanged') throw new Error(`Unchanged item cannot be applied: ${id}`);
      return change;
    }));

    return Object.freeze({
      review,
      approvedBy: approver.id.trim(),
      approvedChanges,
      requestedIds
    });
  };

  return Object.freeze({
    async inspect(request) {
      const adapter = getAdapter(request.platform);
      const capability = findCapability(adapter, request.operation);
      let inspection: IntegrationAdapterInspection;
      try {
        inspection = await adapter.inspect(request);
        assertValidChangeIds(inspection.changes);
      } catch (error) {
        await appendAuditSafely({
          platform: request.platform,
          operation: request.operation,
          action: 'inspect-failed',
          details: { errorType: toSafeErrorType(error) }
        });
        throw error;
      }
      const createdAt = now();
      const review: IntegrationReview = Object.freeze({
        id: createId(),
        platform: request.platform,
        operation: request.operation,
        effect: capability.effect,
        remoteRevision: inspection.remoteRevision,
        changes: Object.freeze(inspection.changes.map(cloneChange)),
        warnings: Object.freeze([...(inspection.warnings ?? [])]),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + reviewTtlMs).toISOString()
      });
      reviews.set(review.id, review);
      try {
        await appendAudit({
          reviewId: review.id,
          platform: review.platform,
          operation: review.operation,
          action: 'inspected',
          details: { changeCount: review.changes.length, effect: review.effect }
        });
      } catch (error) {
        reviews.delete(review.id);
        throw error;
      }
      return review;
    },

    async apply(request) {
      const { review, approvedBy, approvedChanges, requestedIds } = getApprovedReviewChanges(request);
      if (review.effect !== 'write') throw new Error('Read-only operations cannot be applied');

      const adapter = getAdapter(review.platform);
      findCapability(adapter, review.operation);
      consumedReviews.add(review.id);
      try {
        await appendAudit({
          reviewId: review.id,
          platform: review.platform,
          operation: review.operation,
          action: 'apply-started',
          actor: approvedBy,
          details: { approvedChangeCount: requestedIds.length }
        });
      } catch (error) {
        consumedReviews.delete(review.id);
        throw error;
      }

      let receipt: IntegrationApplyReceipt;
      try {
        receipt = await adapter.apply({
          operation: review.operation,
          remoteRevision: review.remoteRevision,
          approvedChanges,
          idempotencyKey: review.id
        });
      } catch (error) {
        await appendAuditSafely({
          reviewId: review.id,
          platform: review.platform,
          operation: review.operation,
          action: 'apply-failed',
          actor: approvedBy,
          details: { errorType: toSafeErrorType(error) }
        });
        throw error;
      }
      if (!receiptMatches(receipt, requestedIds)) {
        await appendAuditSafely({
          reviewId: review.id,
          platform: review.platform,
          operation: review.operation,
          action: 'apply-outcome-unknown',
          actor: approvedBy,
          details: { errorType: 'ReceiptMismatch' }
        });
        throw new Error('Integration receipt does not match the approved changes; outcome is unknown');
      }
      await appendAuditSafely({
        reviewId: review.id,
        platform: review.platform,
        operation: review.operation,
        action: 'apply-succeeded',
        actor: approvedBy,
        details: { appliedChangeCount: receipt.appliedChangeIds.length }
      });
      return receipt;
    },

    async commitImport(request) {
      const { review, approvedBy, approvedChanges, requestedIds } = getApprovedReviewChanges(request);
      if (review.effect !== 'read') throw new Error('Write operations cannot be imported');
      if (approvedChanges.some(change => change.action === 'delete')) {
        throw new Error('Delete changes cannot be imported automatically');
      }
      const importPort = environment.importPort;
      if (!importPort) throw new Error('Integration import port is not configured');

      consumedReviews.add(review.id);
      try {
        await appendAudit({
          reviewId: review.id,
          platform: review.platform,
          operation: review.operation,
          action: 'import-started',
          actor: approvedBy,
          details: { approvedChangeCount: requestedIds.length }
        });
      } catch (error) {
        consumedReviews.delete(review.id);
        throw error;
      }

      let receipt: IntegrationApplyReceipt;
      try {
        receipt = await importPort.import({
          platform: review.platform,
          operation: review.operation,
          remoteRevision: review.remoteRevision,
          approvedChanges,
          approvedBy,
          approvalReason: request.approval.reason?.trim() || undefined,
          idempotencyKey: review.id
        });
      } catch (error) {
        await appendAuditSafely({
          reviewId: review.id,
          platform: review.platform,
          operation: review.operation,
          action: 'import-failed',
          actor: approvedBy,
          details: { errorType: toSafeErrorType(error) }
        });
        throw error;
      }
      if (!receiptMatches(receipt, requestedIds)) {
        await appendAuditSafely({
          reviewId: review.id,
          platform: review.platform,
          operation: review.operation,
          action: 'import-outcome-unknown',
          actor: approvedBy,
          details: { errorType: 'ReceiptMismatch' }
        });
        throw new Error('Integration receipt does not match the approved changes; outcome is unknown');
      }
      await appendAuditSafely({
        reviewId: review.id,
        platform: review.platform,
        operation: review.operation,
        action: 'import-succeeded',
        actor: approvedBy,
        details: { appliedChangeCount: receipt.appliedChangeIds.length }
      });
      return receipt;
    }
  });
};

export const createInMemoryIntegrationAuditPort = (): IntegrationAuditPort & Readonly<{
  events(): readonly IntegrationAuditEvent[];
}> => {
  const stored: IntegrationAuditEvent[] = [];
  return Object.freeze({
    async append(event) {
      stored.push(event);
    },
    events() {
      return stored.map(event => ({ ...event }));
    }
  });
};

export const createInMemoryIntegrationAdapter = (input: Readonly<{
  platform: IntegrationPlatform;
  capabilities: readonly IntegrationCapability[];
  inspection: IntegrationAdapterInspection;
  failApplyWith?: Error;
  receiptAppliedChangeIds?: readonly string[];
}>): IntegrationAdapter & Readonly<{ applied(): readonly IntegrationAdapterApplyRequest[] }> => {
  const appliedRequests: IntegrationAdapterApplyRequest[] = [];
  return Object.freeze({
    platform: input.platform,
    capabilities: Object.freeze([...input.capabilities]),
    async inspect() {
      return {
        remoteRevision: input.inspection.remoteRevision,
        changes: input.inspection.changes.map(cloneChange),
        warnings: [...(input.inspection.warnings ?? [])]
      };
    },
    async apply(request) {
      if (input.failApplyWith) throw input.failApplyWith;
      appliedRequests.push(request);
      return {
        reference: `memory://${input.platform}/${request.idempotencyKey}`,
        appliedChangeIds: input.receiptAppliedChangeIds
          ? [...input.receiptAppliedChangeIds]
          : request.approvedChanges.map(change => change.id),
        completedAt: new Date(0).toISOString()
      };
    },
    applied() {
      return [...appliedRequests];
    }
  });
};

export const createInMemoryIntegrationImportPort = (): IntegrationImportPort & Readonly<{
  imported(): readonly IntegrationImportExecutionRequest[];
}> => {
  const importedRequests: IntegrationImportExecutionRequest[] = [];
  return Object.freeze({
    async import(request) {
      importedRequests.push(request);
      return Object.freeze({
        reference: `memory://import/${request.platform}/${request.idempotencyKey}`,
        appliedChangeIds: Object.freeze(request.approvedChanges.map(change => change.id)),
        completedAt: new Date(0).toISOString()
      });
    },
    imported() {
      return [...importedRequests];
    }
  });
};
