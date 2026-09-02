import { AttendanceRecord, Student } from '../types';

export interface SmartArchive {
    version: number;
    meta: {
        created_at: string;
        range_start: string;
        range_end: string;
        total_records: number;
    };
    students: Record<string, string>; // id -> name mapping for quick lookup
    classes: Record<string, string>; // id -> class mapping
    // Compressed Logs: student_id -> status -> list of dates
    // For 'late', we store "YYYY-MM-DD:Minutes" to preserve late minutes info
    data: Record<string, {
        p?: string[]; // Present
        a?: string[]; // Absent
        l?: string[]; // Late (format: "date:minutes")
    }>;
}

export const SmartArchiver = {
    /**
     * Compresses raw attendance records into a lightweight Smart Archive
     */
    compress: (records: AttendanceRecord[], students: Student[]): SmartArchive => {
        if (!records.length) {
            return {
                version: 1,
                meta: { created_at: new Date().toISOString(), range_start: '', range_end: '', total_records: 0 },
                students: {},
                classes: {},
                data: {}
            };
        }

        // 1. Sort to find range
        const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
        const range_start = sorted[0].date;
        const range_end = sorted[sorted.length - 1].date;

        // 2. Build map
        const data: SmartArchive['data'] = {};
        const studentMap: Record<string, string> = {};
        const classMap: Record<string, string> = {};

        // Populate student info
        students.forEach(s => {
            studentMap[s.id] = s.name;
            classMap[s.id] = `${s.class_name} - ${s.section}`;
        });

        // Process records
        records.forEach(r => {
            if (!data[r.student_id]) data[r.student_id] = {};

            if (r.status === 'present') {
                if (!data[r.student_id].p) data[r.student_id].p = [];
                data[r.student_id].p!.push(r.date);
            } else if (r.status === 'absent') {
                if (!data[r.student_id].a) data[r.student_id].a = [];
                data[r.student_id].a!.push(r.date);
            } else if (r.status === 'late') {
                if (!data[r.student_id].l) data[r.student_id].l = [];
                data[r.student_id].l!.push(`${r.date}:${r.minutes_late || 0}`);
            }
        });

        // Verify student map has all IDs from records (in case deleted students)
        records.forEach(r => {
            if (!studentMap[r.student_id]) {
                studentMap[r.student_id] = 'Unknown Student';
                classMap[r.student_id] = 'Unknown';
            }
        });

        return {
            version: 1,
            meta: {
                created_at: new Date().toISOString(),
                range_start,
                range_end,
                total_records: records.length
            },
            students: studentMap,
            classes: classMap,
            data
        };
    },

    /**
     * Decompresses Smart Archive back to flat records for viewing/reporting
     */
    decompress: (archive: SmartArchive): AttendanceRecord[] => {
        const records: AttendanceRecord[] = [];

        Object.entries(archive.data).forEach(([studentId, logs]) => {
            // Present
            logs.p?.forEach(date => {
                records.push({
                    id: `arc_${Math.random()}`, // Mock ID
                    student_id: studentId,
                    date,
                    timestamp: new Date(date).toISOString(), // Approx
                    status: 'present',
                    minutes_late: 0
                });
            });
            // Absent
            logs.a?.forEach(date => {
                records.push({
                    id: `arc_${Math.random()}`,
                    student_id: studentId,
                    date,
                    timestamp: new Date(date).toISOString(),
                    status: 'absent',
                    minutes_late: 0
                });
            });
            // Late
            logs.l?.forEach(entry => {
                const [date, minutes] = entry.split(':');
                records.push({
                    id: `arc_${Math.random()}`,
                    student_id: studentId,
                    date,
                    timestamp: new Date(date).toISOString(),
                    status: 'late',
                    minutes_late: parseInt(minutes, 10) || 0
                });
            });
        });

        return records.sort((a, b) => b.date.localeCompare(a.date));
    },

    /**
     * Generates a filename for the archive
     */
    getFilename: (archive: SmartArchive) => {
        return `hader_archive_${archive.meta.range_start}_to_${archive.meta.range_end}.hader`;
    }
};
