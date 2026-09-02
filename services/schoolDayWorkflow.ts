import { createSchoolDayWorkflow } from '../modules/schoolDay';
import { db } from './db';
import { roster } from './roster';
import { appSettings } from './settings';
import { studentAffairs } from './studentAffairs';
import { resolveFullSessionUser } from './sessionUserResolver';

/** Production adapter for the school-day workflow. */
export const createDbSchoolDayWorkflow = () => createSchoolDayWorkflow(
  {
    getRoster: () => roster.load(),
    getSettings: () => appSettings.load(),
    getDailySummary: date => db.getDailySummary(date),
    getExits: date => studentAffairs.load({ type: 'exits', date }).then(result => result.exits),
    getViolations: date => studentAffairs.load({ type: 'violations', date }).then(result => result.violations),
    getAttendance: date => db.getAttendance(date)
  },
  resolveFullSessionUser
);
