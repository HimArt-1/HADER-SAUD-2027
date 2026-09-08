import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../services/auth';
import { db } from '../services/db';
import { secureSessionStorage } from '../services/secureStorage';
import { Role, type User } from '../types';

const user: User = { id: 'audit-user', username: 'audit-user', password: 'AuditPass1', name: 'موظف اختبار', role: Role.WATCHER };

beforeEach(() => {
  vi.spyOn(db, 'getMode').mockReturnValue('local');
  vi.spyOn(db, 'getUsers').mockResolvedValue([{ ...user, is_active: false }]);
});

afterEach(() => vi.restoreAllMocks());

describe('authentication audit regressions', () => {
  it('rejects a disabled local staff account even with the correct password', async () => {
    const setSession = vi.spyOn(auth, 'setSession').mockImplementation(() => undefined);
    const result = await auth.login(user.username, user.password!, 'staff');
    expect(result.success).toBe(false);
    expect(setSession).not.toHaveBeenCalled();
  });

  it('does not renew an expired session on activity', () => {
    vi.spyOn(secureSessionStorage, 'get').mockReturnValue({
      user, token: 'test-token', createdAt: Date.now() - 20000, expiresAt: Date.now() - 1
    });
    const save = vi.spyOn(secureSessionStorage, 'save').mockImplementation(() => undefined);
    const logout = vi.spyOn(auth, 'logout').mockImplementation(() => undefined);
    auth.refreshSession(true);
    expect(save).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalledWith({ reason: 'SESSION_EXPIRED' });
  });

  it('returns no authorized user when requireRole rejects the role', () => {
    vi.spyOn(auth, 'getSession').mockReturnValue(user);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const refresh = vi.spyOn(auth, 'refreshSession').mockImplementation(() => undefined);
    expect(auth.requireRole([Role.SITE_ADMIN])).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
