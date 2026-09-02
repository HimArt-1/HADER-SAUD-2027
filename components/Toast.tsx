/**
 * ═══════════════════════════════════════════════════════════════
 * 🔔 Toast Component - نظام إشعارات موحد بديلاً عن alert()
 * ═══════════════════════════════════════════════════════════════
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

// ═══════════════════════════════════════════════════════════════
// Context
// ═══════════════════════════════════════════════════════════════

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback to alert if context is not available
    return {
      showToast: (message: string) => console.log('[Toast]', message),
      success: (message: string) => console.log('[Toast Success]', message),
      error: (message: string) => console.error('[Toast Error]', message),
      warning: (message: string) => console.warn('[Toast Warning]', message),
      info: (message: string) => console.info('[Toast Info]', message),
    };
  }
  return context;
};

// ═══════════════════════════════════════════════════════════════
// Toast Item Component
// ═══════════════════════════════════════════════════════════════

const ToastItem: React.FC<{
  toast: ToastMessage;
  onClose: (id: string) => void;
}> = ({ toast, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onClose]);

  const config = {
    success: {
      icon: CheckCircle,
      bg: 'bg-emerald-500/90',
      border: 'border-emerald-400/30',
    },
    error: {
      icon: AlertCircle,
      bg: 'bg-red-500/90',
      border: 'border-red-400/30',
    },
    warning: {
      icon: AlertTriangle,
      bg: 'bg-amber-500/90',
      border: 'border-amber-400/30',
    },
    info: {
      icon: Info,
      bg: 'bg-secondary-500/90',
      border: 'border-secondary-400/30',
    },
  }[toast.type];

  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md border text-white animate-fade-in-up ${config.bg} ${config.border}`}
      role="alert"
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="font-bold text-sm flex-1">{toast.message}</span>
      <button
        onClick={() => onClose(toast.id)}
        className="hover:bg-white/20 rounded-full p-1 transition-colors"
        aria-label="إغلاق"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Toast Provider Component
// ═══════════════════════════════════════════════════════════════

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'success', duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const value: ToastContextType = {
    showToast,
    success: (message, duration) => showToast(message, 'success', duration),
    error: (message, duration) => showToast(message, 'error', duration),
    warning: (message, duration) => showToast(message, 'warning', duration),
    info: (message, duration) => showToast(message, 'info', duration),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      
      {/* Toast Container */}
      <div className="fixed bottom-6 left-6 z-[9999] flex flex-col gap-2 max-w-md" dir="rtl">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// ═══════════════════════════════════════════════════════════════
// Standalone Toast Function (for use outside React components)
// ═══════════════════════════════════════════════════════════════

let globalShowToast: ToastContextType['showToast'] | null = null;

export const setGlobalToast = (fn: ToastContextType['showToast']) => {
  globalShowToast = fn;
};

export const toast = {
  show: (message: string, type: ToastType = 'success') => {
    if (globalShowToast) {
      globalShowToast(message, type);
    } else {
      console.log(`[Toast ${type}]`, message);
    }
  },
  success: (message: string) => toast.show(message, 'success'),
  error: (message: string) => toast.show(message, 'error'),
  warning: (message: string) => toast.show(message, 'warning'),
  info: (message: string) => toast.show(message, 'info'),
};

export default ToastProvider;
