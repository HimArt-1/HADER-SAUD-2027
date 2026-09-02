import type { Student } from '../../types';

export type BarcodeScope = 'selected' | 'single' | 'grade' | 'section';
export type BarcodeTemplate = 'cards' | 'sheet' | 'raw' | 'id-cards' | 'labels';

const normalizeLabel = (value?: string | null) =>
    (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');

export const resolveBarcodeStudents = ({
    students,
    scope,
    selectedIds,
    studentId,
    grade,
    section
}: {
    students: readonly Student[];
    scope: BarcodeScope;
    selectedIds: ReadonlySet<string>;
    studentId?: string;
    grade?: string;
    section?: string;
}) => {
    const seenIds = new Set<string>();
    const invalidStudents: Student[] = [];
    const validStudents: Student[] = [];
    const normalizedGrade = normalizeLabel(grade);
    const normalizedSection = normalizeLabel(section);

    for (const student of students) {
        const id = student.id?.trim();
        const matches = scope === 'selected'
            ? selectedIds.has(student.id)
            : scope === 'single'
                ? student.id === studentId
                : scope === 'grade'
                    ? Boolean(normalizedGrade) && normalizeLabel(student.class_name) === normalizedGrade
                    : Boolean(normalizedGrade && normalizedSection)
                        && normalizeLabel(student.class_name) === normalizedGrade
                        && normalizeLabel(student.section) === normalizedSection;

        if (!matches) continue;
        if (!id || seenIds.has(id)) {
            invalidStudents.push(student);
            continue;
        }
        seenIds.add(id);
        validStudents.push({ ...student, id });
    }

    return { validStudents, invalidStudents };
};

export const isCode128Compatible = (value: string) =>
    value.length > 0 && value.length <= 128 && /^[\x20-\x7E]+$/.test(value);

export const safeBarcodeFileStem = (student: Student) => {
    const printableSource = Array.from(`${student.id}-${student.name}`.normalize('NFKC'))
        .filter(character => character.charCodeAt(0) >= 32)
        .join('');
    const source = printableSource
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '_')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 96);
    return source || 'student-barcode';
};

export const escapeBarcodePrintHtml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const getBarcodeTemplateConfig = (template: BarcodeTemplate) => {
    if (template === 'id-cards') return {
        previewGridClass: 'grid-cols-1 md:grid-cols-2',
        printColumns: 2,
        cardsPerPage: 6,
        orientation: 'landscape' as const,
        cardCss: 'border: 2px solid #d1d5db; border-radius: 14px; padding: 18px; background: #fff; min-height: 180px;'
    };
    if (template === 'labels') return {
        previewGridClass: 'grid-cols-2 md:grid-cols-3',
        printColumns: 3,
        cardsPerPage: 30,
        orientation: 'portrait' as const,
        cardCss: 'border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; background: #fff;'
    };
    if (template === 'sheet') return {
        previewGridClass: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        printColumns: 3,
        cardsPerPage: 24,
        orientation: 'portrait' as const,
        cardCss: 'border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; background: #fff;'
    };
    if (template === 'raw') return {
        previewGridClass: 'grid-cols-2 md:grid-cols-4',
        printColumns: 4,
        cardsPerPage: 32,
        orientation: 'portrait' as const,
        cardCss: 'border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px; background: #fff;'
    };
    return {
        previewGridClass: 'grid-cols-1',
        printColumns: 1,
        cardsPerPage: 6,
        orientation: 'portrait' as const,
        cardCss: 'border: 2px solid #d1d5db; border-radius: 14px; padding: 18px; background: #fff;'
    };
};
