import { describe, expect, it, vi } from 'vitest';
import { Role, type User } from '../types';
import { createSessionUserResolver } from '../modules/access/sessionUserResolver';

const classSupervisor: User = {
  id: 'supervisor-1',
  username: 'supervisor',
  name: 'مشرف الصف',
  role: Role.SUPERVISOR_CLASS,
  assigned_classes: [{ class_name: 'الأول', sections: ['A'] }]
};

describe('session user resolver interface', () => {
  it('does not load the directory for roles without stored class scope', async () => {
    const getUsers = vi.fn(async () => [] as User[]);
    const resolver = createSessionUserResolver({ getUsers });
    const admin = { ...classSupervisor, role: Role.SCHOOL_ADMIN };

    await expect(resolver.resolve(admin)).resolves.toBe(admin);
    expect(getUsers).not.toHaveBeenCalled();
  });

  it('hydrates a class supervisor scope from the stored directory user', async () => {
    const storedUser: User = {
      ...classSupervisor,
      name: 'الاسم المخزن',
      assigned_classes: [{ class_name: 'الثاني', sections: ['B'] }],
      assigned_sections: ['B']
    };
    const resolver = createSessionUserResolver({
      getUsers: async () => [storedUser]
    });

    await expect(resolver.resolve(classSupervisor)).resolves.toMatchObject({
      name: 'الاسم المخزن',
      assigned_classes: [{ class_name: 'الثاني', sections: ['B'] }],
      assigned_sections: ['B']
    });
  });

  it('preserves the session user when the directory is unavailable', async () => {
    const resolver = createSessionUserResolver({
      getUsers: async () => { throw new Error('offline'); }
    });

    await expect(resolver.resolve(classSupervisor)).resolves.toBe(classSupervisor);
  });
});
