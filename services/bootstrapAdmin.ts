import { Role, User } from '../types';

const DISALLOWED_USERNAMES = ['admin', 'HimAdmin'];
const DISALLOWED_PASSWORDS = ['admin123', 'HimAdmin5000'];
const MIN_PASSWORD_LENGTH = 12;
const PLACEHOLDER_SUPABASE_URL = 'https://your-project.supabase.co';

const parseBooleanEnv = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const hasSupabaseCloudConfig = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_URL !== PLACEHOLDER_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const bootstrapAdminConfig = {
  enabled: parseBooleanEnv(import.meta.env.VITE_ENABLE_BOOTSTRAP_ADMIN),
  username: import.meta.env.VITE_BOOTSTRAP_ADMIN_USERNAME || '',
  password: import.meta.env.VITE_BOOTSTRAP_ADMIN_PASSWORD || '',
  name: import.meta.env.VITE_BOOTSTRAP_ADMIN_NAME || 'مدير النظام'
} as const;

export interface BootstrapValidation {
  enabled: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const hasLowerCase = (value: string) => /[a-z]/.test(value);
const hasUpperCase = (value: string) => /[A-Z]/.test(value);
const hasNumber = (value: string) => /[0-9]/.test(value);
const hasSymbol = (value: string) => /[^a-zA-Z0-9]/.test(value);

export function validateBootstrapAdmin(): BootstrapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!bootstrapAdminConfig.enabled) {
    return { enabled: false, ok: false, errors, warnings };
  }

  if (import.meta.env.PROD) {
    errors.push('حساب bootstrap معطّل في build الإنتاج. استخدم إنشاء مدير عبر قاعدة البيانات أو بيئة خلفية آمنة.');
  }

  if (hasSupabaseCloudConfig) {
    errors.push('لا تستخدم Bootstrap Admin مع إعداد Supabase السحابي. عطّل الميزة أو أزل إعدادات Supabase المحلية قبل التفعيل.');
  }

  if (!bootstrapAdminConfig.username || !bootstrapAdminConfig.password) {
    errors.push('يجب ضبط VITE_BOOTSTRAP_ADMIN_USERNAME و VITE_BOOTSTRAP_ADMIN_PASSWORD بقيم قوية.');
  }

  if (DISALLOWED_USERNAMES.includes(bootstrapAdminConfig.username)) {
    errors.push('اسم المستخدم الافتراضي غير مسموح: تجنب admin/HimAdmin.');
  }

  if (DISALLOWED_PASSWORDS.includes(bootstrapAdminConfig.password)) {
    errors.push('كلمة المرور الافتراضية غير مسموح بها: تجنب admin123/HimAdmin5000.');
  }

  if (bootstrapAdminConfig.password && bootstrapAdminConfig.password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} خانة على الأقل.`);
  }

  if (bootstrapAdminConfig.password) {
    if (!hasLowerCase(bootstrapAdminConfig.password)) warnings.push('أضف حروفاً صغيرة لكلمة المرور.');
    if (!hasUpperCase(bootstrapAdminConfig.password)) warnings.push('أضف حروفاً كبيرة لكلمة المرور.');
    if (!hasNumber(bootstrapAdminConfig.password)) warnings.push('أضف أرقاماً لكلمة المرور.');
    if (!hasSymbol(bootstrapAdminConfig.password)) warnings.push('أضف رموزاً خاصة لكلمة المرور.');
  }

  return { enabled: true, ok: errors.length === 0, errors, warnings };
}

export function isBootstrapAdminReady(): boolean {
  return validateBootstrapAdmin().ok;
}

export function buildBootstrapAdminUser(id: string = 'admin-1'): User {
  return {
    id,
    username: bootstrapAdminConfig.username,
    password: bootstrapAdminConfig.password,
    name: bootstrapAdminConfig.name,
    role: Role.SITE_ADMIN
  };
}
