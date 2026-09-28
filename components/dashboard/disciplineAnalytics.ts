import type { AttendanceRecord, ExitRecord, Student, SystemSettings, ViolationRecord } from '../../types';
import { formatDateKey } from '../../services/academicCalendarService';
import { buildAttendanceAnalytics, percentage } from '../../modules/attendance/analytics';

export function buildDisciplineAnalytics({ students, attendance, violations, exits, settings, today }: {
    students: Student[]; attendance: AttendanceRecord[]; violations: ViolationRecord[]; exits: ExitRecord[];
    settings?: SystemSettings | null; today: string;
}) {
    const start = new Date(`${today}T12:00:00`); start.setDate(start.getDate() - 29);
    const result = buildAttendanceAnalytics({ students, attendance, settings, startDate: formatDateKey(start), endDate: today, today });
    const dates = new Set(result.dates);
    const ids = new Set(result.roster.map(s => s.id));
    const inPeriod = (id: string, timestamp: string) => ids.has(id) && dates.has(formatDateKey(new Date(timestamp)));
    const eligibleViolations = violations.filter(r => inPeriod(r.student_id, r.created_at));
    const eligibleExits = exits.filter(r => inPeriod(r.student_id, r.exit_time));
    return {
        period: result.period, hasData: result.hasData, complete: result.complete, totalDays: dates.size,
        expectedRecords: result.expected, recordedRecords: result.recorded, unrecorded: result.unrecorded,
        attendanceRate: result.attendanceRate ?? 0,
        absenceRate: percentage(result.absent, result.expected) ?? 0,
        lateRate: percentage(result.late, result.attended) ?? 0,
        incidentsCount: eligibleViolations.length + eligibleExits.length,
        exitsCount: eligibleExits.length, violationsCount: eligibleViolations.length,
        // Compatibility name: this now represents measured attendance, with no arbitrary weights.
        disciplineIndex: result.attendanceRate ?? 0
    };
}
