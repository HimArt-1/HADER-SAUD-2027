// =============================================================================
// نظام حاضر (Hader) - Database Types & Interfaces
// =============================================================================
// Shared types, interfaces, and constants used across all database providers

import {
    Student, AttendanceRecord, ExitRecord, ViolationRecord, Notification,
    DashboardStats, ReportFilter, DailySummary, SystemSettings,
    DiagnosticResult, SchoolClass, User, Role,
    ClassStatsSummary, AuthAuditLog, ClientErrorLog,
    AuthAuditAction, ClientErrorSeverity, ClientErrorSource,
    GuardianExcuseRecord, AcademicHoliday
} from '../types';

// =============================================================================
// Configuration
// =============================================================================

export type StorageMode = 'cloud' | 'local' | 'hybrid';
export const CONFIG_KEY = 'hader:config:mode';

// Cache TTL configurations (in milliseconds)
export const CACHE_TTL = {
    STUDENTS: 5 * 60 * 1000,      // 5 minutes
    CLASSES: 30 * 60 * 1000,      // 30 minutes
    SETTINGS: 30 * 1000,          // 30 seconds (reduced for faster kiosk updates)
    ATTENDANCE: 30 * 1000,        // 30 seconds
    STATS: 60 * 1000,             // 1 minute
    USERS: 5 * 60 * 1000,         // 5 minutes
};

// Kiosk storage keys
export const KIOSK_CACHE_KEY = 'hader:kiosk:students';
export const KIOSK_QUEUE_KEY = 'hader:kiosk:queue';
export const KIOSK_SETTINGS_KEY = 'hader:kiosk:settings';
export const KIOSK_ATTENDANCE_KEY = 'hader:kiosk:attendance';
export const DEVICE_ID_KEY = 'hader:device-id';

export const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

// =============================================================================
// Sync State
// =============================================================================

export interface SyncState {
    status: 'idle' | 'syncing' | 'online' | 'offline' | 'error';
    pending: number;
    lastSync?: string;
    lastError?: string;
}
export type SyncStatus = SyncState;

// =============================================================================
// Kiosk Types
// =============================================================================

export interface KioskAttendanceEvent {
    id: string;
    student_id: string;
    status: 'present' | 'late' | 'absent';
    minutes_late: number;
    timestamp: string;
    date: string;
    device_id: string;
    kiosk_id?: string;
    created_at: string;
}

/** نتيجة `markAttendanceFast` (كشك / مسح سريع) — يجب أن تشمل `absent` عند التأخر الشديد */
export type MarkAttendanceFastResult = {
    ok: boolean;
    code: 'present' | 'late' | 'duplicate' | 'not_found' | 'closed';
    status?: 'present' | 'late' | 'absent';
    student?: Student;
    minutes_late?: number;
    timestamp?: string;
    message: string;
    stats?: { late_count: number; todayMinutes: number; totalMinutes: number };
};

export interface KioskStorage {
    loadSnapshot(): Promise<Student[] | null>;
    saveSnapshot(students: Student[]): Promise<void>;

    loadAttendanceCache(): Promise<string[]>;
    saveAttendanceCache(ids: string[]): Promise<void>;

    loadQueue(): Promise<KioskAttendanceEvent[]>;
    saveQueue(events: KioskAttendanceEvent[]): Promise<void>;
}

export type KioskSettingsType = {
    assembly_time?: string;
    grace_period?: number;
    absence_time?: string;
    work_days?: number[];
    academic_holidays?: AcademicHoliday[];
    late_message?: string;
    early_message?: string;
    late_messages?: string[];
    early_messages?: string[];
};

// =============================================================================
// SQL Queue (for local-mode batch operations)
// =============================================================================

export interface SqlQueueEntry {
    id: string;
    table: string;
    action: 'insert' | 'upsert';
    sql: string;
    created_at: string;
}

// =============================================================================
// Filter Types
// =============================================================================

export interface AuthAuditLogFilters {
    from?: string;
    to?: string;
    action?: AuthAuditAction;
    role?: Role | string;
    search?: string;
    limit?: number;
    offset?: number;
}

export interface ClientErrorLogFilters {
    from?: string;
    to?: string;
    severity?: ClientErrorSeverity;
    source?: ClientErrorSource;
    path?: string;
    search?: string;
    limit?: number;
    offset?: number;
}

// =============================================================================
// Database Provider Interface (The Contract)
// =============================================================================

/** Storage adapter surface owned by the student-affairs module. */
export interface IStudentAffairsProvider {
    addExit(record: ExitRecord): Promise<void>;
    updateExit(exit: ExitRecord): Promise<void>;
    deleteExit(id: string): Promise<void>;
    getExits(date?: string): Promise<ExitRecord[]>;
    getTodayExits(): Promise<ExitRecord[]>;
    getStudentExits(student_id: string): Promise<ExitRecord[]>;

    addViolation(record: ViolationRecord): Promise<void>;
    deleteViolation(id: string): Promise<void>;
    getViolations(student_id?: string): Promise<ViolationRecord[]>;
    getViolationsForDate(date: string): Promise<ViolationRecord[]>;
    getTodayViolations(): Promise<ViolationRecord[]>;

    addGuardianExcuse(record: GuardianExcuseRecord): Promise<void>;
    updateGuardianExcuse(record: GuardianExcuseRecord): Promise<void>;
    getGuardianExcuses(filters?: {
        student_id?: string;
        status?: GuardianExcuseRecord['status'] | 'all';
        limit?: number;
    }): Promise<GuardianExcuseRecord[]>;
}

