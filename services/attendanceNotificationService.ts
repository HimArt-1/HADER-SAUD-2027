// =============================================================================
// نظام حاضر (Hader) - Attendance Notification Service
// =============================================================================
// خدمة إشعارات الحضور التلقائية - تُرسل إشعارات للتأخر والغياب

import { db, getLocalISODate } from './db';
import { logger } from './logger';
import { Notification, Student, AttendanceRecord, SystemSettings, ATTENDANCE_DEFAULTS } from '../types';
import { whatsappGateway } from './whatsappGateway';
import { notificationCenter } from './notifications';
import { acquireDistributedLock } from './distributedLock';

// ==========================================
// Types
// ==========================================

export interface AttendanceNotificationConfig {
    enabled: boolean;
    notifyOnLate: boolean;
    notifyOnAbsent: boolean;
    notifyGuardians: boolean;
    notifySupervisors: boolean;
    lateThresholdMinutes: number;  // عدد الدقائق بعد وقت الطابور
    checkIntervalMinutes: number;   // فترة الفحص
}

export const DEFAULT_NOTIFICATION_CONFIG: AttendanceNotificationConfig = {
    enabled: true,
    notifyOnLate: true,
    notifyOnAbsent: true,
    notifyGuardians: true,
    notifySupervisors: true,
    lateThresholdMinutes: 15,
    checkIntervalMinutes: 30
};

// ==========================================
// Storage Keys
// ==========================================

const STORAGE_KEY = 'hader:attendance_notifications';
const LAST_CHECK_KEY = 'hader:attendance_notifications:last_check';
const SENT_TODAY_KEY = 'hader:attendance_notifications:sent_today';

// ==========================================
// Attendance Notification Service
// ==========================================

class AttendanceNotificationService {
    private config: AttendanceNotificationConfig;
    private checkInterval: ReturnType<typeof setInterval> | null = null;
    private isRunning: boolean = false;

    constructor() {
        this.config = this.loadConfig();
    }

    // ==========================================
    // Configuration
    // ==========================================

    private loadConfig(): AttendanceNotificationConfig {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return { ...DEFAULT_NOTIFICATION_CONFIG, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('[AttendanceNotifications] Failed to load config:', e);
        }
        return DEFAULT_NOTIFICATION_CONFIG;
    }

    saveConfig(config: Partial<AttendanceNotificationConfig>): void {
        this.config = { ...this.config, ...config };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    }

    getConfig(): AttendanceNotificationConfig {
        return { ...this.config };
    }

    // ==========================================
    // Sent Notifications Tracking
    // ==========================================

    private getSentToday(): Set<string> {
        try {
            const today = getLocalISODate();
            const saved = localStorage.getItem(SENT_TODAY_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                if (data.date === today) {
                    return new Set(data.ids);
                }
            }
        } catch (e) {
            console.error('[AttendanceNotifications] Failed to load sent today:', e);
        }
        return new Set();
    }

    private markAsSent(notificationKey: string): void {
        const today = getLocalISODate();
        const sent = this.getSentToday();
        sent.add(notificationKey);
        localStorage.setItem(SENT_TODAY_KEY, JSON.stringify({
            date: today,
            ids: Array.from(sent)
        }));
    }

    private wasAlreadySent(notificationKey: string): boolean {
        return this.getSentToday().has(notificationKey);
    }

    // ==========================================
    // Notification Creation
    // ==========================================

    private buildLateNotifications(
        student: Student,
        record: AttendanceRecord,
        settings: SystemSettings | null
    ): { notifications: Notification[]; whatsappPayload?: { phone: string; message: string; student_name: string; status_label: string } } {
        const notificationKey = `late:${student.id}:${getLocalISODate()}`;

        if (this.wasAlreadySent(notificationKey)) {
            return { notifications: [] };
        }

        const notifications: Notification[] = [];
        const time = record.timestamp
            ? new Date(record.timestamp).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
            : 'غير محدد';

        // إشعار للمشرفين
        if (this.config.notifySupervisors) {
            notifications.push({
                id: crypto.randomUUID(),
                title: '⏰ تأخر طالب',
                message: `تأخر الطالب ${student.name} (${student.class_name} - ${student.section}) عن الحضور. وقت الوصول: ${time}`,
                type: 'attendance',
                target_audience: 'supervisor',
                is_popup: false,
                created_at: new Date().toISOString()
            });
        }

        let whatsappPayload: { phone: string; message: string; student_name: string; status_label: string } | undefined;

        if (this.config.notifyGuardians && student.guardian_phone) {
            notifications.push({
                id: crypto.randomUUID(),
                title: 'تنبيه تأخر',
                message: `نفيدكم بتأخر الطالب ${student.name} عن الحضور اليوم. وقت الوصول: ${time}`,
                type: 'attendance',
                target_audience: 'guardian',
                target_id: student.id,
                is_popup: false,
                created_at: new Date().toISOString()
            });

            // 📱 WhatsApp Notification
            if (settings?.whatsapp_triggers?.on_late) {
                const template = settings.whatsapp_templates?.find(t => t.category === 'late') ||
                    settings.whatsapp_templates?.[0];

                let content = template?.content || `السلام عليكم، نفيدكم بتأخر الطالب {StudentName} عن الحضور اليوم {Date}. وقت الحضور: {Time}.`;

                content = content.replace(/\{(StudentName|student_name|name|student|اسم|الطالب|اسم_الطالب)\}/gi, student.name)
                    .replace(/\{(Date|date|تاريخ|التاريخ)\}/gi, getLocalISODate())
                    .replace(/\{(Time|time|وقت|الوقت)\}/gi, time)
                    .replace(/\{(Class|class|class_name|فصل|الفصل|الصف)\}/gi, student.class_name || '')
                    .replace(/\{(Section|section|شعبة|الشعبة|القسم)\}/gi, student.section || '');

                whatsappPayload = {
                    phone: student.guardian_phone,
                    message: content,
                    student_name: student.name,
                    status_label: 'تأخر'
                };
            }
        }

        this.markAsSent(notificationKey);
        return { notifications, whatsappPayload };
    }

