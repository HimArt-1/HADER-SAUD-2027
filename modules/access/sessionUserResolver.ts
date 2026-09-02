import { Role, type User } from '../../types';

export type UserDirectory = {
  getUsers(): Promise<User[]>;
};

export const createSessionUserResolver = (directory: UserDirectory) => Object.freeze({
  async resolve(sessionUser: User | null | undefined): Promise<User | null> {
    if (!sessionUser) return null;
    if (sessionUser.role !== Role.SUPERVISOR_CLASS) return sessionUser;

    try {
      const users = await directory.getUsers();
      const matchingUsers = users.filter(user =>
        user.id === sessionUser.id || user.username === sessionUser.username
      );
      const storedUser = matchingUsers.find(user => user.assigned_classes?.length) ?? matchingUsers[0];
      if (!storedUser) return sessionUser;

      return {
        ...sessionUser,
        ...storedUser,
        role: storedUser.role || sessionUser.role,
        assigned_classes: storedUser.assigned_classes?.length
          ? storedUser.assigned_classes
          : sessionUser.assigned_classes,
        assigned_sections: storedUser.assigned_sections?.length
          ? storedUser.assigned_sections
          : sessionUser.assigned_sections
      };
    } catch {
      return sessionUser;
    }
  }
});
