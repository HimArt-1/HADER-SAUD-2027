import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import handler from '../api/whatsapp';
import { createHttpWhatsAppGateway } from '../services/whatsappGateway';

function createMockRequest(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): IncomingMessage {
  const emitter = new EventEmitter() as any;
  emitter.url = options.url || '/api/whatsapp/status';
  emitter.method = options.method || 'GET';
  emitter.headers = {
    host: 'hader.saud.app',
    ...(options.headers || {}),
  };

  process.nextTick(() => {
    if (options.body) {
      const data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      emitter.emit('data', Buffer.from(data));
    }
    emitter.emit('end');
  });

  return emitter as IncomingMessage;
}

function createMockResponse(): {
  res: ServerResponse;
  getStatusCode: () => number;
  getHeader: (name: string) => string | undefined;
  getJSON: () => any;
  getText: () => string;
} {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      if (hdrs) {
        Object.entries(hdrs).forEach(([k, v]) => {
          headers[k.toLowerCase()] = v;
        });
      }
      return this;
    },
    write(chunk: any) {
      body += chunk?.toString?.() || '';
      return true;
    },
    end(chunk?: any) {
      if (chunk) {
        body += chunk?.toString?.() || '';
      }
      return this;
    },
    headersSent: false,
  } as unknown as ServerResponse;

  return {
    res,
    getStatusCode: () => statusCode,
    getHeader: (name: string) => headers[name.toLowerCase()],
    getJSON: () => (body ? JSON.parse(body) : null),
    getText: () => body,
  };
}

describe('WhatsApp Proxy RBAC & Security Handler (api/whatsapp.ts)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated request with 401 when no token is provided in production', async () => {
    const req = createMockRequest({
      url: '/api/whatsapp/status',
      headers: { host: 'hader.edu.sa' },
    });
    const { res, getStatusCode, getJSON } = createMockResponse();

    await handler(req, res);

    expect(getStatusCode()).toBe(401);
    const json = getJSON();
    expect(json.error).toMatch(/غير مصرح/);
  });

  it('rejects forbidden roles (e.g. guardian, student, kiosk) with 403 Forbidden', async () => {
    // Mock Supabase getUser to return a guardian user
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(
          JSON.stringify({
            id: 'user-guardian-1',
            user_metadata: { role: 'guardian' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const req = createMockRequest({
      url: '/api/whatsapp/status',
      headers: {
        host: 'hader.edu.sa',
        authorization: 'Bearer valid-guardian-token',
      },
    });
    const { res, getStatusCode, getJSON } = createMockResponse();

    await handler(req, res);

    expect(getStatusCode()).toBe(403);
    const json = getJSON();
    expect(json.code).toBe('forbidden');
    expect(json.role).toBe('guardian');
    expect(json.error).toMatch(/ممنوع - ليس لديك صلاحية/);
  });

  it('allows authorized roles (e.g. school_admin, admin) and forwards to upstream', async () => {
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
    process.env.WHATSAPP_SERVER_URL = 'http://127.0.0.1:5001';
    process.env.WHATSAPP_API_KEY = 'test-secret-key';

    let forwardedUpstreamUrl = '';
    let forwardedHeaders: Record<string, string> = {};

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) {
        return new Response(
          JSON.stringify({
            id: 'user-admin-1',
            user_metadata: { role: 'school_admin' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      forwardedUpstreamUrl = url;
      forwardedHeaders = (init?.headers as Record<string, string>) || {};
      return new Response(
        JSON.stringify({ ok: true, state: 'ready', logged_in: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const req = createMockRequest({
      url: '/api/whatsapp/status',
      headers: {
        host: 'hader.edu.sa',
        authorization: 'Bearer valid-school-admin-token',
      },
    });
    const { res, getStatusCode, getJSON } = createMockResponse();

    await handler(req, res);

    expect(getStatusCode()).toBe(200);
    const json = getJSON();
    expect(json.state).toBe('ready');
    expect(forwardedUpstreamUrl).toBe('http://127.0.0.1:5001/api/status');
    expect(forwardedHeaders['X-API-Key']).toBe('test-secret-key');
  });

  it('allows local dev loopback requests with admin_dev role', async () => {
    process.env.NODE_ENV = 'development';
    process.env.WHATSAPP_SERVER_URL = 'http://127.0.0.1:5001';

    let forwardedUpstreamUrl = '';
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      forwardedUpstreamUrl = url;
      return new Response(
        JSON.stringify({ ok: true, version: '3.0.0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const req = createMockRequest({
      url: '/api/whatsapp/status',
      headers: { host: 'localhost:3000' },
    });
    const { res, getStatusCode, getJSON } = createMockResponse();

    await handler(req, res);

    expect(getStatusCode()).toBe(200);
    expect(getJSON().version).toBe('3.0.0');
    expect(forwardedUpstreamUrl).toBe('http://127.0.0.1:5001/api/status');
  });
});

describe('the server key never reaches the browser', () => {
  const captureHeaders = () => {
    const seen: Array<Record<string, string>> = [];
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ ...((init?.headers as Record<string, string>) ?? {}) });
      return new Response(JSON.stringify({ ok: true, state: 'idle' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    return { seen, fetcher };
  };

  it('omits X-API-Key when the app talks through the backend proxy', async () => {
    const { seen, fetcher } = captureHeaders();
    const gateway = createHttpWhatsAppGateway({
      baseUrl: '/api/whatsapp',
      apiKey: 'a-key-that-must-not-be-sent',
      fetcher: fetcher as typeof fetch,
    });

    await gateway.getStatus();

    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0])).not.toContain('X-API-Key');
  });

  it('still sends X-API-Key when talking to a bridge directly', async () => {
    const { seen, fetcher } = captureHeaders();
    const gateway = createHttpWhatsAppGateway({
      baseUrl: 'http://127.0.0.1:5001',
      apiKey: 'direct-bridge-key',
      fetcher: fetcher as typeof fetch,
    });

    await gateway.getStatus();

    expect(seen[0]['X-API-Key']).toBe('direct-bridge-key');
  });
});
