import type { DismissalCallRequest, Student } from '../../types';
import { normalizeStudentId } from '../../services/dbHelpers';

const callTime = (call: DismissalCallRequest) => {
    const parsed = Date.parse(call.called_at ?? call.request_time);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const buildDismissalStudentDirectory = (students: readonly Student[]) => {
    const studentById = new Map<string, Student>();
    for (const student of students) {
        const key = normalizeStudentId(student.id);
        if (!key || student.is_active === false || studentById.has(key)) continue;
        studentById.set(key, student);
    }
    return {
        students: Array.from(studentById.values()),
        studentById
    };
};

export const resolveDismissalStudent = (
    studentById: ReadonlyMap<string, Student>,
    input: string
) => studentById.get(normalizeStudentId(input)) ?? null;

export const findDismissalCallForStudent = (
    calls: readonly DismissalCallRequest[],
    studentId: string
) => {
    const key = normalizeStudentId(studentId);
    return calls
        .filter(call => normalizeStudentId(call.student_id) === key)
        .sort((a, b) => {
            const statusDifference = Number(b.status === 'called') - Number(a.status === 'called');
            return statusDifference || callTime(b) - callTime(a);
        })[0] ?? null;
};

export const splitDismissalCalls = (calls: readonly DismissalCallRequest[]) => ({
    pending: calls.filter(call => call.status === 'pending').sort((a, b) => callTime(a) - callTime(b)),
    called: calls.filter(call => call.status === 'called').sort((a, b) => callTime(a) - callTime(b))
});
