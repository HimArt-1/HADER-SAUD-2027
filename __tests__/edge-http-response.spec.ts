import { describe, expect, it } from 'vitest';
import { jsonResponse } from '../supabase/functions/_shared/http';

describe('Edge Function HTTP responses', () => {
  it('returns a bodyless 204 response for a successful CORS preflight', async () => {
    const origin = 'https://hader-saud-2027.vercel.app';
    const response = jsonResponse(204, {}, origin);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });
});
