import { describe, it, expect, beforeEach } from 'vitest';
import { auth } from '../services/auth';
import { Role, STORAGE_KEYS, User } from '../types';
import { secureSessionStorage } from '../services/secureStorage';

const baseSettings = {
  system_ready: true,
  school_active: true,
  assembly_time: '07:00',
  grace_period: 10,
  logo_url: ''
};

const seedLocalData = () => {
  const users: User[] = [
    {
      id: 'admin-1',
      username: 'admin',
      password: 'admin123',
      name: 'مسؤول',
      role: Role.SITE_ADMIN
    },
    {
      id: 'sup-1',
      username: 'supervisorUser',
      password: 'supPass',
      name: 'مشرف صف',
      role: Role.SUPERVISOR_CLASS
    },
    {
      id: 'watch-1',
      username: 'watcherUser',
      password: 'watch123',
      name: 'مستخدم مراقبة',
      role: Role.WATCHER
    }
  ];

  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  localStorage.setItem(
    STORAGE_KEYS.STUDENTS,
    JSON.stringify([
      { id: '2024001', name: '', class_name: '1A', section: 'A', guardian_phone: '0501112222' },
      { id: '2024002', name: '', class_name: '1A', section: 'A', guardian_phone: '0501112222' }
    ])
  );
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(baseSettings));
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  secureSessionStorage.clear();
  seedLocalData();
});

describe('Authentication flows', () => {
  it(
    'authenticates supervisor and watcher roles and rejects invalid credentials',
    async () => {
      const supervisorLogin = await auth.login('supervisorUser', 'supPass', 'staff');
      expect(supervisorLogin.success).toBe(true);
      expect(supervisorLogin.user?.role).toBe(Role.SUPERVISOR_CLASS);

      const watcherLogin = await auth.login('watcherUser', 'watch123', 'staff');
      expect(watcherLogin.success).toBe(true);
      expect(watcherLogin.user?.role).toBe(Role.WATCHER);

      const failedLogin = await auth.login('supervisorUser', 'wrong-pass', 'staff');
      expect(failedLogin.success).toBe(false);
    },
    15000
  );

  it('supports guardian (student/parent) login and fails on incorrect PIN', async () => {
    const guardianLogin = await auth.login('0501112222', '4001', 'guardian');
    expect(guardianLogin.success).toBe(true);
    expect(guardianLogin.user?.role).toBe(Role.GUARDIAN);

    const failedGuardian = await auth.login('0501112222', '9999', 'guardian');
    expect(failedGuardian.success).toBe(false);
  });
});
