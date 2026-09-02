import type { Notification, Student } from '../../types';
import type { NotificationDraft } from '../../modules/notifications';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const toLatinDigits = (value: string) => value
    .replace(/[٠-٩]/g, digit => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String(PERSIAN_DIGITS.indexOf(digit)));

export const resolveStudentWhatsAppPhone = (student: Student): string | null => {
    const source = student.whatsapp_phone || student.parent_phone || student.guardian_phone;
    if (!source) return null;

    let digits = toLatinDigits(source).replace(/\D/g, '');
    if (digits.startsWith('00966')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = `966${digits.slice(1)}`;
    if (digits.length === 9 && digits.startsWith('5')) digits = `966${digits}`;

    return /^9665\d{8}$/.test(digits) ? digits : null;
};

export const createGuardianNotificationDrafts = ({
    studentIds,
    studentsById,
    title,
    message,
    notificationType = 'attendance',
    createdBy
}: {
    studentIds: Iterable<string>;
    studentsById: ReadonlyMap<string, Student>;
    title: string;
    message: string;
    notificationType?: Notification['type'];
    createdBy?: string;
}) => {
    const drafts: NotificationDraft[] = [];
    const missingStudentIds: string[] = [];
    const cleanMessage = message.trim();

    for (const studentId of studentIds) {
        const student = studentsById.get(studentId);
        if (!student) {
            missingStudentIds.push(studentId);
            continue;
        }
        drafts.push({
            title,
            message: `${student.name}: ${cleanMessage}`,
            type: notificationType,
            target_audience: 'guardian',
            target_id: student.id,
            is_popup: true,
            created_by: createdBy
        });
    }

    return { drafts, missingStudentIds };
};

export type SupervisorCommunicationActivity = {
    id: string;
    channel: 'portal' | 'whatsapp';
    status: 'stored' | 'queued' | 'failed';
    title: string;
    recipientLabel: string;
    recipientCount: number;
    createdAt: string;
    detail?: string;
};

export const communicationStatusLabel = (activity: SupervisorCommunicationActivity) => {
    if (activity.status === 'stored') return 'محفوظ في المنصة';
    if (activity.status === 'queued') return 'مضاف لطابور واتساب';
    return 'فشل الإرسال';
};
