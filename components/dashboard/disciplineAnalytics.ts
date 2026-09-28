import type { AttendanceRecord, ExitRecord, Student, SystemSettings, ViolationRecord } from '../../types';
import { formatDateKey, getDateRange, isDateHoliday, resolveReportingPeriod } from '../../services/academicCalendarService';
import { getAttendanceStatusCounts, uniqueAttendanceByStudentDate } from '../../modules/attendance';
import { calculateDisciplineIndex } from '../../utils/disciplineIndex';

/** Uses the same eligible days for records, denominators and incident rates. */
export function buildDisciplineAnalytics({ students, attendance, violations, exits, settings, today }: {
    students: Student[];
    attendance: AttendanceRecord[];
    violations: ViolationRecord[];
    exits: ExitRecord[];
    settings?: SystemSettings | null;
    today: string;
}) {
    const start = new Date(`${today}T12:00:00`);
    start.setDate(start.getDate() - 29);
    const period = resolveReportingPeriod(formatDateKey(start), today, settings?.attendance_settings, today);
    const schoolDates = new Set((period.isEmpty ? [] : getDateRange(period.startDate, period.endDate))
        .filter(date => !isDateHoliday(date, settings?.attendance_settings?.work_days ?? settings?.work_days, settings?.attendance_settings?.academic_holidays)));
    const studentIds = new Set(students.filter(student => student.is_active !== false).map(student => student.id));
    const records = uniqueAttendanceByStudentDate(attendance.filter(record => studentIds.has(record.student_id) && schoolDates.has(record.date)));
    const expectedRecords = studentIds.size * schoolDates.size;
    const counts = getAttendanceStatusCounts(records, expectedRecords);
    const incidentInPeriod = (studentId: string, timestamp: string) => studentIds.has(studentId) && schoolDates.has(formatDateKey(new Date(timestamp)));
    const eligibleViolations = violations.filter(record => incidentInPeriod(record.student_id, record.created_at));
    const eligibleExits = exits.filter(record => incidentInPeriod(record.student_id, record.exit_time));
    const incidentsCount = eligibleViolations.length + eligibleExits.length;
    const attendanceRate = expectedRecords > 0 ? counts.attended / expectedRecords * 100 : 0;
    const explicitAbsences = records.filter(record => record.status === 'absent').length;
    const absenceRate = expectedRecords > 0 ? explicitAbsences / expectedRecords * 100 : 0;
    const lateRate = counts.attended > 0 ? counts.late / counts.attended * 100 : 0;
    return {
        period,
        hasData: expectedRecords > 0 && records.length > 0,
        totalDays: schoolDates.size,
        expectedRecords,
        recordedRecords: records.length,
        attendanceRate: Math.round(attendanceRate),
        absenceRate: Math.round(absenceRate),
        lateRate: Math.round(lateRate),
        incidentsCount,
        exitRate: expectedRecords > 0 ? Math.round(eligibleExits.length / expectedRecords * 1000) / 10 : 0,
        violationRate: expectedRecords > 0 ? Math.round(eligibleViolations.length / expectedRecords * 1000) / 10 : 0,
        disciplineIndex: calculateDisciplineIndex(attendanceRate, lateRate, absenceRate, incidentsCount, schoolDates.size)
    };
}
