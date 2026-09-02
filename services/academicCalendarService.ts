// =============================================================================
// نظام حاضر (Hader) - Academic Calendar Service
// =============================================================================
// Centralized holiday checking — used by Admin, Dashboard, Kiosk, Telegram Bot
//
// IMPORTANT: This module provides `isDateHoliday()` which checks BOTH:
//   1. Weekly off-days (work_days array, e.g. Fri+Sat off)
//   2. Specific-date holidays (academic_holidays array, e.g. midterm break)

import { AcademicHoliday, ATTENDANCE_DEFAULTS } from '../types';

// =============================================================================
// Storage Key
// =============================================================================
const CALENDAR_STORAGE_KEY = 'hader:academic:holidays';

// =============================================================================
// Core Holiday Check
// =============================================================================

/**
 * Check if a given date is a holiday (either weekly off-day or specific academic holiday).
 *
 * @param dateStr - Date string in YYYY-MM-DD format, or a Date object
 * @param workDays - Array of active workday indices (0=Sunday ... 6=Saturday). Defaults to Sun-Thu.
 * @param holidays - Array of AcademicHoliday objects with specific dates
 * @returns true if the date is a holiday (i.e., NOT a work day)
 */
export function isDateHoliday(
    dateStr: string | Date,
    workDays?: number[],
    holidays?: AcademicHoliday[]
): boolean {
    const date = typeof dateStr === 'string' ? new Date(dateStr + 'T00:00:00') : dateStr;
    const dayIndex = date.getDay(); // 0=Sun, 6=Sat
    const effectiveWorkDays = workDays ?? [...ATTENDANCE_DEFAULTS.WORK_DAYS];

    // Check 1: Is this day of the week an off-day?
    if (!effectiveWorkDays.includes(dayIndex)) {
        return true;
    }

    // Check 2: Is this a specific-date holiday?
    if (holidays && holidays.length > 0) {
        const dateKey = formatDateKey(date);
        return holidays.some(h => h.date === dateKey);
    }

    return false;
}

/**
 * Get the holiday info for a specific date (if any).
 * Returns the AcademicHoliday object if found, null otherwise.
 */
export function getHolidayInfo(
    dateStr: string | Date,
    holidays?: AcademicHoliday[]
): AcademicHoliday | null {
    if (!holidays || holidays.length === 0) return null;
    const date = typeof dateStr === 'string' ? new Date(dateStr + 'T00:00:00') : dateStr;
    const dateKey = formatDateKey(date);
    return holidays.find(h => h.date === dateKey) ?? null;
}

// =============================================================================
// Date Helpers
// =============================================================================

/** Format a Date to YYYY-MM-DD string (local timezone) */
export function formatDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Generate array of dates between start and end (inclusive) */
export function getDateRange(start: string, end: string): string[] {
    const dates: string[] = [];
    const current = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    while (current <= endDate) {
        dates.push(formatDateKey(current));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

/** Validate an exact local calendar key without accepting Date's rollover behaviour. */
export function isValidDateKey(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Inclusive range length calculated in UTC to avoid daylight-saving drift. */
export function getDateRangeLength(start: string, end: string): number {
    if (!isValidDateKey(start) || !isValidDateKey(end) || start > end) return 0;
    const [startYear, startMonth, startDay] = start.split('-').map(Number);
    const [endYear, endMonth, endDay] = end.split('-').map(Number);
    const diff = Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay);
    return Math.floor(diff / 86_400_000) + 1;
}

const HOLIDAY_TYPE_VALUES = new Set(['midterm', 'extended', 'national', 'exceptional']);

/** Remove malformed and duplicate entries before calendar data reaches operational screens. */
export function normalizeAcademicHolidays(value: unknown): AcademicHoliday[] {
    if (!Array.isArray(value)) return [];
    const byDate = new Map<string, AcademicHoliday>();

    value.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const raw = item as Record<string, unknown>;
        const date = typeof raw.date === 'string' ? raw.date : '';
        const label = typeof raw.label === 'string' ? raw.label.trim() : '';
        const type = typeof raw.type === 'string' ? raw.type : '';
        if (!isValidDateKey(date) || !label || !HOLIDAY_TYPE_VALUES.has(type)) return;
        byDate.set(date, { date, label, type: type as AcademicHoliday['type'] });
    });

    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// =============================================================================
// Local Storage Cache (for offline support)
// =============================================================================

/** Cache holidays to localStorage for offline use */
export function cacheHolidays(holidays: AcademicHoliday[]): void {
    try {
        localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(holidays));
    } catch { /* ignore quota errors */ }
}

/** Read cached holidays from localStorage */
export function getCachedHolidays(): AcademicHoliday[] {
    try {
        const raw = localStorage.getItem(CALENDAR_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// =============================================================================
// Holiday Type Metadata (for UI)
// =============================================================================

export const HOLIDAY_TYPES = {
    midterm: { label: 'عطلة نصف العام', color: 'orange', emoji: '🟠' },
    extended: { label: 'عطلة مطوّلة', color: 'blue', emoji: '🔵' },
    national: { label: 'عطلة وطنية', color: 'green', emoji: '🟢' },
    exceptional: { label: 'عطلة استثنائية', color: 'red', emoji: '🔴' },
} as const;
