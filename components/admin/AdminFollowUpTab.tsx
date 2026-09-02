// ═══════════════════════════════════════════════════════════════
// AdminFollowUpTab - Parent notifications follow-up
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { Student } from '../../types';
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock, MessageCircle, Send } from 'lucide-react';

interface FollowUpRow {
    student: Student;
    status: 'late' | 'absent';
    notified: boolean;
    whatsappNotified: boolean;
    lastNotifiedAt?: string;
}

export interface AdminFollowUpTabProps {
    followUpFilter: 'all' | 'notified' | 'pending';
    setFollowUpFilter: (val: 'all' | 'notified' | 'pending') => void;
    guardianIncomingNotifications: any[];
    guardianOutgoingNotifications: any[];
    lateStudents: Student[];
    absentStudents: Student[];
    followUpRows: FollowUpRow[];
}

const AdminFollowUpTab: React.FC<AdminFollowUpTabProps> = ({
    followUpFilter, setFollowUpFilter,
    guardianIncomingNotifications, guardianOutgoingNotifications,
    lateStudents, absentStudents, followUpRows
}) => {
    const notifiedCount = followUpRows.filter(row => row.notified).length;
    const pendingCount = followUpRows.filter(row => !row.notified).length;
    const whatsappCount = followUpRows.filter(row => row.whatsappNotified).length;
    const displayedRows = followUpRows.slice(0, 50);

    const summaryCards = [
        { label: 'الوارد من ولي الأمر', value: guardianIncomingNotifications.length, hint: 'رسائل تحتاج مراجعة', icon: Bell, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' },
        { label: 'الصادر لولي الأمر', value: guardianOutgoingNotifications.length, hint: 'إشعارات مرسلة', icon: Send, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' },
        { label: 'المتأخرون اليوم', value: lateStudents.length, hint: `${whatsappCount} عبر واتساب`, icon: Clock, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'الغائبون اليوم', value: absentStudents.length, hint: `${pendingCount} متابعة معلقة`, icon: AlertTriangle, className: 'border-red-500/20 bg-red-500/[0.07] text-red-100' }
    ];

    const filterOptions = [
        { key: 'all' as const, label: 'الكل', hint: followUpRows.length },
        { key: 'notified' as const, label: 'تم التبليغ', hint: notifiedCount },
        { key: 'pending' as const, label: 'لم يتم التبليغ', hint: pendingCount }
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <Activity className="h-4 w-4" />
                            متابعة التواصل
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">إشعارات أولياء الأمور</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            مراقبة الرسائل الواردة والصادرة، ومعرفة حالات الطلاب التي تحتاج متابعة مباشرة.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        {summaryCards.map(card => (
                            <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <card.icon className="h-4 w-4 opacity-80" />
                                    <span className="text-[11px] font-semibold text-slate-400">{card.label}</span>
                                </div>
                                <div className="mt-3 truncate font-mono text-2xl font-black">{card.value}</div>
                                <div className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                    {filterOptions.map(option => (
                        <button
                            key={option.key}
                            onClick={() => setFollowUpFilter(option.key)}
                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition active:scale-[0.98] ${
                                followUpFilter === option.key
                                    ? 'border-primary-300/50 bg-primary-400/10 text-primary-100'
                                    : 'border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.07] hover:text-white'
                            }`}
                        >
                            <span>{option.label}</span>
                            <span className="rounded-lg bg-white/10 px-2 py-0.5 font-mono text-[11px]">{option.hint}</span>
                        </button>
                    ))}
                </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/55 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.5)] backdrop-blur-xl">
                <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                        <div className="mb-2 inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-100">
                            <MessageCircle className="h-4 w-4" />
                            سجل المتابعة
                        </div>
                        <h3 className="text-xl font-black text-white">حالات الطلاب الحالية</h3>
                        <p className="mt-1 text-sm text-slate-400">يعرض أول 50 حالة حسب الفلتر النشط من لوحة الإدارة.</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-300">
                        {displayedRows.length} من {followUpRows.length}
                    </div>
                </div>

                {followUpRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-10 text-center">
                        <Activity className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                        <p className="font-bold text-slate-300">لا توجد إشعارات متابعة حالياً</p>
                        <p className="mt-1 text-sm text-slate-500">ستظهر الحالات عند تسجيل تأخر أو غياب مرتبط بإشعار.</p>
                    </div>
                ) : (
                    <>
                        <div className="max-h-[68dvh] space-y-3 overflow-y-auto pr-1 md:hidden">
                            {displayedRows.map((row, idx) => {
                                const statusLabel = row.status === 'late' ? 'متأخر' : 'غائب';
                                const statusClass = row.status === 'late'
                                    ? 'border-amber-400/25 bg-amber-400/10 text-amber-100'
                                    : 'border-red-400/25 bg-red-400/10 text-red-100';

                                return (
                                    <div key={`${row.student.id}-${row.status}-${idx}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-base font-black text-white" title={row.student.name}>
                                                    {row.student.name}
                                                </div>
                                                <div className="mt-1 text-xs text-slate-500">
                                                    {row.student.class_name} / فصل {row.student.section}
                                                </div>
                                            </div>
                                            <span className={`shrink-0 rounded-xl border px-3 py-1 text-xs font-bold ${statusClass}`}>
                                                {statusLabel}
                                            </span>
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                            <span className={`rounded-xl border px-3 py-2 font-bold ${
                                                row.notified
                                                    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
                                                    : 'border-slate-500/25 bg-slate-500/10 text-slate-300'
                                            }`}>
                                                {row.notified ? 'تم التبليغ' : 'لم يتم التبليغ'}
                                            </span>
                                            <span className={`rounded-xl border px-3 py-2 font-bold ${
                                                row.whatsappNotified
                                                    ? 'border-green-400/25 bg-green-400/10 text-green-100'
                                                    : 'border-slate-500/25 bg-slate-500/10 text-slate-300'
                                            }`}>
                                                واتساب: {row.whatsappNotified ? 'نعم' : 'لا'}
                                            </span>
                                        </div>

                                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                                            <CheckCircle2 className="h-4 w-4 text-slate-500" />
                                            <span>
                                                آخر إشعار: {row.lastNotifiedAt ? new Date(row.lastNotifiedAt).toLocaleString('ar-SA') : 'غير مسجل'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="hidden overflow-hidden rounded-2xl border border-white/10 md:block">
                            <div className="max-h-[70dvh] overflow-auto">
                                <table className="w-full min-w-[760px] text-right text-sm">
                                    <thead className="sticky top-0 z-10 bg-slate-950/95 text-gray-400">
                                        <tr className="border-b border-white/10">
                                            <th className="p-3">الطالب</th>
                                            <th className="p-3">الحالة</th>
                                            <th className="p-3">التبليغ</th>
                                            <th className="p-3">واتساب</th>
                                            <th className="p-3">آخر إشعار</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {displayedRows.map((row, idx) => {
                                            const statusLabel = row.status === 'late' ? 'متأخر' : 'غائب';
                                            const statusClass = row.status === 'late'
                                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                                : 'bg-red-500/20 text-red-300 border border-red-500/30';

                                            return (
                                                <tr key={`${row.student.id}-${row.status}-${idx}`} className="text-slate-300 transition-colors hover:bg-white/[0.04]">
                                                    <td className="p-3">
                                                        <div className="font-bold text-white">{row.student.name}</div>
                                                        <div className="mt-0.5 text-xs text-slate-500">{row.student.class_name} / {row.student.section}</div>
                                                    </td>
                                                    <td className="p-3">
                                                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>
                                                            {statusLabel}
                                                        </span>
                                                    </td>
                                                    <td className="p-3">
                                                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${
                                                            row.notified
                                                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                                                : 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                                                        }`}>
                                                            {row.notified ? 'تم التبليغ' : 'لم يتم التبليغ'}
                                                        </span>
                                                    </td>
                                                    <td className="p-3">
                                                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${
                                                            row.whatsappNotified
                                                                ? 'bg-green-500/20 text-green-300 border-green-500/30'
                                                                : 'bg-slate-500/20 text-slate-300 border-slate-500/30'
                                                        }`}>
                                                            {row.whatsappNotified ? 'نعم' : 'لا'}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 font-mono text-slate-500">
                                                        {row.lastNotifiedAt
                                                            ? new Date(row.lastNotifiedAt).toLocaleString('ar-SA')
                                                            : '-'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
};

export default AdminFollowUpTab;
