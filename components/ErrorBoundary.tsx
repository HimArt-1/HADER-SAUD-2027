import React from 'react';
import { logClientError } from '../services/telemetry';
import { auth } from '../services/auth';
import { clearStaleDeploymentCaches, CHUNK_RELOAD_KEY, isChunkLoadError } from '../utils/lazyWithRetry';

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
  isChunkError: boolean;
};

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

async function hardReload(): Promise<void> {
  await clearStaleDeploymentCaches();
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
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
    const isChunk = this.state.isChunkError;
    const reloadKey = CHUNK_RELOAD_KEY;
    const lastReload = parseInt(sessionStorage.getItem(reloadKey) || '0', 10);
    const isReloading = isChunk && (Date.now() - lastReload < 15_000);

    const urlMatch =
      error.message?.match(/https?:\/\/[^\s'")]+/)?.[0] ||
      error.message?.match(/\/assets\/[^\s'")]+/)?.[0];

    void logClientError({
      severity: 'ERROR',
      source: 'react-boundary',
      error,
      stack: info.componentStack,
      path: window.location.pathname,
      user: auth.getSession(),
      meta: {
        componentStack: info.componentStack,
        is_chunk_error: isChunk,
        failed_url: urlMatch,
        auto_reload_attempted: Boolean(lastReload > 0),
        is_reloading: isReloading
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