export interface IDatabaseProvider {
    getStudents(options?: { forceSync?: boolean }): Promise<Student[]>;
    getStudentsByGuardian(guardian_phone: string): Promise<Student[]>;
    getStudentById(id: string): Promise<Student | undefined>;
    saveStudents(students: Student[]): Promise<Student[]>;
    updateStudent(student: Student): Promise<Student>;
    renameStudentId(currentId: string, nextId: string): Promise<Student>;
    deleteStudent(student_id: string): Promise<void>;

    getAttendance(date?: string): Promise<AttendanceRecord[]>;
    getAllAttendance(): Promise<AttendanceRecord[]>;
    saveAttendanceBatch(records: AttendanceRecord[]): Promise<void>;
    deleteAttendanceRange(startDate: string, endDate: string): Promise<void>;
    getAttendanceRange(startDate: string, endDate: string): Promise<AttendanceRecord[]>;
    getStudentAttendance(student_id: string): Promise<AttendanceRecord[]>;
    markAttendance(id: string): Promise<{
        success: boolean,
        message: string,
        record?: AttendanceRecord,
        student?: Student,
        stats?: { late_count: number, todayMinutes: number, totalMinutes: number }
    }>;
    addManualAttendance(record: {
        student_id: string;
        date: string;
        time: string;
    }): Promise<{
        success: boolean;
        message: string;
        record?: AttendanceRecord;
        student?: Student;
        status?: 'present' | 'late';
        minutes_late?: number;
    }>;
    addManualAbsence(record: {
        student_id: string;
        date: string;
    }): Promise<{
        success: boolean;
        message: string;
        record?: AttendanceRecord;
        student?: Student;
    }>;
    deleteAttendance(student_id: string, date: string): Promise<{ success: boolean; message: string }>;
    getUnmarkedStudents(date: string, class_name: string, section: string): Promise<Student[]>;
    bulkMarkAllPresent(params: {
        class_name: string;
        section: string;
        date: string;
    }): Promise<{
        success: boolean;
        message: string;
        count: number;
        students: Student[];
    }>;
    bulkMarkAbsent(params: {
        student_ids: string[];
        date: string;
    }): Promise<{
        success: boolean;
        message: string;
        count: number;
    }>;
    updateAttendanceStatus(params: {
        student_ids: string[];
        date: string;
        new_status: 'present' | 'absent' | 'late';
    }): Promise<{
        success: boolean;
        message: string;
        updated_count: number;
    }>;
    bulkMarkLate(params: {
        student_ids: string[];
        date: string;
        time: string;
    }): Promise<{
        success: boolean;
        message: string;
        count: number;
    }>;
    subscribeToAttendance(callback: (record: AttendanceRecord) => void): { unsubscribe: () => void };

    getDailySummary(date: string): Promise<DailySummary | null>;
    saveDailySummary(summary: DailySummary): Promise<void>;

    getDashboardStats(): Promise<DashboardStats>;
    getWeeklyStats(): Promise<any[]>;
    getClassStats(): Promise<any[]>;
    getAttendanceReport(filters: ReportFilter): Promise<{ summary: any, details: any[] }>;

    saveNotification(notification: Notification): Promise<void>;
    saveNotifications(notifications: Notification[]): Promise<void>;
    getStudentNotifications(student_id: string, className: string): Promise<Notification[]>;
    getUserNotifications(user: User, limit?: number): Promise<Notification[]>;
    getAllNotifications(limit?: number): Promise<Notification[]>;
    subscribeToNotifications(user: User | 'kiosk', callback: (n: Notification) => void): { unsubscribe: () => void };

    // Structure & Users
    getClasses(): Promise<SchoolClass[]>;
    getClassesGroupedByGrade(): Promise<Record<string, SchoolClass[]>>;
    getStudentsByClass(className: string, section?: string): Promise<Student[]>;
    getClassProfileStats(className: string, section: string, fromDate: string, toDate: string): Promise<ClassStatsSummary>;
    saveClass(schoolClass: SchoolClass): Promise<void>;
    deleteClass(classId: string): Promise<void>;

    getUsers(): Promise<User[]>;
    saveUser(user: User): Promise<User>;
    deleteUser(userId: string): Promise<void>;

    // Support Extensions
    getSettings(): Promise<SystemSettings>;
    saveSettings(settings: SystemSettings): Promise<void>;
    sendBroadcast(targetRole: string, message: string, title: string): Promise<void>;
    runDiagnostics(): Promise<DiagnosticResult[]>;
    getAuthAuditLogs(filters: AuthAuditLogFilters): Promise<AuthAuditLog[]>;
    getClientErrorLogs(filters: ClientErrorLogFilters): Promise<ClientErrorLog[]>;
    cleanupTelemetryLogs(retentionDays: number): Promise<{ auth_deleted: number; error_deleted: number }>;

    // Dismissals
    addDismissal(record: any): Promise<void>;
    getTodayDismissals(): Promise<any[]>;
    getStudentDismissals(studentId: string): Promise<any[]>;
    getDismissalsByDateRange(startDate: string, endDate: string): Promise<any[]>;
    isStudentDismissedToday(studentId: string): Promise<boolean>;

    getDismissalSchedules(): Promise<any[]>;
    saveDismissalSchedules(schedules: any[]): Promise<void>;

    addDismissalCall(call: any): Promise<void>;
    getActiveDismissalCalls(): Promise<any[]>;
    updateDismissalCallStatus(callId: string, status: string): Promise<void>;
    subscribeToDismissalCalls(callback: (calls: any[]) => void): { unsubscribe: () => void };
}
