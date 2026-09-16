import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

const UPSTREAM_TIMEOUT_MS = 30_000;
const DEFAULT_UPSTREAM_URL = 'http://127.0.0.1:5001';

// Server-side environment variables (kept strictly secret on server)
const getUpstreamUrl = (): string => {
  const url = process.env.WHATSAPP_SERVER_URL || process.env.WHATSAPP_API_URL || DEFAULT_UPSTREAM_URL;
  return url.replace(/\/+$/, '');
};

const getSecretApiKey = (): string => {
  return process.env.WHATSAPP_API_KEY || '';
};

const getSupabaseClient = () => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const readRequestBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
};

const extractBearerToken = (request: IncomingMessage): string | null => {
  const authHeader = request.headers['authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = request.headers['x-hader-auth-token'];
  if (customHeader && typeof customHeader === 'string') {
    return customHeader.trim();
  }
  return null;
};

/**
 * Verify the caller holds a real Hader staff session, and say what it proves.
 *
 * The first version of this asked Supabase Auth to validate a JWT. Hader never
 * issues one: staff credentials are checked by the hader-auth edge function,
 * which returns a plain user record, and the browser session is an encrypted
 * blob holding a locally generated UUID. So the header was always absent and
 * every request answered 401 — the page looked broken while the tunnel, the key
 * and the bridge were all fine.
 *
 * What the server did issue is the survey-admin session token: minted by
 * create_hader_survey_admin_session, stored as a hash with an expiry, and bound
 * to a user who is site_admin or school_admin and still active. list_hader_surveys
 * is used to check it because it calls require_hader_survey_admin first and
 * raises on an invalid, expired or revoked session — it is granted to anon, so
 * the anon key is enough and no service-role secret has to live on Vercel.
 *
 * That check proves "an active Hader admin session", which is why the role
 * returned is hader_admin rather than a guess at which of the two roles it was.
 * It is narrower than the WhatsApp page's own rule (site_admin OR
 * can_use_whatsapp); widening it is the general session token that comes next.
 */
const authenticateUser = async (request: IncomingMessage): Promise<{ ok: boolean; role?: string; error?: string }> => {
  // In development mode on localhost, allow bypass if explicitly configured
  const isDev = process.env.NODE_ENV === 'development';
  const host = request.headers['host'] || '';
  const isLoopback = host.includes('localhost') || host.includes('127.0.0.1');

  const token = extractBearerToken(request);
  if (!token) {
    if (isDev && isLoopback) {
      return { ok: true, role: 'admin_dev' };
    }
    return { ok: false, error: 'غير مصرح - يرجى تسجيل الدخول إلى نظام حاضر' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    // If Supabase is not configured in this environment (e.g. standalone local bridge), allow dev loopback
    if (isLoopback) return { ok: true, role: 'admin_local' };
    return { ok: false, error: 'خدمة التحقق من الهوية غير متوفرة' };
  }

  try {
    const { error } = await supabase.rpc('list_hader_surveys', { p_session_token: token });
    if (!error) return { ok: true, role: 'hader_admin' };
    return {
      ok: false,
      error: 'انتهت جلسة حاضر أو لا تملك صلاحية إدارية. سجّل الخروج ثم ادخل مجدداً.'
    };
  } catch {
    return { ok: false, error: 'فشل التحقق من الجلسة' };
  }
};

/** Query parameters that pick the sub-route; every other parameter belongs to the bridge */
const ROUTING_PARAMS = ['route', 'path'];

/** Resolves the target sub-route from the incoming request URL */
export const resolveSubRoute = (rawUrl: string = '/'): string => {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const queryPath = parsed.searchParams.get('path') || parsed.searchParams.get('route');
    if (queryPath) {
      const clean = queryPath.startsWith('/') ? queryPath : `/${queryPath}`;
      return clean.replace(/^\/api/, '');
    }
    // Extract path after /api/whatsapp
    const pathname = parsed.pathname;
    const match = pathname.match(/^\/api\/whatsapp(\/.*)?$/);
    if (match && match[1]) {
      return match[1].replace(/^\/api/, '');
    }
    return '/status';
  } catch {
    return '/status';
  }
};

/** The incoming query string minus the routing parameters, with its leading "?" when non-empty */
const resolveForwardedQuery = (rawUrl: string = '/'): string => {
  try {
    const params = new URL(rawUrl, 'http://localhost').searchParams;
    ROUTING_PARAMS.forEach(name => params.delete(name));
    const query = params.toString();
    return query ? `?${query}` : '';
  } catch {
    return '';
  }
};

/**
 * Build the bridge URL for an incoming request, keeping the caller's query parameters.
 *
 * vercel.json rewrites /api/whatsapp/send?append=true to /api/whatsapp?route=send&append=true.
 * This used to forward only the route, so the bridge never saw append=true, and without it
 * /api/send replaces the whole queue: pending notices, sent history and the ids that keep an
 * automatic notice from reaching a guardian twice.
 */
export const buildUpstreamUrl = (upstreamBase: string, rawUrl: string = '/'): string => {
  return `${upstreamBase}/api${resolveSubRoute(rawUrl)}${resolveForwardedQuery(rawUrl)}`;
};

const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  // CORS Preflight
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hader-Auth-Token, X-Idempotency-Key');

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  // 1. Authenticate user identity and verify valid session
  const auth = await authenticateUser(request);
  if (!auth.ok) {
    writeJson(response, 401, { error: auth.error || 'غير مصرح - يرجى تسجيل الدخول' });
    return;
  }

  // 2. Authorize permissions: only admins/managers/supervisors can access WhatsApp engine
  const ALLOWED_WHATSAPP_ROLES = new Set([
    'hader_admin',
    'site_admin',
    'school_admin',
    'supervisor_global',
    'admin',
    'manager',
    'admin_dev',
    'admin_local',
  ]);

  if (!ALLOWED_WHATSAPP_ROLES.has(auth.role || '')) {
    writeJson(response, 403, {
      error: 'ممنوع - ليس لديك صلاحية لإدارة أو إرسال رسائل واتساب في نظام حاضر',
      code: 'forbidden',
      role: auth.role
    });
    return;
  }

  // 2. Resolve sub-route
  const subRoute = resolveSubRoute(request.url);
  const targetUrl = buildUpstreamUrl(getUpstreamUrl(), request.url);

  // 3. Prepare upstream headers (Inject Secret API Key on server only)
  const upstreamHeaders: Record<string, string> = {
    'Accept': request.headers['accept'] || 'application/json',
  };

  const secretApiKey = getSecretApiKey();
  if (secretApiKey) {
    upstreamHeaders['X-API-Key'] = secretApiKey;
  }

  if (request.headers['content-type']) {
    upstreamHeaders['Content-Type'] = String(request.headers['content-type']);
  }
  if (request.headers['x-idempotency-key']) {
    upstreamHeaders['X-Idempotency-Key'] = String(request.headers['x-idempotency-key']);
  }

  // 4. Handle SSE stream (/events)
  if (subRoute === '/events' && request.method === 'GET') {
    try {
      const controller = new AbortController();
      request.on('close', () => controller.abort());

      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: upstreamHeaders,
        signal: controller.signal,
      });

      if (!upstream.ok) {
        writeJson(response, upstream.status, { error: `Upstream returned HTTP ${upstream.status}` });
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      if (upstream.body) {
        // @ts-ignore - ReadableStream on Node fetch
        for await (const chunk of upstream.body) {
          response.write(chunk);
        }
      }
      response.end();
      return;
    } catch (err) {
      if (!response.headersSent) {
        writeJson(response, 502, { error: 'فشل تدفق أحداث واتساب من الخادم الخلفي' });
      } else {
        response.end();
      }
      return;
    }
  }

  // 5. Forward standard request (GET, POST, DELETE)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let bodyData: Buffer | undefined = undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      bodyData = await readRequestBody(request);
    }

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method: request.method,
        headers: upstreamHeaders,
        body: bodyData ? (new Uint8Array(bodyData) as any) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const contentType = upstream.headers.get('content-type') || 'application/json';
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', contentType);

    const buffer = await upstream.arrayBuffer();
    response.end(Buffer.from(buffer));
  } catch (err: any) {
    writeJson(response, 502, {
      error: 'خادم واتساب غير متاح حالياً. يرجى التحقق من تشغيل الخادم.',
      details: err?.message || 'Connection refused'
    });
  }
};

export default handler;
