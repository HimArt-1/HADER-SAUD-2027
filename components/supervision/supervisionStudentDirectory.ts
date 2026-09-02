import type { AttendanceRecord, ExitRecord, Student, ViolationRecord } from '../../types';
import { uniqueAttendanceByStudentDate } from '../../modules/attendance';
import { normalizeStudentId } from '../../services/dbHelpers';
import type { SupervisorAttendanceStatus } from './supervisionAttendanceRules';

export type StudentDirectoryFilters = {
    query?: string;
    className?: string;
    section?: string;
    status?: 'all' | SupervisorAttendanceStatus;
};

export type StudentDirectoryRow = Student & {
    attendanceStatus: SupervisorAttendanceStatus;
    timestamp?: string;
    minutes_late: number;
};

const normalizeLabel = (value?: string | null) =>
    (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');

export const normalizeStudentSearchText = (value?: string | null) =>
    normalizeLabel(value)
        .normalize('NFKD')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

export const filterStudentDirectory = (
    rows: StudentDirectoryRow[],
    filters: StudentDirectoryFilters
) => {
    const className = normalizeLabel(filters.className);
    const section = normalizeLabel(filters.section);
    const query = normalizeStudentSearchText(filters.query);
    const queryId = normalizeStudentId(filters.query);

    return rows.filter(row => {
        if (className && normalizeLabel(row.class_name) !== className) return false;
        if (section && normalizeLabel(row.section) !== section) return false;
        if (filters.status && filters.status !== 'all' && row.attendanceStatus !== filters.status) return false;
        if (!query) return true;

        return normalizeStudentSearchText(row.name).includes(query)
            || normalizeStudentId(row.id).includes(queryId);
    });
};

const compareNewestFirst = (left: string, right: string) =>
    right.localeCompare(left);

export const buildStudentProfileSnapshot = (data: {
    attendance: AttendanceRecord[];
    exits: ExitRecord[];
    violations: ViolationRecord[];
}) => {
    const attendance = uniqueAttendanceByStudentDate(data.attendance)
        .sort((left, right) => compareNewestFirst(
            left.timestamp || `${left.date}T00:00:00`,
            right.timestamp || `${right.date}T00:00:00`
        ));
    const exits = [...data.exits].sort((left, right) => compareNewestFirst(left.exit_time, right.exit_time));
    const violations = [...data.violations].sort((left, right) => compareNewestFirst(left.created_at, right.created_at));

    return {
        attendance,
        exits,
        violations,
        stats: {
            attended: attendance.filter(record => record.status === 'present' || record.status === 'late').length,
            late: attendance.filter(record => record.status === 'late').length,
            absent: attendance.filter(record => record.status === 'absent').length,
            exits: exits.length,
            violations: violations.length
        }
    };
};
