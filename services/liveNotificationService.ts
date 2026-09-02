// =============================================================================
// نظام حاضر (Hader) - Live Attendance Notification Service
// =============================================================================
// خدمة الإشعارات المباشرة (اللحظية) عند تسجيل الحضور
// تعمل بشكل معزول ولا تعطل عملية المسح في الكشك

import { db, getLocalISODate } from './db';
import { logger } from './logger';
import { AttendanceRecord, Student, SystemSettings } from '../types';
import { acquireDistributedLock } from './distributedLock';

const SENT_PRESENT_KEY = 'hader:live_notifications:sent_present_today';

class LiveNotificationService {
    
    // ==========================================
    // State / Storage
    // ==========================================
    private getSentPresentToday(): Set<string> {
        try {
            const today = getLocalISODate();
            const saved = localStorage.getItem(SENT_PRESENT_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                if (data.date === today) {
                    return new Set(data.ids);
                }
            }
        } catch (e) {
            console.error('[LiveNotifications] Failed to load sent present today:', e);
        }
        return new Set();
    }

    private markAsSent(studentId: string): void {
        const today = getLocalISODate();
        const sent = this.getSentPresentToday();
        sent.add(studentId);
        localStorage.setItem(SENT_PRESENT_KEY, JSON.stringify({
            date: today,
            ids: Array.from(sent)
        }));
    }

    private wasAlreadySent(studentId: string): boolean {
        return this.getSentPresentToday().has(studentId);
    }

    // ==========================================
    // Processing
    // ==========================================
    
    /**
     * معالجة سجل للحضور اللحظي (مزامنة خلفية بلا تعليق)
     */
    public async handleAttendanceRecorded(record: AttendanceRecord): Promise<void> {
        try {
            if (record.status !== 'present') return;
            const today = getLocalISODate();
            const dedupeKey = `live:present:${record.student_id}:${today}`;

            // Debounce: prevent duplicate messages for the same student on the same day
            if (this.wasAlreadySent(record.student_id)) {
                logger.debug('LiveNotifications', `Already sent present notification for ${record.student_id} today.`);
                return;
            }

            // Load settings & student info concurrently
            const [settings, students] = await Promise.all([
                db.getSettings(),
                db.getStudents()
            ]);

            const triggerOnPresent = settings.whatsapp_triggers?.on_present;
            if (!triggerOnPresent) {
                return;
            }

            const student = students.find(s => s.id === record.student_id);
            if (!student || student.is_active === false || !student.guardian_phone) {
                return;
            }

            const lockAcquired = await acquireDistributedLock(dedupeKey);
            if (!lockAcquired) {
                logger.debug('LiveNotifications', `Distributed lock already acquired for ${record.student_id} on ${today}`);
                this.markAsSent(record.student_id);
                return;
            }

            // 1. Get Template
            const defaultTemplate = `السلام عليكم، وصل ابنكم/ابنتكم {StudentName} بسلامة الله في تمام الساعة {Time}.`;
            const templateObj = settings.whatsapp_templates?.find(t => t.category === 'present');
            let content = templateObj?.content || defaultTemplate;

            // 2. Parse Variables
            const time = record.timestamp
                ? new Date(record.timestamp).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
                : new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

            content = content.replace(/\{(StudentName|student_name|name|student|اسم|الطالب|اسم_الطالب)\}/gi, student.name)
                .replace(/\{(Date|date|تاريخ|التاريخ)\}/gi, today)
                .replace(/\{(Time|time|وقت|الوقت)\}/gi, time)
                .replace(/\{(Class|class|class_name|فصل|الفصل|الصف)\}/gi, student.class_name || '')
                .replace(/\{(Section|section|شعبة|الشعبة|القسم)\}/gi, student.section || '');

            // 3. Prepare Payload (100% accurate integration with WhattONE queue)
            const whatsappPayload = [
                {
                    phone: student.guardian_phone,
                    message: content,
                    student_name: student.name,
                    status_label: 'حضور'
                }
            ];

            // 4. Dispatch Async Request without blocking
            logger.info('LiveNotifications', `Queueing present notification for ${student.name}`);

            void import('./whatsappGateway').then(({ whatsappGateway }) =>
                whatsappGateway.enqueue(whatsappPayload)
            ).then(() => {
                logger.debug('LiveNotifications', `Queued successfully for ${student.name}`);
            }).catch(e => {
                console.error('[LiveNotifications] gateway error:', e);
            });

            // 5. Mark as Sent
            this.markAsSent(record.student_id);

        } catch (error) {
            // صائد الأخطاء لضمان استقرار التطبيق الرئيسي
            console.error('[LiveNotifications] Fatal error handling attendance record:', error);
            logger.error('LiveNotifications', 'Fatal error handling attendance record');
        }
    }
}

export const liveNotificationService = new LiveNotificationService();
