import { SchoolClass } from '../types';

export type SchoolCatalog = {
  grades: string[];
  sections: string[];
  sectionsByGrade: Record<string, string[]>;
};

const normalizeKey = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const formatGrade = (value?: string | null) => {
  if (!value) return '';
  return value.toString().trim().replace(/\s+/g, ' ');
};

const formatSection = (value?: string | null) => {
  if (!value) return '';
  return value.toString().trim().replace(/\s+/g, ' ').toUpperCase();
};

const sortLabels = (labels: string[]) =>
  labels.sort((a, b) => a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' }));

const removeDiacritics = (value: string) =>
  value.replace(/[\u064B-\u065F\u0670\u0640]/g, '');

const normalizeArabic = (value: string) =>
  removeDiacritics(value)
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');

export const buildSchoolCatalog = (classes: SchoolClass[]): SchoolCatalog => {
  const gradeMap = new Map<string, string>();
  const sectionsMap = new Map<string, Map<string, string>>();

  const registerGrade = (rawGrade: string) => {
    const formatted = formatGrade(rawGrade);
    if (!formatted) return '';
    const key = normalizeKey(normalizeArabic(formatted));
    if (!gradeMap.has(key)) {
      gradeMap.set(key, formatted);
    }
    if (!sectionsMap.has(key)) {
      sectionsMap.set(key, new Map());
    }
    return gradeMap.get(key) || formatted;
  };

  const registerSection = (gradeLabel: string, rawSection: string) => {
    const formatted = formatSection(rawSection);
    if (!formatted) return;
    const gradeKey = normalizeKey(normalizeArabic(gradeLabel));
    if (!sectionsMap.has(gradeKey)) {
      sectionsMap.set(gradeKey, new Map());
    }
    const sectionKey = normalizeKey(normalizeArabic(formatted));
    const sectionMap = sectionsMap.get(gradeKey)!;
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, formatted);
    }
  };

  classes.forEach((schoolClass) => {
    const gradeLabel = registerGrade(schoolClass.name || '');
    if (!gradeLabel) return;
    (schoolClass.sections || []).forEach((section) => registerSection(gradeLabel, section));
  });

  const grades = sortLabels(Array.from(gradeMap.values()));
  const sectionsByGrade: Record<string, string[]> = {};

  gradeMap.forEach((label, key) => {
    const sectionMap = sectionsMap.get(key);
    if (!sectionMap) return;
    sectionsByGrade[label] = sortLabels(Array.from(sectionMap.values()));
  });

  const sections = sortLabels(
    Array.from(
      new Set(
        Object.values(sectionsByGrade).flatMap((list) => list)
      )
    )
  );

  return { grades, sections, sectionsByGrade };
};

export const getCatalogSections = (catalog: SchoolCatalog, grade?: string) => {
  if (!grade) return catalog.sections;
  return catalog.sectionsByGrade[grade] || [];
};
