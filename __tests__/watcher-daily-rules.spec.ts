import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, Student } from '../types';
import {
    buildManualAttendanceSeed,
    buildWatcherDailyState,
    filterWatcherStudents,
    getWatcherStudentsForTab
} from '../components/watcher/watcherDailyRules';

const student = (id: string, name: string, className = 'الأول', section = 'أ', isActive = true): Student => ({
    id,
    name,
    class_name: className,
    section,
    is_active: isActive
});

const log = (
    id: string,
    studentId: string,
    date: string,
    status: AttendanceRecord['status'],
    timestamp: string
): AttendanceRecord => ({
    id,
    student_id: studentId,
    date,
    status,
    timestamp,
    minutes_late: status === 'late' ? 15 : 0
});

describe('watcher daily rules', () => {
    it('uses active unique students, ignores other dates, and keeps the latest status', () => {
        const state = buildWatcherDailyState({
            date: '2026-08-23',
            students: [
                student('1', 'أحمد'),
                student('1', 'نسخة مكررة'),
                student('2', 'سالم'),
                student('3', 'غير نشط', 'الثاني', 'ب', false)
            ],
            logs: [
                log('a', '1', '2026-08-22', 'late', '2026-08-22T08:00:00+03:00'),
                log('b', '1', '2026-08-23', 'present', '2026-08-23T07:00:00+03:00'),
                log('c', '1', '2026-08-23', 'late', '2026-08-23T07:30:00+03:00'),
                log('d', '3', '2026-08-23', 'present', '2026-08-23T07:10:00+03:00')
            ]
        });

        expect(state.activeStudents.map(item => item.id)).toEqual(['1', '2']);
        expect(state.present).toEqual([]);
        expect(state.late.map(item => item.id)).toEqual(['1']);
        expect(state.absent.map(item => item.id)).toEqual(['2']);
        expect(getWatcherStudentsForTab(state, 'late')).toEqual(state.late);
    });

    it('searches names, ids, classes, and sections with normalized text', () => {
        const students = [student('ST-1', 'أَحْمَد العلي', ' Grade 1 ', 'A'), student('ST-2', 'سالم', 'الثاني', 'ب')];

        expect(filterWatcherStudents(students, 'احمد').map(item => item.id)).toEqual(['ST-1']);
        expect(filterWatcherStudents(students, ' grade   1 ').map(item => item.id)).toEqual(['ST-1']);
        expect(filterWatcherStudents(students, 'A').map(item => item.id)).toEqual(['ST-1']);
    });

    it('seeds manual attendance from current records instead of overwriting them visually', () => {
        const students = [student('1', 'أحمد'), student('2', 'سالم'), student('3', 'ماجد')];
        const attendance = new Map<string, AttendanceRecord>([
            ['1', log('a', '1', '2026-08-23', 'late', '2026-08-23T07:45:00+03:00')],
            ['2', log('b', '2', '2026-08-23', 'absent', '2026-08-23T07:00:00+03:00')]
        ]);

        const seed = buildManualAttendanceSeed({ students, attendanceByStudent: attendance });
        expect(seed.statusMap).toEqual({ '1': 'late', '2': 'absent', '3': 'absent' });
        expect(seed.lateTimes['1']).toMatch(/^\d{2}:\d{2}$/);
    });
});
