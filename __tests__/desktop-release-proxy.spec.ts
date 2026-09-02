import type { IncomingMessage, ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from '../api/desktop-release';

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

const createResponse = (): MockResponse => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name, value) {
    this.headers[name] = value;
  },
  end(body = '') {
    this.body = body;
  },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('desktop release same-origin proxy', () => {
  it('returns the latest GitHub manifest with edge caching', async () => {
    const manifest = { version: '1.0.0', platforms: {} };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => manifest,
    })));
    const response = createResponse();

    await handler({ method: 'GET' } as IncomingMessage, response as unknown as ServerResponse);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(manifest);
    expect(response.headers['Cache-Control']).toContain('s-maxage=300');
  });

  it('returns a non-cacheable 502 when GitHub is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const response = createResponse();

    await handler({ method: 'GET' } as IncomingMessage, response as unknown as ServerResponse);

    expect(response.statusCode).toBe(502);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(response.body)).toEqual({ error: 'desktop-release-unavailable' });
  });

  it('aborts a stalled GitHub request before the serverless function timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const response = createResponse();

    const request = handler(
      { method: 'GET' } as IncomingMessage,
      response as unknown as ServerResponse
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await request;

    expect(response.statusCode).toBe(502);
    expect(response.headers['Cache-Control']).toBe('no-store');
  });
});
