import type { AttendanceRecord, SystemSettings } from '../../types';
import { uniqueAttendanceByStudentDate } from '../../modules/attendance';
import {
    buildKioskOperationalConfig,
    resolveKioskDayState
} from '../kiosk/kioskOperationalState';

export type SupervisorAttendanceStatus = AttendanceRecord['status'] | 'unrecorded';

export interface SupervisorAttendanceStats {
    total: number;
    recorded: number;
    present: number;
    late: number;
    absent: number;
    unrecorded: number;
    attended: number;
    attendanceRate: number;
    completionRate: number;
}

export interface SupervisorDayState {
    allowsEdits: boolean;
    kind: 'school-day' | 'weekly-off' | 'academic-holiday' | 'system-not-ready' | 'school-inactive' | 'future-date';
    title: string;
    helper: string;
}

export const buildSupervisorAttendanceIndex = (
    records: AttendanceRecord[],
    date: string
): Map<string, AttendanceRecord> => {
    const byStudentId = new Map<string, AttendanceRecord>();
    uniqueAttendanceByStudentDate(records, date).forEach(record => {
        byStudentId.set(record.student_id, record);
    });
    return byStudentId;
};

export const getSupervisorAttendanceStatus = (
    studentId: string,
    attendanceByStudentId: Map<string, AttendanceRecord>
): SupervisorAttendanceStatus => attendanceByStudentId.get(studentId)?.status ?? 'unrecorded';

export const summarizeSupervisorAttendance = (
    studentIds: string[],
    attendanceByStudentId: Map<string, AttendanceRecord>
): SupervisorAttendanceStats => {
    let present = 0;
    let late = 0;
    let absent = 0;

    studentIds.forEach(studentId => {
        const status = getSupervisorAttendanceStatus(studentId, attendanceByStudentId);
        if (status === 'present') present += 1;
        if (status === 'late') late += 1;
        if (status === 'absent') absent += 1;
    });

    const total = studentIds.length;
    const recorded = present + late + absent;
    const unrecorded = Math.max(0, total - recorded);
    const attended = present + late;

    return {
        total,
        recorded,
        present,
        late,
        absent,
        unrecorded,
        attended,
        attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0,
        completionRate: total > 0 ? Math.round((recorded / total) * 100) : 0
    };
};

export const resolveSupervisorDayState = (
    date: string,
    settings: SystemSettings = {},
    today: string
): SupervisorDayState => {
    if (date > today) {
        return {
            allowsEdits: false,
            kind: 'future-date',
            title: 'تاريخ مستقبلي',
            helper: 'يمكن عرض التاريخ، لكن لا يمكن تسجيل حضور قبل حلول اليوم الدراسي.'
        };
    }

    const kioskState = resolveKioskDayState(
        date,
        buildKioskOperationalConfig(settings).policy
    );

    return {
        allowsEdits: kioskState.allowsAttendance,
        kind: kioskState.kind,
        title: kioskState.title,
        helper: kioskState.helper
    };
};
