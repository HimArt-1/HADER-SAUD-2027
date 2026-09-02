import { db } from './db';

/** Shared roster entry point for application workflows. */
export const roster = db.getRosterModule();
