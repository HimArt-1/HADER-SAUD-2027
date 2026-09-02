// =============================================================================
// نظام حاضر (Hader) - Local Provider
// =============================================================================
// LocalStorage-based database provider for fully offline operation

import { logger } from './logger';
import {
  Student, AttendanceRecord, ExitRecord, ViolationRecord, Notification,
  DashboardStats, ReportFilter, DailySummary, STORAGE_KEYS, SystemSettings,
  DiagnosticResult, Role, SchoolClass, User,
  ClassStatsSummary, AuthAuditLog, ClientErrorLog, ATTENDANCE_DEFAULTS,
  GuardianExcuseRecord, DismissalCallRequest, DismissalRecord, DismissalSchedule
} from '../types';
import {
  IDatabaseProvider, IStudentAffairsProvider, AuthAuditLogFilters, ClientErrorLogFilters, SqlQueueEntry,
  CACHE_TTL
} from './dbTypes';
import { staticCache, CACHE_KEYS } from './cache';
import { broadcastSettingsUpdate } from './settingsBroadcast';
import { buildBootstrapAdminUser, validateBootstrapAdmin } from './bootstrapAdmin';
import {
  mapStudent, mapAttendance, mapSettingsFromDB, mapSettingsToDB,
  mapNotificationRow,
  getLocalISODate, getLocalDateStr,
  normalizeStudentId, normalizeAssignedClasses, normalizeAssignedSections, buildStructureFromStudents,
  DEFAULT_LOCAL_ADMINS,
  readSqlQueue, pushSqlQueueEntry, sqlEscape, sqlValue, buildUpsertSql,
  safeParse, getSyncedDate, getSyncedISOString, getSyncedNow,
  buildClassSectionTargetId, getRandomMessage
} from './dbHelpers';
import { resolveRecorder } from './recorderResolver';
import { accessPolicy } from '../modules/access';
import {
  decideAttendanceTiming,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate
} from '../modules/attendance';

const { notificationMatchesUser } = accessPolicy;

// Module-level bootstrap admin validation (computed once at import time)
const bootstrapAdminStatus = validateBootstrapAdmin();
const isBootstrapAdminSecure = bootstrapAdminStatus.ok;

export class LocalProvider implements IDatabaseProvider, IStudentAffairsProvider {
  private listeners: (() => void)[] = [];

  constructor() {
    this.seed();
  }

  /**
   * Bootstrap: Initialize empty data structures with only essential defaults.
   * No dummy/test data - production ready.
   */
  private seed() {
    // Initialize empty students array (no dummy data)
    if (!localStorage.getItem(STORAGE_KEYS.STUDENTS)) {
      localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify([]));
    }

