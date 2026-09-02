import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Cloud, 
  RefreshCw, 
  Trash2, 
  Download, 
  Upload,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  HardDrive,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronUp,
  FileJson,
  Server
} from 'lucide-react';
import { db } from '../services/db';
import { localDb, getPendingSyncEntries, getUnresolvedConflicts } from '../services/localDb';
import { syncService } from '../services/syncService';
import { conflictResolver } from '../services/conflictResolver';
import { SyncQueueEntry, ConflictLogEntry } from '../services/localDb';

interface DiagnosticsData {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: string | null;
  queueSize: number;
  queueByTable: Record<string, number>;
  conflictCount: number;
  conflictsByTable: Record<string, number>;
  supabaseConfigured: boolean;
}

const SyncDiagnostics: React.FC = () => {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [queueEntries, setQueueEntries] = useState<SyncQueueEntry[]>([]);
  const [conflicts, setConflicts] = useState<ConflictLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    queue: true,
    conflicts: false,
    storage: false
  });
  const [storageInfo, setStorageInfo] = useState<{
    used: number;
    quota: number;
    tables: Record<string, number>;
  } | null>(null);

  const loadDiagnostics = async () => {
    try {
      setLoading(true);
      
      // Get sync diagnostics
      const diag = await syncService.getDiagnostics();
      setDiagnostics(diag);

      // Get queue entries
      const entries = await getPendingSyncEntries({ includeBlocked: true });
      setQueueEntries(entries);

      // Get conflicts
      const conflictList = await getUnresolvedConflicts();
      setConflicts(conflictList);

      // Get storage info
      const tables: Record<string, number> = {};
      const tableNames = ['students', 'attendance_logs', 'users', 'classes', 'settings', 'exits', 'violations', 'notifications'];
      
      for (const tableName of tableNames) {
        try {
          const count = await localDb.table(tableName).count();
          tables[tableName] = count;
        } catch {
          tables[tableName] = 0;
        }
      }

      // Estimate storage
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageInfo({
          used: estimate.usage || 0,
          quota: estimate.quota || 0,
          tables
        });
      } else {
        setStorageInfo({ used: 0, quota: 0, tables });
      }

    } catch (error) {
      console.error('Failed to load diagnostics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDiagnostics();
    
    // Refresh every 5 seconds
    const interval = setInterval(loadDiagnostics, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleForceSync = async () => {
    setSyncing(true);
    try {
      await syncService.syncNow('bidirectional');
      await loadDiagnostics();
    } catch (error) {
      console.error('Force sync failed:', error);
    } finally {
      setSyncing(false);
    }
  };

  const handleClearQueue = async () => {
    if (!confirm('هل أنت متأكد من حذف جميع السجلات المعلقة؟ لن يتم مزامنتها مع السحابة.')) {
      return;
    }
    
    try {
      await localDb.sync_queue.clear();
      await loadDiagnostics();
    } catch (error) {
      console.error('Failed to clear queue:', error);
    }
  };

  const handleResolveConflict = async (conflictId: number, resolution: 'local' | 'cloud') => {
    try {
      await conflictResolver.resolveManually(conflictId, resolution);
      await loadDiagnostics();
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
    }
  };

  const handleExportData = async () => {
    try {
      const data = await localDb.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hader-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleClearAllData = async () => {
    if (!confirm('تحذير: سيتم حذف جميع البيانات المحلية! هل أنت متأكد؟')) {
      return;
    }
    if (!confirm('هذا الإجراء لا يمكن التراجع عنه. هل تريد المتابعة؟')) {
      return;
    }
    
    try {
      await localDb.clearAllData();
      await loadDiagnostics();
      alert('تم حذف جميع البيانات المحلية');
    } catch (error) {
      console.error('Failed to clear data:', error);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (isoString: string | null): string => {
    if (!isoString) return 'غير معروف';
    try {
      return new Date(isoString).toLocaleString('ar-SA');
    } catch {
      return 'غير معروف';
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  if (loading && !diagnostics) {
    return (
      <div className="p-6 bg-slate-900/50 rounded-xl border border-white/10">
        <div className="flex items-center justify-center gap-2 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>جاري تحميل التشخيصات...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-secondary-400" />
          تشخيصات المزامنة
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDiagnostics}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-gray-400 hover:text-white transition-colors"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Connection Status */}
        <div className={`p-4 rounded-xl border ${diagnostics?.isOnline ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            {diagnostics?.isOnline ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-red-400" />}
            <span className="text-xs text-gray-400">الاتصال</span>
          </div>
          <p className={`text-lg font-bold ${diagnostics?.isOnline ? 'text-emerald-400' : 'text-red-400'}`}>
            {diagnostics?.isOnline ? 'متصل' : 'غير متصل'}
          </p>
        </div>

        {/* Supabase Status */}
        <div className={`p-4 rounded-xl border ${diagnostics?.supabaseConfigured ? 'bg-secondary-500/10 border-secondary-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Cloud className={`w-4 h-4 ${diagnostics?.supabaseConfigured ? 'text-secondary-400' : 'text-amber-400'}`} />
            <span className="text-xs text-gray-400">Supabase</span>
          </div>
          <p className={`text-lg font-bold ${diagnostics?.supabaseConfigured ? 'text-secondary-400' : 'text-amber-400'}`}>
            {diagnostics?.supabaseConfigured ? 'مُعد' : 'غير مُعد'}
          </p>
        </div>

        {/* Pending Queue */}
        <div className={`p-4 rounded-xl border ${(diagnostics?.queueSize || 0) > 0 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-500/10 border-slate-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Clock className={`w-4 h-4 ${(diagnostics?.queueSize || 0) > 0 ? 'text-amber-400' : 'text-slate-400'}`} />
            <span className="text-xs text-gray-400">معلق</span>
          </div>
          <p className={`text-lg font-bold ${(diagnostics?.queueSize || 0) > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {diagnostics?.queueSize || 0}
          </p>
        </div>

        {/* Conflicts */}
        <div className={`p-4 rounded-xl border ${(diagnostics?.conflictCount || 0) > 0 ? 'bg-orange-500/10 border-orange-500/30' : 'bg-slate-500/10 border-slate-500/30'}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className={`w-4 h-4 ${(diagnostics?.conflictCount || 0) > 0 ? 'text-orange-400' : 'text-slate-400'}`} />
            <span className="text-xs text-gray-400">تعارضات</span>
          </div>
          <p className={`text-lg font-bold ${(diagnostics?.conflictCount || 0) > 0 ? 'text-orange-400' : 'text-slate-400'}`}>
            {diagnostics?.conflictCount || 0}
          </p>
        </div>
      </div>

      {/* Last Sync */}
      <div className="p-3 bg-slate-800/50 rounded-lg border border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <RefreshCw className="w-4 h-4" />
          <span>آخر مزامنة: {formatDate(diagnostics?.lastSync || null)}</span>
        </div>
        <button
          onClick={handleForceSync}
          disabled={syncing}
          className="px-4 py-1.5 bg-secondary-600 hover:bg-secondary-500 disabled:bg-slate-600 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'جاري المزامنة...' : 'مزامنة الآن'}
        </button>
      </div>

      {/* Sync Queue Section */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 overflow-hidden">
        <button
          onClick={() => toggleSection('queue')}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <span className="font-medium text-white">طابور المزامنة</span>
            <span className="text-xs text-gray-500">({queueEntries.length} سجل)</span>
          </div>
          {expandedSections.queue ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>

        {expandedSections.queue && (
          <div className="p-4 pt-0 border-t border-white/5">
            {queueEntries.length > 0 ? (
              <>
                <div className="max-h-60 overflow-y-auto space-y-2 mb-3">
                  {queueEntries.slice(0, 20).map((entry, idx) => (
                    <div key={entry.id || idx} className="p-2 bg-slate-900/50 rounded-lg text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-medium">{entry.table}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] ${
                          entry.operation === 'INSERT' ? 'bg-green-500/20 text-green-400' :
                          entry.operation === 'UPDATE' ? 'bg-secondary-500/20 text-secondary-400' :
                          entry.operation === 'DELETE' ? 'bg-red-500/20 text-red-400' :
                          'bg-secondary-500/20 text-secondary-400'
                        }`}>
                          {entry.operation}
                        </span>
                      </div>
                      <div className="text-gray-500 mt-1">
                        {formatDate(entry.created_at)}
                        {entry.retry_count > 0 && (
                          <span className="text-amber-400 mr-2">({entry.retry_count} محاولات)</span>
                        )}
                        {entry.blocked_at && (
                          <span className="text-red-400 mr-2">محظور للمراجعة</span>
                        )}
                      </div>
                      {entry.last_error && (
                        <div className="mt-1 truncate text-red-300" title={entry.last_error}>
                          {entry.last_error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleClearQueue}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  مسح الطابور
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">
                <CheckCircle className="w-5 h-5 mx-auto mb-1 text-emerald-400" />
                لا توجد سجلات معلقة
              </p>
            )}
          </div>
        )}
      </div>

      {/* Conflicts Section */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 overflow-hidden">
        <button
          onClick={() => toggleSection('conflicts')}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            <span className="font-medium text-white">التعارضات</span>
            <span className="text-xs text-gray-500">({conflicts.length} تعارض)</span>
          </div>
          {expandedSections.conflicts ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>

        {expandedSections.conflicts && (
          <div className="p-4 pt-0 border-t border-white/5">
            {conflicts.length > 0 ? (
              <div className="space-y-3">
                {conflicts.map((conflict) => (
                  <div key={conflict.id} className="p-3 bg-slate-900/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-medium">{conflict.table}</span>
                      <span className="text-xs text-gray-500">{conflict.record_id}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResolveConflict(conflict.id!, 'local')}
                        className="flex-1 px-3 py-1.5 bg-secondary-500/20 hover:bg-secondary-500/30 text-secondary-400 text-xs rounded-lg transition-colors flex items-center justify-center gap-1"
                      >
                        <HardDrive className="w-3 h-3" />
                        استخدام المحلي
                      </button>
                      <button
                        onClick={() => handleResolveConflict(conflict.id!, 'cloud')}
                        className="flex-1 px-3 py-1.5 bg-secondary-500/20 hover:bg-secondary-500/30 text-secondary-400 text-xs rounded-lg transition-colors flex items-center justify-center gap-1"
                      >
                        <Cloud className="w-3 h-3" />
                        استخدام السحابي
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">
                <CheckCircle className="w-5 h-5 mx-auto mb-1 text-emerald-400" />
                لا توجد تعارضات
              </p>
            )}
          </div>
        )}
      </div>

      {/* Storage Section */}
      <div className="bg-slate-800/50 rounded-xl border border-white/10 overflow-hidden">
        <button
          onClick={() => toggleSection('storage')}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-secondary-400" />
            <span className="font-medium text-white">التخزين المحلي</span>
          </div>
          {expandedSections.storage ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>

        {expandedSections.storage && storageInfo && (
          <div className="p-4 pt-0 border-t border-white/5">
            {/* Storage Usage Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>المستخدم: {formatBytes(storageInfo.used)}</span>
                <span>المتاح: {formatBytes(storageInfo.quota)}</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-secondary-500 to-secondary-500 rounded-full transition-all"
                  style={{ width: `${Math.min((storageInfo.used / storageInfo.quota) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Table Counts */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {Object.entries(storageInfo.tables).map(([table, count]) => (
                <div key={table} className="p-2 bg-slate-900/50 rounded-lg flex items-center justify-between">
                  <span className="text-xs text-gray-400">{table}</span>
                  <span className="text-sm font-medium text-white">{count}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleExportData}
                className="flex-1 px-3 py-2 bg-secondary-500/20 hover:bg-secondary-500/30 text-secondary-400 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                تصدير البيانات
              </button>
              <button
                onClick={handleClearAllData}
                className="flex-1 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                مسح الكل
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SyncDiagnostics;
