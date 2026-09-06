import React, { useEffect, useMemo, useState } from 'react';
import { createStaffIntegrationsController, type StaffIntegrationsController } from '../../services/staffIntegrations';
import { staffReportTemplates, type StaffReportPlatform } from '../../modules/integrations/staffReportParser';
import type { IntegrationReview } from '../../modules/integrations';

type Props = { controller?: StaffIntegrationsController; showToast(message: string, type: 'success' | 'error'): void };
const names = { huduri: 'حضوري', madrasati: 'مدرستي' };
const statuses = { present: 'حاضر', late: 'متأخر', absent: 'غائب', prepared: 'محضر', 'not-prepared': 'غير محضر' };
const actions = { create: 'إضافة', update: 'تحديث', unchanged: 'مطابق', delete: 'حذف' };
const button = 'rounded-xl border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-40 disabled:cursor-not-allowed';
const errorText = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('expired')) return 'انتهت صلاحية المعاينة؛ أعد فحص التقرير';
  if (message.includes('consumed')) return 'استُخدمت هذه المعاينة؛ أعد فحص التقرير';
  return /[\u0600-\u06ff]/.test(message) ? message : 'تعذرت المزامنة؛ أعد فحص التقرير وتحقق من صلاحية جلستك';
};
const details = (value: Readonly<Record<string, unknown>> | null | undefined) => {
  if (!value) return 'لا يوجد سجل';
  return [statuses[String(value.status)], value.minutesLate !== undefined ? `تأخر ${value.minutesLate} دقيقة` : '', value.period ? `الحصة ${value.period} · ${value.subject} · ${value.className} / ${value.section}` : ''].filter(Boolean).join(' · ');
};

