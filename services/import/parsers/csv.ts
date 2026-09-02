import Papa from 'papaparse';
import { ParsedData } from '../../../types/import';

export const parseCsvFile = async (file: File): Promise<ParsedData> => {
  const text = await file.text();
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data || []).filter(row => Object.keys(row).length > 0);
        const columns = results.meta.fields || [];
        resolve({ rows, columns });
      },
      error: (error) => reject(error)
    });
  });
};
