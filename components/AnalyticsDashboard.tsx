import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db, getLocalISODate, getLocalDateStr } from '../services/db';
import { appSettings } from '../services/settings';
import { buildAttendanceAnalytics } from '../modules/attendance/analytics';
import { resolveReportingPeriod } from '../services/academicCalendarService';

type Analytics = ReturnType<typeof buildAttendanceAnalytics>;

/** All series are built from persisted attendance, bounded by the operating calendar. */
export default function AnalyticsDashboard() {
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError(''); setData(null);
    try {
      const today = getLocalISODate();
      const start = new Date(`${today}T12:00:00`);
      start.setDate(start.getDate() - (range === 'week' ? 6 : range === 'month' ? 29 : 364));
      const settings = await appSettings.load();
      const period = resolveReportingPeriod(getLocalDateStr(start), today, settings?.attendance_settings, today);
      const [students, attendance] = await Promise.all([db.getStudents(), period.isEmpty ? Promise.resolve([]) : db.getAttendanceRange(period.startDate, period.endDate)]);
      if (id !== request.current) return;
      setData(buildAttendanceAnalytics({ students, attendance, settings, startDate: getLocalDateStr(start), endDate: today, today }));
    } catch {
      if (id === request.current) setError('تعذر تحميل الإحصاءات. أعد المحاولة.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [range]);
  useEffect(() => {
    void load();
    const unsubscribe = appSettings.subscribe(() => { void load(); });
    return () => { request.current++; unsubscribe(); };
  }, [load]);
  return <section dir="rtl" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-bold">تحليلات الحضور المسجل</h2>
      <div className="flex gap-3">
        <select aria-label="فترة التحليل" value={range} onChange={event => setRange(event.target.value as typeof range)} className="rounded-xl bg-slate-800 p-3">
          <option value="week">آخر 7 أيام</option><option value="month">آخر 30 يومًا</option><option value="year">آخر 365 يومًا</option>
        </select>
        <button aria-label="تحديث الإحصاءات" disabled={loading} onClick={() => void load()} className="rounded-xl border border-slate-600 p-3"><RefreshCw className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">جارٍ تحميل السجلات…</p>}
    {data && <>
      <p className="text-sm text-slate-400">{data.period.isEmpty ? 'لا توجد أيام مؤهلة في الفترة المحددة.' : `${data.period.startDate} إلى ${data.period.endDate} · ${data.dates.length} يوم دوام`}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['حضور دون تأخر', data.present], ['تأخر', data.late], ['غياب مسجل', data.absent], ['غير مسجل', data.unrecorded]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-slate-900 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}
      </div>
      <p>الحضور المسجل: {data.attendanceRate == null ? 'لا توجد بيانات' : `${data.attendanceRate}%`} · اكتمال التسجيل: {data.completionRate == null ? '—' : `${data.completionRate}%`}</p>
      <p className="text-xs leading-6 text-slate-400">الحضور المسجل = الحضور والتأخر ÷ السجلات المتوقعة وفق الطلاب النشطين حاليًا وأيام الدوام ضمن فترة التشغيل. الحالات غير المسجلة ليست غيابًا. الفجوات في الرسم تعني عدم توفر تسجيل.</p>
      {data.hasData ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.days}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" /><XAxis dataKey="date" /><YAxis domain={[0, 100]} />
        <Tooltip /><Area type="linear" dataKey="rate" name="الحضور المسجل %" stroke="#34d399" fill="#34d39933" connectNulls={false} />
      </AreaChart></ResponsiveContainer></div> : <p>لا توجد سجلات حضور ضمن فترة الاحتساب.</p>}
    </>}
  </section>;
}
