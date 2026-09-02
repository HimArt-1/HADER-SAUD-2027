// @ts-nocheck -- Supabase Edge Functions run on Deno, outside the Vite TS runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (status: number, body: Record<string, unknown>, origin: string | null) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin ?? 'null',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    }
  }
);

const splitConfig = (value: string | undefined) => new Set(
  (value ?? '').split(',').map(item => item.trim()).filter(Boolean)
);

const digest = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  const allowedOrigins = splitConfig(Deno.env.get('HADER_ALLOWED_ORIGINS'));
  const expectedHostnames = splitConfig(Deno.env.get('TURNSTILE_HOSTNAMES'));
  const isAllowedOrigin = Boolean(origin && allowedOrigins.has(origin));

  if (request.method === 'OPTIONS') {
    return isAllowedOrigin ? json(204, {}, origin) : json(403, { error: 'forbidden' }, null);
  }
  if (request.method !== 'POST' || !isAllowedOrigin) return json(403, { error: 'forbidden' }, null);

  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!turnstileSecret || !supabaseUrl || !serviceRoleKey || expectedHostnames.size === 0) {
    return json(503, { error: 'security_not_configured' }, origin);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'invalid_request' }, origin);
  }

  const username = typeof payload.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const turnstileToken = typeof payload.turnstileToken === 'string' ? payload.turnstileToken : '';
  if (!username || username.length > 100 || !password || password.length > 500 || !turnstileToken || turnstileToken.length > 2048) {
    return json(400, { error: 'invalid_request' }, origin);
  }

  const forwardedIps = request.headers.get('x-forwarded-for')?.split(/\s*,\s*/).filter(Boolean) ?? [];
  const clientIp = forwardedIps[0] ?? '';
  const verificationBody = new URLSearchParams({
    secret: turnstileSecret,
    response: turnstileToken,
    ...(clientIp ? { remoteip: clientIp } : {})
  });

  let verification: Record<string, unknown>;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verificationBody,
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    verification = await response.json();
  } catch {
    return json(403, { error: 'verification_failed' }, origin);
  }

  if (
    verification.success !== true
    || verification.action !== 'hader_login'
    || typeof verification.hostname !== 'string'
    || !expectedHostnames.has(verification.hostname)
  ) {
    return json(403, { error: 'verification_failed' }, origin);
  }

  const sourceHash = await digest(clientIp || 'unknown-source');
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: allowed, error: rateError } = await adminClient.rpc('consume_hader_auth_edge_rate_limit', {
    p_source: sourceHash
  });
  if (rateError || allowed !== true) return json(429, { error: 'rate_limited' }, origin);

  const { data: authData, error: authError } = await adminClient.rpc('authenticate_hader_staff', {
    p_username: username,
    p_plain_password: password
  });
  const user = authData?.user ?? authData;
  if (authError || !user?.id) return json(401, { error: 'invalid_credentials' }, origin);

  let surveySession: Record<string, unknown> | null = null;
  if (user.role === 'site_admin' || user.role === 'school_admin') {
    const { data, error } = await adminClient.rpc('create_hader_survey_admin_session', {
      p_username: username,
      p_plain_password: password
    });
    if (error || !data?.token) return json(401, { error: 'invalid_credentials' }, origin);
    surveySession = data;
  }

  return json(200, { user, surveySession }, origin);
});
