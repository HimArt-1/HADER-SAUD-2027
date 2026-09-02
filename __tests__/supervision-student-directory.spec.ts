import { describe, expect, it } from 'vitest';
import type { AttendanceRecord, ExitRecord, Student, ViolationRecord } from '../types';
import {
    buildStudentProfileSnapshot,
    filterStudentDirectory,
    normalizeStudentSearchText,
    StudentDirectoryRow
} from '../components/supervision/supervisionStudentDirectory';

const student = (id: string, name: string, className = 'الأول', section = 'أ'): Student => ({
    id,
    name,
    class_name: className,
    section,
    guardian_phone: '',
    is_active: true
});

const row = (value: Student, attendanceStatus: StudentDirectoryRow['attendanceStatus']): StudentDirectoryRow => ({
    ...value,
    attendanceStatus,
    minutes_late: attendanceStatus === 'late' ? 8 : 0
});

describe('supervision student directory', () => {
    it('normalizes Arabic spelling and Arabic/Persian digits for search', () => {
        expect(normalizeStudentSearchText('  أَحْمَد  ١۲٣ ')).toBe('احمد 123');

        const rows = [
            row(student('ST-123', 'أحمد علي'), 'present'),
            row(student('ST-999', 'سالم محمد'), 'absent')
        ];

        expect(filterStudentDirectory(rows, { query: 'احمد' }).map(item => item.id)).toEqual(['ST-123']);
        expect(filterStudentDirectory(rows, { query: '١٢٣' }).map(item => item.id)).toEqual(['ST-123']);
    });

    it('combines class, section, and explicit attendance status filters', () => {
        const rows = [
            row(student('1', 'أحمد', 'الأول', 'أ'), 'present'),
            row(student('2', 'سالم', 'الأول', 'ب'), 'absent'),
            row(student('3', 'ناصر', 'الثاني', 'أ'), 'absent')
        ];

        expect(filterStudentDirectory(rows, {
            className: ' الأول ',
            section: 'ب',
            status: 'absent'
        }).map(item => item.id)).toEqual(['2']);
    });

    it('deduplicates attendance and sorts every profile timeline newest first', () => {
        const attendance: AttendanceRecord[] = [
            { id: 'a1', student_id: '1', date: '2026-08-22', status: 'present', timestamp: '2026-08-22T07:00:00Z' },
            { id: 'a2', student_id: '1', date: '2026-08-22', status: 'late', timestamp: '2026-08-22T07:20:00Z', minutes_late: 20 },
            { id: 'a3', student_id: '1', date: '2026-08-23', status: 'absent', timestamp: '2026-08-23T08:00:00Z' }
        ];
        const exits = [
            { id: 'e1', student_id: '1', exit_time: '2026-08-22T10:00:00Z', reason: 'موعد' },
            { id: 'e2', student_id: '1', exit_time: '2026-08-23T10:00:00Z', reason: 'مرض' }
        ] as ExitRecord[];
        const violations = [
            { id: 'v1', student_id: '1', created_at: '2026-08-21T09:00:00Z', type: 'تنبيه' },
            { id: 'v2', student_id: '1', created_at: '2026-08-23T09:00:00Z', type: 'ملاحظة' }
        ] as ViolationRecord[];

        const snapshot = buildStudentProfileSnapshot({ attendance, exits, violations });

        expect(snapshot.attendance.map(item => item.id)).toEqual(['a3', 'a2']);
        expect(snapshot.exits.map(item => item.id)).toEqual(['e2', 'e1']);
        expect(snapshot.violations.map(item => item.id)).toEqual(['v2', 'v1']);
        expect(snapshot.stats).toEqual({ attended: 1, late: 1, absent: 1, exits: 2, violations: 2 });
    });
});
