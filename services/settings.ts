import { db } from './db';

/** Shared settings entry point for application workflows. */
export const appSettings = db.getSettingsModule();
