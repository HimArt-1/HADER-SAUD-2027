
// Service to handle File Imports and Exports
import { Student, SchoolClass } from '../types';
import { db } from './db';
// CSV/XLSX parsers are loaded on demand so normal admin/supervisor screens
// do not download heavy import libraries before a file is selected.

const normalizeLabel = (value: any): string => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
};

const normalizeKey = (key: string): string => key.trim().toLowerCase().replace(/[\s_-]+/g, '');

const pickValue = (row: any, keys: string[]): string => {
    const normalizedTargets = keys.map(normalizeKey).filter(Boolean);
    const entries = Object.keys(row);

    for (const rawKey of entries) {
        const normalized = normalizeKey(rawKey);
        if (normalizedTargets.includes(normalized)) {
            return normalizeLabel(row[rawKey]);
        }
    }
    return '';
};

const pickValueWithMapping = (
    row: any,
    field: ImportField,
    mapping?: ImportMapping,
    fallbacks: string[] = []
): string => {
    const override = mapping?.[field];
    if (override) {
        const mapped = pickValue(row, [override]);
        if (mapped) return mapped;
    }
    return pickValue(row, fallbacks);
};

const collectStructure = (students: Student[]): Map<string, Set<string>> => {
    const structure = new Map<string, Set<string>>();
    students.forEach((student) => {
        const grade = normalizeLabel(student.class_name) || 'عام';
        const section = normalizeLabel(student.section) || 'A';
        if (!structure.has(grade)) structure.set(grade, new Set());
        structure.get(grade)!.add(section);
    });
    return structure;
};

export interface ExportColumn {
    header: string;
    key: string;
}

export type ImportIdMode = 'keep' | 'generate' | 'replace';

export interface ImportIdPattern {
    prefix?: string;
    length?: number;
    charset?: 'numeric' | 'alphanumeric';
    start?: number;
}

export type ImportField = 'id' | 'name' | 'grade' | 'section' | 'guardian_phone' | 'guardian_name';

export type ImportMapping = Partial<Record<ImportField, string>>;

export interface ImportOptions {
    mode?: ImportIdMode;
    idColumn?: string;
    idPattern?: ImportIdPattern;
    preventDuplicates?: boolean;
    manualMapping?: ImportMapping;
}

const buildGeneratedId = (index: number, pattern?: ImportIdPattern) => {
    const length = pattern?.length && pattern.length > 0 ? pattern.length : 6;
    const start = typeof pattern?.start === 'number' && pattern.start > 0 ? pattern.start : 1;
    const charset = pattern?.charset === 'alphanumeric' ? 'alphanumeric' : 'numeric';
    const prefix = pattern?.prefix || '';

    const sequence = start + index;
    const body = charset === 'numeric'
        ? sequence.toString().padStart(length, '0')
        : sequence.toString(36).padStart(length, '0');

    return `${prefix || ''}${body}`;
};

