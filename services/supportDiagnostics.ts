import { supabase, supabaseStatus } from './supabase';
import type { SyncResult } from './syncTypes';

export interface TableProbe {
  name: string;
  accessible: boolean;
  error?: string;
  code?: string;
}

// Read-only probes: success means the current session can query the table,
// not that every record is visible under RLS or that writes are permitted.
export async function probeSupportTables(names: readonly string[]): Promise<TableProbe[]> {
  return Promise.all(names.map(async name => {
    if (!supabaseStatus.isConfigured || !navigator.onLine) {
      return { name, accessible: false, code: 'UNAVAILABLE', error: !supabaseStatus.isConfigured
        ? 'إعدادات الاتصال السحابي غير مكتملة' : 'الجهاز غير متصل بالإنترنت' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const { error } = await supabase.from(name).select('id').limit(1).abortSignal(controller.signal);
      return error
        ? { name, accessible: false, error: error.message, code: error.code }
        : { name, accessible: true };
    } catch (error) {
      return { name, accessible: false, error: error instanceof Error ? error.message : 'تعذر فحص الاتصال', code: 'EXCEPTION' };
    } finally {
      clearTimeout(timeout);
    }
  }));
}

export const supportConnections = [
  { id: 'kiosk-api', name: 'بيانات كشك الحضور', path: '/kiosk', tables: ['students', 'attendance_logs', 'settings'] },
  { id: 'watcher-stats', name: 'بيانات واجهة المراقب', path: '/watcher', tables: ['students', 'attendance_logs'] },
  { id: 'admin-reports', name: 'بيانات تقارير الحضور', path: '/admin', tables: ['attendance_logs', 'classes'] },
  { id: 'supervision-data', name: 'بيانات بوابة الإشراف', path: '/supervision', tables: ['students', 'classes'] }
] as const;

export function syncFailureMessage(result: SyncResult): string | null {
  if (result.success && !result.errors.length && !result.pushed.failed && !result.pulled.failed) return null;
  const reasons: Record<string, string> = {
    Offline: 'الجهاز غير متصل بالإنترنت',
    'Supabase not configured': 'إعدادات الاتصال السحابي غير مكتملة',
    'Sync already in progress': 'توجد مزامنة قيد التنفيذ بالفعل'
  };
  return result.errors.map(error => reasons[error.message] || error.message).join('؛ ') || 'لم تكتمل المزامنة؛ راجع السجلات المعلقة';
}
