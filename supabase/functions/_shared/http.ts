export const jsonResponse = (
  status: number,
  body: Record<string, unknown>,
  origin: string | null
) => {
  const hasBody = status !== 204 && status !== 205 && status !== 304;
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin ?? 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };

  if (hasBody) headers['Content-Type'] = 'application/json; charset=utf-8';

  return new Response(hasBody ? JSON.stringify(body) : null, {
    status,
    headers
  });
};
