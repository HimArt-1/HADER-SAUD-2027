import React, { useState, useEffect } from 'react';
import { Database, HardDrive, Download, Upload, AlertCircle, CheckCircle, FileArchive, RefreshCw, Search } from 'lucide-react';
import { db, getLocalISODate } from '../services/db';
import { motion } from 'framer-motion';
import { SmartArchiver } from '../services/archiver';
import { useToast } from '../components/Toast';
import { notificationCenter } from '../services/notifications';
import { studentAffairs } from '../services/studentAffairs';

const StorageCenter: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'backup' | 'archive'>('backup');
    const [viewArchiveData, setViewArchiveData] = useState<any>(null); // For Archive Viewer
    const [lastBackup, setLastBackup] = useState<string | null>(null);
    const toast = useToast();

    // Archive Search State
    const [archiveSearch, setArchiveSearch] = useState('');
    const [selectedStudentReport, setSelectedStudentReport] = useState<{ name: string, p: number, a: number, l: number } | null>(null);
    const [cleanupAfterArchive, setCleanupAfterArchive] = useState(false);

    // Stats
    const [stats, setStats] = useState({
        logs: 0,
        students: 0,
        size: '0 KB'
    });

    useEffect(() => {
        // Determine last backup from local storage if possible, or DB settings
        const last = localStorage.getItem('hader_last_backup_date');
        if (last) setLastBackup(last);

        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const [students, attendance] = await Promise.all([
                db.getStudents(),
                db.getAllAttendance()
            ]);

            const size = JSON.stringify({ students, attendance }).length;
            const sizeStr = size > 1024 * 1024
                ? `${(size / (1024 * 1024)).toFixed(2)} MB`
                : `${(size / 1024).toFixed(2)} KB`;

            setStats({
                logs: attendance.length,
                students: students.length,
                size: sizeStr
            });
        } catch (e) { console.error(e); }
    };

    const handleExport = async () => {
        setLoading(true);
        try {
            const [students, attendance, settings, classes, notifications, violations, exits] = await Promise.all([
                db.getStudents(),
                db.getAllAttendance(),
                db.getSettings(),
                db.getClasses(),
                notificationCenter.load({ type: 'all' }),
                studentAffairs.load({ type: 'violations' }).then(result => result.violations),
                studentAffairs.load({ type: 'exits', date: getLocalISODate() }).then(result => result.exits)
            ]);

            const backupData = {
                meta: {
                    app: 'Hader',
                    version: '2.0',
                    created_at: new Date().toISOString(),
                    type: 'full_backup'
                },
                data: {
                    students,
                    attendance,
                    settings,
                    classes,
                    notifications,
                    violations,
                    exits
                }
            };

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hader_backup_${getLocalISODate()}.json`;
            a.click();

            const now = new Date().toLocaleString('ar-SA');
            localStorage.setItem('hader_last_backup_date', now);
            setLastBackup(now);
        } catch (e) {
            toast.error('فشل التصدير: ' + (e as any).message);
        } finally {
            setLoading(false);
        }
    };

    const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm('هل أنت متأكد من استعادة البيانات؟ سيتم دمج البيانات الجديدة مع الموجودة حالياً.')) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            setLoading(true);
            try {
                const text = event.target?.result as string;
                const json = JSON.parse(text);
                const data = json.data || json; // Handle wrapped or raw

                // Restore Students
                if (data.students && Array.isArray(data.students)) {
                    await db.saveStudents(data.students);
                }

                // Restore Settings
                if (data.settings) {
                    await db.saveSettings(data.settings);
                }

                // Restore Classes
                if (data.classes && Array.isArray(data.classes)) {
                    for (const c of data.classes) {
                        await db.saveClass(c);
                    }
                }

                if (data.attendance) await db.saveAttendanceBatch(data.attendance);

                toast.success('تم استعادة البيانات بنجاح.');
                fetchStats();
            } catch (err) {
                console.error(err);
                toast.error('فشل قراءة ملف النسخة الاحتياطية');
            } finally {
                setLoading(false);
            }
        };
        reader.readAsText(file);
    };

    const handleCreateArchive = async () => {
        setLoading(true);
        try {
            const [students, attendance] = await Promise.all([
                db.getStudents(),
                db.getAllAttendance()
            ]);

            if (attendance.length === 0) {
                toast.warning('لا توجد سجلات للأرشفة.');
                return;
            }

            const archive = SmartArchiver.compress(attendance, students);
            const filename = SmartArchiver.getFilename(archive);

            const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();

            // Cleanup Logic
            if (cleanupAfterArchive) {
                if (confirm(`تحذير خطر: لقد اخترت حذف السجلات من قاعدة البيانات!\n\nسيتم حذف ${attendance.length} سجل من النظام (للفترة ${archive.meta.range_start} إلى ${archive.meta.range_end}).\n\nتأكد أن ملف الأرشيف (.hader) تم تحميله وحفظه بنجاح في جهازك قبل الموافقة.\n\nهل أنت متأكد من الحذف؟`)) {
                    await db.deleteAttendanceRange(archive.meta.range_start, archive.meta.range_end);
                    toast.success('تم حذف السجلات المؤرشفة بنجاح، وتحرير مساحة التخزين.');
                    fetchStats(); // Refresh stats
                }
            } else {
                toast.success(`تم إنشاء الأرشيف الذكي بنجاح. الملف: ${filename}`);
            }
        } catch (e) {
            console.error(e);
            toast.error('فشل إنشاء الأرشيف');
        } finally {
            setLoading(false);
        }
    };

    const handleViewArchive = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target?.result as string;
                const archive = JSON.parse(text);

                if (!archive.version || !archive.data) {
                    throw new Error('ملف أرشيف غير صالح');
                }

                setViewArchiveData(archive);
                setArchiveSearch('');
                setSelectedStudentReport(null);
            } catch (err) {
                toast.error('الملف المحدد ليس ملف أرشيف ذكي صالح (.hader)');
            }
        };
        reader.readAsText(file);
    };

    const handleSearchArchive = () => {
        if (!viewArchiveData || !archiveSearch) return [];
        // Search in viewArchiveData.students
        return Object.entries(viewArchiveData.students || {})
            .filter(([id, name]: [string, any]) => name.toLowerCase().includes(archiveSearch.toLowerCase()))
            .slice(0, 5); // Limit 5
    };

    const handleSelectArchivedStudent = (id: string, name: string) => {
        const logs = viewArchiveData.data[id] || {};
        const p = logs.p?.length || 0;
        const a = logs.a?.length || 0;
        const l = logs.l?.length || 0;
        setSelectedStudentReport({ name, p, a, l });
    };

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8 animate-fade-in text-right" dir="rtl">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div>
                    <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-600 flex items-center gap-3">
                        <Database className="w-10 h-10 text-primary-500" />
                        مركز التخزين والأرشفة
                    </h1>
                    <p className="text-gray-400 mt-2 text-lg">إدارة النسخ الاحتياطية وحماية البيانات</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 mb-8 border-b border-white/10 pb-4">
                <button
                    onClick={() => setActiveTab('backup')}
                    className={`px-6 py-2 rounded-xl font-bold transition-all ${activeTab === 'backup' ? 'bg-primary-500/20 text-primary-400 border border-primary-500/50' : 'text-gray-400 hover:text-white'}`}
                >
                    النسخ والاحتفاظ
                </button>
                <button
                    onClick={() => setActiveTab('archive')}
                    className={`px-6 py-2 rounded-xl font-bold transition-all ${activeTab === 'archive' ? 'bg-secondary-500/20 text-secondary-400 border border-secondary-500/50' : 'text-gray-400 hover:text-white'}`}
                >
                    الأرشيف الذكي
                </button>
            </div>

            {/* Content */}
            {activeTab === 'backup' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Card 1: Backup Status */}
                    <div className="glass-card p-8 rounded-3xl border border-white/10 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl -z-10 group-hover:bg-primary-500/20 transition-all" />

                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-600 flex items-center justify-center text-white shadow-lg shadow-primary-500/30">
                                <HardDrive className="w-8 h-8" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-white">حالة التخزين</h3>
                                <p className={`text-sm ${lastBackup ? 'text-green-400' : 'text-orange-400'}`}>
                                    {lastBackup ? `آخر نسخة: ${lastBackup}` : 'لم يتم عمل نسخة احتياطية قريبة'}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-8">
                            <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                <div className="text-gray-400 text-sm mb-1">الطلاب المسجلين</div>
                                <div className="text-2xl font-mono font-bold text-white">{stats.students}</div>
                            </div>
                            <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                <div className="text-gray-400 text-sm mb-1">سجلات الحضور</div>
                                <div className="text-2xl font-mono font-bold text-white">{stats.logs}</div>
                            </div>
                        </div>

                        <button
                            onClick={handleExport}
                            disabled={loading}
                            className="w-full py-4 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-600 text-white font-bold text-lg shadow-lg shadow-primary-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 relative overflow-hidden"
                        >
                            {loading ? (
                                <span className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
                            ) : (
                                <>
                                    <Download className="w-5 h-5" />
                                    <span>إنشاء نسخة احتياطية كاملة</span>
                                </>
                            )}
                        </button>
                        <p className="text-xs text-gray-500 mt-4 text-center">
                            سيتم تحميل ملف JSON يحتوي على كافة بيانات النظام (الطلاب، الحضور، الإعدادات)
                        </p>
                    </div>

                    {/* Card 2: Restore / Import */}
                    <div className="glass-card p-8 rounded-3xl border border-white/10 relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-64 h-64 bg-secondary-500/10 rounded-full blur-3xl -z-10 group-hover:bg-secondary-500/20 transition-all" />

                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-secondary-500 to-secondary-600 flex items-center justify-center text-white shadow-lg shadow-secondary-500/30">
                                <RefreshCw className="w-8 h-8" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-white">استعادة البيانات</h3>
                                <p className="text-sm text-gray-400">استرجاع نسخة محفوظة سابقاً</p>
                            </div>
                        </div>

                        <div className={`bg-dashed-border border-2 border-dashed border-gray-700 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:border-secondary-500/50 hover:bg-secondary-500/5 transition-all cursor-pointer group-hover:shadow-[0_0_30px_rgb(var(--color-secondary-500)_/_0.1)] h-[180px] relative ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                            <FileArchive className="w-12 h-12 text-gray-600 mb-4 group-hover:text-secondary-400 transition-colors" />
                            <p className="text-gray-300 font-bold mb-2">إسقاط ملف النسخة الاحتياطية هنا</p>
                            <p className="text-xs text-gray-500">يقبل ملفات JSON فقط</p>
                            <input
                                type="file"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                accept=".json"
                                onChange={handleRestore}
                            />
                        </div>

                        <div className="mt-6 flex items-start gap-3 bg-orange-500/10 border border-orange-500/20 p-4 rounded-xl">
                            <AlertCircle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-orange-200 leading-relaxed">
                                تنبيه: استعادة البيانات ستقوم باستبدال أو دمج البيانات الحالية. يفضل دائماً أخذ نسخة احتياطية جديدة قبل الاستعادة.
                            </p>
                        </div>
                    </div>

                </div>
            ) : (
                // ARCHIVE UI
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="glass-card p-8 rounded-3xl border border-white/10 relative">
                        <div className="absolute -right-20 -top-20 w-64 h-64 bg-green-500/10 rounded-full blur-3xl -z-10" />
                        <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                            <FileArchive className="w-6 h-6 text-green-400" />
                            إنشاء أرشيف ذكي
                        </h3>
                        <p className="text-gray-400 mb-6 leading-relaxed">
                            يقوم الأرشيف الذكي بضغط بيانات الحضور لفترة كاملة في ملف واحد صغير الحجم (.hader) يمكن الاحتفاظ به لسنوات.
                            هذا الملف يحتوي على سجل تاريخي كامل ويمكن فتحه في أي وقت دون الحاجة لاستعادته للنظام.
                        </p>

                        <button
                            onClick={handleCreateArchive}
                            disabled={loading}
                            className="w-full py-4 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
                        >
                            {loading ? <span className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full" /> : <Download className="w-5 h-5" />}
                            <span>أرشفة البيانات الحالية</span>
                        </button>

                        <div className="mt-4 flex items-start gap-4 bg-red-500/5 p-4 rounded-xl border border-red-500/10 hover:bg-red-500/10 transition-colors">
                            <input
                                type="checkbox"
                                checked={cleanupAfterArchive}
                                onChange={e => setCleanupAfterArchive(e.target.checked)}
                                className="w-5 h-5 mt-1 accent-red-500 cursor-pointer"
                            />
                            <div className="text-right">
                                <span className={`block text-sm font-bold ${cleanupAfterArchive ? 'text-red-400' : 'text-gray-400'}`}>حذف البيانات بعد الأرشفة (تنظيف النظام)</span>
                                <span className="text-xs text-gray-500 block mt-1">تفعيل هذا الخيار سيقوم بحذف سجلات الحضور من قاعدة البيانات بعد تحميل ملف الأرشيف بنجاح. استخدمه في نهاية السنة الدراسية لتجهيز النظام للعام الجديد.</span>
                            </div>
                        </div>
                    </div>

                    <div className="glass-card p-8 rounded-3xl border border-white/10 relative">
                        <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                            <Search className="w-6 h-6 text-secondary-400" />
                            مستكشف الأرشيف
                        </h3>
                        <p className="text-gray-400 mb-6">
                            افتح ملفات الأرشيف (.hader) للاطلاع على التقارير السابقة والبحث في سجلات الطلاب القديمة.
                        </p>

                        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center relative hover:bg-white/10 transition-all cursor-pointer">
                            <p className="text-secondary-400 font-bold mb-2">اضغط لفتح ملف أرشيف</p>
                            <p className="text-xs text-gray-500">ملفات .hader فقط</p>
                            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".hader,.json" onChange={handleViewArchive} />
                        </div>

                        {viewArchiveData && (
                            <div className="mt-6 bg-green-500/10 border border-green-500/20 p-4 rounded-xl animate-fade-in text-right">
                                <div className="flex justify-between items-center mb-4 border-b border-green-500/20 pb-2">
                                    <span className="text-green-400 font-bold">الأرشيف النشط</span>
                                    <span className="text-xs text-gray-400">{viewArchiveData.meta?.range_start} - {viewArchiveData.meta?.range_end}</span>
                                </div>

                                <div className="relative mb-4">
                                    <Search className="absolute right-3 top-3 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="ابحث عن اسم طالب في الأرشيف..."
                                        className="w-full bg-black/20 border border-white/10 rounded-xl py-2 pr-10 pl-4 text-white text-sm focus:outline-none focus:border-green-500/50"
                                        value={archiveSearch}
                                        onChange={(e) => setArchiveSearch(e.target.value)}
                                    />
                                </div>

                                {archiveSearch && (
                                    <div className="space-y-2 mb-4">
                                        {handleSearchArchive().map(([id, name]: [string, any]) => (
                                            <div key={id} onClick={() => handleSelectArchivedStudent(id, name)} className="p-2 bg-white/5 rounded-lg flex justify-between items-center hover:bg-white/10 cursor-pointer">
                                                <span className="text-sm text-gray-300">{name}</span>
                                                <span className="text-xs text-green-400">عرض التقرير</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {selectedStudentReport && (
                                    <div className="bg-black/40 p-3 rounded-lg border border-white/5 animate-fade-in">
                                        <h4 className="text-green-400 font-bold mb-2 text-sm">{selectedStudentReport.name}</h4>
                                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                            <div className="bg-green-500/10 p-2 rounded">
                                                <div className="text-gray-400">حضور</div>
                                                <div className="text-white font-bold">{selectedStudentReport.p}</div>
                                            </div>
                                            <div className="bg-red-500/10 p-2 rounded">
                                                <div className="text-gray-400">غياب</div>
                                                <div className="text-white font-bold">{selectedStudentReport.a}</div>
                                            </div>
                                            <div className="bg-yellow-500/10 p-2 rounded">
                                                <div className="text-gray-400">تأخر</div>
                                                <div className="text-white font-bold">{selectedStudentReport.l}</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-4 pt-4 border-t border-green-500/20 text-xs text-center text-gray-500">
                                    هذه البيانات للعرض فقط ولا تؤثر على قاعدة البيانات الحالية
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default StorageCenter;
