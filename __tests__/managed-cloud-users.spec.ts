import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock('../services/supabase', () => ({ supabaseStatus: { isConfigured: true }, supabase: { rpc: mocks.rpc } }));
vi.mock('../services/secureStorage', () => ({ secureSessionStorage: { get: mocks.session } }));
import { saveManagedCloudUser, deleteManagedCloudUser } from '../services/surveys';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockReturnValue({ surveyAdminToken: 'test-session', surveyAdminExpiresAt: Date.now() + 60_000 });
});

describe('authenticated user administration', () => {
  it('sends edits through the server session and preserves omitted passwords', async () => {
    const draft = { id: 'existing', username: 'DH', name: 'مدير', role: 'school_admin' };
    mocks.rpc.mockResolvedValue({ data: draft, error: null });
    await expect(saveManagedCloudUser(draft)).resolves.toEqual(draft);
    expect(mocks.rpc).toHaveBeenCalledWith('save_hader_user', { p_session_token: 'test-session', p_user: draft });
    expect(mocks.rpc.mock.calls[0][1].p_user).not.toHaveProperty('password');
  });

  it.each([null, { surveyAdminExpiresAt: Date.now() + 60_000 }, { surveyAdminToken: 'expired', surveyAdminExpiresAt: 1 }])(
    'requires a valid administrative session before changing accounts', async session => {
      mocks.session.mockReturnValue(session);
      await expect(saveManagedCloudUser({})).rejects.toThrow('جلسة إدارة المستخدمين');
      await expect(deleteManagedCloudUser('existing')).rejects.toThrow('جلسة إدارة المستخدمين');
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ code: 'PGRST202', message: 'function absent from schema cache' }, 'خدمة إدارة المستخدمين غير مهيأة'],
    [{ code: '23505', message: 'duplicate key' }, 'اسم المستخدم مستخدم'],
    [{ message: 'جلسة إدارة الاستبيانات غير صالحة أو منتهية' }, 'انتهت جلسة إدارة المستخدمين'],
    [{ message: 'TypeError: Failed to fetch' }, 'تعذر تأكيد'],
    [{ message: 'لا يمكنك تعطيل حسابك الحالي' }, 'لا يمكنك تعطيل حسابك الحالي']
  ])('explains server failures for both saving and deletion', async (error, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(saveManagedCloudUser({})).rejects.toThrow(expected);
    await expect(deleteManagedCloudUser('existing')).rejects.toThrow(expected);
  });

  it('does not claim failure or success definitively after a lost connection', async () => {
    mocks.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(saveManagedCloudUser({})).rejects.toThrow('حدّث قائمة المستخدمين قبل إعادة المحاولة');
    await expect(deleteManagedCloudUser('existing')).rejects.toThrow('حدّث قائمة المستخدمين قبل إعادة المحاولة');
  });

  it('requires a server receipt for saving but accepts void deletion responses', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(saveManagedCloudUser({})).rejects.toThrow('لم يؤكد الخادم');
    await expect(deleteManagedCloudUser('existing')).resolves.toBeUndefined();
  });
});
