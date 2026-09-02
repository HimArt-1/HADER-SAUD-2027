import React, { useMemo } from 'react';
import { FileText, Search, Maximize2, Minimize2, FileSpreadsheet, FileType, Printer, BarChart3, CalendarRange, Users, Timer, RotateCcw, SlidersHorizontal, Loader2, UserPlus, AlertCircle } from 'lucide-react';
import { AcademicHoliday, ReportFilter, SchoolClass, Student } from '../../types';
import { FileService } from '../../services/fileService';
import { db } from '../../services/db';
import { logError } from '../../types/errors';
import {
    AdminAttendanceReportData,
    buildAttendanceReportData,
    getQuickReportRange,
    validateReportDateRange
} from './reportAnalytics';

export interface AdminReportsTabProps {
    reportFilter: ReportFilter;
    setReportFilter: React.Dispatch<React.SetStateAction<ReportFilter>>;
    reportFiltersCollapsed: boolean;
    setReportFiltersCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    reportData: AdminAttendanceReportData | null;
    setReportData: React.Dispatch<React.SetStateAction<AdminAttendanceReportData | null>>;
    classes: SchoolClass[];
    students: Student[];
    kiosk_settings: { school_name?: string; assembly_time?: string; grace_period?: number };
    loading: boolean;
    setLoading: React.Dispatch<React.SetStateAction<boolean>>;
    defaultReportDate: string;
    workDays: number[];
    holidays: AcademicHoliday[];
    onGoToStudents: () => void;
}

