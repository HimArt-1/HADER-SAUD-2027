import type { User } from '../types';
import { createSessionUserResolver } from '../modules/access/sessionUserResolver';
import { db } from './db';

const resolver = createSessionUserResolver({
  getUsers: () => db.getUsers()
});

export const resolveFullSessionUser = (
  sessionUser: User | null | undefined
): Promise<User | null> => resolver.resolve(sessionUser);
