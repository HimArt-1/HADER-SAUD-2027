import React from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { ConnectionStatus, CONNECTION_STATUS_CONFIG } from '../../hooks/useConnectionMonitor';

// ═══════════════════════════════════════════════════════════════
// 🔌 Connection Status Badge
// شارة حالة الاتصال مع تفاصيل تفاعلية
// ═══════════════════════════════════════════════════════════════

interface ConnectionStatusBadgeProps {
  status: ConnectionStatus;
  latency?: number | null;
  reconnectAttempts?: number;
  isOnline?: boolean;
  onReconnect?: () => void;
  showDetails?: boolean;
  className?: string;
}

const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = ({
  status,
  latency,
  reconnectAttempts = 0,
  isOnline = true,
  onReconnect,
  showDetails = true,
  className = '',
}) => {
  const config = CONNECTION_STATUS_CONFIG[status];
  
  const getIcon = () => {
    switch (status) {
      case 'connected':
        return <Wifi className="w-3.5 h-3.5" />;
      case 'connecting':
        return <RefreshCw className="w-3.5 h-3.5 animate-spin" />;
      case 'disconnected':
      case 'error':
        return <WifiOff className="w-3.5 h-3.5" />;
      default:
        return <AlertTriangle className="w-3.5 h-3.5" />;
    }
  };

  const getLatencyColor = () => {
    if (!latency) return 'text-gray-400';
    if (latency < 100) return 'text-emerald-400';
    if (latency < 300) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* شارة الحالة الرئيسية */}
      <div 
        className={`
          relative flex items-center gap-2 px-3 py-1.5 rounded-full
          bg-slate-800/80 border border-slate-700/50
          transition-all duration-300 cursor-default
          ${status === 'error' ? 'border-red-500/50' : ''}
          ${status === 'connected' ? 'border-emerald-500/30' : ''}
        `}
        title={`${config.label}${latency ? ` - ${latency}ms` : ''}`}
      >
        {/* نقطة الحالة مع Pulse */}
        <span className="relative flex h-2.5 w-2.5">
          {(status === 'connected' || status === 'connecting') && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.pulseColor} opacity-75`} />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${config.color}`} />
        </span>
        
        {/* الأيقونة */}
        <span className={config.textColor}>
          {getIcon()}
        </span>
        
        {/* النص */}
        <span className={`text-xs font-medium ${config.textColor}`}>
          {config.label}
        </span>
        
        {/* زمن الاستجابة */}
        {showDetails && status === 'connected' && latency && (
          <span className={`text-[10px] font-mono ${getLatencyColor()}`}>
            {latency}ms
          </span>
        )}
        
        {/* عدد محاولات إعادة الاتصال */}
        {showDetails && status === 'disconnected' && reconnectAttempts > 0 && (
          <span className="text-[10px] text-gray-500">
            ({reconnectAttempts}/5)
          </span>
        )}
      </div>
      
      {/* زر إعادة الاتصال */}
      {(status === 'disconnected' || status === 'error') && onReconnect && (
        <button
          onClick={onReconnect}
          className="
            p-1.5 rounded-lg
            bg-slate-800 border border-slate-700
            text-gray-400 hover:text-white
            hover:bg-slate-700 hover:border-slate-600
            transition-all duration-200
            active:scale-95
          "
          title="إعادة الاتصال"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}
      
      {/* مؤشر عدم الاتصال بالإنترنت */}
      {!isOnline && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20 border border-red-500/30">
          <WifiOff className="w-3 h-3 text-red-400" />
          <span className="text-[10px] text-red-400 font-medium">أوفلاين</span>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// 🎯 نسخة مصغرة للشريط العلوي
// ═══════════════════════════════════════════════════════════════

export const ConnectionDot: React.FC<{
  status: ConnectionStatus;
  className?: string;
}> = ({ status, className = '' }) => {
  const config = CONNECTION_STATUS_CONFIG[status];
  
  return (
    <span 
      className={`relative flex h-2 w-2 ${className}`}
      title={config.label}
    >
      {status === 'connected' && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.pulseColor} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${config.color}`} />
    </span>
  );
};

export default ConnectionStatusBadge;
