import { db } from './db';

/** Shared student-affairs entry point for application workflows. */
export const studentAffairs = db.getStudentAffairsModule();
