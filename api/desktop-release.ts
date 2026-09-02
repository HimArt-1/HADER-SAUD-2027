import type { IncomingMessage, ServerResponse } from 'node:http';

const RELEASE_MANIFEST_URL =
  'https://github.com/HimArt-1/HADER-SAUD-2027/releases/latest/download/desktop-manifest.json';
const UPSTREAM_TIMEOUT_MS = 5_000;

interface ErrorResponse {
  error: 'desktop-release-unavailable';
}

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const handler = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    writeJson(response, 405, { error: 'desktop-release-unavailable' } satisfies ErrorResponse);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let manifest: unknown;
    try {
      const upstream = await fetch(RELEASE_MANIFEST_URL, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!upstream.ok) throw new Error(`GitHub release manifest returned ${upstream.status}`);
      manifest = await upstream.json() as unknown;
    } finally {
      clearTimeout(timeoutId);
    }
    if (!manifest || typeof manifest !== 'object') throw new Error('GitHub release manifest is not a JSON object');

    response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    if (request.method === 'HEAD') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end();
      return;
    }
    writeJson(response, 200, manifest);
  } catch {
    response.setHeader('Cache-Control', 'no-store');
    writeJson(response, 502, { error: 'desktop-release-unavailable' } satisfies ErrorResponse);
  }
};

export default handler;
