import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GraduationCap,
  LockKeyhole,
  RefreshCw,
  School,
  ShieldCheck
} from 'lucide-react';
import type { IntegrationAuditEvent, IntegrationChange, IntegrationReview } from '../../modules/integrations';
import {
  createIntegrationCenterController,
  type IntegrationCenterController
} from '../../services/integrationCenter';

type Props = Readonly<{
  controller?: IntegrationCenterController;
  showToast: (message: string, type: 'success' | 'error') => void;
}>;

const actionLabels: Record<IntegrationChange['action'], string> = {
  create: 'طالب جديد',
  update: 'تحديث بيانات',
  unchanged: 'مطابق',
  delete: 'غير ظاهر في الكشف'
};

const actionClasses: Record<IntegrationChange['action'], string> = {
  create: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  update: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  unchanged: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
  delete: 'border-rose-400/25 bg-rose-400/10 text-rose-200'
};

const auditLabels: Record<IntegrationAuditEvent['action'], string> = {
  inspected: 'اكتمل فحص الكشف',
  'inspect-failed': 'تعذر فحص الكشف',
  'apply-started': 'بدأت الكتابة الخارجية',
  'apply-succeeded': 'اكتملت الكتابة الخارجية',
  'apply-failed': 'فشلت الكتابة الخارجية',
  'apply-outcome-unknown': 'نتيجة الكتابة الخارجية غير مؤكدة',
  'import-started': 'بدأ الاستيراد إلى حاضر',
  'import-succeeded': 'اكتمل الاستيراد إلى حاضر',
  'import-failed': 'فشل الاستيراد إلى حاضر',
  'import-outcome-unknown': 'نتيجة الاستيراد غير مؤكدة'
};

const readableError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('authentication is required')) {
    return 'أكمل تسجيل الدخول يدوياً في نافذة نور، ثم افتح كشف الطلاب وأعد الفحص.';
  }
  if (message.includes('layout is not recognized')) {
    return 'الصفحة الحالية ليست كشف طلاب معروفاً. انتقل إلى كشف الطلاب داخل نور ثم أعد المحاولة.';
  }
  if (message.includes('desktop session is unavailable')) {
    return 'هذه الميزة متاحة في تطبيق حاضر لسطح المكتب فقط.';
  }
  if (message.includes('outcome is unknown')) {
    return 'نتيجة الاستيراد غير مؤكدة. لا تُعد المحاولة؛ راجع سجل التدقيق وحدّث بيانات حاضر أولاً.';
  }
  if (message.includes('افتح جلسة نور') || message.includes('انتظر حتى') || message.includes('تغيرت صفحة نور')) {
    return message;
  }
  return 'تعذر إكمال العملية بأمان. راجع سجل التدقيق وأعد فحص بيانات حاضر قبل المحاولة.';
};

const getStudentDetails = (record: Readonly<Record<string, unknown>> | null | undefined) => {
  const source = record ?? {};
  return {
    id: String(source.external_id ?? source.id ?? ''),
    name: String(source.name ?? ''),
    className: String(source.class_name ?? ''),
    section: String(source.section ?? '')
  };
};