    private buildAbsentNotifications(
        student: Student,
        settings: SystemSettings | null
    ): { notifications: Notification[]; whatsappPayload?: { phone: string; message: string; student_name: string; status_label: string } } {
        const notificationKey = `absent:${student.id}:${getLocalISODate()}`;

        if (this.wasAlreadySent(notificationKey)) {
            return { notifications: [] };
        }

        const notifications: Notification[] = [];

        // إشعار للمشرفين
        if (this.config.notifySupervisors) {
            notifications.push({
                id: crypto.randomUUID(),
                title: '🚫 غياب طالب',
                message: `الطالب ${student.name} (${student.class_name} - ${student.section}) غائب اليوم.`,
                type: 'attendance',
                target_audience: 'supervisor',
                is_popup: false,
                created_at: new Date().toISOString()
            });
        }

        let whatsappPayload: { phone: string; message: string; student_name: string; status_label: string } | undefined;

        // إشعار لولي الأمر
        if (this.config.notifyGuardians && student.guardian_phone) {
            notifications.push({
                id: crypto.randomUUID(),
                title: 'تنبيه غياب',
                message: `نفيدكم بغياب الطالب ${student.name} اليوم. نرجو التواصل مع الإدارة لتوضيح السبب.`,
                type: 'attendance',
                target_audience: 'guardian',
                target_id: student.id,
                is_popup: false,
                created_at: new Date().toISOString()
            });

            // 📱 WhatsApp Notification
            if (settings?.whatsapp_triggers?.on_absent) {
                const template = settings.whatsapp_templates?.find(t => t.category === 'absence') ||
                    settings.whatsapp_templates?.[0];

                let content = template?.content || `السلام عليكم، نفيدكم بغياب الطالب {StudentName} اليوم {Date}. نرجو تزويدنا بسبب الغياب.`;

                content = content.replace(/\{(StudentName|student_name|name|student|اسم|الطالب|اسم_الطالب)\}/gi, student.name)
                    .replace(/\{(Date|date|تاريخ|التاريخ)\}/gi, getLocalISODate())
                    .replace(/\{(Class|class|class_name|فصل|الفصل|الصف)\}/gi, student.class_name || '')
                    .replace(/\{(Section|section|شعبة|الشعبة|القسم)\}/gi, student.section || '');

                whatsappPayload = {
                    phone: student.guardian_phone,
                    message: content,
                    student_name: student.name,
                    status_label: 'غياب'
                };
            }
        }

        this.markAsSent(notificationKey);
        return { notifications, whatsappPayload };
    }

    // ==========================================
    // Main Check Logic
    // ==========================================

