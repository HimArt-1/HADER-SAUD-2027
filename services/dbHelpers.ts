// =============================================================================
// نظام حاضر (Hader) - Database Helpers & Utilities
// =============================================================================
// Shared mapping, normalization, date, and local-storage utilities for providers

import {
    Student, AttendanceRecord, Notification, SystemSettings,
    STORAGE_KEYS, Role, User, ATTENDANCE_DEFAULTS
} from '../types';
import { SqlQueueEntry } from './dbTypes';
import { getSyncedDate, getSyncedNow, getSyncedISOString } from './timeSync';
export { normalizeAssignedClasses, normalizeAssignedSections } from './userAssignments';

export { getSyncedDate, getSyncedNow, getSyncedISOString };

// =============================================================================
// SQL Queue Helpers (for local-mode batch operations)
// =============================================================================

const SQL_QUEUE_KEY = STORAGE_KEYS.SQL_QUEUE;

export const readSqlQueue = (): SqlQueueEntry[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(SQL_QUEUE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const pushSqlQueueEntry = (entry: SqlQueueEntry) => {
    if (typeof window === 'undefined') return;
    const existing = readSqlQueue();
    const next = [entry, ...existing].slice(0, 200);
    localStorage.setItem(SQL_QUEUE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('hader:sql-queue-update'));
};

export const sqlEscape = (value: string) => value.replace(/'/g, "''");

export const sqlValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return Number.isFinite(value) ? `${value}` : 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'object') {
        return `'${sqlEscape(JSON.stringify(value))}'::jsonb`;
    }
    return `'${sqlEscape(String(value))}'`;
};

export const buildUpsertSql = (table: string, columns: string[], values: string[], conflictColumns: string[]) => {
    const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
    const updateClause = updateColumns.length > 0
        ? ` ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}`
        : '';
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})${updateClause};`;
};

// =============================================================================
// Default Local Admins (PBKDF2 hashed)
// =============================================================================

export const DEFAULT_LOCAL_ADMINS: User[] = [
    {
        id: 'adminhim-local',
        username: 'adminHim',
        name: 'مدير النظام',
        role: Role.SITE_ADMIN,
        password:
            '100000:256d63775b1eb3d40bd505344fa78575:2af061074e754758390e577bd7acd96a0129f5c5a02d57fd219a2e119e13097d',
        is_active: true
    },
    {
        id: 'admin-local',
        username: 'admin',
        name: 'مدير تجريبي (محلي فقط)',
        role: Role.SITE_ADMIN,
        password:
            '100000:03d815218edcacaf6abfc86a4a0271ca:7dbfa3a2c81ce0fef420dfde79c7c09ded5efaeec8a0dd660937e9553a983fcf',
        is_active: true
    }
];

// =============================================================================
// Data Mappers
// =============================================================================

export const mapStudent = (data: any): Student => ({
    id: String(data.id), // Ensure string - used for attendance and parent login
    name: data.name,
    class_name: data.class_name,
    section: data.section,
    guardian_phone: data.guardian_phone || '',
    guardian_name: data.guardian_name || '',
    is_active: data.is_active !== undefined ? data.is_active : true
});

export const mapAttendance = (data: any): AttendanceRecord => ({
    id: data.id,
    student_id: String(data.student_id || data.student_id),
    date: data.date,
    timestamp: data.timestamp || data.created_at || (data.date && data.time ? `${data.date}T${data.time}` : ''),
    status: (data.status === 'recorded' && data.type ? data.type : data.status || data.type),
    minutes_late: data.minutes_late || data.minutes_late || 0,
    recorded_by: data.recorded_by,
    recorded_by_label: data.recorded_by_label,
    device_id: data.device_id,
    created_at: data.created_at,
    updated_at: data.updated_at,
    _updated_at: data._updated_at
});

// Map settings from Supabase (snake_case) to TypeScript (camelCase)
export const mapSettingsFromDB = (data: any): SystemSettings => {
    const ks = typeof data.kiosk_settings === 'object' ? data.kiosk_settings : {};
    const isAdminThemeObject = (value: any) =>
        value &&
        typeof value === 'object' &&
        typeof value.primary_400 === 'string' &&
        typeof value.primary_500 === 'string' &&
        typeof value.secondary_500 === 'string';
    
    // 🔥 TOP-LEVEL columns are the single source of truth (when present); else JSONB kiosk_settings
    const assembly_time = data.assembly_time || ks?.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME;
    const grace_period = data.grace_period ?? ks?.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD;
    const absence_time =
        (data.absence_time != null && String(data.absence_time) !== '' ? String(data.absence_time) : undefined) ||
        (ks?.absence_time != null ? String(ks.absence_time) : undefined) ||
        ATTENDANCE_DEFAULTS.ABSENCE_TIME;
    const telemetry_retention_days = data.telemetry_retention_days ?? ks?.telemetry_retention_days ?? 90;
    const admin_theme = data.admin_theme ?? ks?.admin_theme;
    const theme =
        (isAdminThemeObject(data.theme) ? data.theme : undefined) ??
        (isAdminThemeObject(ks?.admin_theme_values) ? ks.admin_theme_values : undefined) ??
        (isAdminThemeObject(ks?.theme) ? ks.theme : undefined);

    return {
        system_ready: data.system_ready ?? true,
        school_active: data.school_active ?? true,
        logo_url: data.logo_url || '',
        school_name: data.school_name || '',
        principal_name: data.principal_name || '',
        dark_mode: data.dark_mode ?? true,
        admin_theme,
        assembly_time,
        grace_period,
        absence_time,
        telemetry_retention_days,
        theme,
        kiosk_settings: {
            ...ks,
            // Keep mirrored for legacy compatibility
            assembly_time,
            grace_period,
            absence_time,
            telemetry_retention_days
        },
        notification_templates: data.notification_templates ?? ks?.notification_templates,
        social_links: data.social_links || ks?.social_links,
        security_settings: data.security_settings ?? ks?.security_settings,
        attendance_settings: data.attendance_settings ?? ks?.attendance_settings,
        whatsapp_templates: data.whatsapp_templates ?? ks?.whatsapp_templates,
        whatsapp_triggers: data.whatsapp_triggers ?? ks?.whatsapp_triggers,
        whatsapp_autopilot: data.whatsapp_autopilot ?? ks?.whatsapp_autopilot,
        whatsapp_autopilot_time: data.whatsapp_autopilot_time ?? ks?.whatsapp_autopilot_time,
        work_days:
            (typeof data.attendance_settings === 'object' ? data.attendance_settings?.work_days : undefined) ??
            (typeof ks?.attendance_settings === 'object' ? ks.attendance_settings?.work_days : undefined) ??
            data.work_days ??
            [...ATTENDANCE_DEFAULTS.WORK_DAYS],
    };
};

// Map settings from TypeScript (camelCase) to Supabase (snake_case).
// Top-level: minimal scalars only; theme/templates/social/security/attendance JSON live under kiosk_settings.
export const mapSettingsToDB = (settings: SystemSettings, remoteRowId?: string | number | null): any => ({
    id: remoteRowId ?? '00000000-0000-0000-0000-000000000000',
    system_ready: settings.system_ready,
    school_active: settings.school_active,
    logo_url: settings.logo_url,
    school_name: settings.school_name,
    principal_name: settings.principal_name,
    dark_mode: settings.dark_mode,

    kiosk_settings: {
        ...(typeof settings.kiosk_settings === 'object' ? settings.kiosk_settings : {}),
        assembly_time: settings.assembly_time ?? ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
        grace_period: settings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD,
        absence_time: settings.absence_time ?? ATTENDANCE_DEFAULTS.ABSENCE_TIME,
        telemetry_retention_days: settings.telemetry_retention_days ?? 90,
        admin_theme: settings.admin_theme,
        admin_theme_values: settings.theme,
        social_links: settings.social_links,
        notification_templates: settings.notification_templates,
        whatsapp_templates: settings.whatsapp_templates,
        security_settings: settings.security_settings,
        attendance_settings: {
            ...(typeof settings.attendance_settings === 'object' ? settings.attendance_settings : {}),
            work_days: settings.work_days
        },
    },
});


// =============================================================================
// Notification Helpers
// =============================================================================

export const mapNotificationRow = (row: any): Notification => ({
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type,
    target_audience: row.target_audience,
    target_id: row.target_id ?? undefined,
    is_popup: row.is_popup ?? row.is_popup ?? false,
    priority: row.priority || 0,
    created_by: row.created_by ?? undefined,
    created_at: row.created_at
});

// =============================================================================
// Date Helpers
// =============================================================================

// Helper for Local Timezone Date String (YYYY-MM-DD)
// EXPORTED NOW to be used across pages for consistency
export const getLocalISODate = (): string => {
    const now = getSyncedDate();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().split('T')[0];
};

// Convert any Date object to local YYYY-MM-DD string (avoids UTC shift bug)
export const getLocalDateStr = (date: Date): string => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('T')[0];
};

// =============================================================================
// ID & Name Normalizers
// =============================================================================

const ARABIC_INDIC_DIGITS: Record<string, string> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9'
};

export const normalizeStudentId = (input: unknown): string => {
    if (input === null || input === undefined) return '';
    const raw = String(input).trim();
    if (!raw) return '';
    const normalizedDigits = raw.replace(/[٠-٩]/g, (digit) => ARABIC_INDIC_DIGITS[digit] || digit);
    const stripped = normalizedDigits.replace(/[\s\-_]+/g, '');
    return stripped ? stripped.toUpperCase() : '';
};

export const normalizeClassName = (input: unknown): string => {
    if (input === null || input === undefined) return '';
    const raw = String(input).trim();
    if (!raw) return '';
    return raw.replace(/\s+/g, ' ');
};

export const normalizeSectionName = (input: unknown): string => {
    if (input === null || input === undefined) return '';
    const raw = String(input).trim();
    if (!raw) return '';
    return raw.replace(/\s+/g, ' ').toUpperCase();
};

export const isActiveStudent = (student: Student): boolean =>
    student.is_active !== false && (student.is_active as any) !== 0;

export const buildClassSectionTargetId = (className: unknown, section?: unknown): string => {
    const normalizedClass = normalizeClassName(className);
    const normalizedSection = normalizeSectionName(section);
    return normalizedSection ? `${normalizedClass}::${normalizedSection}` : normalizedClass;
};

export function parseClassSectionTargetId(targetId: unknown): { className: string; section: string } {
    const raw = String(targetId ?? '').trim();
    const [className, section = ''] = raw.split('::');
    return {
        className: normalizeClassName(className),
        section: normalizeSectionName(section)
    };
}

/**
 * الواجهة الرئيسية لوحة عامة: لا تُقيَّد حسب دور المستخدم، لكنها تستبعد
 * سجلات الطلاب غير الموجودين في قائمة الطلاب النشطين المحمّلة.
 */
export function filterRowsByDashboardStudents<T extends { student_id: string }>(
    rows: T[],
    students: Student[]
): T[] {
    const dashboardStudentIds = new Set(students.map(student => student.id));
    return rows.filter(row => dashboardStudentIds.has(row.student_id));
}

// =============================================================================
// Message Bank Helper
// =============================================================================
export const getRandomMessage = (messages: string[] | undefined, singleMessage: string | undefined, defaultMessage: string): string => {
    if (messages && messages.length > 0) {
        const randomIndex = Math.floor(Math.random() * messages.length);
        return messages[randomIndex];
    }
    return singleMessage || defaultMessage;
};

// =============================================================================
// Structure Builder
// =============================================================================

export const buildStructureFromStudents = (students: Student[]) => {
    const structure = new Map<string, Set<string>>();
    const labelLookup = new Map<string, string>();
    let missingSections = 0;

    students.forEach((student) => {
        const classLabel = normalizeClassName(student.class_name);
        if (!classLabel) return;
        const classKey = classLabel.toLowerCase();
        if (!labelLookup.has(classKey)) {
            labelLookup.set(classKey, classLabel);
        }
        const label = labelLookup.get(classKey) || classLabel;
        const sectionLabel = normalizeSectionName(student.section);

        if (!sectionLabel) {
            missingSections += 1;
            if (!structure.has(label)) {
                structure.set(label, new Set());
            }
            return;
        }

        const sections = structure.get(label) || new Set<string>();
        sections.add(sectionLabel);
        structure.set(label, sections);
    });

    return { structure, missingSections };
};

// =============================================================================
// JSON parse helper
// =============================================================================

export const safeParse = <T>(value: string | null): T | null => {
    if (!value) return null;
    try {
        return JSON.parse(value) as T;
    } catch (error) {
        console.warn('[KioskStorage] Failed to parse JSON', error);
        return null;
    }
};