    // Initialize empty attendance logs
    if (!localStorage.getItem(STORAGE_KEYS.ATTENDANCE)) {
      localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify([]));
    }

    // Initialize empty exits
    if (!localStorage.getItem(STORAGE_KEYS.EXITS)) {
      localStorage.setItem(STORAGE_KEYS.EXITS, JSON.stringify([]));
    }

    // Initialize empty violations
    if (!localStorage.getItem(STORAGE_KEYS.VIOLATIONS)) {
      localStorage.setItem(STORAGE_KEYS.VIOLATIONS, JSON.stringify([]));
    }

    // Initialize empty notifications
    if (!localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) {
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify([]));
    }

    if (!localStorage.getItem(STORAGE_KEYS.GUARDIAN_EXCUSES)) {
      localStorage.setItem(STORAGE_KEYS.GUARDIAN_EXCUSES, JSON.stringify([]));
    }

    if (!localStorage.getItem(STORAGE_KEYS.DISMISSALS)) {
      localStorage.setItem(STORAGE_KEYS.DISMISSALS, JSON.stringify([]));
    }

    if (!localStorage.getItem(STORAGE_KEYS.DISMISSAL_CALLS)) {
      localStorage.setItem(STORAGE_KEYS.DISMISSAL_CALLS, JSON.stringify([]));
    }

    if (!localStorage.getItem(STORAGE_KEYS.DISMISSAL_SCHEDULES)) {
      localStorage.setItem(STORAGE_KEYS.DISMISSAL_SCHEDULES, JSON.stringify([]));
    }

    // Default System Settings (Required for app to function)
    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
      const defaultSettings: SystemSettings = {
        system_ready: true,
        school_active: true,
        logo_url: '',
        dark_mode: true,
        assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
        grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD,
        telemetry_retention_days: 90,
        security_settings: {
          maxLoginAttempts: 5,
          lockoutDurationMinutes: 30,
          sessionTimeoutMinutes: 480,
          requireStrongPassword: true,
          student_id_settings: {
            allow_edit: true,
            charset: 'numeric',
            length: 6,
            prefix: ''
          }
        }
      };
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(defaultSettings));
    }

    // Initialize empty classes (admin will add them)
    if (!localStorage.getItem(STORAGE_KEYS.CLASSES)) {
      localStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify([]));
    }

    // Bootstrap Admin User (Required for initial access)
    // Only the Site Admin is pre-created; other users are managed via Admin panel
    if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
      if (isBootstrapAdminSecure) {
        const bootstrapUsers: User[] = [
          buildBootstrapAdminUser()
        ];
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(bootstrapUsers));
      } else if (bootstrapAdminStatus.enabled) {
        const reasons = [...bootstrapAdminStatus.errors, ...bootstrapAdminStatus.warnings];
        console.warn(
          '[LocalProvider] لم يتم إنشاء حساب المدير الافتراضي لأن بيانات bootstrap غير مضبوطة أو ضعيفة.',
          reasons.length ? `الأسباب: ${reasons.join(' | ')}` : ''
        );
      }
    }
  }

  private get<T>(key: string): T[] {
    const item = localStorage.getItem(key);
    if (!item) return [];
    try {
      const parsed = JSON.parse(item);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object') {
        // Legacy support for old dictionary-based storage formats
        return Object.values(parsed) as T[];
      }
      return [];
    } catch (error) {
      console.warn(`[LocalProvider] Failed to parse ${key}, resetting entry`, error);
      localStorage.removeItem(key);
      return [];
    }
  }

  private set<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }

  private notifyListeners() {
    this.listeners.forEach(l => l());
  }

  private dispatchLocalStorageUpdate<T>(key: string, data: T[]): void {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: JSON.stringify(data)
    }));
  }

  private dispatchDismissalCallsUpdate(): void {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent('hader:dismissal-calls-updated'));
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('hader:dismissal_calls:channel');
        bc.postMessage({ type: 'calls_changed' });
        bc.close();
      }
    } catch {
      // BroadcastChannel is optional in local/offline mode.
    }
  }

  async getStudents(options?: { forceSync?: boolean }): Promise<Student[]> {
    return Promise.resolve(this.get<Student>(STORAGE_KEYS.STUDENTS));
  }

  async getStudentsByGuardian(guardian_phone: string): Promise<Student[]> {
    const all = this.get<Student>(STORAGE_KEYS.STUDENTS);
    return Promise.resolve(all.filter(s => s.guardian_phone === guardian_phone));
  }

  async getStudentById(id: string): Promise<Student | undefined> {
    const all = this.get<Student>(STORAGE_KEYS.STUDENTS);
    return Promise.resolve(all.find(s => s.id === id));
  }

  async saveStudents(students: Student[]): Promise<Student[]> {
    const existing = this.get<Student>(STORAGE_KEYS.STUDENTS);
    const newIds = new Set(students.map(s => s.id));
    const kept = existing.filter(s => !newIds.has(s.id));
    const all = [...kept, ...students];
    this.set(STORAGE_KEYS.STUDENTS, all);

    students.forEach((student) => {
      const columns = [
        'id',
        'name',
        'class_name',
        'section',
        'guardian_phone',
        'guardian_name',
        'is_active'
      ];
      const values = [
        sqlValue(student.id),
        sqlValue(student.name),
        sqlValue(student.class_name),
        sqlValue(student.section),
        sqlValue(student.guardian_phone ?? null),
        sqlValue(student.guardian_name ?? null),
        sqlValue(student.is_active ?? true)
      ];
      const sql = buildUpsertSql('students', columns, values, ['id']);
      pushSqlQueueEntry({
        id: `sql-${getSyncedNow()}-${Math.random().toString(16).slice(2)}`,
        table: 'students',
        action: 'upsert',
        sql,
        created_at: getSyncedISOString()
      });
    });
    return Promise.resolve(students);
  }

  async updateStudent(student: Student): Promise<Student> {
    const existing = this.get<Student>(STORAGE_KEYS.STUDENTS);
    const index = existing.findIndex(s => s.id === student.id);
    if (index !== -1) {
      existing[index] = student;
      this.set(STORAGE_KEYS.STUDENTS, existing);
    }
    return Promise.resolve(student);
  }

  async renameStudentId(currentId: string, nextId: string): Promise<Student> {
    const students = this.get<Student>(STORAGE_KEYS.STUDENTS);
    const targetIndex = students.findIndex(s => s.id === currentId);
    if (targetIndex === -1) {
      throw new Error('الطالب غير موجود');
    }

    students[targetIndex] = { ...students[targetIndex], id: nextId };
    this.set(STORAGE_KEYS.STUDENTS, students);

    const updateIds = <T extends { student_id: string }>(items: T[]) =>
      items.map(item => (item.student_id === currentId ? { ...item, student_id: nextId } : item));

    const attendance = updateIds(this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE));
    const exits = updateIds(this.get<ExitRecord>(STORAGE_KEYS.EXITS));
    const violations = updateIds(this.get<ViolationRecord>(STORAGE_KEYS.VIOLATIONS));

    this.set(STORAGE_KEYS.ATTENDANCE, attendance);
    this.set(STORAGE_KEYS.EXITS, exits);
    this.set(STORAGE_KEYS.VIOLATIONS, violations);

    const notifications = this.get<Notification>(STORAGE_KEYS.NOTIFICATIONS).map((item) => {
      if (item.target_audience !== 'student') return item;
      return item.target_id === currentId ? { ...item, target_id: nextId } : item;
    });
    this.set(STORAGE_KEYS.NOTIFICATIONS, notifications);

    return Promise.resolve(students[targetIndex]);
  }

  async deleteStudent(student_id: string): Promise<void> {
    const existing = this.get<Student>(STORAGE_KEYS.STUDENTS);
    const filtered = existing.filter(s => s.id !== student_id);
    this.set(STORAGE_KEYS.STUDENTS, filtered);
    return Promise.resolve();
  }

  async getAttendance(date?: string): Promise<AttendanceRecord[]> {
    const all = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    return Promise.resolve(uniqueAttendanceByStudentDate(all, date));
  }

  async getAttendanceRange(startDate: string, endDate: string): Promise<AttendanceRecord[]> {
    const all = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    // Simple lexicographical comparison for ISO dates (YYYY-MM-DD)
    return Promise.resolve(uniqueAttendanceByStudentDate(all.filter(a => a.date >= startDate && a.date <= endDate)));
  }

  async getAllAttendance(): Promise<AttendanceRecord[]> {
    return Promise.resolve(uniqueAttendanceByStudentDate(this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE)));
  }

  async saveAttendanceBatch(records: AttendanceRecord[]): Promise<void> {
    const current = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    this.set(STORAGE_KEYS.ATTENDANCE, uniqueAttendanceByStudentDate([...current, ...records]));
    return Promise.resolve();
  }

  async deleteAttendanceRange(startDate: string, endDate: string): Promise<void> {
    const current = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    const filtered = current.filter(a => a.date < startDate || a.date > endDate);
    this.set(STORAGE_KEYS.ATTENDANCE, filtered);
    return Promise.resolve();
  }

  async getStudentAttendance(student_id: string): Promise<AttendanceRecord[]> {
    const all = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    return Promise.resolve(
      uniqueAttendanceByStudentDate(all.filter(a => a.student_id === student_id))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    );
  }

  async markAttendance(id: string): Promise<{ success: boolean, message: string, record?: AttendanceRecord, student?: Student, stats?: { late_count: number, todayMinutes: number, totalMinutes: number } }> {
    const students = await this.getStudents();
    const student = students.find(s => s.id === id);
    if (!student) return Promise.resolve({ success: false, message: 'رقم الطالب غير صحيح' });

    const now = getSyncedDate();
    const allLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);

    const settings = await this.getSettings();
    const timing = decideAttendanceTiming({
      occurredAt: now,
      settings,
      holidays: settings.attendance_settings?.academic_holidays
    });
    if (timing.allowed === false) {
      return Promise.resolve({
        success: false,
        message: timing.reason === 'holiday'
          ? '⛔ عذراً، النظام متوقف اليوم (عطلة رسمية)'
          : 'تعذر تحديد وقت الحضور'
      });
    }
    const today = timing.date;
    const arrivalStatus = timing.status === 'absent' ? 'late' : timing.status;
    const isLate = arrivalStatus === 'late';
    const minutes_late = timing.minutes_late;

    const exists = allLogs.find(l => l.student_id === id && l.date === today);
    if (exists) {
      // ✅ إذا كان "غائب" → نسمح بالتعديل إلى "حاضر/متأخر"
      if (exists.status === 'absent') {
        exists.status = arrivalStatus;
        exists.minutes_late = minutes_late;
        exists.timestamp = timing.timestamp;
        this.set(STORAGE_KEYS.ATTENDANCE, allLogs);
        this.notifyListeners();

        window.dispatchEvent(new StorageEvent('storage', {
          key: STORAGE_KEYS.ATTENDANCE,
          newValue: JSON.stringify(allLogs)
        }));

        const studentLogs = allLogs.filter(l => l.student_id === id);
        const late_count = studentLogs.filter(l => l.status === 'late').length;
        const totalMinutes = studentLogs.reduce((sum, l) => sum + (l.minutes_late || 0), 0);

        return Promise.resolve({
          success: true,
          message: isLate ? `تم تحديث الحالة إلى متأخر (${minutes_late} دقيقة)` : 'تم تحديث الحالة إلى حاضر',
          record: exists,
          student,
          stats: { late_count, todayMinutes: minutes_late, totalMinutes }
        });
      }
      return Promise.resolve({ success: false, message: 'تم تسجيل الدخول مسبقاً لهذا اليوم' });
    }

    const newRecord: AttendanceRecord = {
      id: Math.random().toString(36).substr(2, 9),
      student_id: id,
      date: today,
      timestamp: timing.timestamp,
      status: arrivalStatus,
      minutes_late: minutes_late
    };

    const updatedLogs = [...allLogs, newRecord];
    this.set(STORAGE_KEYS.ATTENDANCE, updatedLogs);

    this.notifyListeners();

    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEYS.ATTENDANCE,
      newValue: JSON.stringify(updatedLogs)
    }));

    // Calculate student stats
    const studentLogs = updatedLogs.filter(l => l.student_id === id);
    const late_count = studentLogs.filter(l => l.status === 'late').length;
    const totalMinutes = studentLogs.reduce((sum, l) => sum + (l.minutes_late || 0), 0);
    const stats = { late_count, todayMinutes: minutes_late, totalMinutes };

    return Promise.resolve({
      success: true,
      message: isLate 
        ? getRandomMessage(settings?.late_messages, settings?.late_message, 'لقد تأخرت عن التجمع')
        : getRandomMessage(settings?.early_messages, settings?.early_message, 'أهلاً بك! وصلت في الوقت المناسب'),
      record: newRecord,
      student,
      stats
    });
  }

  async addManualAttendance(record: {
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
  }> {
    const students = await this.getStudents();
    const student = students.find(s => s.id === record.student_id);
    if (!student) return Promise.resolve({ success: false, message: 'رقم الطالب غير صحيح' });

    const settings = await this.getSettings();
    const timing = decideAttendanceTiming({
      occurredAt: new Date(`${record.date}T${record.time}`),
      settings,
      holidays: settings.attendance_settings?.academic_holidays
    });
    if (timing.allowed === false) {
      return Promise.resolve({
        success: false,
        message: timing.reason === 'holiday'
          ? '⛔ لا يمكن التحضير في يوم عطلة'
          : 'يرجى إدخال تاريخ ووقت صالحين'
      });
    }
    const arrivalStatus = timing.status === 'absent' ? 'late' : timing.status;

    const allLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    const exists = allLogs.find((l: AttendanceRecord) => l.student_id === record.student_id && l.date === record.date);
    if (exists) {
      // ✅ Allow updating absent records to present/late (matching HybridProvider)
      if (exists.status === 'absent') {
        exists.status = arrivalStatus;
        exists.minutes_late = timing.minutes_late;
        exists.timestamp = timing.timestamp;
        this.set(STORAGE_KEYS.ATTENDANCE, allLogs);
        this.notifyListeners();
        window.dispatchEvent(new StorageEvent('storage', {
          key: STORAGE_KEYS.ATTENDANCE,
          newValue: JSON.stringify(allLogs)
        }));
        return Promise.resolve({
          success: true,
          message: 'تم تحديث حالة الحضور بنجاح',
          record: exists,
          student,
          status: arrivalStatus,
          minutes_late: timing.minutes_late
        });
      }
      return Promise.resolve({ success: false, message: 'تم تسجيل حضور الطالب مسبقاً لهذا اليوم' });
    }

    const newRecord: AttendanceRecord = {
      id: Math.random().toString(36).substring(2, 11),
      student_id: record.student_id,
      date: record.date,
      timestamp: timing.timestamp,
      status: arrivalStatus,
      minutes_late: timing.minutes_late,
      recorded_by: null,
      recorded_by_label: 'local-admin',
      device_id: 'admin-manual'
    };

    const updatedLogs = [...allLogs, newRecord];
    this.set(STORAGE_KEYS.ATTENDANCE, updatedLogs);

    this.notifyListeners();

    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEYS.ATTENDANCE,
      newValue: JSON.stringify(updatedLogs)
    }));

    return Promise.resolve({
      success: true,
      message: arrivalStatus === 'late' ? 'تم تسجيل الحضور كمتأخر' : 'تم تسجيل الحضور بنجاح',
      record: newRecord,
      student,
      status: arrivalStatus,
      minutes_late: timing.minutes_late
    });
  }

  async addManualAbsence(record: {
    student_id: string;
    date: string;
  }): Promise<{
    success: boolean;
    message: string;
    record?: AttendanceRecord;
    student?: Student;
  }> {
    const students = await this.getStudents();
    const student = students.find(s => s.id === record.student_id);
    if (!student) return Promise.resolve({ success: false, message: 'رقم الطالب غير صحيح' });

    const allLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    const exists = allLogs.find((l: AttendanceRecord) => l.student_id === record.student_id && l.date === record.date);
    if (exists) {
      // ✅ Update existing record to absent (matching HybridProvider)
      exists.status = 'absent';
      exists.minutes_late = 0;
      this.set(STORAGE_KEYS.ATTENDANCE, allLogs);
      this.notifyListeners();
      window.dispatchEvent(new StorageEvent('storage', {
        key: STORAGE_KEYS.ATTENDANCE,
        newValue: JSON.stringify(allLogs)
      }));
      return Promise.resolve({
        success: true,
        message: 'تم تحديث الحالة إلى غياب',
        record: exists,
        student
      });
    }

    const newRecord: AttendanceRecord = {
      id: Math.random().toString(36).substring(2, 11),
      student_id: record.student_id,
      date: record.date,
      timestamp: new Date(record.date).toISOString(),
      status: 'absent',
      minutes_late: 0,
      recorded_by: null,
      recorded_by_label: 'local-admin',
      device_id: 'admin-manual'
    };

    const updatedLogs = [...allLogs, newRecord];
    this.set(STORAGE_KEYS.ATTENDANCE, updatedLogs);

    this.notifyListeners();

    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEYS.ATTENDANCE,
      newValue: JSON.stringify(updatedLogs)
    }));

    return Promise.resolve({
      success: true,
      message: 'تم تسجيل غياب الطالب بنجاح',
      record: newRecord,
      student
    });
  }

  async deleteAttendance(student_id: string, date: string): Promise<{ success: boolean; message: string }> {
    const allLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    const updatedLogs = allLogs.filter(l => !(l.student_id === student_id && l.date === date));

    if (updatedLogs.length === allLogs.length) {
      return Promise.resolve({ success: false, message: 'لا يوجد تسجيل للحذف' });
    }

    this.set(STORAGE_KEYS.ATTENDANCE, updatedLogs);
    this.notifyListeners();

    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEYS.ATTENDANCE,
      newValue: JSON.stringify(updatedLogs)
    }));

    return Promise.resolve({ success: true, message: 'تم حذف التسجيل بنجاح' });
  }

  subscribeToAttendance(callback: (record: AttendanceRecord) => void): { unsubscribe: () => void } {
    const localListener = () => {
      const allLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
      const lastLog = allLogs[allLogs.length - 1];
      if (lastLog) callback(lastLog);
    };
    this.listeners.push(localListener);

    const storageListener = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.ATTENDANCE && e.newValue) {
        const newLogs = JSON.parse(e.newValue) as AttendanceRecord[];
        const lastLog = newLogs[newLogs.length - 1];
        const today = getLocalISODate();
        if (lastLog && lastLog.date === today) {
          callback(lastLog);
        }
      }
    };
    window.addEventListener('storage', storageListener);

    return {
      unsubscribe: () => {
        window.removeEventListener('storage', storageListener);
        this.listeners = this.listeners.filter(l => l !== localListener);
      }
    };
  }

  async getUnmarkedStudents(date: string, class_name: string, section: string): Promise<Student[]> {
    const allStudents = await this.getStudentsByClass(class_name, section);
    const attendance = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    const markedStudentIds = new Set(
      attendance.filter(r => r.date === date).map(r => r.student_id)
    );
    return allStudents.filter(s => !markedStudentIds.has(s.id));
  }

  async bulkMarkAllPresent(params: {
    class_name: string;
    section: string;
    date: string;
  }): Promise<{
    success: boolean;
    message: string;
    count: number;
    students: Student[];
  }> {
    try {
      const allStudents = await this.getStudentsByClass(params.class_name, params.section);

      if (allStudents.length === 0) {
        return { success: false, message: 'لا يوجد طلاب في هذا الصف', count: 0, students: [] };
      }

      const settings = await this.getSettings();
      const timing = decideAttendanceTiming({
        occurredAt: new Date(`${params.date}T12:00:00`),
        settings,
        holidays: settings.attendance_settings?.academic_holidays
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ لا يمكن التحضير الجماعي في يوم عطلة'
            : 'تاريخ التحضير غير صالح',
          count: 0,
          students: []
        };
      }

      const attendance = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
      const markedStudentIds = new Set(
        attendance.filter((r: AttendanceRecord) => r.date === params.date).map((r: AttendanceRecord) => r.student_id)
      );

      const unmarkedStudents = allStudents.filter(s => !markedStudentIds.has(s.id));

      if (unmarkedStudents.length === 0) {
        return {
          success: true,
          message: 'جميع الطلاب مسجلين مسبقاً',
          count: allStudents.length,
          students: allStudents
        };
      }

      const newRecords: AttendanceRecord[] = unmarkedStudents.map(student => ({
        id: `att_${getSyncedNow()}_${student.id}`,
        student_id: student.id,
        date: params.date,
        timestamp: new Date(params.date).toISOString(),
        status: 'present',
        minutes_late: 0,
        recorded_by: null,
        recorded_by_label: 'local-admin',
        device_id: 'admin-bulk',
        created_at: getSyncedISOString()
      }));

      this.set(STORAGE_KEYS.ATTENDANCE, [...attendance, ...newRecords]);

      return {
        success: true,
        message: `تم تسجيل ${unmarkedStudents.length} طالب حاضرين`,
        count: allStudents.length,
        students: allStudents
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال', count: 0, students: [] };
    }
  }

  async bulkMarkAbsent(params: {
    student_ids: string[];
    date: string;
  }): Promise<{
    success: boolean;
    message: string;
    count: number;
  }> {
    try {
      if (params.student_ids.length === 0) {
        return { success: false, message: 'لم يتم تحديد أي طالب', count: 0 };
      }

      const settings = await this.getSettings();
      const timing = decideAttendanceTiming({
        occurredAt: new Date(`${params.date}T12:00:00`),
        settings,
        holidays: settings.attendance_settings?.academic_holidays
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ لا يمكن تسجيل الغياب الجماعي في يوم عطلة'
            : 'تاريخ الغياب غير صالح',
          count: 0
        };
      }

      const attendance = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);

      // Remove existing records for these students on this date
      const filtered = attendance.filter(
        (r: AttendanceRecord) => !(r.date === params.date && params.student_ids.includes(r.student_id))
      );

      // Add new absence records
      const absenceRecords: AttendanceRecord[] = params.student_ids.map(student_id => ({
        id: `att_${getSyncedNow()}_${student_id}`,
        student_id,
        date: params.date,
        timestamp: new Date(params.date).toISOString(),
        status: 'absent',
        minutes_late: 0,
        recorded_by: null,
        recorded_by_label: 'local-admin',
        device_id: 'admin-bulk',
        created_at: getSyncedISOString()
      }));

      this.set(STORAGE_KEYS.ATTENDANCE, [...filtered, ...absenceRecords]);

      return {
        success: true,
        message: `تم تسجيل ${params.student_ids.length} طالب غائبين`,
        count: params.student_ids.length
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال', count: 0 };
    }
  }

  async bulkMarkLate(params: {
    student_ids: string[];
    date: string;
    time: string;
  }): Promise<{
    success: boolean;
    message: string;
    count: number;
  }> {
    try {
      if (params.student_ids.length === 0) {
        return { success: false, message: 'لم يتم تحديد أي طالب', count: 0 };
      }

      const settings = await this.getSettings();
      const timing = decideAttendanceTiming({
        occurredAt: new Date(`${params.date}T${params.time}`),
        settings,
        holidays: settings.attendance_settings?.academic_holidays
      });
      if (timing.allowed === false) {
        return {
          success: false,
          message: timing.reason === 'holiday'
            ? '⛔ لا يمكن تسجيل التأخير الجماعي في يوم عطلة'
            : 'تاريخ أو وقت التأخير غير صالح',
          count: 0
        };
      }

      const attendance = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);

      // Remove existing records for these students on this date
      const filtered = attendance.filter(
        (r: AttendanceRecord) => !(r.date === params.date && params.student_ids.includes(r.student_id))
      );

      // Add new late records
      const lateRecords: AttendanceRecord[] = params.student_ids.map(student_id => ({
        id: `att_${getSyncedNow()}_${student_id}`,
        student_id,
        date: params.date,
        timestamp: timing.timestamp,
        status: 'late',
        minutes_late: timing.minutes_late,
        recorded_by: null,
        recorded_by_label: 'local-admin',
        device_id: 'admin-bulk',
        created_at: getSyncedISOString()
      }));

      this.set(STORAGE_KEYS.ATTENDANCE, [...filtered, ...lateRecords]);

      return {
        success: true,
        message: `تم تسجيل ${params.student_ids.length} طالب متأخرين`,
        count: params.student_ids.length
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'فشل الحفظ المحلي', count: 0 };
    }
  }

  async updateAttendanceStatus(params: {
    student_ids: string[];
    date: string;
    new_status: 'present' | 'absent' | 'late';
  }): Promise<{
    success: boolean;
    message: string;
    updated_count: number;
  }> {
    try {
      if (params.student_ids.length === 0) {
        return { success: false, message: 'لم يتم تحديد أي طالب', updated_count: 0 };
      }

      const attendance = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);

      // Remove existing records
      const filtered = attendance.filter(
        (r: AttendanceRecord) => !(r.date === params.date && params.student_ids.includes(r.student_id))
      );

      // Create new records with updated status
      const updatedRecords: AttendanceRecord[] = params.student_ids.map(student_id => ({
        id: `att_${getSyncedNow()}_${student_id}`,
        student_id,
        date: params.date,
        timestamp: new Date(params.date).toISOString(),
        status: params.new_status,
        minutes_late: params.new_status === 'late' ? 30 : 0,
        recorded_by: null,
        recorded_by_label: 'local-admin',
        device_id: 'admin-edit',
        created_at: getSyncedISOString()
      }));

      this.set(STORAGE_KEYS.ATTENDANCE, [...filtered, ...updatedRecords]);

      const statusText = params.new_status === 'present' ? 'حاضرين' : params.new_status === 'absent' ? 'غائبين' : 'متأخرين';

      return {
        success: true,
        message: `تم تحديث ${params.student_ids.length} طالب إلى ${statusText}`,
        updated_count: params.student_ids.length
      };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'حدث خطأ في الاتصال', updated_count: 0 };
    }
  }

  async getDailySummary(date: string): Promise<DailySummary | null> {
    const key = `${STORAGE_KEYS.DAILY_SHARE}:${date}`;
    const item = localStorage.getItem(key);
    return Promise.resolve(item ? JSON.parse(item) : null);
  }

  async saveDailySummary(summary: DailySummary): Promise<void> {
    const key = `${STORAGE_KEYS.DAILY_SHARE}:${summary.date}`;
    localStorage.setItem(key, JSON.stringify(summary));
    return Promise.resolve();
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const allStudents = await this.getStudents();
    // Filter active students only (matching HybridProvider behavior)
    const students = allStudents.filter(s => s.is_active !== false && (s.is_active as any) !== 0);
    const today = getLocalISODate();
    const logs = await this.getAttendance(today);
    const total = students.length;
    const counts = getAttendanceStatusCounts(logs, total, { date: today });
    const present = counts.present;
    const late = counts.late;
    const absent = counts.absent;
    const rate = total > 0 ? (counts.attended / total) * 100 : 0;
    return Promise.resolve({ total_students: total, present_count: present, late_count: late, absent_count: absent, attendance_rate: Math.round(rate) });
  }

  async getWeeklyStats(): Promise<any[]> {
    // Calculate real weekly stats from local attendance data
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
    const allStudents = await this.getStudents();
    const students = allStudents.filter(s => s.is_active !== false && (s.is_active as any) !== 0);
    const total = students.length;
    if (total === 0) return Promise.resolve(days.map(day => ({ day, presence: 0 })));

    const allLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);
    const result: any[] = [];
    const today = getSyncedDate();

    for (let i = 4; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const dayIndex = date.getDay();
      const dayLogs = uniqueAttendanceByStudentDate(allLogs, dateStr)
        .filter(l => l.status === 'present' || l.status === 'late');
      const presence = Math.round((dayLogs.length / total) * 100);
      result.push({ day: days[dayIndex] || days[0], presence });
    }
    return Promise.resolve(result);
  }

  async getClassStats(): Promise<any[]> {
    // Calculate real class stats from local data
    const allStudents = await this.getStudents();
    const students = allStudents.filter(s => s.is_active !== false && (s.is_active as any) !== 0);
    const today = getLocalISODate();
    const todayLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE).filter(l => l.date === today);
    const attendedIds = new Set(todayLogs.filter(l => l.status === 'present' || l.status === 'late').map(l => l.student_id));

    // Group students by class
    const classMap = new Map<string, number>();
    for (const s of students) {
      const cls = s.class_name || 'غير محدد';
      if (!classMap.has(cls)) classMap.set(cls, 0);
      if (!attendedIds.has(s.id)) {
        classMap.set(cls, (classMap.get(cls) || 0) + 1);
      }
    }

    return Promise.resolve(Array.from(classMap.entries()).map(([name, absent]) => ({ name, absent })));
  }

  async getAttendanceReport(filters: ReportFilter): Promise<{ summary: any, details: any[] }> {
    const allLogs = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE).filter(l => l.date >= filters.date_from && l.date <= filters.date_to);
    let students = await this.getStudents();
    if (filters.class_name) students = students.filter(s => s.class_name === filters.class_name);
    if (filters.section) students = students.filter(s => s.section === filters.section);
    const studentsById = new Map(students.map(student => [student.id, student]));

    const details = allLogs.map(log => {
      const s = studentsById.get(log.student_id);
      if (!s) return null;
      return { student_id: log.student_id, studentName: s.name, className: s.class_name, section: s.section, date: log.date, time: log.timestamp, status: log.status };
    }).filter(Boolean);

    return Promise.resolve({
      summary: { totalRecords: details.length, late: details.filter(d => d!.status === 'late').length, present: details.filter(d => d!.status === 'present').length },
      details: details as any[]
    });
  }

  async addExit(record: ExitRecord): Promise<void> {
    const exits = this.get<ExitRecord>(STORAGE_KEYS.EXITS);
    this.set(STORAGE_KEYS.EXITS, [...exits, { ...record, id: record.id || crypto.randomUUID() }]);
    return Promise.resolve();
  }

  async updateExit(exit: ExitRecord): Promise<void> {
    const exits = this.get<ExitRecord>(STORAGE_KEYS.EXITS);
    const index = exits.findIndex(e => e.id === exit.id);
    if (index !== -1) {
      exits[index] = { ...exits[index], ...exit };
      this.set(STORAGE_KEYS.EXITS, exits);
    }
    return Promise.resolve();
  }

  async deleteExit(id: string): Promise<void> {
    const exits = this.get<ExitRecord>(STORAGE_KEYS.EXITS).filter(e => e.id !== id);
    this.set(STORAGE_KEYS.EXITS, exits);
    return Promise.resolve();
  }

  async getTodayExits(): Promise<ExitRecord[]> {
    const today = getLocalISODate();
    return this.getExits(today);
  }

  async getExits(date?: string): Promise<ExitRecord[]> {
    let exits = this.get<ExitRecord>(STORAGE_KEYS.EXITS);
    if (date) exits = exits.filter(e => (e.date || e.exit_time || '').startsWith(date));
    return Promise.resolve(exits);
  }

  async getStudentExits(student_id: string): Promise<ExitRecord[]> {
    const exits = this.get<ExitRecord>(STORAGE_KEYS.EXITS).filter(e => e.student_id === student_id);
    return Promise.resolve(exits);
  }

  async addViolation(record: ViolationRecord): Promise<void> {
    const v = this.get<ViolationRecord>(STORAGE_KEYS.VIOLATIONS);
    const next = { ...record, id: record.id || crypto.randomUUID() };
    this.set(STORAGE_KEYS.VIOLATIONS, [
      ...v.filter(existing => existing.id !== next.id),
      next
    ]);
    return Promise.resolve();
  }

  async deleteViolation(id: string): Promise<void> {
    const violations = this.get<ViolationRecord>(STORAGE_KEYS.VIOLATIONS)
      .filter(violation => violation.id !== id);
    this.set(STORAGE_KEYS.VIOLATIONS, violations);
    return Promise.resolve();
  }

  async getViolations(student_id?: string): Promise<ViolationRecord[]> {
    let v = this.get<ViolationRecord>(STORAGE_KEYS.VIOLATIONS);
    if (student_id) v = v.filter(i => i.student_id === student_id);
    return Promise.resolve(v);
  }

  async getTodayViolations(): Promise<ViolationRecord[]> {
    const today = getLocalISODate();
    return this.getViolationsForDate(today);
  }

  async getViolationsForDate(date: string): Promise<ViolationRecord[]> {
    const v = this.get<ViolationRecord>(STORAGE_KEYS.VIOLATIONS).filter(i => (i.date || i.created_at || '').startsWith(date));
    return Promise.resolve(v);
  }

  async addGuardianExcuse(record: GuardianExcuseRecord): Promise<void> {
    const now = getSyncedISOString();
    const excuses = this.get<GuardianExcuseRecord>(STORAGE_KEYS.GUARDIAN_EXCUSES);
    this.set(STORAGE_KEYS.GUARDIAN_EXCUSES, [
      {
        ...record,
        id: record.id || crypto.randomUUID(),
        status: record.status || 'pending',
        created_at: record.created_at || now,
        updated_at: record.updated_at || now
      },
      ...excuses
    ]);
    return Promise.resolve();
  }

  async updateGuardianExcuse(record: GuardianExcuseRecord): Promise<void> {
    const excuses = this.get<GuardianExcuseRecord>(STORAGE_KEYS.GUARDIAN_EXCUSES);
    const index = excuses.findIndex(excuse => excuse.id === record.id);
    const next = {
      ...record,
      updated_at: record.updated_at || getSyncedISOString()
    };

    if (index >= 0) {
      excuses[index] = { ...excuses[index], ...next };
      this.set(STORAGE_KEYS.GUARDIAN_EXCUSES, excuses);
    } else {
      this.set(STORAGE_KEYS.GUARDIAN_EXCUSES, [next, ...excuses]);
    }
    return Promise.resolve();
  }

  async getGuardianExcuses(filters?: {
    student_id?: string;
    status?: GuardianExcuseRecord['status'] | 'all';
    limit?: number;
  }): Promise<GuardianExcuseRecord[]> {
    let excuses = this.get<GuardianExcuseRecord>(STORAGE_KEYS.GUARDIAN_EXCUSES);
    if (filters?.student_id) excuses = excuses.filter(excuse => excuse.student_id === filters.student_id);
    if (filters?.status && filters.status !== 'all') excuses = excuses.filter(excuse => excuse.status === filters.status);
    excuses = excuses.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return Promise.resolve(filters?.limit ? excuses.slice(0, filters.limit) : excuses);
  }

  async getStudentNotifications(student_id: string, className: string): Promise<Notification[]> {
    const n = this.get<Notification>(STORAGE_KEYS.NOTIFICATIONS);
    const filtered = n.filter(item =>
      item.target_audience === 'all' ||
      (item.target_audience === 'class' && item.target_id === className) ||
      (item.target_audience === 'student' && item.target_id === student_id) ||
      (item.target_audience === 'guardian' && (!item.target_id || item.target_id === student_id))
    );
    return Promise.resolve(filtered);
  }

  async getUserNotifications(user: User, limit = 30): Promise<Notification[]> {
    const all = this.get<Notification>(STORAGE_KEYS.NOTIFICATIONS);
    const matched = all.filter(notification => notificationMatchesUser(notification, user));
    return Promise.resolve(matched.slice(-limit).reverse());
  }

  async getAllNotifications(limit = 200): Promise<Notification[]> {
    const all = this.get<Notification>(STORAGE_KEYS.NOTIFICATIONS);
    const ordered = [...all].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return Promise.resolve(ordered.slice(0, limit));
  }

  subscribeToNotifications(user: User | 'kiosk', callback: (n: Notification) => void): { unsubscribe: () => void } {
    const localListener = () => {
      const all = this.get<Notification>(STORAGE_KEYS.NOTIFICATIONS);
      const last = all[all.length - 1];
      if (!last) return;
      if (notificationMatchesUser(last, user)) {
        callback(last);
      }
    };
    this.listeners.push(localListener);
    const storageListener = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.NOTIFICATIONS && e.newValue) {
        localListener();
      }
    };
    window.addEventListener('storage', storageListener);
    return {
      unsubscribe: () => {
        window.removeEventListener('storage', storageListener);
        this.listeners = this.listeners.filter(l => l !== localListener);
      },
    };
  }

  // Classes Management (LocalProvider)
  getClasses(): Promise<SchoolClass[]> {
    const classes = this.get<SchoolClass>(STORAGE_KEYS.CLASSES);
    // Return default classes if empty
    if (classes.length === 0) {
      return Promise.resolve([]);
    }
    return Promise.resolve(classes);
  }

  async getClassesGroupedByGrade(): Promise<Record<string, SchoolClass[]>> {
    const classes = await this.getClasses();
    return classes.reduce((acc, cls) => {
      const key = (cls.name || 'غير محدد').trim();
      if (!acc[key]) acc[key] = [];
      acc[key].push(cls);
      return acc;
    }, {} as Record<string, SchoolClass[]>);
  }

  async getStudentsByClass(className: string, section?: string): Promise<Student[]> {
    let students = this.get<Student>(STORAGE_KEYS.STUDENTS).filter(s => s.class_name === className);
    if (section) students = students.filter(s => s.section === section);
    return Promise.resolve(students);
  }

  async getClassProfileStats(className: string, section: string, fromDate: string, toDate: string): Promise<ClassStatsSummary> {
    const students = await this.getStudentsByClass(className, section);
    const studentIds = students.map(s => s.id);
    const days = Math.max(1, Math.floor((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1);

    const inRange = (date: string) => date >= fromDate && date <= toDate;

    const attendance = uniqueAttendanceByStudentDate(
      this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE)
        .filter(l => studentIds.includes(l.student_id) && inRange(l.date))
    );

    const exits = this.get<ExitRecord>(STORAGE_KEYS.EXITS)
      .filter(e => {
        const exitDate = (e.exit_time || '').split('T')[0];
        return studentIds.includes(e.student_id) && exitDate && inRange(exitDate);
      });

    const violations = this.get<ViolationRecord>(STORAGE_KEYS.VIOLATIONS)
      .filter(v => {
        const violationDate = (v.created_at || '').split('T')[0];
        return studentIds.includes(v.student_id) && violationDate && inRange(violationDate);
      });

    const counts = getAttendanceStatusCounts(attendance, studentIds.length * days);
    const present = counts.present;
    const late = counts.late;
    const absent = counts.absent;

    return Promise.resolve({
      present,
      late,
      absent,
      exits: exits.length,
      violations: violations.length,
      totalStudents: studentIds.length,
      days,
    });
  }

  saveClass(schoolClass: SchoolClass): Promise<void> {
    const classes = this.get<SchoolClass>(STORAGE_KEYS.CLASSES);
    // First try to find by id
    let idx = classes.findIndex(c => c.id === schoolClass.id);
    // If not found by id, try to find by name (normalized)
    if (idx < 0 && schoolClass.name) {
      const normalizedName = schoolClass.name.trim().toLowerCase();
      idx = classes.findIndex(c => (c.name || '').trim().toLowerCase() === normalizedName);
    }
    let entry = schoolClass;
    if (idx >= 0) {
      // Merge sections if updating existing class
      const existingSections = classes[idx].sections || [];
      const newSections = schoolClass.sections || [];
      const mergedSections = Array.from(new Set([...existingSections, ...newSections])).sort((a, b) => a.localeCompare(b));
      classes[idx] = { ...classes[idx], ...schoolClass, sections: mergedSections };
      entry = classes[idx];
    } else {
      const newClass = { ...schoolClass, id: schoolClass.id || Math.random().toString(36).slice(2, 11) };
      classes.push(newClass);
      entry = newClass;
    }
    this.set(STORAGE_KEYS.CLASSES, classes);

    const columns = ['id', 'name', 'sections', 'grade_level', 'is_active'];
    const values = [
      sqlValue(entry.id),
      sqlValue(entry.name),
      sqlValue(entry.sections ?? []),
      sqlValue(entry.grade_level ?? null),
      sqlValue(entry.is_active ?? true)
    ];
    const sql = buildUpsertSql('classes', columns, values, ['name']);
    pushSqlQueueEntry({
      id: `sql-${getSyncedNow()}-${Math.random().toString(16).slice(2)}`,
      table: 'classes',
      action: 'upsert',
      sql,
      created_at: getSyncedISOString()
    });
    return Promise.resolve();
  }

  deleteClass(classId: string): Promise<void> {
    const classes = this.get<SchoolClass>(STORAGE_KEYS.CLASSES).filter(c => c.id !== classId);
    this.set(STORAGE_KEYS.CLASSES, classes);
    return Promise.resolve();
  }

  // Users Management (LocalProvider)
  getUsers(): Promise<User[]> {
    let users = this.get<User>(STORAGE_KEYS.USERS);

    // Bootstrap: Create admin users if none exist
    if (users.length === 0) {
      const seeded: User[] = [];

      if (isBootstrapAdminSecure) {
        seeded.push(buildBootstrapAdminUser('admin-1'));
      }

      // Always include offline defaults to guarantee local login works
      seeded.push(...DEFAULT_LOCAL_ADMINS);

      this.set(STORAGE_KEYS.USERS, seeded);
      return Promise.resolve(seeded);
    }

    // Ensure default admins are present if local storage already had data
    const missingDefaults = DEFAULT_LOCAL_ADMINS.filter(
      seed => !users.some(u => (u.username || '').toLowerCase() === seed.username.toLowerCase())
    );
    if (missingDefaults.length > 0) {
      users = [...users, ...missingDefaults];
      this.set(STORAGE_KEYS.USERS, users);
    }

    return Promise.resolve(users.map(user => ({
      ...user,
      assigned_classes: normalizeAssignedClasses(user.assigned_classes),
      assigned_sections: normalizeAssignedSections(user.assigned_sections)
    })));
  }

  saveUser(user: User): Promise<User> {
    const users = this.get<User>(STORAGE_KEYS.USERS);
    let savedUser: User;
    const normalizedUser: User = {
      ...user,
      assigned_classes: user.role === Role.SUPERVISOR_CLASS ? (normalizeAssignedClasses(user.assigned_classes) ?? []) : null as any,
      assigned_sections: normalizeAssignedSections(user.assigned_sections)
    };

    const idx = users.findIndex(u => u.id === normalizedUser.id);
    if (idx >= 0) {
      users[idx] = normalizedUser;
      savedUser = users[idx];
    } else {
      const newUser = { ...normalizedUser, id: normalizedUser.id || Math.random().toString(36).substr(2, 9) };
      users.push(newUser);
      savedUser = newUser;
    }
    this.set(STORAGE_KEYS.USERS, users);

    const columns = [
      'id',
      'username',
      'password',
      'name',
      'role',
      'is_active',
      'email',
      'phone',
      'assigned_classes',
      'assigned_sections'
    ];
    const values = [
      sqlValue(savedUser.id),
      sqlValue(savedUser.username),
      sqlValue(savedUser.password ?? null),
      sqlValue(savedUser.name),
      sqlValue(savedUser.role),
      sqlValue(savedUser.is_active ?? true),
      sqlValue(savedUser.email ?? null),
      sqlValue(savedUser.phone ?? null),
      sqlValue(savedUser.assigned_classes ?? null),
      sqlValue(savedUser.assigned_sections ?? null)
    ];
    const sql = buildUpsertSql('users', columns, values, ['id']);
    pushSqlQueueEntry({
      id: `sql-${getSyncedNow()}-${Math.random().toString(16).slice(2)}`,
      table: 'users',
      action: 'insert',
      sql,
      created_at: getSyncedISOString()
    });
    return Promise.resolve(savedUser);
  }

  deleteUser(userId: string): Promise<void> {
    const users = this.get<User>(STORAGE_KEYS.USERS).filter(u => u.id !== userId);
    this.set(STORAGE_KEYS.USERS, users);
    return Promise.resolve();
  }

  // Settings Management (LocalProvider)
  getSettings(): Promise<SystemSettings> {
    // Check cache first
    const cached = staticCache.get<SystemSettings>(CACHE_KEYS.SETTINGS);
    if (cached) return Promise.resolve(cached);

    const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (settings) {
      try {
        const parsed = JSON.parse(settings);
        // Cache the settings
        staticCache.set(CACHE_KEYS.SETTINGS, parsed, CACHE_TTL.SETTINGS);
        return Promise.resolve(parsed);
      } catch (e) {
        console.error('Error parsing settings:', e);
      }
    }
    const defaults: SystemSettings = {
      system_ready: true,
      school_active: true,
      logo_url: '',
      school_name: '',
      principal_name: '',
      assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
      grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD,
      absence_time: ATTENDANCE_DEFAULTS.ABSENCE_TIME,
      telemetry_retention_days: 90,
      security_settings: {
        maxLoginAttempts: 5,
        lockoutDurationMinutes: 30,
        sessionTimeoutMinutes: 480,
        requireStrongPassword: true,
        student_id_settings: {
          allow_edit: true,
          charset: 'numeric',
          length: 6,
          prefix: ''
        }
      }
    };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(defaults));
    staticCache.set(CACHE_KEYS.SETTINGS, defaults, CACHE_TTL.SETTINGS);
    return Promise.resolve(defaults);
  }

  saveSettings(settings: SystemSettings): Promise<void> {
    try {
      // Ensure we're saving the complete settings object
      const settingsToSave = {
        ...settings,
        // Ensure kiosk_settings is properly nested
        kiosk_settings: settings.kiosk_settings || {}
      };
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settingsToSave));
      // Clear cache to force reload on next get
      staticCache.delete(CACHE_KEYS.SETTINGS);
      // Broadcast update event for any listeners (same tab)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hader:settings-updated', { detail: settingsToSave }));
      }
      // Broadcast to other tabs
      broadcastSettingsUpdate(settingsToSave);
      return Promise.resolve();
    } catch (e: any) {
      console.error('Error saving settings:', e);
      if (e?.name === 'QuotaExceededError' || e?.code === 22) {
        return Promise.reject(new Error('QuotaExceededError: Storage is full'));
      }
      return Promise.reject(e);
    }
  }

  async saveNotification(notification: Notification): Promise<void> {
    const notifications = this.get<Notification>(STORAGE_KEYS.NOTIFICATIONS);
    this.set(STORAGE_KEYS.NOTIFICATIONS, [...notifications, notification]);
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEYS.NOTIFICATIONS,
      newValue: JSON.stringify([...notifications, notification])
    }));
  }

  async saveNotifications(notifications: Notification[]): Promise<void> {
    const existing = this.get<Notification>(STORAGE_KEYS.NOTIFICATIONS);
    const all = [...existing, ...notifications];
    this.set(STORAGE_KEYS.NOTIFICATIONS, all);
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEYS.NOTIFICATIONS,
      newValue: JSON.stringify(all)
    }));
  }

  sendBroadcast(targetRole: string, message: string, title: string): Promise<void> {
    const notification: Notification = {
      id: Math.random().toString(36).substr(2, 9),
      title,
      message,
      type: 'announcement',
      target_audience: targetRole as any,
      created_at: getSyncedISOString(),
      is_popup: true
    };
    return this.saveNotification(notification);
  }

  runDiagnostics(): Promise<DiagnosticResult[]> {
    const students = this.get<Student>(STORAGE_KEYS.STUDENTS);
    const users = this.get<User>(STORAGE_KEYS.USERS);
    const classes = this.get<SchoolClass>(STORAGE_KEYS.CLASSES);
    const attendance = this.get<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE);

    const allowLocalFallbackEnv = String(import.meta.env.VITE_ALLOW_LOCAL_FALLBACK || '').toLowerCase();
    const allowLocalFallback = allowLocalFallbackEnv === '1' || allowLocalFallbackEnv === 'true' || allowLocalFallbackEnv === 'yes';
    const hasSupabaseConfig = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
    const unsafeProductionLocal = import.meta.env.PROD && !hasSupabaseConfig && !allowLocalFallback;

    const results: DiagnosticResult[] = [
      {
        key: 'storage_mode',
        title: 'وضع التخزين',
        status: unsafeProductionLocal ? 'error' : 'ok',
        message: unsafeProductionLocal
          ? 'الوضع المحلي يعمل داخل الإنتاج بدون مزامنة سحابية.'
          : 'النظام يعمل في الوضع المحلي (Local Storage)',
        hint: unsafeProductionLocal
          ? 'أكمل إعدادات Supabase أو فعّل VITE_ALLOW_LOCAL_FALLBACK بشكل صريح إذا كان هذا مقصودًا.'
          : undefined
      },
      {
        key: 'students_count',
        title: 'قاعدة بيانات الطلاب',
        status: students.length > 0 ? 'ok' : 'warning',
        message: students.length > 0 ? `يوجد ${students.length} طالب مسجل` : 'لا يوجد طلاب مسجلين',
        count: students.length,
        hint: students.length === 0 ? 'قم بإضافة طلاب من لوحة الإدارة' : undefined
      },
      {
        key: 'users_count',
        title: 'المستخدمين',
        status: users.length > 1 ? 'ok' : 'warning',
        message: `يوجد ${users.length} مستخدم`,
        count: users.length
      },
      {
        key: 'classes_count',
        title: 'الصفوف الدراسية',
        status: classes.length > 0 ? 'ok' : 'warning',
        message: classes.length > 0 ? `يوجد ${classes.length} صف` : 'لا يوجد صفوف',
        count: classes.length
      },
      {
        key: 'attendance_records',
        title: 'سجلات الحضور',
        status: 'ok',
        message: `إجمالي ${attendance.length} سجل حضور`,
        count: attendance.length
      }
    ];

    return Promise.resolve(results);
  }

  getAuthAuditLogs(_filters: AuthAuditLogFilters): Promise<AuthAuditLog[]> {
    return Promise.resolve([]);
  }

  getClientErrorLogs(_filters: ClientErrorLogFilters): Promise<ClientErrorLog[]> {
    return Promise.resolve([]);
  }

  cleanupTelemetryLogs(): Promise<{ auth_deleted: number; error_deleted: number }> {
    return Promise.resolve({ auth_deleted: 0, error_deleted: 0 });
  }

  // 🚪 Dismissals
  async addDismissal(record: DismissalRecord): Promise<void> {
    const now = getSyncedISOString();
    const dismissals = this.get<DismissalRecord>(STORAGE_KEYS.DISMISSALS);
    const nextRecord: DismissalRecord = {
      ...record,
      id: record.id || crypto.randomUUID(),
      student_id: String(record.student_id),
      date: record.date || getLocalISODate(),
      exit_time: record.exit_time || now,
      created_at: record.created_at || now
    };
    const next = [nextRecord, ...dismissals.filter(item => item.id !== nextRecord.id)];

    this.set(STORAGE_KEYS.DISMISSALS, next);
    this.dispatchLocalStorageUpdate(STORAGE_KEYS.DISMISSALS, next);
  }

  getTodayDismissals(): Promise<DismissalRecord[]> {
    const today = getLocalISODate();
    return Promise.resolve(
      this.get<DismissalRecord>(STORAGE_KEYS.DISMISSALS)
        .filter(record => record.date === today)
    );
  }

  getStudentDismissals(studentId: string): Promise<DismissalRecord[]> {
    const normalizedId = String(studentId);
    return Promise.resolve(
      this.get<DismissalRecord>(STORAGE_KEYS.DISMISSALS)
        .filter(record => String(record.student_id) === normalizedId)
        .sort((a, b) => (b.exit_time || '').localeCompare(a.exit_time || ''))
    );
  }

  getDismissalsByDateRange(startDate: string, endDate: string): Promise<DismissalRecord[]> {
    return Promise.resolve(
      this.get<DismissalRecord>(STORAGE_KEYS.DISMISSALS)
        .filter(record => record.date >= startDate && record.date <= endDate)
        .sort((a, b) => (b.exit_time || '').localeCompare(a.exit_time || ''))
    );
  }

  async isStudentDismissedToday(studentId: string): Promise<boolean> {
    const todayDismissals = await this.getTodayDismissals();
    const normalizedId = String(studentId);
    return todayDismissals.some(record => String(record.student_id) === normalizedId);
  }

  getDismissalSchedules(): Promise<DismissalSchedule[]> {
    return Promise.resolve(this.get<DismissalSchedule>(STORAGE_KEYS.DISMISSAL_SCHEDULES));
  }

  saveDismissalSchedules(schedules: DismissalSchedule[]): Promise<void> {
    const normalized = schedules.map(schedule => ({
      ...schedule,
      id: schedule.id || crypto.randomUUID(),
      days: Array.isArray(schedule.days) ? schedule.days : []
    }));

    this.set(STORAGE_KEYS.DISMISSAL_SCHEDULES, normalized);
    this.dispatchLocalStorageUpdate(STORAGE_KEYS.DISMISSAL_SCHEDULES, normalized);
    return Promise.resolve();
  }

  async addDismissalCall(call: DismissalCallRequest): Promise<void> {
    const now = getSyncedISOString();
    const calls = this.get<DismissalCallRequest>(STORAGE_KEYS.DISMISSAL_CALLS);
    const nextCall: DismissalCallRequest = {
      ...call,
      id: call.id || crypto.randomUUID(),
      student_id: String(call.student_id),
      status: call.status || 'pending',
      request_time: call.request_time || now
    };
    const next = [nextCall, ...calls.filter(item => item.id !== nextCall.id)];

    this.set(STORAGE_KEYS.DISMISSAL_CALLS, next);
    this.dispatchLocalStorageUpdate(STORAGE_KEYS.DISMISSAL_CALLS, next);
    this.dispatchDismissalCallsUpdate();

    try {
      await this.saveNotification({
        id: crypto.randomUUID(),
        title: 'نداء انصراف جديد',
        message: `نداء انصراف للطالب ${nextCall.student_name || nextCall.student_id} - الصف ${nextCall.class_name || ''} ${nextCall.section || ''}`.trim(),
        type: 'dismissal_call',
        target_audience: 'supervisor',
        target_id: buildClassSectionTargetId(nextCall.class_name, nextCall.section),
        is_popup: true,
        priority: 1,
        created_at: now
      });
    } catch (error) {
      logger.warn('LocalProvider', 'Failed to create dismissal call notification', error);
    }
  }

  getActiveDismissalCalls(): Promise<DismissalCallRequest[]> {
    return Promise.resolve(
      this.get<DismissalCallRequest>(STORAGE_KEYS.DISMISSAL_CALLS)
        .filter(call => call.status === 'pending' || call.status === 'called')
        .sort((a, b) => (b.request_time || '').localeCompare(a.request_time || ''))
    );
  }

  async updateDismissalCallStatus(callId: string, status: DismissalCallRequest['status']): Promise<void> {
    const now = getSyncedISOString();
    const calls = this.get<DismissalCallRequest>(STORAGE_KEYS.DISMISSAL_CALLS);
    const next = calls.map(call => {
      if (call.id !== callId) return call;
      return {
        ...call,
        status,
        ...(status === 'called' ? { called_at: now } : {}),
        ...(status === 'dismissed' ? { dismissed_at: now } : {})
      };
    });

    this.set(STORAGE_KEYS.DISMISSAL_CALLS, next);
    this.dispatchLocalStorageUpdate(STORAGE_KEYS.DISMISSAL_CALLS, next);
    this.dispatchDismissalCallsUpdate();
  }

  subscribeToDismissalCalls(callback: (calls: DismissalCallRequest[]) => void): { unsubscribe: () => void } {
    let active = true;
    let bc: BroadcastChannel | null = null;

    const emit = () => {
      if (!active) return;
      void this.getActiveDismissalCalls().then(calls => {
        if (active) callback(calls);
      });
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.DISMISSAL_CALLS) emit();
    };
    const onLocalEvent = () => emit();

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', onStorage);
      window.addEventListener('hader:dismissal-calls-updated', onLocalEvent);
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          bc = new BroadcastChannel('hader:dismissal_calls:channel');
          bc.onmessage = emit;
        }
      } catch {
        bc = null;
      }
    }

    emit();

    return {
      unsubscribe: () => {
        active = false;
        if (typeof window !== 'undefined') {
          window.removeEventListener('storage', onStorage);
          window.removeEventListener('hader:dismissal-calls-updated', onLocalEvent);
        }
        if (bc) bc.close();
      }
    };
  }

}

// ------------------------------------------------------------------
// 4. Facade (Main Database Class)
// ------------------------------------------------------------------
