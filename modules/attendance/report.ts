import { activeAnalyticsStudents } from './analytics';
import { AcademicHoliday, ATTENDANCE_DEFAULTS, ReportFilter, Student } from '../../types';
import { AcademicTrackingDates, getDateRange, isDateHoliday, isValidDateKey, resolveReportingPeriod } from '../../services/academicCalendarService';
import { isNewerAttendanceRecord } from './index';
import type { AttendanceRecord } from '../../types';

export interface AttendanceReportDetail {
    id?: string;
    updated_at?: string | null;
    created_at?: string;
    student_id: string;
    studentName: string;
    className: string;
    section?: string;
    date: string;
    time: string;
    status: 'present' | 'late' | 'absent';
    isHoliday?: boolean;
}

export interface AttendanceReportSummary {
    totalRecords: number;
    rosterCount: number;
    calendarDays: number;
    workingDays: number;
    expectedRecords: number;
    recordedRecords: number;
    present: number;
    late: number;
    absent: number;
    unrecorded: number;
    holidayRecords: number;
    attendanceRate: number | null;
}

export interface AdminAttendanceReportData {
    summary: AttendanceReportSummary;
    details: AttendanceReportDetail[];
}

const normalizeSearchValue = (value: unknown): string =>
    String(value ?? '').trim().toLocaleLowerCase('ar');

export const validateReportDateRange = (
    dateFrom: string,
    dateTo: string,
    today: string
): string | null => {
    if (!isValidDateKey(dateFrom) || !isValidDateKey(dateTo)) {
        return 'حدد تاريخ البداية والنهاية.';
    }
    if (dateFrom > dateTo) return 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.';
    if (dateTo > today) return 'لا يمكن إنشاء تقرير حضور لفترة مستقبلية.';
    return null;
};

export const getQuickReportRange = (
    period: 'today' | 'week' | 'month',
    today: string
): { date_from: string; date_to: string } => {
    if (period === 'today') return { date_from: today, date_to: today };

    const start = new Date(`${today}T12:00:00`);
    start.setDate(start.getDate() - (period === 'week' ? 6 : 29));
    const year = start.getFullYear();
    const month = String(start.getMonth() + 1).padStart(2, '0');
    const day = String(start.getDate()).padStart(2, '0');
    return { date_from: `${year}-${month}-${day}`, date_to: today };
};

export const buildAttendanceReportData = ({
    students,
    details,
    filter,
    workDays = [...ATTENDANCE_DEFAULTS.WORK_DAYS],
    holidays = [],
    trackingDates,
    today
}: {
    students: Student[];
    details: AttendanceReportDetail[];
    filter: ReportFilter;
    workDays?: number[];
    holidays?: AcademicHoliday[];
    trackingDates?: AcademicTrackingDates;
    today?: string;
}): AdminAttendanceReportData => {
    const query = normalizeSearchValue(filter.search_query);
    const roster = activeAnalyticsStudents(students).filter(student => {
        if (student.is_active === false || (student.is_active as unknown) === 0) return false;
        if (filter.class_name && student.class_name !== filter.class_name) return false;
        if (filter.section && student.section !== filter.section) return false;
        if (query && ![student.name, student.id].some(value => normalizeSearchValue(value).includes(query))) return false;
        return true;
    });
    const rosterById = new Map(roster.map(student => [student.id, student]));
    const period = resolveReportingPeriod(filter.date_from, filter.date_to, trackingDates, today);
    const dateRange = period.isEmpty ? [] : getDateRange(period.startDate, period.endDate);
    const workingDates = new Set(dateRange.filter(date => !isDateHoliday(date, workDays, holidays)));

    const uniqueDetails = new Map<string, AttendanceReportDetail>();
    const asRecord = (row: AttendanceReportDetail): AttendanceRecord => ({ ...row, id: row.id ?? '', timestamp: row.time, minutes_late: 0, created_at: row.created_at ?? row.time });
    details.forEach(detail => {
        const student = rosterById.get(detail.student_id);
        if (!student || period.isEmpty || detail.date < period.startDate || detail.date > period.endDate) return;
        const key = `${detail.student_id}:${detail.date}`;
        const previous = uniqueDetails.get(key);
        if (previous && !isNewerAttendanceRecord(asRecord(detail), asRecord(previous))) return;
        uniqueDetails.set(key, {
            ...detail,
            studentName: detail.studentName || student.name,
            className: detail.className || student.class_name,
            section: detail.section || student.section,
            isHoliday: !workingDates.has(detail.date)
        });
    });

    const allDetails = Array.from(uniqueDetails.values()).sort((a, b) =>
        b.date.localeCompare(a.date) || a.studentName.localeCompare(b.studentName, 'ar')
    );
    const workingDetails = allDetails.filter(detail => !detail.isHoliday);
    const present = workingDetails.filter(detail => detail.status === 'present').length;
    const late = workingDetails.filter(detail => detail.status === 'late').length;
    const absent = workingDetails.filter(detail => detail.status === 'absent').length;
    const recordedRecords = present + late + absent;
    const expectedRecords = roster.length * workingDates.size;
    const unrecorded = Math.max(0, expectedRecords - recordedRecords);
    const filteredDetails = filter.status && filter.status !== 'all'
        ? allDetails.filter(detail => detail.status === filter.status)
        : allDetails;

    return {
        summary: {
            totalRecords: filteredDetails.length,
            rosterCount: roster.length,
            calendarDays: dateRange.length,
            workingDays: workingDates.size,
            expectedRecords,
            recordedRecords,
            present,
            late,
            absent,
            unrecorded,
            holidayRecords: allDetails.filter(detail => detail.isHoliday).length,
            attendanceRate: expectedRecords > 0 && recordedRecords > 0
                ? Math.round(((present + late) / expectedRecords) * 1000) / 10
                : null
        },
        details: filteredDetails
    };
};
