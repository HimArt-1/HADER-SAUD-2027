import * as XLSX from 'xlsx';
import { ParsedData } from '../../../types/import';

const MAX_XLSX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_XLSX_ROWS = 10_000;
const MAX_XLSX_COLUMNS = 120;
const BLOCKED_COLUMN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isBlockedColumnKey = (key: string) => {
  const normalized = key.trim().toLowerCase();
  return Array.from(BLOCKED_COLUMN_KEYS).some((blocked) =>
    normalized === blocked || normalized.startsWith(`${blocked}_`)
  );
};

const getSheetBounds = (worksheet: XLSX.WorkSheet) => {
  const ref = worksheet['!ref'];
  if (!ref) return { rows: 0, columns: 0 };
  const range = XLSX.utils.decode_range(ref);
  return {
    rows: range.e.r - range.s.r + 1,
    columns: range.e.c - range.s.c + 1
  };
};

const sanitizeRows = (rows: Record<string, unknown>[]) => {
  return rows.map((row) => {
    const safeRow: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(row)) {
      if (!isBlockedColumnKey(key)) {
        safeRow[key] = value;
      }
    }
    return safeRow;
  });
};

export const parseXlsxFile = async (file: File): Promise<ParsedData> => {
  if (file.size > MAX_XLSX_IMPORT_BYTES) {
    throw new Error('ملف Excel كبير جداً. الحد الأقصى المسموح 5MB.');
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    WTF: false
  });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    return { rows: [], columns: [], sheets: workbook.SheetNames };
  }
  const bounds = getSheetBounds(worksheet);
  if (bounds.rows > MAX_XLSX_ROWS || bounds.columns > MAX_XLSX_COLUMNS) {
    throw new Error(`ملف Excel يتجاوز الحد المسموح: ${MAX_XLSX_ROWS} صف و ${MAX_XLSX_COLUMNS} عمود.`);
  }

  const rows = sanitizeRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' }));
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, columns, sheets: workbook.SheetNames, sheetName };
};
