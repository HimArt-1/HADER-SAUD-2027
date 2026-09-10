import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { auth } from './services/auth';
import { initTelemetry, logClientError } from './services/telemetry';
import { initializeTimeSync } from './services/timeSync';
import { clearStaleDeploymentCaches, CHUNK_RELOAD_KEY, isChunkLoadError } from './utils/lazyWithRetry';

initTelemetry();
initializeTimeSync().catch(console.warn);

// Patterns of external scripts we own no responsibility for (Vercel analytics, browser extensions, etc.)
const EXTERNAL_SCRIPT_PATTERNS = [
  /instrument\.[a-f0-9]+\.js/,  // Vercel Speed Insights / Web Analytics
  /feedback\.js/,               // Vercel feedback widget
  /^chrome-extension:\/\//,     // Browser extensions
  /^moz-extension:\/\//,
  /^safari-extension:\/\//,
];

function isExternalScriptError(filename?: string): boolean {
  if (!filename) return false;
  return EXTERNAL_SCRIPT_PATTERNS.some(p => p.test(filename));
}

if (typeof window !== 'undefined') {
  // Vite official preload error handler (triggers when a deployed chunk is 404 / stale)
  window.addEventListener('vite:preloadError', (event: any) => {
    const error = event?.payload ?? event?.error;
    const msg = error instanceof Error ? error.message : String(error || 'Vite module preload failed');
    const failedUrl =
      event?.payload?.src ||
      event?.payload?.href ||
      (typeof error?.message === 'string' && error.message.match(/https?:\/\/[^\s'")]+/)?.[0]) ||
      undefined;

    const lastReload = parseInt(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0', 10);
    const now = Date.now();
    const canAutoReload = now - lastReload > 15_000;

    void logClientError({
      severity: 'ERROR',
      source: 'window.onerror',
      error,
      message: `Vite preload error: ${msg}`,
      path: window.location.pathname,
      user: auth.getSession(),
      meta: {
        event_type: 'vite:preloadError',
        failed_url: failedUrl,
        auto_reloading: canAutoReload
      }
    });

    if (canAutoReload) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
      void clearStaleDeploymentCaches().finally(() => {
        window.location.reload();
      });
    }
  });

  window.addEventListener('error', (event) => {
    if (isExternalScriptError(event.filename)) return;
    const isChunk = isChunkLoadError(event.error ?? event.message);
    const failedUrl = event.filename || (typeof event.message === 'string' && event.message.match(/https?:\/\/[^\s'")]+/)?.[0]) || undefined;

    void logClientError({
      severity: 'ERROR',
      source: 'window.onerror',
      error: event.error ?? event.message,
      message: event.message,
      path: window.location.pathname,
      user: auth.getSession(),
      meta: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        is_chunk_error: isChunk,
        failed_url: failedUrl
      }
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const isChunk = isChunkLoadError(event.reason);
    const reasonMsg = event.reason instanceof Error ? event.reason.message : String(event.reason ?? '');
    const failedUrl = reasonMsg.match(/https?:\/\/[^\s'")]+/)?.[0] || reasonMsg.match(/\/assets\/[^\s'")]+/)?.[0] || undefined;

    void logClientError({
      severity: 'ERROR',
      source: 'unhandledrejection',
      error: event.reason,
      path: window.location.pathname,
      user: auth.getSession(),
      meta: {
        reasonType: typeof event.reason,
        is_chunk_error: isChunk,
        failed_url: failedUrl
      }
    });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