export default function StaffIntegrationsPanel({ controller, showToast }: Props) {
  const integrations = useMemo(() => controller ?? createStaffIntegrationsController(), [controller]);
  const [platform, setPlatform] = useState<StaffReportPlatform>('huduri');
  const [review, setReview] = useState<IntegrationReview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<StaffIntegrationsController['history']>> | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [pastedReport, setPastedReport] = useState('');

  const refreshHistory = async () => {
    try { setHistory(await integrations.history()); setHistoryError(''); }
    catch (error) { setHistory(null); setHistoryError(errorText(error)); }
  };
  useEffect(() => {
    let active = true;
    integrations.history().then(value => { if (active) setHistory(value); }).catch(error => { if (active) setHistoryError(errorText(error)); });
    return () => { active = false; };
  }, [integrations]);
  const inspect = async (file: File) => {
    setBusy(true); setReview(null); setSelected(new Set());
    try { setReview(await integrations.inspectFile(platform, file)); }
    catch (error) { showToast(errorText(error), 'error'); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    if (!review || !selected.size) return;
    setBusy(true);
    try {
      const receipt = await integrations.commit({ reviewId: review.id, approvedChangeIds: [...selected], approval: {} });
      showToast(`تمت مزامنة ${receipt.appliedChangeIds.length} سجل من ${names[platform]} إلى حاضر`, 'success');
    } catch (error) { showToast(errorText(error), 'error'); }
    finally { setReview(null); setSelected(new Set()); await refreshHistory(); setBusy(false); }
  };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', staffReportTemplates[platform]], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${platform}-report-template.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const lastImport = history?.imports.filter(event => event.details.platform === platform).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const saved = platform === 'huduri' ? history?.snapshot.attendance.filter(row => row.source === 'huduri') ?? [] : history?.snapshot.preparations ?? [];
  const savedNames = new Map(history?.snapshot.teachers.map(teacher => [teacher.id, teacher.name]));

  return <section id="staff-integrations" aria-label="مزامنة حضوري ومدرستي" className="space-y-5 rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-5 md:p-7">
    <h3 className="text-xl font-black text-white">مزامنة حضوري ومدرستي</h3>
    <p className="text-sm leading-7 text-slate-300">استورد تقرير حضور المعلمين أو تحضير الدروس، أو الصق جدول التقرير المنسوخ من المتصفح مع عناوينه، ثم راجع التغييرات قبل حفظها في حاضر.</p>
    <div className="flex flex-wrap gap-3" role="group" aria-label="اختيار منصة التقرير">
      {(['huduri', 'madrasati'] as const).map(value => <button key={value} type="button" className={`${button} ${platform === value ? 'bg-primary-500/25 border-primary-400' : ''}`} aria-pressed={platform === value} disabled={busy} onClick={() => { setPlatform(value); setReview(null); setSelected(new Set()); setPastedReport(''); }}>{names[value]}</button>)}
    </div>
    <p className="rounded-xl bg-amber-400/10 p-3 text-xs leading-6 text-amber-100">مزامنة يدوية إلى هذا الجهاز؛ الاتصال المباشر والمزامنة السحابية غير مفعّلين. طابق معرفات المعلمين مع سجل حاضر، واستخدم تاريخاً ميلادياً بصيغة YYYY-MM-DD. تقارير البصمات الخام والحالات غير المعروفة تحتاج معالجة قبل استيرادها.</p>
    <div className="flex flex-wrap items-center gap-3">
      <label className={`${button} flex flex-col gap-2`}>
        تقرير {names[platform]} (Excel أو CSV، حتى 5MB)
        <input aria-label={`رفع تقرير ${names[platform]}`} type="file" accept=".csv,.xls,.xlsx" disabled={busy} className="max-w-full text-xs" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspect(file); }} />
      </label>
      <button type="button" className={button} onClick={downloadTemplate} disabled={busy}>تنزيل قالب {names[platform]}</button>
      <span className="text-xs text-slate-400">{lastImport ? `آخر اعتماد: ${new Date(lastImport.occurredAt).toLocaleString('ar-SA')}` : 'لم يُعتمد تقرير لهذه المنصة بعد'}</span>
    </div>
    <details className="text-sm text-slate-300"><summary className="cursor-pointer">لصق جدول من المتصفح</summary>
      <label className="mt-3 block">جدول التقرير مع عناوين الأعمدة<textarea aria-label="جدول التقرير المنسوخ" className="mt-2 block min-h-28 w-full rounded-xl border border-white/15 bg-slate-900 p-3 text-white" value={pastedReport} disabled={busy} onChange={event => setPastedReport(event.target.value)} /></label>
      <button className={`${button} mt-2`} type="button" disabled={busy || !pastedReport.trim()} onClick={() => void inspect(new File([pastedReport], `${platform}.csv`, { type: 'text/csv' }))}>فحص الجدول الملصق</button>
    </details>
    {busy && <p role="status" className="text-sm text-primary-200">جارٍ تنفيذ العملية…</p>}
    {review && <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-bold text-white">مراجعة تقرير {names[platform]} · {review.changes.length} سجل</h4><button type="button" className={`${button} bg-emerald-500/25`} disabled={busy || !selected.size} onClick={() => void commit()}>اعتماد {selected.size} سجلات في حاضر</button></div>
      <p className="text-xs text-slate-400">تحقق من المدرسة والفترة. لا يُحدد أي سجل تلقائياً؛ صلاحية المعاينة 15 دقيقة.</p>
      <div className="max-h-[32rem] overflow-auto space-y-2">
        {review.changes.map(change => <label key={change.id} className="flex gap-3 rounded-xl border border-white/10 p-3">
          <input type="checkbox" aria-label={`اختيار ${change.entityLabel} ${change.after?.date} ${change.after?.period ?? ''}`.trim()} disabled={busy || change.action === 'unchanged' || change.blocked} checked={selected.has(change.id)} onChange={() => setSelected(previous => { const next = new Set(previous); if (next.has(change.id)) next.delete(change.id); else next.add(change.id); return next; })} />
          <div className="space-y-1 text-sm text-white"><strong>{change.entityLabel}</strong><span className="mr-3 text-xs text-primary-200">{actions[change.action]} · {String(change.after?.date)}</span><p>{details(change.after)}</p>{change.action === 'update' && <p className="text-xs text-amber-200">قبل التحديث: {details(change.before)}</p>}{change.warnings?.map(warning => <p key={warning} className="text-xs text-amber-200">{warning}</p>)}</div>
        </label>)}
      </div>
    </div>}
    <div className="border-t border-white/10 pt-4"><h4 className="font-bold text-white">السجلات المحفوظة من {names[platform]} ({saved.length})</h4>
      {historyError && <p role="alert" className="mt-2 text-sm text-amber-200">{historyError}</p>}
      {!saved.length && !historyError && <p className="mt-2 text-sm text-slate-400">لا توجد سجلات محفوظة بعد.</p>}
      <div className="mt-3 max-h-72 overflow-auto space-y-2">{[...saved].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).slice(0, 100).map(record => <div key={record.id} className="rounded-xl bg-white/5 p-3 text-sm text-slate-200">{savedNames.get(record.teacherId) ?? record.teacherId} · {record.date} · {details(record)}</div>)}</div>
      {saved.length > 100 && <p className="text-xs text-slate-400">تُعرض أحدث 100 من {saved.length} سجلات.</p>}
    </div>
  </section>;
}
