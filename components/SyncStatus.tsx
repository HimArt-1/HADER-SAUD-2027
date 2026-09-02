import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, Cloud, CloudOff, CheckCircle, AlertTriangle, Database, HardDrive } from 'lucide-react';
import { db, SyncStatus as SyncStatusType } from '../services/db';

interface ExtendedSyncStatus {
  status: 'idle' | 'syncing' | 'online' | 'offline' | 'error' | 'conflict';
  pending: number;
  conflicts?: number;
  isOnline?: boolean;
  lastSync?: string;
  lastError?: string;
}

const SyncStatus: React.FC = () => {
  const [status, setStatus] = useState<ExtendedSyncStatus>(() => {
    const initial = db.getSyncStatus() as ExtendedSyncStatus | null;
    return initial || { status: 'idle', pending: 0 };
  });
  const [pendingCount, setPendingCount] = useState(status?.pending || 0);
  const [conflictCount, setConflictCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isHybridMode] = useState(() => db.isHybridMode());
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  useEffect(() => {
    // Initial status
    const initial = db.getSyncStatus() as ExtendedSyncStatus | null;
    if (initial) {
      setStatus(initial);
      setPendingCount(initial.pending || 0);
      setConflictCount(initial.conflicts || 0);
      if (initial.lastSync) {
        setLastSyncTime(initial.lastSync);
      }
    }

    // Subscribe to status changes
    const unsubscribe = db.onSyncStatusChange((newStatus) => {
      const extStatus = newStatus as ExtendedSyncStatus;
      setStatus(extStatus);
      setPendingCount(extStatus.pending || 0);
      setConflictCount(extStatus.conflicts || 0);
      if (extStatus.lastSync) {
        setLastSyncTime(extStatus.lastSync);
      }
    });

    // Periodic check for pending count
    const interval = setInterval(() => {
      const currentStatus = db.getSyncStatus();
      if (currentStatus) {
        setPendingCount(currentStatus.pending || 0);
        setConflictCount((currentStatus as ExtendedSyncStatus).conflicts || 0);
      }
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const handleForceSync = async () => {
    setIsRefreshing(true);
    try {
      await db.forceSyncNow();
    } catch (e) {
      console.error('Force sync failed:', e);
    }
    setIsRefreshing(false);
  };

  // Format last sync time
  const formatLastSync = (isoString: string | null): string => {
    if (!isoString) return 'لم تتم المزامنة بعد';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return 'الآن';
      if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
      if (diffMins < 1440) return `منذ ${Math.floor(diffMins / 60)} ساعة`;
      return date.toLocaleDateString('ar-SA');
    } catch {
      return 'غير معروف';
    }
  };

  // Status configuration
  const statusConfig = {
    online: {
      icon: Cloud,
      text: isHybridMode ? 'متزامن' : 'متصل',
      bgClass: 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20',
      textClass: 'text-emerald-400',
      dotClass: 'bg-emerald-500',
      glowClass: 'shadow-[0_0_15px_rgba(16,185,129,0.3)]'
    },
    offline: {
      icon: isHybridMode ? HardDrive : CloudOff,
      text: isHybridMode ? 'محلي' : 'غير متصل',
      bgClass: isHybridMode ? 'bg-secondary-500/10 border-secondary-500/30 hover:bg-secondary-500/20' : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20',
      textClass: isHybridMode ? 'text-secondary-400' : 'text-red-400',
      dotClass: isHybridMode ? 'bg-secondary-500' : 'bg-red-500',
      glowClass: isHybridMode ? 'shadow-[0_0_15px_rgb(var(--color-secondary-400)_/_0.3)]' : 'shadow-[0_0_15px_rgba(239,68,68,0.3)]'
    },
    syncing: {
      icon: RefreshCw,
      text: 'مزامنة...',
      bgClass: 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20',
      textClass: 'text-amber-400',
      dotClass: 'bg-amber-500',
      glowClass: 'shadow-[0_0_15px_rgba(245,158,11,0.3)]'
    },
    idle: {
      icon: isHybridMode ? Database : Wifi,
      text: isHybridMode ? 'هجين' : 'تهيئة',
      bgClass: 'bg-slate-500/10 border-slate-500/30 hover:bg-slate-500/20',
      textClass: 'text-slate-300',
      dotClass: 'bg-slate-400',
      glowClass: 'shadow-[0_0_15px_rgba(148,163,184,0.3)]'
    },
    error: {
      icon: WifiOff,
      text: 'خطأ',
      bgClass: 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20',
      textClass: 'text-red-400',
      dotClass: 'bg-red-500',
      glowClass: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]'
    },
    conflict: {
      icon: AlertTriangle,
      text: 'تعارض',
      bgClass: 'bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20',
      textClass: 'text-orange-400',
      dotClass: 'bg-orange-500',
      glowClass: 'shadow-[0_0_15px_rgba(249,115,22,0.3)]'
    }
  };

  const config = statusConfig[status.status] || statusConfig.online;
  const Icon = isRefreshing || status.status === 'syncing' ? RefreshCw : config.icon;

  return (
    <div className="relative">
      <button
        onClick={handleForceSync}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        disabled={isRefreshing}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-full border backdrop-blur-md
          transition-all duration-300 cursor-pointer
          ${config.bgClass} ${config.glowClass}
          disabled:cursor-wait
        `}
      >
        {/* Status Dot */}
        <span className={`w-2 h-2 rounded-full ${config.dotClass} ${status.status === 'syncing' || isRefreshing ? 'animate-pulse' : ''}`}></span>
        
        {/* Icon */}
        <Icon className={`w-4 h-4 ${config.textClass} ${isRefreshing || status.status === 'syncing' ? 'animate-spin' : ''}`} />
        
        {/* Text */}
        <span className={`text-xs font-medium ${config.textClass}`}>
          {isRefreshing ? 'جاري التحديث...' : config.text}
        </span>

        {/* Pending Badge */}
        {pendingCount > 0 && (
          <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {pendingCount}
          </span>
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full mt-2 right-0 z-50 animate-fade-in">
          <div className="bg-slate-800/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl min-w-[220px]">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              {status.status === 'online' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
              {status.status === 'offline' && (isHybridMode ? <HardDrive className="w-4 h-4 text-secondary-400" /> : <WifiOff className="w-4 h-4 text-red-400" />)}
              {status.status === 'syncing' && <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />}
              {status.status === 'idle' && (isHybridMode ? <Database className="w-4 h-4 text-slate-300" /> : <Cloud className="w-4 h-4 text-slate-300" />)}
              {status.status === 'error' && <WifiOff className="w-4 h-4 text-red-400" />}
              <span className="text-sm font-medium text-white">
                {status.status === 'online' && (isHybridMode ? 'متزامن مع السحابة' : 'الاتصال نشط')}
                {status.status === 'offline' && (isHybridMode ? 'يعمل محلياً' : 'لا يوجد اتصال')}
                {status.status === 'syncing' && 'جاري المزامنة'}
                {status.status === 'idle' && (isHybridMode ? 'الوضع الهجين' : 'جاري التهيئة')}
                {status.status === 'error' && 'فشل المزامنة'}
              </span>
            </div>

            {/* Mode Badge */}
            {isHybridMode && (
              <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-secondary-500/10 rounded-lg border border-secondary-500/20">
                <Database className="w-3 h-3 text-secondary-400" />
                <span className="text-[10px] text-secondary-300 font-medium">الوضع الهجين - محلي + سحابي</span>
              </div>
            )}
            
            <div className="text-xs text-gray-400 space-y-1.5">
              {/* Pending Records */}
              {pendingCount > 0 ? (
                <p className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  <span>{pendingCount} سجل في انتظار المزامنة</span>
                </p>
              ) : (
                <p className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>جميع البيانات محدثة</span>
                </p>
              )}

              {/* Conflicts */}
              {conflictCount > 0 && (
                <p className="flex items-center gap-1.5 text-orange-400">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{conflictCount} تعارض يحتاج حل</span>
                </p>
              )}

              {/* Last Sync Time */}
              {isHybridMode && (
                <p className="flex items-center gap-1.5 text-gray-500">
                  <RefreshCw className="w-3 h-3" />
                  <span>آخر مزامنة: {formatLastSync(lastSyncTime)}</span>
                </p>
              )}

              {/* Action Hint */}
              <p className="text-gray-500 mt-2 pt-2 border-t border-white/5">
                اضغط لتحديث البيانات {isHybridMode ? 'ومزامنتها' : ''}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncStatus;

