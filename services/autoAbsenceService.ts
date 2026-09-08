import { db, getLocalISODate } from './db';
import { isDateHoliday, getCachedHolidays } from './academicCalendarService';
import { logger } from './logger';
import { ATTENDANCE_DEFAULTS } from '../types';
import { supabaseStatus } from './supabase';
import { markCloudAutomaticAbsence } from './automaticAbsenceWriter';

/**
 * AutoAbsenceService
 * ═══════════════════════════════════════════════════════════════
 * Handles automatic marking of students as absent if they haven't
 * checked in by the configured cutoff time (default 09:00 AM).
 */
class AutoAbsenceService {
    private checkInterval: ReturnType<typeof setInterval> | null = null;
    private initialCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    private isRunning = false;

    /**
     * Initialize the background checker
     */
    init() {
        if (this.checkInterval) return;

        // Check every minute
        this.checkInterval = setInterval(() => this.checkAndProcess(), 60000);
        
        // Also check immediately on init
        this.initialCheckTimeout = setTimeout(() => {
            this.initialCheckTimeout = null;
            this.checkAndProcess();
        }, 5000);
        
        logger.info('AutoAbsence', 'Service initialized');
    }

    /**
     * Stop background timers when the active session should not process attendance.
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        if (this.initialCheckTimeout) {
            clearTimeout(this.initialCheckTimeout);
            this.initialCheckTimeout = null;
        }
    }

    /**
     * Main check logic
     */
    private async checkAndProcess() {
        if (this.isRunning) return;
        this.isRunning = true;

        try {
            // The server uses its own clock, roster and transaction-scoped lock.
            // Never queue a cloud-wide absence decision based on an offline roster.
            if (supabaseStatus.isConfigured) {
                const result = await markCloudAutomaticAbsence();
                if (result.success && result.completed && result.date) {
                    localStorage.setItem('hader:auto_absence:last_run', result.date);
                    if (result.records?.length) {
                        void db.notifyAutomaticAbsences(result.records).catch(error =>
                            logger.warn('AutoAbsence', 'Automatic absence notifications failed:', error));
                    }
                }
                return;
            }

            const now = new Date();
            const todayStr = getLocalISODate();
            
            // 1. Check if already run today on this device
            const lastRun = localStorage.getItem('hader:auto_absence:last_run');
            if (lastRun === todayStr) return;

            // 2. Load Settings
            const settings = await db.getSettings();
            if (settings?.school_active === false || settings?.system_ready === false) return;

            // Get cutoff time (priority: absence_time > auto_mark_time > default)
            const cutoffTimeStr = settings?.absence_time || settings?.attendance_settings?.auto_mark_time || '09:00';
            const [cutoffH, cutoffM] = cutoffTimeStr.split(':').map(Number);
            
            const currentH = now.getHours();
            const currentM = now.getMinutes();
            
            // 3. Check if we are past the cutoff
            const isPastCutoff = (currentH > cutoffH) || (currentH === cutoffH && currentM >= cutoffM);
            if (!isPastCutoff) return;

            logger.info('AutoAbsence', `Cutoff reached (${cutoffTimeStr}). Checking for unmarked students...`);

            // 4. Check if Today is a Holiday/Weekend
            const workDays = settings?.work_days ?? [...ATTENDANCE_DEFAULTS.WORK_DAYS];
            const holidays = settings?.attendance_settings?.academic_holidays ?? getCachedHolidays();
            
            if (isDateHoliday(todayStr, workDays, holidays)) {
                logger.info('AutoAbsence', 'Today is a holiday. Skipping auto-absence.');
                localStorage.setItem('hader:auto_absence:last_run', todayStr);
                return;
            }

            // 5. Get Unmarked Students
            // We need all active students
            const allStudents = await db.getStudents();
            if (allStudents.length === 0) {
                return;
            }

            // Get today's recorded attendance
            const todayAttendance = await db.getAttendance(todayStr);
            const markedIds = new Set(todayAttendance.map(r => r.student_id));
            
            // Filter students who have no record at all today
            const unmarkedIds = allStudents
                .filter(s => s.is_active !== false && (s.is_active as unknown) !== 0 && !markedIds.has(s.id))
                .map(s => s.id);

            if (unmarkedIds.length > 0) {
                logger.info('AutoAbsence', `Marking ${unmarkedIds.length} students as absent.`);
                
                const result = await db.bulkMarkAbsent({
                    student_ids: unmarkedIds,
                    date: todayStr,
                    only_unmarked: true
                });

                if (result.success) {
                    logger.info('AutoAbsence', `Successfully marked ${result.count} unmarked students as absent.`);
                } else {
                    logger.warn('AutoAbsence', `Auto-absence did not complete: ${result.message}`);
                    return;
                }
            } else {
                logger.info('AutoAbsence', 'All students are already marked.');
            }

            // 6. Record last run
            localStorage.setItem('hader:auto_absence:last_run', todayStr);

        } catch (error) {
            logger.error('AutoAbsence', 'Error during auto-absence processing:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Manual trigger for debugging or forced run
     */
    async forceRun() {
        if (this.isRunning) return;
        localStorage.removeItem('hader:auto_absence:last_run');
        return this.checkAndProcess();
    }
}

export const autoAbsenceService = new AutoAbsenceService();
