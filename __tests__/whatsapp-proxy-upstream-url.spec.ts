import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler, { buildUpstreamUrl, resolveSubRoute } from '../api/whatsapp';
import { createHttpWhatsAppGateway } from '../services/whatsappGateway';

const BRIDGE = 'http://127.0.0.1:5011';

// vercel.json rewrites /api/whatsapp/(.*) to /api/whatsapp?route=$1 and keeps the caller's query,
// so the function can see either shape depending on whether the rewrite applied.
const REWRITE_FORM = '/api/whatsapp?route=send&append=true';
const DIRECT_FORM = '/api/whatsapp/send?append=true';

describe('resolveSubRoute', () => {
  it.each([
    ['rewrite form', REWRITE_FORM],
    ['direct path form', DIRECT_FORM],
  ])('reads /send from the %s without the query', (_label, url) => {
    expect(resolveSubRoute(url)).toBe('/send');
  });

  it('accepts path= and strips a leading /api', () => {
    expect(resolveSubRoute('/api/whatsapp?path=/api/send&append=true')).toBe('/send');
  });

  it('falls back to /status', () => {
    expect(resolveSubRoute('/api/whatsapp')).toBe('/status');
  });
});

describe('buildUpstreamUrl', () => {
  it.each([
    ['rewrite form', REWRITE_FORM],
    ['direct path form', DIRECT_FORM],
  ])('keeps append=true for send?append=true in the %s', (_label, url) => {
    expect(buildUpstreamUrl(BRIDGE, url)).toBe(`${BRIDGE}/api/send?append=true`);
  });

  it('does not forward the routing parameters themselves', () => {
    const target = new URL(buildUpstreamUrl(BRIDGE, '/api/whatsapp?path=/api/send&route=ignored&append=false'));
    expect(target.pathname).toBe('/api/send');
    expect([...target.searchParams.keys()]).toEqual(['append']);
    expect(target.searchParams.get('append')).toBe('false');
  });

  it('forwards every other parameter, including repeated and encoded values', () => {
    const target = new URL(
      buildUpstreamUrl(BRIDGE, '/api/whatsapp?route=send&append=true&idempotency_key=a%20b%26c&tag=x&tag=y')
    );
    expect(target.pathname).toBe('/api/send');
    expect(target.searchParams.get('append')).toBe('true');
    expect(target.searchParams.get('idempotency_key')).toBe('a b&c');
    expect(target.searchParams.getAll('tag')).toEqual(['x', 'y']);
  });

  it('leaves no dangling "?" when only the route was given', () => {
    expect(buildUpstreamUrl(BRIDGE, '/api/whatsapp?route=status')).toBe(`${BRIDGE}/api/status`);
    expect(buildUpstreamUrl(BRIDGE, '/api/whatsapp/queue')).toBe(`${BRIDGE}/api/queue`);
  });

  it('carries what the app actually sends through the proxy', async () => {
    const seen: string[] = [];
    const gateway = createHttpWhatsAppGateway({
      baseUrl: '/api/whatsapp',
      fetcher: (async (input: RequestInfo | URL) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ saved: 1, duplicates: 0 }), { status: 200 });
      }) as typeof fetch,
    });

    await gateway.enqueue([{ phone: '966500000000', message: 'hello' }]);

    expect(seen).toEqual([DIRECT_FORM]);
    expect(buildUpstreamUrl(BRIDGE, seen[0])).toBe(`${BRIDGE}/api/send?append=true`);
  });
});

describe('the proxy handler forwards append=true to the bridge', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'development', WHATSAPP_SERVER_URL: BRIDGE };
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it.each([
    ['rewrite form', REWRITE_FORM],
    ['direct path form', DIRECT_FORM],
  ])('in the %s', async (_label, url) => {
    const upstreamCalls: Array<{ url: string; method?: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (target: string, init?: RequestInit) => {
      upstreamCalls.push({
        url: target,
        method: init?.method,
        body: Buffer.from(init?.body as Uint8Array).toString('utf8'),
      });
      return new Response(JSON.stringify({ saved: 1, duplicates: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const payload = JSON.stringify([{ id: 'late:s1:2026-09-16', phone: '966500000000', message: 'hello' }]);
    // Loopback host with no token and no Supabase configured: the dev bypass, so only routing is under test.
    const request = Object.assign(Readable.from([Buffer.from(payload)]), {
      url,
      method: 'POST',
      headers: { host: 'localhost:3000', 'content-type': 'application/json' },
    }) as unknown as IncomingMessage;
    const response = {
      statusCode: 0,
      body: '',
      setHeader() {},
      end(chunk?: Buffer | string) {
        this.body = chunk ? chunk.toString() : '';
      },
    };

    await handler(request, response as unknown as ServerResponse);

    expect(response.statusCode).toBe(200);
    expect(upstreamCalls).toEqual([
      { url: `${BRIDGE}/api/send?append=true`, method: 'POST', body: payload },
    ]);
  });
});