const AdminReportsTab: React.FC<AdminReportsTabProps> = ({
    reportFilter,
    setReportFilter,
    reportFiltersCollapsed,
    setReportFiltersCollapsed,
    reportData,
    setReportData,
    classes,
    students,
    kiosk_settings,
    loading,
    setLoading,
    defaultReportDate,
    workDays,
    holidays,
    onGoToStudents,
}) => {
    const [reportError, setReportError] = React.useState<string | null>(null);
    // --- Computed Values ---
    const activeReportFilters = useMemo(() => {
        let count = 0;
        if (reportFilter.class_name) count++;
        if (reportFilter.section) count++;
        if (reportFilter.status && reportFilter.status !== 'all') count++;
        if (reportFilter.search_query && reportFilter.search_query.trim()) count++;
        if (reportFilter.date_from !== defaultReportDate || reportFilter.date_to !== defaultReportDate) count++;
        return count;
    }, [reportFilter, defaultReportDate]);

    const reportDateSummary = reportFilter.date_from === reportFilter.date_to
        ? `يوم ${reportFilter.date_from}`
        : `${reportFilter.date_from} → ${reportFilter.date_to}`;

    const reportDateError = validateReportDateRange(
        reportFilter.date_from,
        reportFilter.date_to,
        defaultReportDate
    );
    const reportPreview = useMemo(() => buildAttendanceReportData({
        students,
        details: [],
        filter: reportFilter,
        workDays,
        holidays
    }).summary, [holidays, reportFilter, students, workDays]);
    const displayedSummary = reportData?.summary ?? reportPreview;
    const reportSummaryCards = [
        { label: 'الطلاب في النطاق', value: displayedSummary.rosterCount, hint: reportFilter.search_query ? 'يشمل نتيجة البحث' : reportFilter.class_name ? 'حسب الصف أو الفصل' : 'جميع الطلاب النشطين', icon: Users, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'أيام الدوام', value: displayedSummary.workingDays, hint: `${displayedSummary.calendarDays} أيام تقويمية`, icon: CalendarRange, className: 'border-secondary-500/20 bg-secondary-500/[0.07] text-secondary-100' },
        { label: 'الفلاتر المفعلة', value: activeReportFilters, hint: activeReportFilters === 0 ? 'الوضع الافتراضي' : 'تصفية مخصصة', icon: SlidersHorizontal, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' },
        { label: 'نسبة الانضباط', value: reportData ? `${displayedSummary.attendanceRate}%` : '-', hint: reportData ? 'الحضور والتأخر في أيام الدوام' : 'تظهر بعد توليد التقرير', icon: BarChart3, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' }
    ];

    const updateReportFilter = React.useCallback((changes: Partial<ReportFilter>) => {
        setReportFilter(previous => ({ ...previous, ...changes }));
        setReportData(null);
        setReportError(null);
    }, [setReportData, setReportFilter]);

    const resetReportFilter = React.useCallback(() => {
        setReportFilter({
            date_from: defaultReportDate,
            date_to: defaultReportDate,
            class_name: '',
            section: '',
            status: 'all',
            search_query: ''
        });
        setReportData(null);
        setReportError(null);
    }, [defaultReportDate, setReportData, setReportFilter]);

    // --- Handlers ---
    const handleGenerateReport = async () => {
        if (reportDateError) {
            setReportError(reportDateError);
            return;
        }
        if (students.length === 0) {
            setReportError('أضف الطلاب أولًا قبل إنشاء تقرير الحضور.');
            return;
        }
        setLoading(true);
        setReportError(null);
        setReportData(null);
        try {
            const data = await db.getAttendanceReport(reportFilter);
            setReportData(buildAttendanceReportData({
                students,
                details: data.details,
                filter: reportFilter,
                workDays,
                holidays
            }));
        } catch (e) {
            logError(e, 'Admin - Generate Attendance Report');
            setReportError('تعذر تحميل التقرير. تحقق من الاتصال وحاول مرة أخرى.');
        } finally { setLoading(false); }
    };

    const handleExport = (type: 'csv' | 'xlsx' | 'html' | 'pdf') => {
        if (!reportData) return;
        const filename = `تقرير_الحضور_${reportFilter.date_from}_${reportFilter.date_to}`;
        const title = `تقرير الحضور - ${reportFilter.date_from} إلى ${reportFilter.date_to}`;
        const exportData = reportData.details.map(d => ({
            student_id: d.student_id,
            studentName: d.studentName,
            className: d.className,
            section: d.section || '-',
            date: d.date,
            status: d.status === 'present' ? 'حاضر' : d.status === 'late' ? 'متأخر' : 'غائب',
            time: new Date(d.time).toLocaleTimeString('ar-SA')
        }));
        const columns = [
            { header: 'المعرف', key: 'student_id' },
            { header: 'الاسم', key: 'studentName' },
            { header: 'الصف', key: 'className' },
            { header: 'الفصل', key: 'section' },
            { header: 'التاريخ', key: 'date' },
            { header: 'الوقت', key: 'time' },
            { header: 'الحالة', key: 'status' },
        ];
        switch (type) {
            case 'csv': FileService.exportToCSV(exportData, filename); break;
            case 'xlsx': FileService.exportToXLSX(exportData, filename); break;
            case 'html': FileService.exportToHTML(columns, exportData, filename, title); break;
            case 'pdf': FileService.exportToPDF(columns, exportData, filename, title); break;
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <BarChart3 className="h-4 w-4" />
                            مركز التقارير
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">التقارير والتحليل</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            توليد تقارير الحضور وتصديرها مع فلاتر دقيقة للصفوف والفصول والحالات.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        {reportSummaryCards.map(card => (
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
            </section>

            {students.length === 0 && (
                <section className="rounded-[1.5rem] border border-primary-400/20 bg-primary-500/[0.06] p-6">
                    <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="inline-flex items-center gap-2 text-xs font-bold text-primary-100">
                                <UserPlus className="h-4 w-4" /> المتطلب الأول للتقارير
                            </div>
                            <h3 className="mt-3 text-xl font-black text-white">أضف الطلاب قبل إنشاء تقرير الحضور</h3>
                            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">يحتاج التقرير إلى سجل طلاب ليحسب نطاق الدوام والحضور والغياب بصورة صحيحة.</p>
                        </div>
                        <button onClick={onGoToStudents} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary-300 px-5 font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.98]">
                            فتح إدارة الطلاب
                        </button>
                    </div>
                </section>
            )}

            {/* Advanced Filters */}
            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.65)] backdrop-blur-xl no-print">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                    <div>
                        <div className="flex items-center gap-2 text-white font-bold text-lg">
                            <FileText className="w-5 h-5 text-primary-400" />
                            فلترة التقارير والسجلات
                            <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100">جاهز للتصدير</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">اضبط نطاق التاريخ والحالات والصفوف وشاهد النتائج فوراً.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-200">
                        <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">فلاتر مفعلة: {activeReportFilters}</span>
                        <span className="px-3 py-1 rounded-full bg-primary-500/10 border border-primary-500/30 text-primary-100">المدى: {reportDateSummary}</span>
                        <button
                            onClick={() => setReportFiltersCollapsed(!reportFiltersCollapsed)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:border-primary-400/50 text-white transition"
                            title={reportFiltersCollapsed ? 'إظهار الفلاتر' : 'تصغير لوحة الفلاتر'}
                        >
                            {reportFiltersCollapsed ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                            {reportFiltersCollapsed ? 'توسيع' : 'تصغير'}
                        </button>
                        <button
                            onClick={resetReportFilter}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20 transition"
                        >
                            <RotateCcw className="w-4 h-4" />
                            إعادة الضبط
                        </button>
                    </div>
                </div>

                {reportFiltersCollapsed ? (
                    <div className="flex flex-wrap gap-2 text-xs text-gray-200">
                        {reportFilter.class_name && <span className="px-3 py-1 rounded-full bg-primary-500/15 border border-primary-500/30 text-primary-50">الصف: {reportFilter.class_name}</span>}
                        {reportFilter.section && <span className="px-3 py-1 rounded-full bg-secondary-500/15 border border-secondary-500/30 text-secondary-50">الفصل: {reportFilter.section}</span>}
                        {reportFilter.status !== 'all' && <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-50">الحالة: {reportFilter.status === 'present' ? 'حضور' : reportFilter.status === 'late' ? 'تأخر' : 'غياب مسجل'}</span>}
                        {reportFilter.search_query && <span className="px-3 py-1 rounded-full bg-secondary-500/15 border border-secondary-500/30 text-secondary-50">بحث: {reportFilter.search_query}</span>}
                        {reportFilter.date_from !== defaultReportDate || reportFilter.date_to !== defaultReportDate ? (
                            <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-50">المدى: {reportDateSummary}</span>
                        ) : (
                            <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">المدى الحالي: {reportDateSummary}</span>
                        )}
                        {activeReportFilters === 0 && <span className="px-3 py-1 rounded-full bg-slate-800/60 border border-white/10">الفلاتر الافتراضية مفعلة</span>}
                    </div>
                ) : (
                    <>
                        {/* Date Range */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">من تاريخ</label>
                                <input
                                    type="date"
                                    max={defaultReportDate}
                                    className="w-full input-glass p-3 rounded-xl"
                                    value={reportFilter.date_from}
                                    onChange={e => updateReportFilter({ date_from: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">إلى تاريخ</label>
                                <input
                                    type="date"
                                    max={defaultReportDate}
                                    className="w-full input-glass p-3 rounded-xl"
                                    value={reportFilter.date_to}
                                    onChange={e => updateReportFilter({ date_to: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">الصف</label>
                                <select
                                    className="w-full input-glass p-3 rounded-xl"
                                    value={reportFilter.class_name || ''}
                                    onChange={e => updateReportFilter({ class_name: e.target.value, section: '' })}
                                >
                                    <option value="">جميع الصفوف</option>
                                    {classes.map(c => (
                                        <option key={c.id} value={c.name}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">الفصل</label>
                                <select
                                    className="w-full input-glass p-3 rounded-xl"
                                    value={reportFilter.section || ''}
                                    onChange={e => updateReportFilter({ section: e.target.value })}
                                    disabled={!reportFilter.class_name}
                                >
                                    <option value="">جميع الفصول</option>
                                    {reportFilter.class_name && classes.find(c => c.name === reportFilter.class_name)?.sections.map(s => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Status & Search Filters */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">الحالة</label>
                                <select
                                    className="w-full input-glass p-3 rounded-xl"
                                    value={reportFilter.status || 'all'}
                                    onChange={e => updateReportFilter({ status: e.target.value as ReportFilter['status'] })}
                                >
                                    <option value="all">جميع الحالات</option>
                                    <option value="present">الحضور فقط</option>
                                    <option value="late">المتأخرين فقط</option>
                                    <option value="absent">الغياب المسجل فقط</option>
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs text-gray-400 mb-2">البحث عن طالب</label>
                                <div className="relative">
                                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                    <input
                                        type="text"
                                        className="w-full input-glass p-3 pr-10 rounded-xl"
                                        placeholder="اكتب اسم الطالب أو رقم المعرف..."
                                        value={reportFilter.search_query || ''}
                                        onChange={e => updateReportFilter({ search_query: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Quick Filters */}
                        <div className="flex flex-wrap gap-2 mb-6">
                            <span className="text-xs text-gray-400 ml-2">فلاتر سريعة:</span>
                            <button
                                onClick={() => updateReportFilter(getQuickReportRange('today', defaultReportDate))}
                                className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors"
                            >
                                اليوم
                            </button>
                            <button
                                onClick={() => updateReportFilter(getQuickReportRange('week', defaultReportDate))}
                                className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors"
                            >
                                آخر أسبوع
                            </button>
                            <button
                                onClick={() => updateReportFilter(getQuickReportRange('month', defaultReportDate))}
                                className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors"
                            >
                                آخر شهر
                            </button>
                            <div className="w-px h-6 bg-white/10 mx-1"></div>
                            <button
                                onClick={() => updateReportFilter({ status: 'late' })}
                                className={`px-3 py-1 border rounded-lg text-xs transition-colors ${reportFilter.status === 'late'
                                    ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'
                                    }`}
                            >
                                المتأخرين
                            </button>
                            <button
                                onClick={() => updateReportFilter({ status: 'absent' })}
                                className={`px-3 py-1 border rounded-lg text-xs transition-colors ${reportFilter.status === 'absent'
                                    ? 'bg-red-500/20 border-red-500/30 text-red-400'
                                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'
                                    }`}
                            >
                                الغياب المسجل
                            </button>
                            <button
                                onClick={resetReportFilter}
                                className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs text-red-400 transition-colors"
                            >
                                مسح الفلاتر
                            </button>
                        </div>
                    </>
                )}

                {(reportDateError || reportError) && (
                    <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{reportError || reportDateError}</span>
                    </div>
                )}

                {/* Generate Button */}
                <button
                    onClick={handleGenerateReport}
                    disabled={loading || Boolean(reportDateError) || students.length === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-300 px-8 py-3 font-black text-slate-950 shadow-[0_16px_35px_-24px_rgb(var(--color-primary-400)_/_0.9)] transition hover:bg-primary-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-primary-300/40 disabled:text-slate-900/50 md:w-auto"
                >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                    {loading ? 'جاري توليد التقرير' : 'عرض التقرير'}
                </button>
            </div>

            {!reportData && students.length > 0 && (
                <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-slate-950/35 p-8 text-center backdrop-blur-xl">
                    <Timer className="mx-auto mb-3 h-10 w-10 text-primary-300/70" />
                    <h3 className="text-lg font-black text-white">لم يتم توليد تقرير بعد</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-slate-400">
                        اختر النطاق والفلاتر المناسبة ثم اضغط عرض التقرير لعرض النتائج وخيارات التصدير.
                    </p>
                </div>
            )}

            {/* Report Results */}
            {reportData && (
                <div className="animate-fade-in-up">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 no-print">
                        <div>
                            <h2 className="text-2xl font-bold text-white font-serif">نتائج التقرير</h2>
                            <p className="text-sm text-gray-400 mt-1">
                                {reportFilter.date_from === reportFilter.date_to
                                    ? `تاريخ: ${reportFilter.date_from}`
                                    : `من ${reportFilter.date_from} إلى ${reportFilter.date_to}`
                                }
                                {reportFilter.class_name && ` • ${reportFilter.class_name}`}
                                {reportFilter.section && ` - ${reportFilter.section}`}
                                {reportFilter.status && reportFilter.status !== 'all' && ` • ${reportFilter.status === 'present' ? 'الحضور' :
                                    reportFilter.status === 'late' ? 'المتأخرين' : 'الغياب المسجل'
                                    }`}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button disabled={reportData.details.length === 0} onClick={() => handleExport('csv')} className="flex items-center gap-2 px-4 py-2 bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 rounded-xl hover:bg-emerald-600/20 transition-all text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40">
                                <FileText className="w-4 h-4" /> CSV
                            </button>
                            <button disabled={reportData.details.length === 0} onClick={() => handleExport('xlsx')} className="flex items-center gap-2 px-4 py-2 bg-sky-600/10 text-sky-400 border border-sky-500/20 rounded-xl hover:bg-sky-600/20 transition-all text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40">
                                <FileSpreadsheet className="w-4 h-4" /> XLSX
                            </button>
                            <button disabled={reportData.details.length === 0} onClick={() => handleExport('pdf')} className="flex items-center gap-2 px-4 py-2 bg-red-600/10 text-red-400 border border-red-500/20 rounded-xl hover:bg-red-600/20 transition-all text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40">
                                <FileType className="w-4 h-4" /> PDF
                            </button>
                            <button onClick={() => window.print()} className="p-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-gray-300" title="طباعة">
                                <Printer className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div id="print-area" className="glass-card p-8 rounded-3xl bg-white text-black print:text-black print:bg-white print:shadow-none print:border-none print:p-0">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-8">
                            <div>
                                <div className="text-sm text-gray-500">نظام حاضر الذكي</div>
                                <h3 className="text-3xl font-bold text-gray-900">تقرير الحضور الرسمي</h3>
                                <p className="text-sm text-gray-500 mt-2">
                                    المدرسة: <span className="font-semibold text-gray-700">{kiosk_settings.school_name || 'المدرسة'}</span>
                                </p>
                                <p className="text-sm text-gray-500">
                                    الفترة: <span className="font-semibold text-gray-700">{reportDateSummary}</span>
                                </p>
                            </div>
                            <div className="grid gap-3 text-xs text-gray-500">
                                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                    <div className="uppercase tracking-wide text-[10px] text-gray-400">تم الإنشاء</div>
                                    <div className="font-semibold text-gray-700">{new Date().toLocaleString('ar-SA')}</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                    <div className="uppercase tracking-wide text-[10px] text-gray-400">نطاق التقرير</div>
                                    <div className="font-semibold text-gray-700">
                                        {reportFilter.class_name ? `${reportFilter.class_name}${reportFilter.section ? ` - ${reportFilter.section}` : ''}` : 'جميع الصفوف'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm">
                                <p className="text-[11px] font-bold text-slate-500 mb-1">الطلاب في النطاق</p>
                                <p className="text-2xl font-bold text-gray-800 font-mono">{reportData.summary.rosterCount}</p>
                            </div>
                            <div className="p-4 rounded-2xl bg-secondary-50 border border-secondary-100 shadow-sm">
                                <p className="text-[11px] font-bold text-secondary-600 mb-1">أيام الدوام</p>
                                <p className="text-2xl font-bold text-gray-800 font-mono">{reportData.summary.workingDays}</p>
                            </div>
                            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 shadow-sm">
                                <p className="text-[11px] font-bold text-emerald-600 mb-1">الحضور</p>
                                <p className="text-2xl font-bold text-gray-800 font-mono">{reportData.summary.present}</p>
                            </div>
                            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 shadow-sm">
                                <p className="text-[11px] font-bold text-amber-600 mb-1">التأخر</p>
                                <p className="text-2xl font-bold text-gray-800 font-mono">{reportData.summary.late}</p>
                            </div>
                            <div className="p-4 rounded-2xl bg-red-50 border border-red-100 shadow-sm">
                                <p className="text-[11px] font-bold text-red-600 mb-1">الغياب المسجل</p>
                                <p className="text-2xl font-bold text-gray-800 font-mono">{reportData.summary.absent}</p>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-10">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-xs text-gray-500">إجمالي السجلات</div>
                                <div className="text-3xl font-bold text-slate-800 font-mono">{reportData.summary.totalRecords}</div>
                            </div>
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                                <div className="text-xs text-emerald-700">نسبة الانضباط</div>
                                <div className="text-3xl font-bold text-emerald-700 font-mono">{reportData.summary.attendanceRate}%</div>
                            </div>
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                                <div className="text-xs text-amber-700">غير مسجل</div>
                                <div className="text-3xl font-bold text-amber-700 font-mono">{reportData.summary.unrecorded}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-xs text-gray-500">السجلات المتوقعة</div>
                                <div className="text-3xl font-bold text-slate-800 font-mono">{reportData.summary.expectedRecords}</div>
                            </div>
                        </div>

                        {reportData.summary.holidayRecords > 0 && (
                            <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                                توجد {reportData.summary.holidayRecords} سجلات في أيام عطلة. تظهر في التفاصيل ولا تدخل في نسبة الانضباط.
                            </div>
                        )}

                        {/* Results Table */}
                        {reportData.details.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                <p>لا توجد نتائج للفلاتر المحددة</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-right border-collapse text-gray-700">
                                    <thead>
                                        <tr className="bg-gray-50 border-b">
                                            <th className="p-4 text-sm font-bold">#</th>
                                            <th className="p-4 text-sm font-bold">التاريخ</th>
                                            <th className="p-4 text-sm font-bold">الطالب</th>
                                            <th className="p-4 text-sm font-bold">الصف</th>
                                            <th className="p-4 text-sm font-bold">الفصل</th>
                                            <th className="p-4 text-sm font-bold">الوقت</th>
                                            <th className="p-4 text-sm font-bold">الحالة</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportData.details.map((row, i) => (
                                            <tr key={`${row.student_id}-${row.date}`} className="border-b hover:bg-gray-50 transition-colors">
                                                <td className="p-3 text-gray-400 font-mono text-sm">{i + 1}</td>
                                                <td className="p-3 font-mono text-sm">
                                                    {row.date}
                                                    {row.isHoliday && <span className="mr-2 rounded bg-sky-100 px-1.5 py-0.5 font-sans text-[10px] font-bold text-sky-700">عطلة</span>}
                                                </td>
                                                <td className="p-3 font-bold">{row.studentName}</td>
                                                <td className="p-3 text-sm">{row.className}</td>
                                                <td className="p-3 text-sm">{row.section || '-'}</td>
                                                <td className="p-3 font-mono text-sm">
                                                    {new Date(row.time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-1 rounded-lg text-xs font-bold ${row.status === 'present' ? 'bg-emerald-100 text-emerald-700' :
                                                        row.status === 'late' ? 'bg-amber-100 text-amber-700' :
                                                            'bg-red-100 text-red-700'
                                                        }`}>
                                                        {row.status === 'present' ? 'حاضر' :
                                                            row.status === 'late' ? 'متأخر' : 'غائب'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Footer for print */}
                        <div className="mt-10 pt-6 border-t border-gray-200 grid md:grid-cols-3 gap-6 text-xs text-gray-500 print:block hidden">
                            <div>
                                <div className="mb-2 font-semibold text-gray-700">ملاحظات الإدارة</div>
                                <div className="h-16 border border-dashed border-gray-300 rounded-xl"></div>
                            </div>
                            <div>
                                <div className="mb-2 font-semibold text-gray-700">توقيع المدير</div>
                                <div className="h-16 border border-dashed border-gray-300 rounded-xl"></div>
                            </div>
                            <div>
                                <div className="mb-2 font-semibold text-gray-700">ختم المدرسة</div>
                                <div className="h-16 border border-dashed border-gray-300 rounded-xl"></div>
                            </div>
                            <div className="md:col-span-3 text-center text-[10px] text-gray-400 mt-4">
                                تم إنشاء هذا التقرير بواسطة نظام حاضر - {new Date().toLocaleString('ar-SA')}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminReportsTab;
