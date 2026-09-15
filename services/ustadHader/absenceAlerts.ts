// =============================================================================
// نظام حاضر (Hader) - تنبيهات الغياب التي يؤكدها «أستاذ حاضر»
// =============================================================================
// لا تستورد هذه الوحدة attendanceNotificationService: استيرادها يشغّل الفحص الدوري التلقائي لكل مستخدم.
// تستخدم قفل اليوم نفسه لكل طالب، فلا يصل لولي الأمر تنبيهان عن اليوم ذاته من المسارين.

import { notificationCenter } from '../notifications';
import { whatsappGateway } from '../whatsappGateway';
import { acquireDistributedLock, releaseDistributedLock } from '../distributedLock';
import { logger } from '../logger';
import type { Notification, Student, SystemSettings } from '../../types';

export interface AbsenceAlertRecipient {
  student: Student;
  phone: string;
}

const DEFAULT_ABSENCE_TEMPLATE = 'السلام عليكم، نفيدكم بغياب الطالب {StudentName} اليوم {Date}. نرجو تزويدنا بسبب الغياب.';

// مطابق لمفتاح القفل في attendanceNotificationService
const absenceLockKey = (studentId: string, date: string) => `attendance:absent:${studentId}:${date}`;

export function buildAbsenceAlertMessage(settings: SystemSettings | null, student: Student, date: string): string {
  const template = settings?.whatsapp_templates?.find(t => t.category === 'absence')?.content || DEFAULT_ABSENCE_TEMPLATE;
  return template
    .replace(/\{(StudentName|student_name|name|student|اسم|الطالب|اسم_الطالب)\}/gi, student.name)
    .replace(/\{(Date|date|تاريخ|التاريخ)\}/gi, date)
    .replace(/\{(Class|class|class_name|فصل|الفصل|الصف)\}/gi, student.class_name || '')
    .replace(/\{(Section|section|شعبة|الشعبة|القسم)\}/gi, student.section || '');
}

/**
 * يضيف تنبيهات الغياب إلى طابور واتساب ويحفظ إشعاراتها لأولياء الأمور.
 * يتخطى من نُبّه اليوم مسبقاً، ويرمي خطأً دون حجز أي طالب إذا تعذر الوصول إلى الطابور.
 */
export async function sendAbsenceAlerts(
  recipients: readonly AbsenceAlertRecipient[],
  date: string,
  settings: SystemSettings | null
): Promise<{ queued: number; alreadySent: number }> {
  const pending: AbsenceAlertRecipient[] = [];
  for (const recipient of recipients) {
    if (await acquireDistributedLock(absenceLockKey(recipient.student.id, date))) {
      pending.push(recipient);
    }
  }

  const alreadySent = recipients.length - pending.length;
  if (pending.length === 0) return { queued: 0, alreadySent };

  try {
    await whatsappGateway.enqueue(pending.map(({ student, phone }) => ({
      // نفس معرّف إشعار الغياب في attendanceNotificationService: يتجاهل الجسر المكرر فيصل ولي الأمر إشعار واحد
      id: `absent:${student.id}:${date}`,
      phone,
      message: buildAbsenceAlertMessage(settings, student, date),
      student_name: student.name,
      status_label: 'غياب',
      meta: { source: 'ustad-hader', student_id: student.id, date }
    })));
  } catch (error) {
    // لم يصل شيء إلى الطابور؛ تحرير الأقفال يسمح بإعادة المحاولة
    await Promise.all(pending.map(({ student }) => releaseDistributedLock(absenceLockKey(student.id, date))));
    throw error;
  }

  const createdAt = new Date().toISOString();
  const notifications: Notification[] = pending.map(({ student }) => ({
    id: crypto.randomUUID(),
    title: 'تنبيه غياب',
    message: `نفيدكم بغياب الطالب ${student.name} اليوم. نرجو التواصل مع الإدارة لتوضيح السبب.`,
    type: 'attendance',
    target_audience: 'guardian',
    target_id: student.id,
    is_popup: false,
    created_at: createdAt
  }));

  try {
    await notificationCenter.execute({ type: 'send-many', notifications });
  } catch (error) {
    // الرسائل في الطابور بالفعل، فلا يُعاد إرسالها بسبب إشعار التطبيق
    logger.warn('UstadHader', 'Guardian in-app absence notifications were not saved', error);
  }

  return { queued: pending.length, alreadySent };
}
