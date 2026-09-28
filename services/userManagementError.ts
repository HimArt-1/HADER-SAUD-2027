/** Translate server failures without confusing account administration with surveys. */
export const getUserManagementErrorMessage = (error: unknown, action: string): string => {
  const failure = error as { code?: string; message?: string } | null;
  const message = String(failure?.message ?? '');
  if (['42P01', '42883', 'PGRST202', 'PGRST204'].includes(failure?.code ?? '') || /does not exist|schema cache/i.test(message)) {
    return 'خدمة إدارة المستخدمين غير مهيأة في الخادم. يلزم تحديث قاعدة البيانات، ثم إعادة تسجيل الدخول.';
  }
  if (/جلسة.*(?:غير صالحة|منتهية)|session.*(?:invalid|expired)/i.test(message)) {
    return 'انتهت جلسة إدارة المستخدمين أو أُلغيت. سجّل الخروج ثم ادخل مجددًا بحساب المدير.';
  }
  if (failure?.code === '23505') return 'اسم المستخدم مستخدم في حساب آخر. اختر اسمًا مختلفًا.';
  if (/fetch|network|load failed|timeout|timed?\s*out|aborted/i.test(message)) {
    return `تعذر تأكيد ${action} بسبب الاتصال بالخادم. تحقق من الاتصال وحدّث قائمة المستخدمين قبل إعادة المحاولة.`;
  }
  return message ? `تعذر ${action}: ${message}` : `لم يؤكد الخادم ${action}. حدّث قائمة المستخدمين قبل إعادة المحاولة.`;
};
