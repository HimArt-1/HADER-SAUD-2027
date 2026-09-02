import { db } from './db';

/** Shared notification entry point for application workflows. */
export const notificationCenter = db.getNotificationsModule();
