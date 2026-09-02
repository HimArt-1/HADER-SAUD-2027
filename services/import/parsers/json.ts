import { ParsedData } from '../../../types/import';

const extractRowsFromJson = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter(item => item && typeof item === 'object') as Record<string, unknown>[];
  }
  if (payload && typeof payload === 'object') {
    const candidates = Object.values(payload as Record<string, unknown>);
    const arrayCandidate = candidates.find(value => Array.isArray(value)) as unknown[] | undefined;
    if (arrayCandidate) {
      return arrayCandidate.filter(item => item && typeof item === 'object') as Record<string, unknown>[];
    }
  }
  return [];
};

export const parseJsonFile = async (file: File): Promise<ParsedData> => {
  const text = await file.text();
  const payload = JSON.parse(text) as unknown;
  const rows = extractRowsFromJson(payload);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, columns };
};
