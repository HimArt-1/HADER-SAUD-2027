import React from 'react';
import { logClientError } from '../services/telemetry';
import { auth } from '../services/auth';

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
  isChunkError: boolean;
};

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

function isChunkLoadError(err?: Error): boolean {
  if (!err) return false;
  const msg = err.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Unable to preload CSS')
  );
}

async function hardReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* non-fatal */ }
  sessionStorage.removeItem('hader:chunk-reload');
  window.location.reload();
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    isChunkError: false
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void logClientError({
      severity: 'ERROR',
      source: 'react-boundary',
      error,
      stack: info.componentStack,
      path: window.location.pathname,
      user: auth.getSession(),
      meta: {
        componentStack: info.componentStack
      }
    });
  }

  render() {
    if (this.state.hasError) {
      const isChunk = this.state.isChunkError;
      return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center px-6">
          <div className="glass-card p-8 rounded-3xl border border-red-500/30 max-w-lg text-center">
            <h2 className="text-2xl font-bold text-white mb-3">
              {isChunk ? 'تحديث النظام متاح' : 'حدث خطأ غير متوقع'}
            </h2>
            <p className="text-sm text-gray-300 mb-6">
              {isChunk
                ? 'يبدو أن النظام تم تحديثه مؤخراً. اضغط على الزر لإعادة التحميل والحصول على أحدث نسخة.'
                : 'تمت مشاركة تفاصيل الخطأ مع لوحة الدعم الفني. يمكنك إعادة تحميل الصفحة للمحاولة مرة أخرى.'}
            </p>
            <button
              onClick={() => isChunk ? void hardReload() : window.location.reload()}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-white font-bold shadow-lg"
            >
              {isChunk ? 'تحديث وإعادة التحميل' : 'إعادة تحميل الصفحة'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
