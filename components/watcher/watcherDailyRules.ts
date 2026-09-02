import type { AttendanceRecord, Student } from '../../types';

export type WatcherAttendanceTab = 'early' | 'late' | 'absent';

const normalizeWatcherText = (value?: string | null) => (value ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ar');

const recordTime = (record: AttendanceRecord) => {
    const value = record._updated_at ?? record.updated_at ?? record.timestamp ?? record.created_at ?? '';
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const buildWatcherDailyState = ({
    students,
    logs,
    date
}: {
    students: readonly Student[];
    logs: readonly AttendanceRecord[];
    date: string;
}) => {
    const seenStudentIds = new Set<string>();
    const activeStudents: Student[] = [];

    for (const student of students) {
        const id = student.id?.trim();
        if (!id || student.is_active === false || seenStudentIds.has(id)) continue;
        seenStudentIds.add(id);
        activeStudents.push(id === student.id ? student : { ...student, id });
    }

    const attendanceByStudent = new Map<string, AttendanceRecord>();
    for (const log of logs) {
        if (log.date !== date || !seenStudentIds.has(log.student_id)) continue;
        const current = attendanceByStudent.get(log.student_id);
        if (!current || recordTime(log) >= recordTime(current)) {
            attendanceByStudent.set(log.student_id, log);
        }
    }

    const present: Student[] = [];
    const late: Student[] = [];
    const absent: Student[] = [];
    for (const student of activeStudents) {
        const status = attendanceByStudent.get(student.id)?.status;
        if (status === 'present') present.push(student);
        else if (status === 'late') late.push(student);
        else absent.push(student);
    }

    return { activeStudents, attendanceByStudent, present, late, absent };
};

export const filterWatcherStudents = (students: readonly Student[], search: string) => {
    const query = normalizeWatcherText(search);
    if (!query) return [...students];

    return students.filter(student => [
        student.id,
        student.name,
        student.class_name,
        student.section
    ].some(value => normalizeWatcherText(value).includes(query)));
};

export const getWatcherStudentsForTab = (
    state: Pick<ReturnType<typeof buildWatcherDailyState>, 'present' | 'late' | 'absent'>,
    tab: WatcherAttendanceTab
) => tab === 'early' ? state.present : tab === 'late' ? state.late : state.absent;

export const buildManualAttendanceSeed = ({
    students,
    attendanceByStudent
}: {
    students: readonly Student[];
    attendanceByStudent: ReadonlyMap<string, AttendanceRecord>;
}) => {
    const statusMap: Record<string, AttendanceRecord['status']> = {};
    const lateTimes: Record<string, string> = {};

    for (const student of students) {
        const record = attendanceByStudent.get(student.id);
        statusMap[student.id] = record?.status ?? 'absent';
        if (record?.status !== 'late') continue;

        const parsed = new Date(record.timestamp);
        if (!Number.isNaN(parsed.getTime())) {
            lateTimes[student.id] = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
        }
    }

    return { statusMap, lateTimes };
};