export const FileService = {
    /**
     * Parse CSV/XLSX/JSON File
     */
    parseImportFile: async (file: File): Promise<any[]> => {
        const name = file.name.toLowerCase();
        if (name.endsWith('.csv')) {
            const { parseCsvFile } = await import('./import/parsers/csv');
            const parsed = await parseCsvFile(file);
            return parsed.rows;
        }
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            const { parseXlsxFile } = await import('./import/parsers/xlsx');
            const parsed = await parseXlsxFile(file);
            return parsed.rows;
        }
        if (name.endsWith('.json')) {
            const { parseJsonFile } = await import('./import/parsers/json');
            const parsed = await parseJsonFile(file);
            return parsed.rows;
        }
        throw new Error('الصيغة غير مدعومة. الصيغ المتاحة: CSV / XLSX / JSON.');
    },

    /**
     * Preview headers and a few sample rows for manual mapping.
     */
    previewColumns: async (file: File): Promise<{ columns: string[]; sample: any[] }> => {
        const name = file.name.toLowerCase();
        if (name.endsWith('.csv')) {
            const { parseCsvFile } = await import('./import/parsers/csv');
            const parsed = await parseCsvFile(file);
            return { columns: parsed.columns, sample: parsed.rows.slice(0, 5) };
        }
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            const { parseXlsxFile } = await import('./import/parsers/xlsx');
            const parsed = await parseXlsxFile(file);
            return { columns: parsed.columns, sample: parsed.rows.slice(0, 5) };
        }
        if (name.endsWith('.json')) {
            const { parseJsonFile } = await import('./import/parsers/json');
            const parsed = await parseJsonFile(file);
            return { columns: parsed.columns, sample: parsed.rows.slice(0, 5) };
        }
        throw new Error('الصيغة غير مدعومة. الصيغ المتاحة: CSV / XLSX / JSON.');
    },

    detectColumnMapping: (columns: string[]): ImportMapping => {
        const mapping: ImportMapping = {};
        const normalizedColumns = columns.map((col) => ({
            original: col,
            normalized: normalizeKey(col),
        }));

        const matchColumn = (targets: string[]): string | undefined => {
            const normalizedTargets = targets.map(normalizeKey);
            const found = normalizedColumns.find((col) => normalizedTargets.includes(col.normalized));
            return found?.original;
        };

        mapping.grade = matchColumn(['الصف', 'صف', 'الصف الدراسي', 'المرحلة الدراسية', 'المستوى الدراسي', 'class_name', 'classname', 'class', 'grade', 'grade_name', 'gradelevel', 'level', 'المرحلة', 'المستوى', 'grade level']);
        mapping.section = matchColumn(['الفصل', 'فصل', 'الفصل الدراسي', 'الشعبة', 'الشعبة الدراسية', 'القسم', 'section', 'sectionname', 'class_section', 'classsection', 'classroom', 'room', 'group', 'section/class']);
        mapping.name = matchColumn(['الاسم', 'اسم الطالب', 'name', 'student_name', 'student', 'fullname', 'full name']);
        mapping.id = matchColumn(['المعرف', 'رقم المعرف', 'معرف الطالب', 'id', 'student_id', 'identifier', 'uid', 'student_number', 'رقم الطالب']);
        mapping.guardian_phone = matchColumn(['جوال ولي الأمر', 'guardian_phone', 'guardianPhone', 'الجوال', 'phone', 'mobile']);
        mapping.guardian_name = matchColumn(['اسم ولي الأمر', 'guardian_name', 'guardianName', 'guardian']);

        return mapping;
    },

    /**
     * Map imported rows to Student objects and build grade/section structure
     */
    mapRowsToStudents: (
        rawData: any[],
        options: ImportOptions = {}
    ): { students: Student[]; structure: Map<string, Set<string>> } => {
        const mode = options.mode || 'keep';
        const idColumn = options.idColumn?.trim();
        const students: Student[] = [];
        const seenIds = new Set<string>();
        const seenNameKeys = new Set<string>();
        const manual = options.manualMapping;

        rawData.forEach((row: any, index: number) => {
            const className = pickValueWithMapping(row, 'grade', manual, ['الصف', 'صف', 'الصف الدراسي', 'المرحلة الدراسية', 'المستوى الدراسي', 'class_name', 'classname', 'class', 'grade', 'grade_name', 'gradelevel', 'level', 'المرحلة', 'المستوى']);
            const section = pickValueWithMapping(row, 'section', manual, ['الفصل', 'فصل', 'الفصل الدراسي', 'الشعبة', 'الشعبة الدراسية', 'القسم', 'section', 'sectionname', 'class_section', 'classsection', 'classroom', 'room', 'group']);
            const name = pickValueWithMapping(row, 'name', manual, ['الاسم', 'اسم الطالب', 'name', 'student_name', 'student', 'fullname']);
            const rawId = idColumn
                ? pickValue(row, [idColumn])
                : pickValueWithMapping(row, 'id', manual, ['المعرف', 'رقم المعرف', 'معرف الطالب', 'id', 'student_id', 'identifier', 'uid', 'student_number', 'رقم الطالب']);

            if (!className || !section) {
                throw new Error(`الصف والفصل حقول مطلوبة. تحقق من الصف: ${name || 'طالب'} في السطر ${index + 2}`);
            }
            if (!name) {
                throw new Error(`حقل الاسم مطلوب في السطر ${index + 2}`);
            }

            let studentId = rawId;

            if (mode === 'generate') {
                if (rawId) {
                    throw new Error('وضع "توليد المعرفات" يتطلب أن يكون حقل المعرف فارغاً في النموذج.');
                }
                studentId = buildGeneratedId(index, options.idPattern);
            } else if (mode === 'replace') {
                studentId = buildGeneratedId(index, options.idPattern);
            } else {
                if (!rawId) {
                    throw new Error(`المعرف مطلوب أو اختر وضع التوليد التلقائي. السطر ${index + 2}`);
                }
            }

            const normalizedId = studentId.trim();
            const nameKey = `${normalizeLabel(name)}-${normalizeLabel(className)}-${normalizeLabel(section)}`;

            if (options.preventDuplicates !== false) {
                if (normalizedId && seenIds.has(normalizedId)) return;
                if (seenNameKeys.has(nameKey)) return;
            }

            seenIds.add(normalizedId);
            seenNameKeys.add(nameKey);

            students.push({
                id: normalizedId,
                name: name || 'Unknown',
                class_name: className,
                section: section,
                guardian_phone: pickValueWithMapping(row, 'guardian_phone', manual, ['جوال ولي الأمر', 'guardian_phone', 'guardianPhone', 'الجوال', 'phone', 'mobile']) || '',
                guardian_name: pickValueWithMapping(row, 'guardian_name', manual, ['اسم ولي الأمر', 'guardian_name', 'guardianName', 'guardian']) || undefined,
                is_active: true,
            });
        });

        return { students, structure: collectStructure(students) };
    },

    /**
     * Upsert derived grade/class structure into Supabase/local storage.
     */
    syncClassStructure: async (structure: Map<string, Set<string>>): Promise<{ created: number; updated: number; grades: number; classes: number; }> => {
        const existing = await db.getClasses();
        let created = 0;
        let updated = 0;
        let classes = 0;

        for (const [grade, sectionsSet] of structure.entries()) {
            const sections = Array.from(sectionsSet).filter(Boolean);
            classes += Math.max(1, sections.length);

            const current = existing.find(cls => normalizeLabel(cls.name) === normalizeLabel(grade));
            if (current) {
                const mergedSections = Array.from(new Set([...(current.sections || []), ...sections]));
                const hasChanges = mergedSections.length !== (current.sections || []).length;
                if (hasChanges) {
                    await db.saveClass({ ...current, sections: mergedSections });
                    updated += 1;
                }
            } else {
                await db.saveClass({
                    id: '',
                    name: grade,
                    sections: sections.length ? sections : ['A'],
                    is_active: true,
                } as SchoolClass);
                created += 1;
            }
        }

        return { created, updated, grades: structure.size, classes };
    },

    /**
     * Export Data to XLSX
     */
    exportToXLSX: async (data: any[], filename: string, sheetName: string = 'Sheet1') => {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, `${filename}.xlsx`);
    },

    /**
     * Export Data to CSV
     */
    exportToCSV: async (data: any[], filename: string) => {
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        const escapeCell = (value: unknown) => {
            const stringValue = value === undefined || value === null ? '' : String(value);
            const needsQuotes = /[",\n]/.test(stringValue);
            const escaped = stringValue.replace(/"/g, '""');
            return needsQuotes ? `"${escaped}"` : escaped;
        };
        const rows = data.map(row => headers.map(header => escapeCell(row[header])).join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${filename}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    /**
     * Export Data to HTML (and Print/PDF helper)
     */
    exportToHTML: (columns: ExportColumn[], data: any[], filename: string, title: string, autoPrint: boolean = false) => {
        const htmlContent = `
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                body { font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; direction: rtl; background: white; color: black; font-size: 12px; }
                h1 { text-align: center; color: #333; margin-bottom: 5px; }
                .meta { text-align: center; color: #666; margin-bottom: 15px; font-size: 0.85em; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; border: 1px solid #ddd; font-size: 11px; }
                th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: right; }
                th { background-color: #f8f9fa; font-weight: bold; color: #333; }
                tr:nth-child(even) { background-color: #f9f9f9; }
                @media print {
                    @page { margin: 0.6cm; size: A4 portrait; }
                    body { -webkit-print-color-adjust: exact; padding: 0; }
                    th { background-color: #eee !important; }
                    table { page-break-inside: auto; }
                    tr { page-break-inside: avoid; page-break-after: auto; }
                }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            <div class="meta">تم استخراج التقرير بتاريخ: ${new Date().toLocaleDateString('ar-SA')}</div>
            <table>
                <thead>
                    <tr>${columns.map(c => `<th>${c.header}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${data.map(row => `<tr>${columns.map(c => `<td>${row[c.key] || '-'}</td>`).join('')}</tr>`).join('')}
                </tbody>
            </table>
            <script>
                ${autoPrint ? 'window.onload = function() { window.print(); }' : ''}
            </script>
        </body>
        </html>`;

        if (autoPrint) {
            const printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.write(htmlContent);
                printWindow.document.close();
            } else {
                alert('يرجى السماح بالنوافذ المنبثقة للطباعة');
            }
        } else {
            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `${filename}.html`);
            link.click();
        }
    },

    /**
     * Export Data to PDF (Via Native Print)
     * Using native browser print ensures 100% Arabic support without heavy font files.
     */
    exportToPDF: (columns: ExportColumn[], data: any[], filename: string, title: string) => {
        // We leverage the HTML export with auto-print enabled.
        // Modern browsers allow "Save as PDF" from the print dialog, which renders Arabic perfectly.
        FileService.exportToHTML(columns, data, filename, title, true);
    }
};
