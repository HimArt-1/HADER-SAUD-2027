import { supabase } from './supabase';
import type { AttendanceRecord } from '../types';

export interface AutomaticAbsenceResult {
  success: boolean;
  completed: boolean;
  count: number;
  date?: string;
  reason?: string;
  records?: AttendanceRecord[];
}

/** Cloud automatic absence must be decided and written in one server transaction. */
export async function markCloudAutomaticAbsence(): Promise<AutomaticAbsenceResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, completed: false, count: 0, reason: 'offline' };
  }
  const { data, error } = await supabase.rpc('mark_hader_automatic_absence');
  if (error) throw error;
  if (!data || typeof data.success !== 'boolean' || typeof data.completed !== 'boolean'
    || !Number.isInteger(data.count) || data.count < 0
    || typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
    || (data.count > 0 && (!Array.isArray(data.records) || data.records.length !== data.count
      || data.records.some((record: AttendanceRecord) => !record || typeof record.id !== 'string'
        || typeof record.student_id !== 'string' || record.status !== 'absent' || record.date !== data.date)))) {
    throw new Error('Invalid automatic absence response');
  }
  return data as AutomaticAbsenceResult;
}
