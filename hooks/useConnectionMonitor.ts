import { useState, useEffect, useCallback, useRef } from 'react';
import { whatsappGateway } from '../services/whatsappGateway';
import { useWhatsAppSSE } from './useWhatsAppSSE';

// ═══════════════════════════════════════════════════════════════
// 🔌 Connection Monitor Hook
// مراقب اتصال متكامل مع إعادة الاتصال التلقائي
// ═══════════════════════════════════════════════════════════════

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  lastCheck: Date | null;
  latency: number | null;
  serverVersion: string | null;
  errorMessage: string | null;
  reconnectAttempts: number;
  isOnline: boolean;
}

export interface UseConnectionMonitorOptions {
  /** فترة الفحص بالمللي ثانية (الافتراضي: 10 ثواني) */
  checkInterval?: number;
  /** الحد الأقصى لمحاولات إعادة الاتصال (الافتراضي: 5) */
  maxRetries?: number;
  /** مهلة الطلب بالمللي ثانية (الافتراضي: 5 ثواني) */
  timeout?: number;
  /** تفعيل إعادة الاتصال التلقائي (الافتراضي: true) */
  autoReconnect?: boolean;
  /** Callback عند تغير الحالة */
  onStatusChange?: (status: ConnectionStatus, state: ConnectionState) => void;
  /** Callback عند النجاح بعد انقطاع */
  onReconnected?: () => void;
  /** Callback عند الفشل النهائي */
  onDisconnected?: () => void;
}

const DEFAULT_OPTIONS: Required<Omit<UseConnectionMonitorOptions, 'onStatusChange' | 'onReconnected' | 'onDisconnected'>> = {
  checkInterval: 30000, // ⚡ تم زيادة الفترة من 10 ثوان إلى 30 ثانية لتقليل الحمل
  maxRetries: 5,
  timeout: 5000,
  autoReconnect: true,
};