const AdminIntegrationsTab: React.FC<Props> = ({ controller, showToast }) => {
  const integrations = useMemo(
    () => controller ?? createIntegrationCenterController(),
    [controller]
  );
  const desktopAvailable = integrations.isNoorDesktopAvailable();
  const [review, setReview] = useState<IntegrationReview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'open' | 'inspect' | 'commit' | null>(null);
  const [auditEvents, setAuditEvents] = useState<readonly IntegrationAuditEvent[]>(
    () => integrations.auditEvents().slice(-8).reverse()
  );

  const refreshAudit = () => setAuditEvents(integrations.auditEvents().slice(-8).reverse());

  const handleOpenNoor = async () => {
    setBusy('open');
    setReview(null);
    setSelectedIds(new Set());
    try {
      const result = await integrations.openNoorSession();
      if (!result.opened) throw new Error('Noor desktop session is unavailable');
      showToast('فُتحت جلسة نور الآمنة؛ سجّل الدخول يدوياً وانتقل إلى كشف الطلاب', 'success');
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleInspect = async () => {
    setBusy('inspect');
    setReview(null);
    setSelectedIds(new Set());
    try {
      const nextReview = await integrations.inspectNoorRoster();
      setReview(nextReview);
      showToast(`اكتمل الفحص: ${nextReview.changes.length} سجل للمراجعة`, 'success');
    } catch (error) {
      setReview(null);
      setSelectedIds(new Set());
      showToast(readableError(error), 'error');
    } finally {
      refreshAudit();
      setBusy(null);
    }
  };

  const toggleChange = (change: IntegrationChange) => {
    if (change.blocked || change.action === 'unchanged' || change.action === 'delete') return;
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(change.id)) next.delete(change.id);
      else next.add(change.id);
      return next;
    });
  };

  const handleCommit = async () => {
    if (!review || selectedIds.size === 0) return;
    setBusy('commit');
    try {
      const receipt = await integrations.commitNoorRoster({
        reviewId: review.id,
        approvedChangeIds: [...selectedIds],
        approval: {}
      });
      showToast(`تم استيراد ${receipt.appliedChangeIds.length} طالب/تحديث بنجاح`, 'success');
      setReview(null);
      setSelectedIds(new Set());
    } catch (error) {
      setReview(null);
      setSelectedIds(new Set());
      showToast(readableError(error), 'error');
    } finally {
      refreshAudit();
      setBusy(null);
    }
  };

  const selectableCount = review?.changes.filter(
    change => !change.blocked && ['create', 'update'].includes(change.action)
  ).length ?? 0;

  return (
    <section className="space-y-6" dir="rtl">
      <div className="overflow-hidden rounded-[1.75rem] border border-primary-400/20 bg-slate-950/70 shadow-[0_26px_80px_-52px_rgba(34,211,238,0.55)]">
        <div className="border-b border-white/10 bg-gradient-to-l from-primary-500/15 via-slate-950/40 to-secondary-500/10 p-6 md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
                <ShieldCheck className="h-4 w-4" /> تشغيل مراقَب وآمن
              </div>
              <h2 className="text-2xl font-black text-white md:text-3xl">مركز التكاملات</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                قراءة ومراجعة بيانات المنصات التعليمية من نافذة مرئية، مع دخول يدوي واعتماد صريح قبل حفظ أي تغيير داخل حاضر.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center text-xs">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-slate-300">
                <LockKeyhole className="mx-auto mb-2 h-5 w-5 text-primary-200" /> لا تُحفظ كلمات المرور
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-slate-300">
                <ShieldCheck className="mx-auto mb-2 h-5 w-5 text-emerald-200" /> لا حذف تلقائي
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 md:p-7">
          <div className="grid gap-4 lg:grid-cols-3">
            <article className="rounded-3xl border border-primary-400/25 bg-primary-400/[0.07] p-5 lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-primary-400/15 p-3 text-primary-100"><School className="h-6 w-6" /></div>
                  <div>
                    <h3 className="text-lg font-black text-white">نظام نور</h3>
                    <p className="text-xs text-slate-400">كشف الطلاب · قراءة واستيراد محلي فقط</p>
                  </div>
                </div>
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-200">نسخة تجريبية مراقبة</span>
              </div>

              {!desktopAvailable && (
                <div className="mt-5 flex gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.08] p-4 text-sm text-amber-100">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>التشغيل الحي يتطلب تطبيق حاضر لسطح المكتب؛ نسخة الويب لا تستطيع الوصول إلى جلسة نور.</span>
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleOpenNoor}
                  disabled={!desktopAvailable || busy !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === 'open' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  فتح جلسة نور الآمنة
                </button>
                <button
                  type="button"
                  onClick={handleInspect}
                  disabled={!desktopAvailable || busy !== null}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === 'inspect' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  فحص كشف الطلاب الحالي
                </button>
              </div>
            </article>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 opacity-75">
                <div className="flex items-center gap-3"><GraduationCap className="h-5 w-5 text-secondary-200" /><strong className="text-white">منصة مدرستي</strong></div>
                <p className="mt-2 text-xs leading-6 text-slate-400">مراجعة تحضير الدروس للمعلمين</p>
                <span className="mt-3 inline-block text-xs font-bold text-slate-500">قيد البناء</span>
              </article>
              <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 opacity-75">
                <div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-amber-200" /><strong className="text-white">حضوري</strong></div>
                <p className="mt-2 text-xs leading-6 text-slate-400">حضور المعلمين وجدول الانتظار</p>
                <span className="mt-3 inline-block text-xs font-bold text-slate-500">قيد البناء</span>
              </article>
            </div>
          </div>
        </div>
      </div>

      {review && (
        <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-5 md:p-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-black text-white">مراجعة كشف نور</h3>
              <p className="mt-1 text-sm text-slate-400">حدد يدوياً ما تريد استيراده. المتاح للاعتماد: {selectableCount}</p>
            </div>
            <button
              type="button"
              onClick={handleCommit}
              disabled={selectedIds.size === 0 || busy !== null}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'commit' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              اعتماد {selectedIds.size} تغييرات
            </button>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-xs leading-6 text-amber-100">
              تأكد أن الصفحة التي فتحتها يدوياً هي كشف الطلاب الصحيح للمدرسة والفترة الحالية قبل تحديد أي تغيير.
            </div>
            {review.changes.map(change => {
              const before = getStudentDetails(change.before);
              const after = getStudentDetails(change.after);
              const details = change.after ? after : before;
              const disabled = Boolean(change.blocked) || change.action === 'unchanged' || change.action === 'delete';
              const changedFields = change.action === 'update'
                ? [
                  ['الاسم', before.name, after.name],
                  ['الصف', before.className, after.className],
                  ['الفصل', before.section, after.section]
                ].filter(([, previous, next]) => previous !== next)
                : [];
              return (
                <label key={change.id} className={`flex gap-4 rounded-2xl border p-4 ${disabled ? 'border-white/5 bg-white/[0.025]' : 'border-white/10 bg-white/[0.045] hover:border-primary-400/25'}`}>
                  <input
                    type="checkbox"
                    aria-label={`اختيار ${change.entityLabel}`}
                    checked={selectedIds.has(change.id)}
                    disabled={disabled}
                    onChange={() => toggleChange(change)}
                    className="mt-1 h-5 w-5 accent-emerald-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-white">{change.entityLabel}</strong>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${actionClasses[change.action]}`}>{actionLabels[change.action]}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span>المعرف: {details.id || '—'}</span>
                      {change.action !== 'update' && <span>الصف: {details.className || '—'}</span>}
                      {change.action !== 'update' && <span>الفصل: {details.section || '—'}</span>}
                    </div>
                    {changedFields.length > 0 && (
                      <div className="mt-2 space-y-1 text-xs text-amber-100">
                        {changedFields.map(([label, previous, next]) => (
                          <p key={label}>{label}: {previous || '—'} ← {next || '—'}</p>
                        ))}
                      </div>
                    )}
                    {(change.warnings ?? []).map(warning => <p key={warning} className="mt-2 text-xs text-rose-200">{warning}</p>)}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-5 md:p-7">
        <h3 className="text-lg font-black text-white">آخر أحداث التدقيق</h3>
        {auditEvents.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">لا توجد عمليات تكامل مسجلة بعد.</p>
        ) : (
          <div className="mt-4 divide-y divide-white/5">
            {auditEvents.map(event => (
              <div key={event.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="text-slate-200">{auditLabels[event.action]}</span>
                <time className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString('ar-SA')}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default AdminIntegrationsTab;
