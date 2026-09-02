import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, ExternalLink, FileText, RefreshCw, Search, XCircle } from 'lucide-react';
import { GuardianExcuseRecord, GuardianExcuseStatus, Student } from '../../types';
import {
    getGuardianExcuseStatusLabel,
    GUARDIAN_EXCUSE_STATUS_STYLES
} from '../../services/guardianExcuses';

interface AdminExcusesTabProps {
    excuses: GuardianExcuseRecord[];
    students: Student[];
    loading: boolean;
    onRefresh: () => void;
    onReview: (excuse: GuardianExcuseRecord, status: Exclude<GuardianExcuseStatus, 'pending'>, notes: string) => Promise<void>;
}

const statusOrder: Record<GuardianExcuseStatus, number> = {
    pending: 0,
    approved: 1,
    rejected: 2
};

const AdminExcusesTab: React.FC<AdminExcusesTabProps> = ({
    excuses,
    students,
    loading,
    onRefresh,
    onReview
}) => {
    const [statusFilter, setStatusFilter] = useState<GuardianExcuseStatus | 'all'>('pending');
    const [query, setQuery] = useState('');
    const [notesById, setNotesById] = useState<Record<string, string>>({});
    const [reviewingId, setReviewingId] = useState<string | null>(null);

    const studentById = useMemo(() => {
        const map = new Map<string, Student>();
        students.forEach(student => map.set(student.id, student));
        return map;
    }, [students]);

    const stats = useMemo(() => ({
        total: excuses.length,
        pending: excuses.filter(excuse => excuse.status === 'pending').length,
        approved: excuses.filter(excuse => excuse.status === 'approved').length,
        rejected: excuses.filter(excuse => excuse.status === 'rejected').length
    }), [excuses]);

    const filteredExcuses = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return [...excuses]
            .filter(excuse => statusFilter === 'all' || excuse.status === statusFilter)
            .filter(excuse => {
                if (!normalizedQuery) return true;
                const student = studentById.get(excuse.student_id);
                const haystack = [
                    excuse.student_id,
                    excuse.student_name,
                    student?.name,
                    excuse.class_name,
                    excuse.section,
                    excuse.guardian_name,
                    excuse.guardian_phone,
                    excuse.reason
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(normalizedQuery);
            })
            .sort((a, b) => {
                const byStatus = statusOrder[a.status] - statusOrder[b.status];
                if (byStatus !== 0) return byStatus;
                return String(b.created_at || '').localeCompare(String(a.created_at || ''));
            });
    }, [excuses, query, statusFilter, studentById]);

    const handleReview = async (
        excuse: GuardianExcuseRecord,
        status: Exclude<GuardianExcuseStatus, 'pending'>
    ) => {
        setReviewingId(excuse.id);
        try {
            await onReview(excuse, status, notesById[excuse.id]?.trim() || '');
            setNotesById(prev => ({ ...prev, [excuse.id]: '' }));
        } finally {
            setReviewingId(null);
        }
    };

    const filterOptions = [
        { key: 'pending' as const, label: 'قيد المراجعة', count: stats.pending },
        { key: 'approved' as const, label: 'المعتمدة', count: stats.approved },
        { key: 'rejected' as const, label: 'المرفوضة', count: stats.rejected },
        { key: 'all' as const, label: 'الكل', count: stats.total }
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-100">
                            <FileText className="h-4 w-4" />
                            أعذار أولياء الأمور
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">مراجعة أعذار الغياب</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            استقبال الأعذار المرفوعة من ولي الأمر، فتح المرفقات، ثم اعتماد العذر أو رفضه مع ملاحظة واضحة.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={loading}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-white/[0.09] disabled:opacity-60"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        تحديث
                    </button>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {filterOptions.map(option => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => setStatusFilter(option.key)}
                            className={`rounded-2xl border p-4 text-right transition active:scale-[0.98] ${
                                statusFilter === option.key
                                    ? 'border-primary-300/35 bg-primary-400/10 text-primary-50'
                                    : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.07]'
                            }`}
                        >
                            <div className="text-[11px] font-bold text-slate-500">{option.label}</div>
                            <div className="mt-2 font-mono text-2xl font-black">{option.count}</div>
                        </button>
                    ))}
                </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.5)] backdrop-blur-xl">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="relative min-w-0 md:w-96">
                        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-300/70" />
                        <input
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="بحث باسم الطالب، الرقم، ولي الأمر..."
                            className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 pr-10 pl-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-primary-300/45 focus:ring-2 focus:ring-primary-400/15"
                        />
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-300">
                        {filteredExcuses.length} طلب
                    </div>
                </div>

                {filteredExcuses.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-10 text-center">
                        <FileText className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                        <p className="font-bold text-slate-300">لا توجد أعذار مطابقة</p>
                        <p className="mt-1 text-sm text-slate-500">ستظهر الأعذار هنا فور رفعها من واجهة ولي الأمر.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredExcuses.map(excuse => {
                            const student = studentById.get(excuse.student_id);
                            const studentName = excuse.student_name || student?.name || excuse.student_id;
                            const classLabel = `${excuse.class_name || student?.class_name || '-'} / ${excuse.section || student?.section || '-'}`;
                            const isPending = excuse.status === 'pending';
                            const isReviewing = reviewingId === excuse.id;

                            return (
                                <article key={excuse.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold ${GUARDIAN_EXCUSE_STATUS_STYLES[excuse.status]}`}>
                                                    {excuse.status === 'pending' && <Clock className="h-3.5 w-3.5" />}
                                                    {excuse.status === 'approved' && <CheckCircle2 className="h-3.5 w-3.5" />}
                                                    {excuse.status === 'rejected' && <XCircle className="h-3.5 w-3.5" />}
                                                    {getGuardianExcuseStatusLabel(excuse.status)}
                                                </span>
                                                <span className="font-mono text-xs text-slate-500">{excuse.absence_date}</span>
                                                <span className="font-mono text-xs text-slate-600">#{excuse.student_id}</span>
                                            </div>

                                            <h3 className="mt-3 truncate text-lg font-black text-white">{studentName}</h3>
                                            <div className="mt-1 text-xs text-slate-500">{classLabel}</div>
                                            <p className="mt-3 text-sm leading-7 text-slate-300">{excuse.reason}</p>

                                            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 md:grid-cols-3">
                                                <div className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2">
                                                    ولي الأمر: <span className="text-slate-300">{excuse.guardian_name || '-'}</span>
                                                </div>
                                                <div className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2">
                                                    الجوال: <span className="font-mono text-slate-300" dir="ltr">{excuse.guardian_phone || '-'}</span>
                                                </div>
                                                <div className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2">
                                                    أرسل: <span className="text-slate-300">{new Date(excuse.created_at).toLocaleString('ar-SA')}</span>
                                                </div>
                                            </div>

                                            {(excuse.admin_notes || excuse.reviewed_by_label) && (
                                                <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/45 p-3 text-xs leading-6 text-slate-400">
                                                    {excuse.admin_notes && <div>ملاحظة الإدارة: {excuse.admin_notes}</div>}
                                                    {excuse.reviewed_by_label && <div>المراجع: {excuse.reviewed_by_label}</div>}
                                                </div>
                                            )}
                                        </div>

                                        <div className="w-full shrink-0 space-y-3 xl:w-80">
                                            <a
                                                href={excuse.attachment_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary-300/20 bg-primary-400/10 px-3 py-2 text-xs font-bold text-primary-100 transition hover:bg-primary-400/15"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                                فتح المرفق
                                            </a>

                                            {isPending && (
                                                <>
                                                    <label className="block text-xs text-slate-400">
                                                        <span className="mb-2 block font-bold text-slate-300">ملاحظة المراجعة</span>
                                                        <textarea
                                                            value={notesById[excuse.id] || ''}
                                                            onChange={event => setNotesById(prev => ({ ...prev, [excuse.id]: event.target.value }))}
                                                            rows={3}
                                                            placeholder="اختياري: سبب الاعتماد أو الرفض..."
                                                            className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-primary-300/40"
                                                        />
                                                    </label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={isReviewing}
                                                            onClick={() => handleReview(excuse, 'approved')}
                                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100 transition active:scale-[0.98] hover:bg-emerald-400/15 disabled:opacity-60"
                                                        >
                                                            <CheckCircle2 className="h-4 w-4" />
                                                            اعتماد
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={isReviewing}
                                                            onClick={() => handleReview(excuse, 'rejected')}
                                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-100 transition active:scale-[0.98] hover:bg-red-400/15 disabled:opacity-60"
                                                        >
                                                            <XCircle className="h-4 w-4" />
                                                            رفض
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

export default AdminExcusesTab;