    async checkAttendance(): Promise<{ late: number; absent: number }> {
        if (!this.config.enabled) {
            return { late: 0, absent: 0 };
        }

        let lateCount = 0;
        let absentCount = 0;

        try {
            const today = getLocalISODate();
            const [students, attendance, settings] = await Promise.all([
                db.getStudents(),
                db.getAttendance(today),
                db.getSettings()
            ]);

            const attendanceMap = new Map<string, AttendanceRecord>();
            attendance.forEach(record => {
                attendanceMap.set(record.student_id, record);
            });

            const allNotifications: Notification[] = [];
            const whatsappPayloads: { phone: string; message: string; student_name: string; status_label: string }[] = [];

            // فحص المتأخرين
            if (this.config.notifyOnLate) {
                const lateRecords = attendance.filter(r => r.status === 'late');
                for (const record of lateRecords) {
                    const student = students.find(s => s.id === record.student_id);
                    if (student && student.is_active !== false) {
                        const notificationKey = `late:${student.id}:${today}`;
                        if (this.wasAlreadySent(notificationKey)) {
                            continue;
                        }

                        const lockAcquired = await acquireDistributedLock(`attendance:${notificationKey}`);
                        if (!lockAcquired) {
                            this.markAsSent(notificationKey);
                            continue;
                        }

                        const { notifications, whatsappPayload } = this.buildLateNotifications(student, record, settings);
                        allNotifications.push(...notifications);
                        if (whatsappPayload) whatsappPayloads.push(whatsappPayload);
                        if (notifications.length > 0) lateCount++;
                    }
                }
            }

            // فحص الغائبين (بعد وقت معين)
            if (this.config.notifyOnAbsent) {
                const now = new Date();
                const assemblyTime = settings?.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME;
                const [hours, minutes] = assemblyTime.split(':').map(Number);
                const assemblyDate = new Date();
                assemblyDate.setHours(hours, minutes + this.config.lateThresholdMinutes, 0, 0);

                // فقط بعد انتهاء فترة السماح
                if (now > assemblyDate) {
                    for (const student of students) {
                        if (student.is_active === false) continue;

                        const record = attendanceMap.get(student.id);
                        // إذا لا يوجد سجل أو الحالة غائب
                        if (!record || record.status === 'absent') {
                            const notificationKey = `absent:${student.id}:${today}`;
                            if (this.wasAlreadySent(notificationKey)) {
                                continue;
                            }

                            const lockAcquired = await acquireDistributedLock(`attendance:${notificationKey}`);
                            if (!lockAcquired) {
                                this.markAsSent(notificationKey);
                                continue;
                            }

                            const { notifications, whatsappPayload } = this.buildAbsentNotifications(student, settings);
                            allNotifications.push(...notifications);
                            if (whatsappPayload) whatsappPayloads.push(whatsappPayload);
                            if (notifications.length > 0) absentCount++;
                        }
                    }
                }
            }

            // 📦 حفظ جميع الإشعارات دفعة واحدة
            if (allNotifications.length > 0) {
                await notificationCenter.execute({ type: 'send-many', notifications: allNotifications });
                logger.debug('Notifications', `Batch saved ${allNotifications.length} notifications`);
            }

            // 📱 إرسال رسائل واتساب بشكل مجمع
            if (whatsappPayloads.length > 0) {
                void whatsappGateway.enqueue(whatsappPayloads)
                    .catch(e => console.error('[AttendanceNotifications] WhatsApp batch send failed:', e));
            }

            // تحديث وقت آخر فحص
            localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());

        } catch (error) {
            console.error('[AttendanceNotifications] Check failed:', error);
        }

        return { late: lateCount, absent: absentCount };
    }

    // ==========================================
    // Service Control
    // ==========================================

    start(): void {
        if (this.isRunning) {
            logger.debug('Notifications', 'Service already running');
            return;
        }

        if (!this.config.enabled) {
            logger.debug('Notifications', 'Service disabled in config');
            return;
        }

        const intervalMs = this.config.checkIntervalMinutes * 60 * 1000;

        // فحص أولي
        this.checkAttendance().then(result => {
            logger.debug('Notifications', `Initial check: ${result.late} late, ${result.absent} absent`);
        });

        // فحص دوري
        this.checkInterval = setInterval(() => {
            this.checkAttendance().catch(console.error);
        }, intervalMs);

        this.isRunning = true;
        logger.info('Notifications', `Service started (interval: ${this.config.checkIntervalMinutes} minutes)`);
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isRunning = false;
        logger.info('Notifications', 'Service stopped');
    }

    isActive(): boolean {
        return this.isRunning;
    }

    // ==========================================
    // Manual Trigger
    // ==========================================

    async triggerCheck(): Promise<{ late: number; absent: number }> {
        logger.debug('Notifications', 'Manual check triggered');
        return this.checkAttendance();
    }

    // ==========================================
    // Statistics
    // ==========================================

    getLastCheckTime(): string | null {
        return localStorage.getItem(LAST_CHECK_KEY);
    }

    getTodaySentCount(): number {
        return this.getSentToday().size;
    }
}

// ==========================================
// Singleton Instance
// ==========================================

export const attendanceNotificationService = new AttendanceNotificationService();

// Auto-start if in browser and enabled
if (typeof window !== 'undefined') {
    // تأخير البدء للسماح بتهيئة التطبيق
    setTimeout(() => {
        const config = attendanceNotificationService.getConfig();
        if (config.enabled) {
            attendanceNotificationService.start();
        }
    }, 5000);
}
