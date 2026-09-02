import { describe, expect, it } from 'vitest';
import type { DismissalCallRequest, Student } from '../types';
import {
    buildDismissalStudentDirectory,
    findDismissalCallForStudent,
    resolveDismissalStudent,
    splitDismissalCalls
} from '../components/dismissal/dismissalUiRules';

const student = (id: string, name: string, active = true): Student => ({
    id, name, class_name: 'الأول', section: 'أ', is_active: active
});
const call = (id: string, studentId: string, status: DismissalCallRequest['status'], time: string): DismissalCallRequest => ({
    id,
    student_id: studentId,
    student_name: 'طالب',
    class_name: 'الأول',
    section: 'أ',
    requested_by: 'guard',
    status,
    request_time: time,
    ...(status === 'called' ? { called_at: time } : {})
});

describe('dismissal UI rules', () => {
    it('builds an active normalized student directory', () => {
        const directory = buildDismissalStudentDirectory([
            student('1234', 'أحمد'),
            student('١٢٣٤', 'مكرر'),
            student('9', 'غير نشط', false)
        ]);
        expect(directory.students.map(item => item.name)).toEqual(['أحمد']);
        expect(resolveDismissalStudent(directory.studentById, '١٢٣٤')?.name).toBe('أحمد');
    });

    it('prefers a called request for a scanned student and orders queues oldest first', () => {
        const calls = [
            call('pending-late', '1234', 'pending', '2026-08-23T09:00:00Z'),
            call('called', '١٢٣٤', 'called', '2026-08-23T08:30:00Z'),
            call('pending-early', '9', 'pending', '2026-08-23T08:00:00Z')
        ];
        expect(findDismissalCallForStudent(calls, '1234')?.id).toBe('called');
        expect(splitDismissalCalls(calls).pending.map(item => item.id)).toEqual(['pending-early', 'pending-late']);
    });
});