export function useConnectionMonitor(options: UseConnectionMonitorOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Stabilize opts reference to prevent infinite re-renders
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [state, setState] = useState<ConnectionState>({
    status: 'connecting',
    lastCheck: null,
    latency: null,
    serverVersion: null,
    errorMessage: null,
    reconnectAttempts: 0,
    isOnline: navigator.onLine,
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wasConnectedRef = useRef(false);
  // SSE suppresses the next polling tick when it has already delivered a status
  const sseActiveRef = useRef(false);

  // ═══════════════════════════════════════════════════════════════
  // 📡 SSE — primary real-time channel (falls back to polling on error)
  // ═══════════════════════════════════════════════════════════════
  useWhatsAppSSE({
    onOpen: () => {
      sseActiveRef.current = true;
    },
    onStatus: (sseStatus) => {
      sseActiveRef.current = true;
      const latency = 0; // SSE push, no round-trip latency to measure
      setState(prev => {
        const newState: ConnectionState = {
          status: 'connected',
          lastCheck: new Date(),
          latency,
          serverVersion: sseStatus.version || prev.serverVersion,
          errorMessage: null,
          reconnectAttempts: 0,
          isOnline: true,
        };
        if (prev.status !== 'connected' && wasConnectedRef.current) {
          optsRef.current.onReconnected?.();
        }
        wasConnectedRef.current = true;
        optsRef.current.onStatusChange?.('connected', newState);
        return newState;
      });
    },
    onError: () => {
      sseActiveRef.current = false;
      // Polling will handle reconnect detection from here
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // 🔍 فحص الاتصال (polling fallback — skipped when SSE is active)
  // ═══════════════════════════════════════════════════════════════
  const checkConnection = useCallback(async (): Promise<boolean> => {
    // If SSE already confirmed the server is alive this tick, skip the poll
    if (sseActiveRef.current) return true;
    const startTime = Date.now();

    try {
      const data = await whatsappGateway.getStatus({ timeoutMs: optsRef.current.timeout });
      const latency = Date.now() - startTime;

      setState(prev => {
        const newState: ConnectionState = {
          status: 'connected',
          lastCheck: new Date(),
          latency,
          serverVersion: data.version || '1.0.0',
          errorMessage: null,
          reconnectAttempts: 0,
          isOnline: true,
        };

        // إذا كان منقطعاً سابقاً والآن متصل
        if (prev.status !== 'connected' && wasConnectedRef.current) {
          optsRef.current.onReconnected?.();
        }

        wasConnectedRef.current = true;
        optsRef.current.onStatusChange?.('connected', newState);

        return newState;
      });

      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'خطأ غير معروف';

      setState(prev => {
        const newAttempts = prev.status === 'connected' ? 1 : prev.reconnectAttempts + 1;
        const newStatus: ConnectionStatus = newAttempts >= optsRef.current.maxRetries ? 'error' : 'disconnected';

        const newState: ConnectionState = {
          status: newStatus,
          lastCheck: new Date(),
          latency: null,
          serverVersion: prev.serverVersion,
          errorMessage,
          reconnectAttempts: newAttempts,
          isOnline: navigator.onLine,
        };

        if (newStatus === 'error') {
          optsRef.current.onDisconnected?.();
        }

        optsRef.current.onStatusChange?.(newStatus, newState);

        return newState;
      });

      return false;
    }
  }, []); // Stable: no deps, uses optsRef internally

  // ═══════════════════════════════════════════════════════════════
  // 🔄 إعادة الاتصال اليدوي
  // ═══════════════════════════════════════════════════════════════
  const reconnect = useCallback(async () => {
    setState(prev => ({
      ...prev,
      status: 'connecting',
      reconnectAttempts: 0,
      errorMessage: null,
    }));

    return checkConnection();
  }, [checkConnection]);

  // ═══════════════════════════════════════════════════════════════
  // 🚀 بدء/إيقاف المراقبة
  // ═══════════════════════════════════════════════════════════════
  const startMonitoring = useCallback(() => {
    if (intervalRef.current) return;

    // فحص فوري
    checkConnection();

    // فحص دوري
    intervalRef.current = setInterval(checkConnection, optsRef.current.checkInterval);
  }, [checkConnection]);

  const stopMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // 🌐 مراقبة حالة الشبكة
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const handleOnline = () => {
      setState(prev => ({ ...prev, isOnline: true }));
      if (optsRef.current.autoReconnect) {
        reconnect();
      }
    };

    const handleOffline = () => {
      setState(prev => ({
        ...prev,
        isOnline: false,
        status: 'disconnected',
        errorMessage: 'لا يوجد اتصال بالإنترنت',
      }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [reconnect]);

  // ═══════════════════════════════════════════════════════════════
  // 🎬 بدء المراقبة عند التحميل
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    startMonitoring();
    return stopMonitoring;
  }, [startMonitoring, stopMonitoring]);

  // ═══════════════════════════════════════════════════════════════
  // 🔄 إعادة المحاولة التلقائية مع تأخير تصاعدي
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (
      optsRef.current.autoReconnect &&
      state.status === 'disconnected' &&
      state.reconnectAttempts < optsRef.current.maxRetries &&
      state.isOnline
    ) {
      // تأخير تصاعدي: 2s, 4s, 8s, 16s, 32s
      const delay = Math.min(2000 * Math.pow(2, state.reconnectAttempts), 32000);

      retryTimeoutRef.current = setTimeout(() => {
        checkConnection();
      }, delay);

      return () => {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
      };
    }
  }, [state.status, state.reconnectAttempts, state.isOnline, checkConnection]);

  return {
    ...state,
    reconnect,
    startMonitoring,
    stopMonitoring,
    isHealthy: state.status === 'connected' && state.isOnline,
  };
}

// ═══════════════════════════════════════════════════════════════
// 🏷️ مكون شارة حالة الاتصال
// ═══════════════════════════════════════════════════════════════
export const CONNECTION_STATUS_CONFIG = {
  connected: {
    label: 'متصل',
    color: 'bg-emerald-500',
    pulseColor: 'bg-emerald-400',
    textColor: 'text-emerald-400',
    icon: '●',
  },
  connecting: {
    label: 'جاري الاتصال...',
    color: 'bg-amber-500',
    pulseColor: 'bg-amber-400',
    textColor: 'text-amber-400',
    icon: '◐',
  },
  disconnected: {
    label: 'منقطع',
    color: 'bg-red-500',
    pulseColor: 'bg-red-400',
    textColor: 'text-red-400',
    icon: '○',
  },
  error: {
    label: 'خطأ في الاتصال',
    color: 'bg-red-600',
    pulseColor: 'bg-red-500',
    textColor: 'text-red-500',
    icon: '✕',
  },
} as const;

export default useConnectionMonitor;
