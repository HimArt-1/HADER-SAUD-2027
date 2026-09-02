import { describe, expect, it } from 'vitest';
import type { Student } from '../types';
import {
    communicationStatusLabel,
    createGuardianNotificationDrafts,
    resolveStudentWhatsAppPhone
} from '../components/supervision/supervisionCommunication';

const student = (id: string, phone?: string): Student => ({
    id,
    name: `طالب ${id}`,
    class_name: 'الأول',
    section: 'أ',
    guardian_phone: phone
});

describe('supervision communication rules', () => {
    it('normalizes valid Saudi WhatsApp numbers and rejects incomplete contacts', () => {
        expect(resolveStudentWhatsAppPhone(student('1', '٠٥٠ ١٢٣ ٤٥٦٧'))).toBe('966501234567');
        expect(resolveStudentWhatsAppPhone(student('2', '00966 55 123 4567'))).toBe('966551234567');
        expect(resolveStudentWhatsAppPhone(student('3', '12345'))).toBeNull();
    });

    it('builds scoped guardian drafts and reports stale selections', () => {
        const students = new Map([
            ['1', student('1')],
            ['2', student('2')]
        ]);
        const result = createGuardianNotificationDrafts({
            studentIds: ['1', 'missing', '2'],
            studentsById: students,
            title: 'تنبيه تأخر',
            message: '  يرجى متابعة الحضور  ',
            createdBy: 'supervisor-1'
        });

        expect(result.drafts).toHaveLength(2);
        expect(result.drafts[0]).toMatchObject({
            message: 'طالب 1: يرجى متابعة الحضور',
            target_audience: 'guardian',
            target_id: '1',
            created_by: 'supervisor-1'
        });
        expect(result.missingStudentIds).toEqual(['missing']);
    });

    it('uses channel-accurate activity labels', () => {
        expect(communicationStatusLabel({
            id: '1', channel: 'portal', status: 'stored', title: '', recipientLabel: '', recipientCount: 1, createdAt: ''
        })).toBe('محفوظ في المنصة');
        expect(communicationStatusLabel({
            id: '2', channel: 'whatsapp', status: 'queued', title: '', recipientLabel: '', recipientCount: 1, createdAt: ''
        })).toBe('مضاف لطابور واتساب');
    });
});
