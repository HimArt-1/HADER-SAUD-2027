import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { auth } from './services/auth';
import { initTelemetry, logClientError } from './services/telemetry';
import { initializeTimeSync } from './services/timeSync';

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
  window.addEventListener('error', (event) => {
    if (isExternalScriptError(event.filename)) return;
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
        colno: event.colno
      }
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    void logClientError({
      severity: 'ERROR',
      source: 'unhandledrejection',
      error: event.reason,
      path: window.location.pathname,
      user: auth.getSession(),
      meta: {
        reasonType: typeof event.reason
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
