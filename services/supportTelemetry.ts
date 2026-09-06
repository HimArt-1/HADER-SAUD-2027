import { supabase, supabaseStatus } from './supabase';
import type { AuthAuditLog, ClientErrorLog } from '../types';
import type { AuthAuditLogFilters, ClientErrorLogFilters } from './dbTypes';

function requireConnection() {
  if (!supabaseStatus.isConfigured || !navigator.onLine) {
    throw new Error('يتطلب عرض السجلات وتنظيفها اتصالاً بالخادم');
  }
}

export const supportTelemetry = {
  async getAuthAuditLogs(filters: AuthAuditLogFilters): Promise<AuthAuditLog[]> {
    requireConnection();
    const {
      from,
      to,
      action,
      role,
      search,
      limit = 200,
      offset = 0
    } = filters;
    let query = supabase
      .from('auth_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (action) query = query.eq('action', action);
    if (role) query = query.eq('actor_role', role);
    if (search) {
      query = query.or(`actor_user_id.ilike.%${search}%,actor_label.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error || !data) {
      throw error || new Error('تعذر تحميل سجل الدخول');
    }
    return data as AuthAuditLog[];
  },

  async getClientErrorLogs(filters: ClientErrorLogFilters): Promise<ClientErrorLog[]> {
    requireConnection();
    const {
      from,
      to,
      severity,
      source,
      path,
      search,
      limit = 200,
      offset = 0
    } = filters;
    let query = supabase
      .from('client_error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (severity) query = query.eq('severity', severity);
    if (source) query = query.eq('source', source);
    if (path) query = query.ilike('path', `%${path}%`);
    if (search) {
      query = query.or(`message.ilike.%${search}%,stack.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error || !data) {
      throw error || new Error('تعذر تحميل سجل الأخطاء');
    }
    return data as ClientErrorLog[];
  },

  async cleanupTelemetryLogs(retentionDays: number): Promise<{ auth_deleted: number; error_deleted: number }> {
    requireConnection();
    if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('مدة الاحتفاظ غير صالحة');
    const { data, error } = await supabase.rpc('cleanup_telemetry_logs', {
      retention_days: retentionDays
    });
    if (error) {
      throw error;
    }
    return {
      auth_deleted: data?.auth_deleted ?? 0,
      error_deleted: data?.error_deleted ?? 0
    };
  }

};
