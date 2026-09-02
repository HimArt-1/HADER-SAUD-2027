import type { User } from '../types';

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9'
};

const normalizeClassLabel = (input: unknown): string => {
  if (input === null || input === undefined) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ');
};

const normalizeSectionLabel = (input: unknown): string => {
  if (input === null || input === undefined) return '';
  const raw = String(input).trim();
  if (!raw) return '';
  return raw
    .replace(/[٠-٩]/g, digit => ARABIC_INDIC_DIGITS[digit] || digit)
    .replace(/\s+/g, ' ')
    .toUpperCase();
};

export function normalizeAssignedSections(raw: unknown): string[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  let values: unknown[] | null = null;

  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      values = Array.isArray(parsed) ? parsed : [trimmed];
    } catch {
      values = trimmed.split(',').map(part => part.trim());
    }
  }

  if (!values) return undefined;
  const sections = values
    .filter((value): value is string => typeof value === 'string')
    .map(section => normalizeSectionLabel(section))
    .filter(Boolean);

  return sections.length ? Array.from(new Set(sections)) : undefined;
}

export function normalizeAssignedClasses(raw: unknown): User['assigned_classes'] | undefined {
  if (raw === null || raw === undefined) return undefined;

  let items: unknown[] | null = null;
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      items = trimmed.split(',').map(part => part.trim());
    }
  } else if (typeof raw === 'object') {
    items = [raw];
  }

  if (!items) return undefined;

  const byClass = new Map<string, { class_name: string; sections: string[] }>();
  for (const item of items) {
    let className = '';
    let sections: string[] = [];

    if (typeof item === 'string') {
      className = normalizeClassLabel(item);
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      className = normalizeClassLabel(
        record.class_name ?? record.className ?? record.name ?? record.class
      );
      sections = normalizeAssignedSections(record.sections ?? record.assigned_sections ?? record.assignedSections) ?? [];
    }

    if (!className) continue;

    const existing = byClass.get(className);
    if (existing) {
      existing.sections = Array.from(new Set([...existing.sections, ...sections]));
    } else {
      byClass.set(className, { class_name: className, sections });
    }
  }

  const assigned = Array.from(byClass.values());
  return assigned.length ? assigned : undefined;
}
