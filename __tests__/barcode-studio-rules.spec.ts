import { describe, expect, it } from 'vitest';
import type { Student } from '../types';
import {
    escapeBarcodePrintHtml,
    getBarcodeTemplateConfig,
    isCode128Compatible,
    resolveBarcodeStudents,
    safeBarcodeFileStem
} from '../components/barcode/barcodeStudioRules';

const student = (id: string, name: string, grade = 'الأول', section = 'أ'): Student => ({
    id, name, class_name: grade, section
});

describe('barcode studio rules', () => {
    it('keeps generation inside the requested scope and drops duplicate or empty ids', () => {
        const students = [
            student('1', 'أحمد'),
            student('1', 'نسخة مكررة'),
            student('', 'بلا معرف'),
            student('2', 'سالم', 'الثاني', 'ب')
        ];
        const result = resolveBarcodeStudents({
            students,
            scope: 'selected',
            selectedIds: new Set(['1', '', 'outside'])
        });

        expect(result.validStudents.map(item => item.name)).toEqual(['أحمد']);
        expect(result.invalidStudents.map(item => item.name)).toEqual(['نسخة مكررة', 'بلا معرف']);
    });

    it('matches grade and section labels without whitespace or casing sensitivity', () => {
        const result = resolveBarcodeStudents({
            students: [student('1', 'أحمد', ' Grade 1 ', 'A'), student('2', 'سالم', 'Grade 1', 'B')],
            scope: 'section',
            selectedIds: new Set(),
            grade: 'grade 1',
            section: ' a '
        });
        expect(result.validStudents.map(item => item.id)).toEqual(['1']);
    });

    it('validates Code128, sanitizes filenames, escapes print data, and returns real print CSS', () => {
        expect(isCode128Compatible('ST-123')).toBe(true);
        expect(isCode128Compatible('طالب-١')).toBe(false);
        expect(safeBarcodeFileStem(student('ST/1', 'أحمد: علي'))).toBe('ST-1-أحمد-_علي');
        expect(escapeBarcodePrintHtml('<script>')).toBe('&lt;script&gt;');
        expect(getBarcodeTemplateConfig('id-cards')).toMatchObject({ printColumns: 2, cardsPerPage: 6 });
        expect(getBarcodeTemplateConfig('id-cards').cardCss).toContain('border: 2px solid');
    });
});
