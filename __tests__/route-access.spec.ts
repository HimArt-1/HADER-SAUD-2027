import { describe, expect, it } from 'vitest';
import { Role, User } from '../types';
import { accessPolicy } from '../modules/access';

const { canAccessRoute } = accessPolicy;

const makeUser = (role: Role): User => ({
  id: `${role}-user`,
  username: `${role}-username`,
  name: 'Tester',
  role
});

describe('route access policy', () => {
  it('limits diagnostics to site admins', () => {
    expect(canAccessRoute(makeUser(Role.SITE_ADMIN), 'diagnostics')).toBe(true);
    expect(canAccessRoute(makeUser(Role.SCHOOL_ADMIN), 'diagnostics')).toBe(false);
    expect(canAccessRoute(makeUser(Role.WATCHER), 'diagnostics')).toBe(false);
  });

  it('limits storage tools to admin roles', () => {
    expect(canAccessRoute(makeUser(Role.SITE_ADMIN), 'storage')).toBe(true);
    expect(canAccessRoute(makeUser(Role.SCHOOL_ADMIN), 'storage')).toBe(true);
    expect(canAccessRoute(makeUser(Role.GUARDIAN), 'storage')).toBe(false);
    expect(canAccessRoute(makeUser(Role.WATCHER), 'storage')).toBe(false);
  });

  it('allows dismissal display workflows only for operational staff roles', () => {
    expect(canAccessRoute(makeUser(Role.KIOSK), 'dismissalKiosk')).toBe(true);
    expect(canAccessRoute(makeUser(Role.SUPERVISOR_CLASS), 'callBoard')).toBe(true);
    expect(canAccessRoute(makeUser(Role.CALL_STATION), 'guardStation')).toBe(true);
    expect(canAccessRoute(makeUser(Role.GUARDIAN), 'dismissalKiosk')).toBe(false);
    expect(canAccessRoute(makeUser(Role.GUARDIAN), 'callBoard')).toBe(false);
  });
});
