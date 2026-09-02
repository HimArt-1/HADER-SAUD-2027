import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseXlsxFile } from '../services/import/parsers/xlsx';

const workbookFile = (rows: Record<string, unknown>[], name = 'students.xlsx') => {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return {
    name,
    size: data.byteLength,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    arrayBuffer: async () => data
  } as File;
};

describe('xlsx import parser hardening', () => {
  it('rejects oversized workbooks before parsing', async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.xlsx');

    await expect(parseXlsxFile(file)).rejects.toThrow('ملف Excel كبير جداً');
  });

  it('removes prototype-polluting column names from parsed rows', async () => {
    const file = workbookFile([
      {
        name: 'Student',
        ['__proto__']: 'blocked',
        constructor: 'blocked'
      }
    ]);

    const parsed = await parseXlsxFile(file);

    expect(parsed.columns).toEqual(['name']);
    expect(parsed.rows[0].name).toBe('Student');
    expect(Object.prototype.hasOwnProperty.call(parsed.rows[0], '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed.rows[0], 'constructor')).toBe(false);
  });
});
