import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, CHUNK_RELOAD_KEY } from '../utils/lazyWithRetry';
import { logClientError, _resetTelemetryDedupeMap } from '../services/telemetry';
import { supabase } from '../services/supabase';

describe('Chunk error recovery and telemetry deduplication', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    _resetTelemetryDedupeMap();
  });

  describe('isChunkLoadError', () => {
    it('accurately identifies various chunk and dynamic module import errors', () => {
      expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
      expect(isChunkLoadError(new Error('TypeError: Failed to fetch dynamically imported module: https://example.com/assets/Admin-123.js'))).toBe(true);
      expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
      expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
      expect(isChunkLoadError(new Error('Unable to preload CSS /assets/Admin-123.css'))).toBe(true);
      expect(isChunkLoadError(new Error('Regular application error: undefined is not a function'))).toBe(false);
    });
  });

  describe('logClientError deduplication and metadata enrichment', () => {
    it('suppresses duplicate errors within the sliding window to prevent error storms', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        insert: insertMock
      } as any);

      // Simulate 16 duplicate calls within milliseconds (identical to the incident report)
      for (let i = 0; i < 16; i++) {
        await logClientError({
          severity: 'ERROR',
          source: 'react-boundary',
          message: 'Importing a module script failed.',
          path: '/index.html'
        });
      }

      // Should only have called insert ONCE
      expect(insertMock).toHaveBeenCalledTimes(1);

      // Verify enriched metadata
      const payload = insertMock.mock.calls[0][0];
      expect(payload.message).toBe('Importing a module script failed.');
      expect(payload.source).toBe('react-boundary');
      expect(payload.meta).toBeDefined();
      expect(payload.meta.event_id).toBeDefined();
      expect(typeof payload.meta.event_id).toBe('string');
      expect(payload.meta.client_timestamp).toBeDefined();
      expect(payload.meta.build_id).toBeDefined();
      expect(payload.meta.app_version).toBeDefined();
    });

    it('allows distinct errors or different paths to be logged independently', async () => {
      const insertMock = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        insert: insertMock
      } as any);

      await logClientError({
        severity: 'ERROR',
        source: 'react-boundary',
        message: 'First unique error',
        path: '/admin'
      });

      await logClientError({
        severity: 'ERROR',
        source: 'react-boundary',
        message: 'Second unique error',
        path: '/admin'
      });

      await logClientError({
        severity: 'ERROR',
        source: 'react-boundary',
        message: 'First unique error',
        path: '/kiosk'
      });

      expect(insertMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('reload throttle protection', () => {
    it('prevents reload loops within 15 seconds', () => {
      const now = Date.now();
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now - 5000)); // 5s ago

      const lastReload = parseInt(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0', 10);
      const canReload = now - lastReload > 15_000;
      expect(canReload).toBe(false);

      // After 20 seconds
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now - 20_000));
      const pastReload = parseInt(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0', 10);
      const canReloadNow = now - pastReload > 15_000;
      expect(canReloadNow).toBe(true);
    });
  });
});
