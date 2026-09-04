import { describe, expect, it } from 'vitest';
import { getHaderAuthFailureMessage } from '../services/haderAuthError';

describe('Hader auth error messages', () => {
  it.each([
    ['verification_failed', 403, 'تعذر التحقق الأمني. أعد تنفيذ Turnstile ثم حاول مجدداً.'],
    ['rate_limited', 429, 'تم تجاوز عدد محاولات الدخول. انتظر خمس دقائق ثم حاول مجدداً.'],
    ['security_not_configured', 503, 'حماية تسجيل الدخول غير مكتملة الإعداد.'],
    ['invalid_credentials', 401, 'بيانات الدخول غير صحيحة.']
  ])('maps %s to a useful Arabic message', async (error, status, expected) => {
    const response = new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });

    await expect(getHaderAuthFailureMessage(response, true)).resolves.toBe(expected);
  });

  it('keeps the configuration hint when Supabase is unavailable', async () => {
    await expect(getHaderAuthFailureMessage(undefined, false)).resolves.toContain('Supabase غير مهيأ');
  });
});
