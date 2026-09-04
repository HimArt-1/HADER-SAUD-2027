export async function getHaderAuthFailureMessage(
  response: Response | undefined,
  isSupabaseConfigured: boolean
): Promise<string> {
  if (!isSupabaseConfigured) {
    return 'Supabase غير مهيأ. تأكد من إعدادات الاتصال ثم أعد المحاولة.';
  }

  let errorCode = '';
  try {
    const payload = await response?.clone().json() as { error?: unknown } | undefined;
    errorCode = typeof payload?.error === 'string' ? payload.error : '';
  } catch {
    // Keep the status-based fallback below for non-JSON responses.
  }

  const messages: Record<string, string> = {
    verification_failed: 'تعذر التحقق الأمني. أعد تنفيذ Turnstile ثم حاول مجدداً.',
    rate_limited: 'تم تجاوز عدد محاولات الدخول. انتظر خمس دقائق ثم حاول مجدداً.',
    security_not_configured: 'حماية تسجيل الدخول غير مكتملة الإعداد.',
    invalid_credentials: 'بيانات الدخول غير صحيحة.',
    invalid_request: 'طلب تسجيل الدخول غير مكتمل. حدّث الصفحة ثم حاول مجدداً.',
    forbidden: 'نطاق الموقع غير مصرح له بتسجيل الدخول.'
  };

  if (errorCode && messages[errorCode]) return messages[errorCode];
  if (response?.status === 429) return messages.rate_limited;
  if (response?.status === 403) return messages.verification_failed;
  if (response && response.status >= 500) return 'خدمة تسجيل الدخول غير متاحة مؤقتاً. حاول مجدداً بعد قليل.';

  return messages.invalid_credentials;
}
