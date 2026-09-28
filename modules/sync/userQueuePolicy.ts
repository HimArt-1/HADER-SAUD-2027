// Account changes require a current administrator action and a server receipt.
// Historical offline mutations must remain reviewable, never replay automatically.
export const LEGACY_USER_QUEUE_CATEGORY = 'legacy_user_management';
export const LEGACY_USER_QUEUE_MESSAGE = 'عملية مستخدم قديمة محفوظة للمراجعة؛ أُوقف إرسالها تلقائيًا. راجع الحساب وأعد التغيير المطلوب من إدارة المستخدمين. لا تمنع هذه العملية حفظ تغييرات جديدة.';
