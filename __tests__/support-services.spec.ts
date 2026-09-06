import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncResult } from '../services/syncTypes';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), status: { isConfigured: true } }));
vi.mock('../services/supabase', () => ({ supabase: mocks, supabaseStatus: mocks.status }));
import { probeSupportTables, syncFailureMessage } from '../services/supportDiagnostics';
import { supportTelemetry } from '../services/supportTelemetry';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.isConfigured = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('support connection probes', () => {
  it('reports a failed table even when other tables are readable', async () => {
    mocks.from.mockImplementation(name => ({ select: () => ({ limit: () => ({ abortSignal: async () => ({
      error: name === 'attendance_logs' ? { message: 'permission denied', code: '42501' } : null
    }) }) }) }));
    const probes = await probeSupportTables(['users', 'students', 'attendance_logs']);
    expect(probes.filter(probe => !probe.accessible)).toEqual([
      { name: 'attendance_logs', accessible: false, code: '42501', error: 'permission denied' }
    ]);
  });

  it.each(['offline', 'unconfigured'])('does not label %s as a successful connection', async reason => {
    if (reason === 'offline') Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    else mocks.status.isConfigured = false;
    expect(await probeSupportTables(['settings'])).toEqual([expect.objectContaining({ accessible: false })]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('reports thrown network failures without dropping the other results', async () => {
    mocks.from.mockImplementation(() => { throw new Error('network unavailable'); });
    expect(await probeSupportTables(['classes'])).toEqual([
      { name: 'classes', accessible: false, error: 'network unavailable', code: 'EXCEPTION' }
    ]);
  });
});

describe('server support telemetry', () => {
  const query = (response: unknown) => {
    const builder = { select: vi.fn(), order: vi.fn(), range: vi.fn(), gte: vi.fn(), lte: vi.fn(), eq: vi.fn(), ilike: vi.fn(), or: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve) };
    for (const method of ['select', 'order', 'range', 'gte', 'lte', 'eq', 'ilike', 'or'] as const) builder[method].mockReturnValue(builder);
    mocks.from.mockReturnValue(builder);
    return builder;
  };
  it('loads real rows and preserves audit filters and pagination', async () => {
    const builder = query({ data: [{ id: 'audit-1' }], error: null });
    expect(await supportTelemetry.getAuthAuditLogs({ role: 'admin', limit: 10, offset: 20, from: '2026-09-01' })).toEqual([{ id: 'audit-1' }]);
    expect(mocks.from).toHaveBeenCalledWith('auth_audit_logs');
    expect(builder.range).toHaveBeenCalledWith(20, 29);
    expect(builder.eq).toHaveBeenCalledWith('actor_role', 'admin');
  });
  it.each(['getAuthAuditLogs', 'getClientErrorLogs'] as const)('propagates %s failures instead of returning an empty log', async method => {
    query({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(supportTelemetry[method]({})).rejects.toMatchObject({ code: '42501' });
  });
  it('calls cleanup RPC and reports its confirmed counts', async () => {
    mocks.rpc.mockResolvedValue({ data: { auth_deleted: 3, error_deleted: 2 }, error: null });
    expect(await supportTelemetry.cleanupTelemetryLogs(90)).toEqual({ auth_deleted: 3, error_deleted: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith('cleanup_telemetry_logs', { retention_days: 90 });
  });
  it('rejects offline cleanup and invalid retention before mutation', async () => {
    await expect(supportTelemetry.cleanupTelemetryLogs(0)).rejects.toThrow();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await expect(supportTelemetry.cleanupTelemetryLogs(90)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('manual sync outcome', () => {
  const result = (): SyncResult => ({ success: true, direction: 'bidirectional', startedAt: '', completedAt: '', duration: 1,
    pushed: { total: 0, success: 0, failed: 0, byTable: {} }, pulled: { total: 0, success: 0, failed: 0, byTable: {} },
    conflicts: { detected: 0, resolved: 0, pending: 0 }, errors: [] });
  it('keeps a successful outcome clear of errors', () => expect(syncFailureMessage(result())).toBeNull());
  it('explains skipped sync and partial failure', () => {
    const skipped = result();
    skipped.success = false;
    skipped.errors = [{ table: 'system', operation: 'UPSERT', timestamp: '', message: 'Offline' }];
    expect(syncFailureMessage(skipped)).toContain('غير متصل');
    const partial = result();
    partial.pushed.failed = 1;
    expect(syncFailureMessage(partial)).toContain('لم تكتمل');
  });
});
