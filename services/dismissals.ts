import { db } from './db';

/** Shared dismissal lifecycle entry point for application workflows. */
export const dismissals = db.getDismissalModule();
