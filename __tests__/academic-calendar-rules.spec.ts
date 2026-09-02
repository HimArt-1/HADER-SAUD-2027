import { describe, expect, it } from 'vitest';
import {
    getDateRangeLength,
    isValidDateKey,
    normalizeAcademicHolidays
} from '../services/academicCalendarService';

describe('academic calendar operational rules', () => {
    it('validates exact calendar dates and calculates inclusive ranges', () => {
        expect(isValidDateKey('2026-02-29')).toBe(false);
        expect(isValidDateKey('2028-02-29')).toBe(true);
        expect(getDateRangeLength('2026-08-23', '2026-08-23')).toBe(1);
        expect(getDateRangeLength('2026-08-23', '2026-08-25')).toBe(3);
        expect(getDateRangeLength('2026-08-25', '2026-08-23')).toBe(0);
    });

    it('drops malformed holidays, trims labels, deduplicates dates, and sorts the result', () => {
        expect(normalizeAcademicHolidays([
            { date: '2026-09-23', label: ' اليوم الوطني ', type: 'national' },
            { date: '2026-08-30', label: 'الأولى', type: 'extended' },
            { date: '2026-08-30', label: 'المعتمدة', type: 'exceptional' },
            { date: '2026-02-30', label: 'غير صالح', type: 'exceptional' },
            { date: '2026-09-24', label: '', type: 'national' },
            { date: '2026-09-25', label: 'نوع خاطئ', type: 'other' }
        ])).toEqual([
            { date: '2026-08-30', label: 'المعتمدة', type: 'exceptional' },
            { date: '2026-09-23', label: 'اليوم الوطني', type: 'national' }
        ]);
    });
});
