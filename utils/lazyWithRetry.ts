import { lazy, type ComponentType } from 'react';

const CHUNK_RELOAD_KEY = 'hader:chunk-reload';

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Unable to preload CSS') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk')
  );
}

async function clearStaleDeploymentCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {
    // Non-fatal — proceed with reload even if cache clearing fails
  }
}

/**
 * Like React.lazy, but triggers a one-time full reload when a dynamic chunk 404s
 * (common right after a deploy: cached index points at removed hashed files).
 * On first failure: clears SW caches + reloads to get fresh index.html.
 * On second failure in same session: throws so ErrorBoundary can show recovery UI.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return mod;
    } catch (err) {
      if (isChunkLoadError(err) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        // Fire-and-forget: do NOT await — awaiting SW/cache APIs can hang indefinitely
        // and leave <Suspense> stuck on the spinner forever.
        void clearStaleDeploymentCaches();
        window.location.reload();
      }
      // Always reject: a never-settling promise leaves <Suspense> stuck on white/loader forever.
      throw err;
    }
  });
}
