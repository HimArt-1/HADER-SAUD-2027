import { GuardianExcuseRecord, GuardianExcuseStatus } from '../types';

export const GUARDIAN_EXCUSE_BUCKET = 'guardian-excuses';
export const GUARDIAN_EXCUSE_MAX_FILE_SIZE = 5 * 1024 * 1024;

export const GUARDIAN_EXCUSE_ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

export const GUARDIAN_EXCUSE_STATUS_LABELS: Record<GuardianExcuseStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض'
};

export const GUARDIAN_EXCUSE_STATUS_STYLES: Record<GuardianExcuseStatus, string> = {
  pending: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
  approved: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  rejected: 'border-red-400/25 bg-red-400/10 text-red-100'
};

export const validateGuardianExcuseFile = (file: File): string | null => {
  if (file.size > GUARDIAN_EXCUSE_MAX_FILE_SIZE) {
    return 'حجم الملف يجب ألا يتجاوز 5MB.';
  }
  if (!GUARDIAN_EXCUSE_ALLOWED_TYPES.has(file.type)) {
    return 'الصيغ المسموحة: صورة JPG/PNG/WebP أو ملف PDF.';
  }
  return null;
};

export const buildGuardianExcuseStoragePath = (studentId: string, file: File) => {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : '';
  const safeExtension = extension ? `.${extension.replace(/[^\w]+/g, '').toLowerCase()}` : '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = crypto.randomUUID();
  return `${studentId}/${stamp}_${random}${safeExtension}`;
};

export const getGuardianExcuseStatusLabel = (status: GuardianExcuseRecord['status']) =>
  GUARDIAN_EXCUSE_STATUS_LABELS[status] || GUARDIAN_EXCUSE_STATUS_LABELS.pending;

