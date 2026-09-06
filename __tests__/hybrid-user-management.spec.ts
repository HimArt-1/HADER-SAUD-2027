import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../types';

const mocks = vi.hoisted(() => ({
  save: vi.fn(), remove: vi.fn(), put: vi.fn(), deleteLocal: vi.fn(), tombstone: vi.fn(),
  pendingCount: vi.fn(), queue: vi.fn(), sync: vi.fn(), from: vi.fn(),
  status: { isConfigured: true }, hash: vi.fn(async () => 'hashed-password')
}));
vi.mock('../services/localDb', () => ({
  localDb: {
    users: { put: mocks.put, delete: mocks.deleteLocal, bulkPut: vi.fn(), toArray: vi.fn(async () => [{ id: 'stale' }]) },
    sync_queue: { where: () => ({ equals: () => ({ count: mocks.pendingCount }) }) }
  },
  queueChange: mocks.queue, recordSyncTombstone: mocks.tombstone,
  getSyncMeta: vi.fn(), setSyncMeta: vi.fn()
}));
vi.mock('../services/surveys', () => ({ saveManagedCloudUser: mocks.save, deleteManagedCloudUser: mocks.remove }));
vi.mock('../services/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabaseStatus: mocks.status, supabase: { from: mocks.from, channel: () => channel } };
});
vi.mock('../services/syncService', () => ({ syncService: { syncNow: mocks.sync, on: vi.fn() } }));
vi.mock('../services/security', () => ({ ensurePasswordForCloud: mocks.hash }));
vi.mock('../services/liveNotificationService', () => ({ liveNotificationService: {} }));
vi.mock('../services/settingsBroadcast', () => ({ broadcastSettingsUpdate: vi.fn() }));
vi.mock('../services/settingsRemoteId', () => ({ rememberRemoteSettingsPk: vi.fn(), resolveSettingsUpsertId: vi.fn() }));
vi.mock('../services/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { HybridProvider } from '../services/hybridProvider';

const draft = { id: '', name: 'حساب اختبار', username: 'test.user', password: 'TestPassword88', role: Role.WATCHER };
const provider = () => Object.create(HybridProvider.prototype) as HybridProvider;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.isConfigured = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  mocks.pendingCount.mockResolvedValue(0);
  mocks.put.mockResolvedValue(undefined);
  mocks.deleteLocal.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ ...draft, id: 'server-id', password: undefined });
});

describe('confirmed cloud user management', () => {
  it('returns the server identity and caches only after confirmation without a background queue', async () => {
    const result = await provider().saveUser(draft);
    expect(result.id).toBe('server-id');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ password: 'hashed-password' }));
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'server-id', _synced: true }));
    expect(mocks.put.mock.calls[0][0]).not.toHaveProperty('password');
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it.each(['offline', 'unconfigured', 'pending'])('rejects %s without local mutation or cloud call', async reason => {
    if (reason === 'offline') Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    if (reason === 'unconfigured') mocks.status.isConfigured = false;
    if (reason === 'pending') mocks.pendingCount.mockResolvedValue(1);
    await expect(provider().saveUser(draft)).rejects.toThrow();
    await expect(provider().deleteUser('existing')).rejects.toThrow();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.deleteLocal).not.toHaveBeenCalled();
    expect(mocks.tombstone).not.toHaveBeenCalled();
  });
  it('does not leave a new account or queued write after server rejection', async () => {
    mocks.save.mockRejectedValueOnce(new Error('اسم المستخدم مستخدم'));
    await expect(provider().saveUser(draft)).rejects.toThrow('اسم المستخدم');
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('preserves existing credentials when editing without a new password', async () => {
    await provider().saveUser({ ...draft, id: 'existing', password: '' });
    expect(mocks.save.mock.calls[0][0]).not.toHaveProperty('password');
    expect(mocks.hash).not.toHaveBeenCalled();
  });
  it('keeps the account and avoids a tombstone when the server refuses deletion', async () => {
    mocks.remove.mockRejectedValueOnce(new Error('لا يمكنك حذف الحساب المستخدم حالياً'));
    await expect(provider().deleteUser('current')).rejects.toThrow('حذف');
    expect(mocks.deleteLocal).not.toHaveBeenCalled();
    expect(mocks.tombstone).not.toHaveBeenCalled();
  });
  it('removes cached account and records tombstone only after confirmed deletion', async () => {
    await provider().deleteUser('existing');
    expect(mocks.remove).toHaveBeenCalledWith('existing');
    expect(mocks.tombstone).toHaveBeenCalledWith('users', 'existing');
    expect(mocks.deleteLocal).toHaveBeenCalledWith('existing');
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('does not report a committed operation as failed if the local cache fails', async () => {
    mocks.put.mockRejectedValueOnce(new Error('disk full'));
    await expect(provider().saveUser(draft)).resolves.toMatchObject({ id: 'server-id' });
    mocks.deleteLocal.mockRejectedValueOnce(new Error('disk full'));
    await expect(provider().deleteUser('existing')).resolves.toBeUndefined();
  });
  it('uses the authoritative cloud list instead of returning deleted cached accounts', async () => {
    mocks.from.mockReturnValue({ select: () => ({ order: async () => ({ data: [], error: null }) }) });
    expect(await provider().getUsers()).toEqual([]);
  });
});
