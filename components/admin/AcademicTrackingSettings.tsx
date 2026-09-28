import React, { useEffect, useId, useState } from 'react';
import { CalendarCheck, Loader2, Save } from 'lucide-react';
import {
    AcademicTrackingDates, formatDateKey, getEffectiveTrackingStart, isValidDateKey
} from '../../services/academicCalendarService';

interface Props {
    dates: AcademicTrackingDates;
    saving: boolean;
    onSave: (dates: AcademicTrackingDates) => Promise<boolean>;
}

export default function AcademicTrackingSettings({ dates, saving, onSave }: Props) {
    const id = useId();
    const [yearStart, setYearStart] = useState(dates.academic_year_start_date || '');
    const [trackingStart, setTrackingStart] = useState(dates.tracking_start_date || '');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const busy = saving || submitting;

    useEffect(() => {
        setYearStart(dates.academic_year_start_date || '');
        setTrackingStart(dates.tracking_start_date || '');
        setError('');
    }, [dates.academic_year_start_date, dates.tracking_start_date]);

    const changed = yearStart !== (dates.academic_year_start_date || '') || trackingStart !== (dates.tracking_start_date || '');
    const effectiveStart = getEffectiveTrackingStart({ academic_year_start_date: yearStart, tracking_start_date: trackingStart });
    const complete = isValidDateKey(yearStart) && isValidDateKey(trackingStart);
    const futureStart = effectiveStart && effectiveStart > formatDateKey(new Date());

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        if (!complete) {
            setError('حدد تاريخًا صالحًا لبداية السنة الدراسية وبداية تشغيل حاضر.');
            return;
        }
        setError('');
        setSubmitting(true);
        try {
            const saved = await onSave({ academic_year_start_date: yearStart, tracking_start_date: trackingStart });
            if (!saved) setError('تعذر حفظ التواريخ. احتفظنا بالتعديلات لتتمكن من المحاولة مجددًا.');
        } catch {
            setError('تعذر حفظ التواريخ. حاول مرة أخرى.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={save} noValidate aria-labelledby={`${id}-title`} className="rounded-2xl border border-primary-400/20 bg-slate-950/50 p-5 sm:p-6">
            <div className="flex items-start gap-3">
                <CalendarCheck className="mt-1 h-5 w-5 shrink-0 text-primary-300" aria-hidden="true" />
                <div>
                    <h3 id={`${id}-title`} className="text-lg font-bold text-white">بداية السنة وفترة احتساب البيانات</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">حدّد متى بدأت الدراسة ومتى بدأ تسجيل الحضور الفعلي في حاضر، لضبط النسب والمقارنات والتقارير.</p>
                </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                    <label htmlFor={`${id}-year`} className="mb-2 block text-sm font-semibold text-slate-200">بداية السنة الدراسية</label>
                    <input id={`${id}-year`} type="date" required value={yearStart} disabled={busy}
                        onChange={event => { setYearStart(event.target.value); setError(''); }}
                        aria-describedby={`${id}-year-help`} className="input-glass w-full min-w-0 rounded-xl p-3 text-sm" />
                    <p id={`${id}-year-help`} className="mt-2 text-xs leading-5 text-slate-500">أول يوم دراسة في العام الحالي. تُستبعد بيانات الأعوام السابقة من مؤشرات هذا العام.</p>
                </div>
                <div>
                    <label htmlFor={`${id}-tracking`} className="mb-2 block text-sm font-semibold text-slate-200">بداية تشغيل حاضر</label>
                    <input id={`${id}-tracking`} type="date" required value={trackingStart} disabled={busy}
                        onChange={event => { setTrackingStart(event.target.value); setError(''); }}
                        aria-describedby={`${id}-tracking-help`} className="input-glass w-full min-w-0 rounded-xl p-3 text-sm" />
                    <p id={`${id}-tracking-help`} className="mt-2 text-xs leading-5 text-slate-500">أول يوم تتوفر منه سجلات حضور فعلية موثوقة، بما فيها البيانات المستوردة إن وجدت.</p>
                </div>
            </div>
            <div role="status" className="mt-4 rounded-xl border border-primary-400/15 bg-primary-500/10 p-4 text-sm leading-7 text-primary-100">
                {complete ? <>
                    بداية الاحتساب {changed ? 'بعد الحفظ' : 'المعتمدة'}: <bdi className="font-mono font-bold">{effectiveStart}</bdi>، وهو التاريخ الأحدث بين التاريخين.
                    {futureStart && <p>لم تبدأ فترة الاحتساب بعد؛ لن تُعامل الأيام السابقة كتقصير في الحضور.</p>}
                </> : 'لم تكتمل تواريخ الاحتساب. حدّد التاريخين لاعتماد فترة واضحة للمؤشرات.'}
                <p className="mt-1 text-xs text-slate-400">تُحتسب أيام الدوام حتى اليوم مع استبعاد العطل. تبقى السجلات الأصلية محفوظة عند تغيير هذه التواريخ.</p>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="submit" disabled={busy || !changed} className="inline-flex items-center gap-2 rounded-xl bg-primary-300 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-primary-200 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {busy ? 'جاري الحفظ…' : 'حفظ تواريخ الاحتساب'}
                </button>
                {changed && <button type="button" disabled={busy} onClick={() => {
                    setYearStart(dates.academic_year_start_date || '');
                    setTrackingStart(dates.tracking_start_date || '');
                    setError('');
                }} className="rounded-xl px-3 py-2 text-sm text-slate-400 hover:bg-white/5 disabled:opacity-50">تراجع عن التعديل</button>}
                {changed && <span className="text-xs text-amber-200">تغييرات غير محفوظة</span>}
            </div>
        </form>
    );
}
