import React, { useState, useEffect } from 'react';
import { Database, Cloud, ArrowLeftRight, Download, Upload, RefreshCw, Check, X, AlertTriangle, HardDrive, ShieldCheck, History } from 'lucide-react';
import { db } from '../services/db';
import { studentAffairs } from '../services/studentAffairs';
import { localDb, getLastSyncTime } from '../services/localDb';
import { supabase } from '../services/supabase';

const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

type Notice = {
    type: 'success' | 'error' | 'warning';
    message: string;
} | null;

export const BackupCenter: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [localStats, setLocalStats] = useState({ students: 0, logs: 0, size: 0 });
    const [cloudStats, setCloudStats] = useState({ connected: false, lastSync: 'Detecting...', latency: 0 });
    const [syncStats, setSyncStats] = useState({ pending: 0, lastSyncTime: '' });

    const refreshStats = async () => {
        setLoading(true);
        try {
            const studentCount = await localDb.students.count();
            const logCount = await localDb.attendance_logs.count();
            const size = (studentCount * 200) + (logCount * 100);

            setLocalStats({ students: studentCount, logs: logCount, size });

            const pending = await db.getPendingCount();
            const lastSync = await getLastSyncTime();
            setSyncStats({ pending, lastSyncTime: lastSync || 'غير معروف' });

            const start = performance.now();
            const { error } = await supabase.from('students').select('count', { count: 'exact', head: true });
            const end = performance.now();

            if (!error) {
                setCloudStats({
                    connected: true,
                    lastSync: 'Online',
                    latency: Math.round(end - start)
                });
            } else {
                setCloudStats({ connected: false, lastSync: 'Offline', latency: 0 });
            }

        } catch (e) {
            console.error(e);
            setNotice({ type: 'error', message: 'تعذر تحديث إحصاءات النسخ والمزامنة.' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshStats();
        const interval = setInterval(refreshStats, 30000);
        return () => clearInterval(interval);
    }, []);

    const handleLocalExport = async () => {
        setLoading(true);
        setNotice(null);
        try {
            const students = await localDb.students.toArray();
            const logs = await localDb.attendance_logs.toArray();
            const classes = await localDb.classes.toArray();

            const backup = {
                version: 1,
                timestamp: new Date().toISOString(),
                type: 'local_full',
                data: { students, logs, classes }
            };

            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hader_backup_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setNotice({ type: 'success', message: 'تم تصدير النسخة الاحتياطية المحلية.' });
        } catch (e) {
            setNotice({ type: 'error', message: `فشل التصدير المحلي: ${e}` });
        } finally {
            setLoading(false);
        }
    };

    const handleLocalImport = async (files: FileList | null) => {
        if (!files || !files[0]) return;
        const file = files[0];

        if (!confirm('تحذير: استعادة النسخة ستدمج البيانات مع البيانات الحالية. هل أنت متأكد؟')) return;

        setLoading(true);
        setNotice(null);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target?.result as string);
                if (!json.data || !json.data.students) throw new Error('ملف غير صالح');

                await localDb.transaction('rw', localDb.students, localDb.attendance_logs, localDb.classes, async () => {
                    await localDb.students.bulkPut(json.data.students);
                    if (json.data.logs) await localDb.attendance_logs.bulkPut(json.data.logs);
                    if (json.data.classes) await localDb.classes.bulkPut(json.data.classes);
                });

                setNotice({ type: 'success', message: `تم استعادة ${json.data.students.length} طالب و ${json.data.logs?.length || 0} سجل.` });
                refreshStats();
            } catch (err) {
                setNotice({ type: 'error', message: `فشل الاستيراد: ${err}` });
            } finally {
                setLoading(false);
            }
        };
        reader.readAsText(file);
    };

    const handleForceSync = async () => {
        setLoading(true);
        setNotice(null);
        try {
            await db.forceSyncNow();
            await refreshStats();
            setNotice({ type: 'success', message: 'تم تنفيذ المزامنة اليدوية.' });
        } catch (e) {
            setNotice({ type: 'error', message: 'فشلت المزامنة اليدوية.' });
        } finally {
            setLoading(false);
        }
    };

    const handleCloudExport = async () => {
        setLoading(true);
        setNotice(null);
        try {
            const [students, attendance, violations, exits, classes, settings] = await Promise.all([
                db.getStudents(),
                supabase.from('attendance_logs').select('*').then(r => r.data || []),
                studentAffairs.load({ type: 'violations' }).then(result => result.violations),
                supabase.from('exit_permissions').select('*').then(r => r.data || []),
                db.getClasses(),
                db.getSettings()
            ]);

            const fullBackup = {
                version: 2,
                timestamp: new Date().toISOString(),
                type: 'cloud_full_export',
                data: {
                    students,
                    attendance_logs: attendance,
                    violations,
                    exit_permissions: exits,
                    classes,
                    settings
                },
                meta: {
                    student_count: students.length,
                    attendance_count: (attendance as any[]).length,
                    violations_count: violations.length,
                    exits_count: (exits as any[]).length,
                    classes_count: classes.length
                }
            };

            const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hader_cloud_export_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            localStorage.setItem('hader_last_backup_date', new Date().toISOString());
            setNotice({ type: 'success', message: 'تم تصدير بيانات السحابة بالكامل.' });
        } catch (e) {
            console.error('Cloud export failed:', e);
            setNotice({ type: 'error', message: `فشل التصدير السحابي: ${e}` });
        } finally {
            setLoading(false);
        }
    };

    const syncTimeLabel = syncStats.lastSyncTime && !Number.isNaN(Date.parse(syncStats.lastSyncTime))
        ? new Date(syncStats.lastSyncTime).toLocaleString('ar-SA')
        : syncStats.lastSyncTime || '-';
    const noticeClass = notice?.type === 'success'
        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
        : notice?.type === 'warning'
            ? 'border-amber-400/25 bg-amber-400/10 text-amber-100'
            : 'border-red-400/25 bg-red-400/10 text-red-100';
    const statusCards = [
        { label: 'الطلاب محلياً', value: localStats.students, hint: 'IndexedDB', icon: HardDrive, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'سجلات الحضور', value: localStats.logs, hint: 'قاعدة المتصفح', icon: Database, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' },
        { label: 'العمليات المعلقة', value: syncStats.pending, hint: 'طابور المزامنة', icon: ArrowLeftRight, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' },
        { label: 'زمن الاتصال', value: cloudStats.connected ? `${cloudStats.latency}ms` : 'Offline', hint: cloudStats.lastSync, icon: Cloud, className: cloudStats.connected ? 'border-secondary-500/20 bg-secondary-500/[0.07] text-secondary-100' : 'border-red-500/20 bg-red-500/[0.07] text-red-100' }
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <ShieldCheck className="h-4 w-4" />
                            مركز حماية البيانات
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">النسخ الاحتياطي والمزامنة</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            مراقبة القاعدة المحلية والسحابة، وتصدير نسخ قابلة للاستعادة، وتنفيذ مزامنة يدوية عند الحاجة.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        {statusCards.map(card => (
                            <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <card.icon className="h-4 w-4 opacity-80" />
                                    <span className="text-[11px] font-semibold text-slate-400">{card.label}</span>
                                </div>
                                <div dir="ltr" className="mt-3 truncate font-mono text-2xl font-black">{card.value}</div>
                                <div className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-6 text-slate-500">آخر مزامنة: {syncTimeLabel}</div>
                    <button
                        onClick={refreshStats}
                        disabled={loading}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-bold text-white transition hover:bg-white/[0.08] active:scale-[0.98] disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        تحديث الحالة
                    </button>
                </div>
            </section>

            {notice && (
                <div className={`flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm ${noticeClass}`}>
                    <span>{notice.message}</span>
                    <button onClick={() => setNotice(null)} className="rounded-lg p-1 transition hover:bg-white/10" title="إغلاق">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_0.72fr_1fr]">
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/55 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-xl">
                    <div className="mb-6 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary-400/20 bg-primary-400/10 text-primary-200">
                                <HardDrive className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-white">القاعدة المحلية</h3>
                                <p className="text-xs text-slate-500">Local Browser DB</p>
                            </div>
                        </div>
                        <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-xs text-slate-300">Dexie.js</span>
                    </div>

                    <div className="mb-6 grid gap-3">
                        {[
                            { label: 'عدد الطلاب', value: localStats.students },
                            { label: 'سجلات الحضور', value: localStats.logs },
                            { label: 'الحجم التقديري', value: formatBytes(localStats.size) }
                        ].map(item => (
                            <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                <span className="text-sm text-slate-400">{item.label}</span>
                                <span dir="ltr" className="font-mono text-xl font-black text-white">{item.value}</span>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                            onClick={handleLocalExport}
                            disabled={loading}
                            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-primary-400/25 bg-primary-400/10 p-4 text-primary-100 transition hover:bg-primary-400/15 active:scale-[0.99] disabled:opacity-50"
                        >
                            <Download className="w-6 h-6" />
                            <span className="text-sm font-black">تصدير محلي</span>
                        </button>
                        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-slate-200 transition hover:bg-white/[0.07] active:scale-[0.99]">
                            <Upload className="w-6 h-6" />
                            <span className="text-sm font-black">استيراد محلي</span>
                            <input type="file" accept=".json" className="hidden" onChange={(e) => handleLocalImport(e.target.files)} />
                        </label>
                    </div>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-6 shadow-[0_18px_65px_-55px_rgba(245,158,11,0.45)] backdrop-blur-xl">
                    <div className="flex h-full min-h-72 flex-col justify-between gap-6">
                        <div className="text-center">
                            <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border ${cloudStats.connected ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-red-400/25 bg-red-400/10 text-red-200'}`}>
                                {cloudStats.connected ? <Check className="w-6 h-6" /> : <X className="w-6 h-6" />}
                            </div>
                            <h3 className="text-xl font-black text-white">{cloudStats.connected ? 'الاتصال مستقر' : 'الاتصال غير متاح'}</h3>
                            <p className="mt-2 text-sm leading-6 text-slate-500">الجسر بين القاعدة المحلية والسحابة يعمل عبر طابور مزامنة قابل للمراجعة.</p>
                        </div>

                        <div className="relative mx-auto flex h-28 w-full max-w-xs items-center justify-center">
                            <div className="absolute inset-x-8 top-1/2 h-px bg-white/10" />
                            <div className={`relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl border font-mono text-2xl font-black ${syncStats.pending > 0 ? 'border-amber-400/25 bg-amber-400/10 text-amber-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>
                                {syncStats.pending}
                            </div>
                        </div>

                        <div>
                            <div className="mb-3 text-center text-xs text-slate-500">عمليات معلقة في الطابور</div>
                            <button
                                onClick={handleForceSync}
                                disabled={syncStats.pending === 0 || loading}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-black text-amber-100 transition hover:bg-amber-400/15 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                <ArrowLeftRight className="w-4 h-4" />
                                مزامنة العمليات
                            </button>
                        </div>
                    </div>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/55 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-secondary-400)_/_0.55)] backdrop-blur-xl">
                    <div className="mb-6 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-secondary-400/20 bg-secondary-400/10 text-secondary-200">
                                <Cloud className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-white">السحابة</h3>
                                <p className="text-xs text-slate-500">Supabase Postgres</p>
                            </div>
                        </div>
                        <span className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${cloudStats.connected ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100' : 'border-red-400/25 bg-red-400/10 text-red-100'}`}>
                            {cloudStats.connected ? 'متصل' : 'منقطع'}
                        </span>
                    </div>

                    <div className="mb-6 space-y-3">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="mb-2 text-xs text-slate-500">معرف المشروع</div>
                            <code dir="ltr" className="block truncate rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-left text-[11px] text-primary-200">
                                {import.meta.env.VITE_SUPABASE_URL || 'Local/Unknown'}
                            </code>
                        </div>
                        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] p-4 text-sm leading-7 text-amber-100">
                            <AlertTriangle className="ml-1 inline-block h-4 w-4" />
                            استخدم التصدير السحابي كنسخة مراجعة كاملة، واترك المزامنة التلقائية تدير العمليات اليومية.
                        </div>
                    </div>

                    <button
                        onClick={handleCloudExport}
                        disabled={loading || !cloudStats.connected}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary-300 px-4 text-sm font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                        تصدير كامل من السحابة
                    </button>
                </div>
            </section>

            <section className="rounded-[1.5rem] border border-red-500/20 bg-red-500/[0.06] p-6 shadow-[0_18px_65px_-55px_rgba(239,68,68,0.45)]">
                <div className="mb-6 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10 text-red-200">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white">منطقة الخطر</h3>
                        <p className="text-sm text-slate-400">إجراءات إصلاح متقدمة. استخدمها عند الحاجة فقط.</p>
                    </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                    <div className="rounded-2xl border border-red-400/20 bg-slate-950/45 p-4">
                        <h4 className="mb-2 flex items-center gap-2 font-black text-red-100">
                            <RefreshCw className="w-4 h-4" />
                            تنظيف طابور المزامنة
                        </h4>
                        <p className="mb-4 text-xs leading-6 text-slate-400">
                            يحذف العمليات المعلقة فقط دون حذف الطلاب أو السجلات الأساسية. قد تفقد عمليات لم ترفع للسيرفر بعد.
                        </p>
                        <button
                            onClick={async () => {
                                if (confirm('هل أنت متأكد من مسح طابور المزامنة؟ هذا الإجراء لا يمكن التراجع عنه.')) {
                                    await localDb.sync_queue.clear();
                                    setNotice({ type: 'success', message: 'تم تنظيف طابور المزامنة.' });
                                    refreshStats();
                                }
                            }}
                            className="h-11 w-full rounded-xl border border-red-400/25 bg-red-400/10 text-sm font-black text-red-100 transition hover:bg-red-400/15 active:scale-[0.99]"
                        >
                            تنفيذ التنظيف
                        </button>
                    </div>

                    <div className="rounded-2xl border border-red-400/20 bg-slate-950/45 p-4">
                        <h4 className="mb-2 flex items-center gap-2 font-black text-red-100">
                            <History className="w-4 h-4" />
                            إعادة ضبط المصنع
                        </h4>
                        <p className="mb-4 text-xs leading-6 text-slate-400">
                            يحذف جميع البيانات المحلية من هذا الجهاز فقط. لا يحذف بيانات Supabase السحابية.
                        </p>
                        <button
                            onClick={async () => {
                                const code = prompt('للتأكيد، اكتب "حذف" في المربع أدناه:');
                                if (code === 'حذف') {
                                    await localDb.clearAllData();
                                    localStorage.clear();
                                    setNotice({ type: 'warning', message: 'تم حذف البيانات المحلية. سيتم تحديث الصفحة.' });
                                    setTimeout(() => window.location.reload(), 800);
                                }
                            }}
                            className="h-11 w-full rounded-xl bg-red-500 text-sm font-black text-white transition hover:bg-red-400 active:scale-[0.99]"
                        >
                            حذف كل شيء وإعادة تعيين
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};
