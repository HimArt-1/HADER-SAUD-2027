// ═══════════════════════════════════════════════════════════════
// AdminStudentsTab - Student list, filters, bulk actions, CRUD
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { Student } from '../../types';
import { getCatalogSections } from '../../constants/schoolCatalog';
import {
    Search, Filter, SlidersHorizontal, ChevronDown, Download,
    FileSpreadsheet, Clock, Camera, CheckSquare, Trash2, Plus,
    Check, AlertOctagon, MoveRight, Maximize2, Minimize2,
    UserIcon, Hash, Settings as SettingsIcon, Users, UserCheck, UserX,
    Building2, ArrowLeft
} from 'lucide-react';

/* ─── Prop Types ─── */

export interface AdminStudentsTabProps {
    // Data
    students: Student[];
    sortedStudents: Student[];
    filteredStudents: Student[];
    selectedStudentIds: Set<string>;
    setSelectedStudentIds: React.Dispatch<React.SetStateAction<Set<string>>>;

    // Search & Sort
    searchTerm: string;
    setSearchTerm: (val: string) => void;
    studentSortBy: 'name' | 'id' | 'class' | 'section';
    setStudentSortBy: (val: 'name' | 'id' | 'class' | 'section') => void;
    studentSortDir: 'asc' | 'desc';
    setStudentSortDir: (val: 'asc' | 'desc') => void;

    // Filters
    studentFilterGrade: string;
    setStudentFilterGrade: (val: string) => void;
    studentFilterSection: string;
    setStudentFilterSection: (val: string) => void;
    studentFilterStatus: string;
    setStudentFilterStatus: React.Dispatch<React.SetStateAction<'all' | 'active' | 'inactive'>>;
    studentFilterActivity: string;
    setStudentFilterActivity: React.Dispatch<React.SetStateAction<'all' | 'today' | 'week' | 'month' | 'older' | 'unknown'>>;
    studentFiltersCollapsed: boolean;
    setStudentFiltersCollapsed: (val: boolean) => void;
    activeStudentFilters: number;
    resetStudentFilters: () => void;

    // Filter data
    gradeFilters: string[];
    visibleSections: string[];
    countStudentsByGrade: (grade: string) => number;
    countStudentsBySection: (section: string, grade?: string) => number;
    statusCounts: { active: number; inactive: number };
    activityCounts: Record<string, number>;

    // Selection
    selectedInView: number;
    allStudentsSelected: boolean;
    toggleSelectAllFiltered: () => void;
    toggleStudentSelection: (id: string) => void;

    // Bulk select by class/section
    bulkSelectGrade: string;
    setBulkSelectGrade: (val: string) => void;
    bulkSelectSection: string;
    setBulkSelectSection: (val: string) => void;
    schoolCatalog: ReturnType<typeof import('../../constants/schoolCatalog').buildSchoolCatalog>;
    handleSelectByClassSection: () => void;

    // Bulk actions
    handleBulkDeleteStudents: () => void;
    handleBulkStatusUpdate: (active: boolean) => void;
    handleBulkMoveStudents: () => void;
    handleExportSelectedStudents: () => void;
    bulkMoveClass: string;
    setBulkMoveClass: (val: string) => void;
    bulkMoveSection: string;
    setBulkMoveSection: (val: string) => void;
    bulkMoveSections: string[];

    // Actions
    handleExportTemplate: () => void;
    openPrivacyGate: (key: string) => void;
    setShowManualAttendanceModal: (val: boolean) => void;
    setShowBarcodeStudio: (val: boolean) => void;
    handleDeleteStudent: (id: string, name: string) => void;
    hasSchoolStructure: boolean;
    onGoToStructure: () => void;

    // Student profile & editing
    allowStudentIdEdit: boolean;
    setSelectedStudentProfile: (s: Student) => void;
    setIdEditTarget: (s: Student | null) => void;
    setIdEditValue: (val: string) => void;
    setIdEditError: (val: string | null) => void;
    setEditingStudent: (s: Student) => void;
    setShowEditStudentModal: (val: boolean) => void;
}

/* ─── Component ─── */

const AdminStudentsTab: React.FC<AdminStudentsTabProps> = ({
    students, sortedStudents, filteredStudents,
    selectedStudentIds, setSelectedStudentIds,
    searchTerm, setSearchTerm,
    studentSortBy, setStudentSortBy, studentSortDir, setStudentSortDir,
    studentFilterGrade, setStudentFilterGrade,
    studentFilterSection, setStudentFilterSection,
    studentFilterStatus, setStudentFilterStatus,
    studentFilterActivity, setStudentFilterActivity,
    studentFiltersCollapsed, setStudentFiltersCollapsed,
    activeStudentFilters, resetStudentFilters,
    gradeFilters, visibleSections,
    countStudentsByGrade, countStudentsBySection,
    statusCounts, activityCounts,
    selectedInView, allStudentsSelected,
    toggleSelectAllFiltered, toggleStudentSelection,
    bulkSelectGrade, setBulkSelectGrade,
    bulkSelectSection, setBulkSelectSection,
    schoolCatalog, handleSelectByClassSection,
    handleBulkDeleteStudents, handleBulkStatusUpdate,
    handleBulkMoveStudents, handleExportSelectedStudents,
    bulkMoveClass, setBulkMoveClass,
    bulkMoveSection, setBulkMoveSection, bulkMoveSections,
    handleExportTemplate, openPrivacyGate,
    setShowManualAttendanceModal, setShowBarcodeStudio,
    handleDeleteStudent, hasSchoolStructure, onGoToStructure,
    allowStudentIdEdit, setSelectedStudentProfile,
    setIdEditTarget, setIdEditValue, setIdEditError,
    setEditingStudent, setShowEditStudentModal
}) => {
    const activePercent = students.length > 0 ? Math.round((statusCounts.active / students.length) * 100) : 0;
    const studentSummaryCards = [
        { label: 'إجمالي الطلاب', value: students.length, icon: Users, className: 'border-primary-500/20 bg-primary-500/[0.06] text-primary-100' },
        { label: 'نتائج التصفية', value: sortedStudents.length, icon: Filter, className: 'border-secondary-500/20 bg-secondary-500/[0.06] text-secondary-100' },
        { label: 'نشطون', value: statusCounts.active, icon: UserCheck, className: 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100' },
        { label: 'موقوفون', value: statusCounts.inactive, icon: UserX, className: 'border-amber-500/20 bg-amber-500/[0.06] text-amber-100' }
    ];

    return (
        <div className="animate-fade-in min-w-0 max-w-full space-y-4">
            <section className="relative max-w-full overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/65 p-4 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl sm:p-5 md:rounded-[1.75rem]">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <Users className="h-4 w-4" />
                            سجل الطلاب
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">إدارة الطلاب</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            بحث وتصفية وإجراءات جماعية مع بقاء بيانات الطلاب والصلاحيات كما هي.
                        </p>
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-3 min-[380px]:grid-cols-2 sm:grid-cols-4 xl:min-w-[520px]">
                        {studentSummaryCards.map(card => (
                            <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <card.icon className="h-4 w-4 opacity-80" />
                                    <span className="text-[11px] font-semibold text-slate-400">{card.label}</span>
                                </div>
                                <div className="mt-3 font-mono text-2xl font-black">{card.value}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {students.length > 0 ? (
                <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="relative w-full xl:max-w-md">
                        <Search className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary-300/70" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder="بحث بالاسم / المعرف / الصف / الفصل"
                            className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/65 pr-11 pl-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-primary-300/50 focus:ring-2 focus:ring-primary-400/15"
                        />
                    </div>

                    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 xl:w-auto">
                    <button
                            onClick={resetStudentFilters}
                            className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm font-bold text-slate-200 transition hover:border-primary-300/35 hover:bg-primary-400/10"
                            title="إعادة تعيين الفلاتر"
                        >
                            <Filter className="w-4 h-4" />
                            إعادة الفلاتر
                        </button>
                        <div className="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-2 min-[430px]:w-auto">
                        <select
                            value={studentSortBy}
                            onChange={e => setStudentSortBy(e.target.value as 'name' | 'id' | 'class' | 'section')}
                                className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-white outline-none"
                        >
                            <option value="name">ترتيب حسب الاسم</option>
                            <option value="id">ترتيب حسب المعرف</option>
                            <option value="class">ترتيب حسب الصف</option>
                            <option value="section">ترتيب حسب الفصل</option>
                        </select>
                        <button
                            onClick={() => setStudentSortDir(studentSortDir === 'asc' ? 'desc' : 'asc')}
                                className="rounded-lg p-2 text-white transition-colors hover:bg-white/10"
                            title={studentSortDir === 'asc' ? 'تصاعدي' : 'تنازلي'}
                        >
                            <ChevronDown className={`w-4 h-4 transition-transform ${studentSortDir === 'asc' ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                        <button onClick={handleExportTemplate} className="inline-flex h-11 items-center gap-2 rounded-xl border border-secondary-500/30 bg-secondary-500/10 px-3 text-sm font-bold text-secondary-200 transition hover:bg-secondary-500/20" title="تحميل نموذج CSV فارغ لتعبئة بيانات الطلاب"><Download className="w-4 h-4" /> النموذج</button>
                        <button onClick={() => openPrivacyGate('import')} className="inline-flex h-11 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-500/20"><FileSpreadsheet className="w-4 h-4" /> استيراد</button>
                        <button onClick={() => setShowManualAttendanceModal(true)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-sm font-bold text-amber-200 transition hover:bg-amber-500/20"><Clock className="w-4 h-4" /> حضور يدوي</button>
                        <button onClick={() => setShowBarcodeStudio(true)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 text-sm font-bold text-sky-200 transition hover:bg-sky-500/20"><Camera className="w-4 h-4" /> الباركود</button>
                        <button onClick={toggleSelectAllFiltered} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm font-bold text-slate-200 transition hover:border-primary-300/35"><CheckSquare className="w-4 h-4" /> {allStudentsSelected ? 'إلغاء التحديد' : 'تحديد الكل'}</button>
                        <button onClick={handleBulkDeleteStudents} disabled={selectedStudentIds.size === 0} className={`inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold transition ${selectedStudentIds.size === 0 ? 'cursor-not-allowed border border-red-500/20 bg-red-500/10 text-red-200/60' : 'border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'}`}><Trash2 className="w-4 h-4" /> حذف المحدد</button>
                        <button onClick={() => openPrivacyGate('add')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary-300 px-4 text-sm font-black text-slate-950 shadow-[0_16px_35px_-24px_rgb(var(--color-primary-400)_/_0.9)] transition hover:bg-primary-200 active:scale-[0.98]"><Plus className="w-4 h-4" /> إضافة طالب</button>
                    </div>
                </div>
                ) : (
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
                        {!hasSchoolStructure && (
                            <button onClick={onGoToStructure} className="inline-flex h-11 items-center gap-2 rounded-xl border border-primary-400/30 bg-primary-400/10 px-3 text-sm font-bold text-primary-100 transition hover:bg-primary-400/20">
                                <Building2 className="h-4 w-4" /> إعداد الهيكل
                            </button>
                        )}
                        <button onClick={handleExportTemplate} className="inline-flex h-11 items-center gap-2 rounded-xl border border-secondary-500/30 bg-secondary-500/10 px-3 text-sm font-bold text-secondary-200 transition hover:bg-secondary-500/20"><Download className="h-4 w-4" /> تنزيل النموذج</button>
                        <button onClick={() => openPrivacyGate('import')} className="inline-flex h-11 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-500/20"><FileSpreadsheet className="h-4 w-4" /> استيراد القائمة</button>
                        {hasSchoolStructure && (
                            <button onClick={() => openPrivacyGate('add')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary-300 px-4 text-sm font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.98]"><Plus className="h-4 w-4" /> إضافة أول طالب</button>
                        )}
                    </div>
                )}
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-l from-emerald-300 to-primary-300 transition-all" style={{ width: `${activePercent}%` }} />
                </div>
            </section>

            {students.length === 0 ? (
                <section className="relative overflow-hidden rounded-[1.5rem] border border-primary-400/20 bg-slate-950/50 p-5 backdrop-blur-xl sm:p-7">
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-primary-300/70" />
                    <div className="mx-auto max-w-4xl">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                            <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${hasSchoolStructure ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/25 bg-amber-400/10 text-amber-200'}`}>
                                {hasSchoolStructure ? <Check className="h-4 w-4" /> : <span className="font-mono">01</span>}
                                الصفوف والفصول
                            </span>
                            <span className="h-px w-8 bg-white/15" aria-hidden="true" />
                            <span className="inline-flex items-center gap-2 rounded-lg border border-primary-400/30 bg-primary-400/10 px-3 py-1.5 text-primary-100">
                                <span className="font-mono">02</span>
                                إضافة الطلاب
                            </span>
                        </div>

                        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)] lg:items-center">
                            <div>
                                <h3 className="text-2xl font-black tracking-tight text-white">
                                    {hasSchoolStructure ? 'أضف أول طالب إلى السجل' : 'أنشئ الهيكل أولًا، أو استورد القائمة مباشرة'}
                                </h3>
                                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                                    {hasSchoolStructure
                                        ? 'الصفوف والشُعب جاهزة. يمكنك إدخال طالب واحد للتجربة أو استيراد ملف المدرسة كاملًا باستخدام النموذج المعتمد.'
                                        : 'المسار المنظم يبدأ بتعريف الصفوف والشُعب. وإذا كانت قائمتك جاهزة، فالاستيراد ينشئ الهيكل تلقائيًا من بيانات الطلاب.'}
                                </p>
                                <div className="mt-5 flex flex-wrap gap-2">
                                    {hasSchoolStructure ? (
                                        <button onClick={() => openPrivacyGate('add')} className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary-300 px-5 font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.98]">
                                            <Plus className="h-4 w-4" /> إضافة أول طالب
                                        </button>
                                    ) : (
                                        <button onClick={onGoToStructure} className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary-300 px-5 font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.98]">
                                            إنشاء الصفوف والفصول <ArrowLeft className="h-4 w-4" />
                                        </button>
                                    )}
                                    <button onClick={() => openPrivacyGate('import')} className="inline-flex h-12 items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-5 font-bold text-emerald-100 transition hover:bg-emerald-400/20">
                                        <FileSpreadsheet className="h-4 w-4" /> استيراد قائمة
                                    </button>
                                </div>
                            </div>

                            <aside className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                                <div className="text-sm font-black text-white">قبل الاستيراد</div>
                                <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-400">
                                    <li className="flex gap-3"><span className="font-mono text-primary-200">01</span><span>نزّل نموذج قائمة الطلاب.</span></li>
                                    <li className="flex gap-3"><span className="font-mono text-primary-200">02</span><span>أدخل المعرّف والاسم والصف والفصل والجوال.</span></li>
                                    <li className="flex gap-3"><span className="font-mono text-primary-200">03</span><span>ارفع الملف وراجع النتيجة قبل الحفظ.</span></li>
                                </ol>
                                <button onClick={handleExportTemplate} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-secondary-200 transition hover:text-secondary-100">
                                    <Download className="h-4 w-4" /> تنزيل النموذج المعتمد
                                </button>
                            </aside>
                        </div>
                    </div>
                </section>
            ) : (
            <>
            <div className="max-w-full rounded-[1.5rem] border border-white/10 bg-slate-950/45 p-4 space-y-4 backdrop-blur-xl">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-center gap-2 text-white font-semibold">
                        <SlidersHorizontal className="w-4 h-4 text-primary-300" />
                        الفلاتر الذكية
                        <span className="text-xs px-2 py-1 rounded-full bg-primary-500/15 border border-primary-500/30 text-primary-100">وضع متقدم</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                        <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10">{filteredStudents.length} نتيجة</span>
                        <span className="px-2 py-1 rounded-full bg-primary-500/10 border border-primary-500/30 text-primary-200">{selectedInView} محدد في الصفحة</span>
                        {selectedStudentIds.size > 0 && (
                            <span className="px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-200">إجمالي {selectedStudentIds.size} محدد</span>
                        )}
                        <button
                            onClick={() => setStudentFiltersCollapsed(!studentFiltersCollapsed)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:border-primary-400/50 text-white transition"
                            title={studentFiltersCollapsed ? 'إظهار الفلاتر' : 'تصغير الفلاتر'}
                        >
                            {studentFiltersCollapsed ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                            {studentFiltersCollapsed ? 'توسيع' : 'تصغير'}
                        </button>
                        <button
                            onClick={resetStudentFilters}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary-500/30 bg-primary-500/10 text-primary-100 hover:bg-primary-500/20 transition"
                            title="إعادة تعيين الفلاتر"
                        >
                            <Filter className="w-4 h-4" />
                            تصفية ذكية
                        </button>
                    </div>
                </div>

                {studentFiltersCollapsed ? (
                    <div className="flex flex-wrap gap-2 text-xs text-gray-200">
                        <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">الفلاتر النشطة: {activeStudentFilters}</span>
                        {studentFilterGrade !== 'all' && <span className="px-3 py-1 rounded-full bg-primary-500/15 border border-primary-500/30 text-primary-50">الصف: {studentFilterGrade}</span>}
                        {studentFilterSection !== 'all' && <span className="px-3 py-1 rounded-full bg-primary-500/15 border border-primary-500/30 text-primary-50">الشعبة: {studentFilterSection}</span>}
                        {studentFilterStatus !== 'all' && <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-50">الحالة: {studentFilterStatus === 'active' ? 'نشط' : 'موقوف'}</span>}
                        {studentFilterActivity !== 'all' && <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-50">النشاط: {studentFilterActivity === 'today' ? 'اليوم' : studentFilterActivity === 'week' ? 'هذا الأسبوع' : studentFilterActivity === 'month' ? 'آخر 30 يوم' : studentFilterActivity === 'older' ? 'أقدم' : 'غير معروف'}</span>}
                        {activeStudentFilters === 0 && <span className="px-3 py-1 rounded-full bg-slate-800/60 border border-white/10">لا توجد فلاتر مفعلة حالياً</span>}
                    </div>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="space-y-2">
                            <div className="text-xs text-gray-400 flex items-center gap-2">الصفوف</div>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => setStudentFilterGrade('all')} className={`px-3 py-1.5 rounded-full text-xs border ${studentFilterGrade === 'all' ? 'bg-primary-500/20 text-primary-50 border-primary-500/50' : 'border-white/10 text-gray-300 hover:border-primary-400/40'}`}>الكل ({students.length})</button>
                                {gradeFilters.map(grade => (
                                    <button
                                        key={grade}
                                        onClick={() => { setStudentFilterGrade(grade); setStudentFilterSection('all'); }}
                                        className={`px-3 py-1.5 rounded-full text-xs border ${studentFilterGrade === grade ? 'bg-primary-500/20 text-primary-50 border-primary-500/50' : 'border-white/10 text-gray-200 hover:border-primary-400/40'}`}
                                    >
                                        {grade} ({countStudentsByGrade(grade)})
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-xs text-gray-400 flex items-center gap-2">الشعب</div>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => setStudentFilterSection('all')} className={`px-3 py-1.5 rounded-full text-xs border ${studentFilterSection === 'all' ? 'bg-primary-500/20 text-primary-50 border-primary-500/50' : 'border-white/10 text-gray-300 hover:border-primary-400/40'}`}>الكل ({students.length})</button>
                                {visibleSections.map(section => (
                                    <button
                                        key={section}
                                        onClick={() => setStudentFilterSection(section)}
                                        className={`px-3 py-1.5 rounded-full text-xs border ${studentFilterSection === section ? 'bg-primary-500/20 text-primary-50 border-primary-500/50' : 'border-white/10 text-gray-200 hover:border-primary-400/40'}`}
                                    >
                                        {section} ({countStudentsBySection(section, studentFilterGrade === 'all' ? undefined : studentFilterGrade)})
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-xs text-gray-400 flex items-center gap-2">حالة التسجيل</div>
                            <div className="flex flex-wrap gap-2">
                                <button onClick={() => setStudentFilterStatus('all')} className={`px-3 py-1.5 rounded-full text-xs border ${studentFilterStatus === 'all' ? 'bg-primary-500/20 text-primary-50 border-primary-500/50' : 'border-white/10 text-gray-300 hover:border-primary-400/40'}`}>الكل ({students.length})</button>
                                <button onClick={() => setStudentFilterStatus('active')} className={`px-3 py-1.5 rounded-full text-xs border ${studentFilterStatus === 'active' ? 'bg-emerald-500/20 text-emerald-50 border-emerald-500/50' : 'border-white/10 text-gray-200 hover:border-emerald-400/40'}`}>نشط ({statusCounts.active})</button>
                                <button onClick={() => setStudentFilterStatus('inactive')} className={`px-3 py-1.5 rounded-full text-xs border ${studentFilterStatus === 'inactive' ? 'bg-amber-500/20 text-amber-50 border-amber-500/50' : 'border-white/10 text-gray-200 hover:border-amber-400/40'}`}>موقوف ({statusCounts.inactive})</button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-xs text-gray-400 flex items-center gap-2">آخر نشاط</div>
                            <div className="flex flex-wrap gap-2">
                                {([
                                    { key: 'all', label: 'الكل', tone: 'primary' },
                                    { key: 'today', label: 'اليوم', tone: 'emerald' },
                                    { key: 'week', label: 'هذا الأسبوع', tone: 'sky' },
                                    { key: 'month', label: 'آخر 30 يوم', tone: 'blue' },
                                    { key: 'older', label: 'أقدم', tone: 'amber' },
                                    { key: 'unknown', label: 'غير معروف', tone: 'slate' }
                                ] as const).map(({ key, label, tone }) => {
                                    const toneMap: Record<string, string> = {
                                        primary: 'bg-primary-500/20 text-primary-50 border-primary-500/50',
                                        emerald: 'bg-emerald-500/15 text-emerald-50 border-emerald-500/40',
                                        sky: 'bg-sky-500/15 text-sky-50 border-sky-500/40',
                                        blue: 'bg-secondary-500/15 text-secondary-50 border-secondary-500/40',
                                        amber: 'bg-amber-500/15 text-amber-50 border-amber-500/40',
                                        slate: 'bg-slate-500/10 text-slate-100 border-slate-500/30'
                                    };
                                    const isActive = studentFilterActivity === key;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => setStudentFilterActivity(key as any)}
                                            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${isActive ? toneMap[tone] : 'border-white/10 text-gray-200 hover:border-primary-400/40'}`}
                                        >
                                            {label} ({key === 'all' ? students.length : activityCounts[key] || 0})
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {selectedStudentIds.size > 0 && (
                <div className="sticky top-4 z-20 glass-card border border-primary-500/30 bg-primary-500/5 rounded-2xl p-4 shadow-lg shadow-primary-500/15">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-primary-100">
                            <div className="flex items-center gap-2 font-semibold">
                                <CheckSquare className="w-4 h-4" />
                                {selectedStudentIds.size} طالب محدد (منهم {selectedInView} ظاهر في النتائج الحالية)
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                                <button onClick={toggleSelectAllFiltered} className="px-3 py-1 rounded-full bg-white/10 border border-white/20 hover:bg-white/20 text-white transition">{allStudentsSelected ? 'إلغاء تحديد المعروض' : 'تحديد كل النتائج'}</button>
                                <button onClick={() => setSelectedStudentIds(new Set())} className="px-3 py-1 rounded-full bg-slate-800/80 border border-white/10 hover:bg-slate-700 text-slate-100 transition">مسح التحديد</button>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center text-xs text-gray-200">
                            <select
                                value={bulkSelectGrade}
                                onChange={(e) => { setBulkSelectGrade(e.target.value); setBulkSelectSection(''); }}
                                className="bg-white/50 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-xs"
                            >
                                <option value="">اختر الصف</option>
                                {gradeFilters.map(grade => <option key={grade} value={grade}>{grade}</option>)}
                            </select>
                            <select
                                value={bulkSelectSection}
                                onChange={(e) => setBulkSelectSection(e.target.value)}
                                className="bg-white/50 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-xs"
                                disabled={!bulkSelectGrade}
                            >
                                <option value="">كل الفصول</option>
                                {bulkSelectGrade && getCatalogSections(schoolCatalog, bulkSelectGrade).map(sec => (
                                    <option key={sec} value={sec}>{sec}</option>
                                ))}
                            </select>
                            <button
                                onClick={handleSelectByClassSection}
                                className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/20 text-white"
                            >
                                تحديد حسب الصف/الفصل
                            </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 items-center">
                            <div className="flex flex-wrap gap-2">
                                <button onClick={handleExportSelectedStudents} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary-500/15 border border-secondary-500/40 text-secondary-100 hover:bg-secondary-500/25 transition"><Download className="w-4 h-4" /> تصدير المحدد</button>
                                <button onClick={handleBulkDeleteStudents} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-100 hover:bg-red-500/25 transition"><Trash2 className="w-4 h-4" /> حذف المحدد</button>
                                <button onClick={() => handleBulkStatusUpdate(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-100 hover:bg-emerald-500/25 transition"><Check className="w-4 h-4" /> تفعيل</button>
                                <button onClick={() => handleBulkStatusUpdate(false)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-100 hover:bg-amber-500/25 transition"><AlertOctagon className="w-4 h-4" /> تعطيل</button>
                            </div>
                            <div className="flex items-center gap-2">
                                <select value={bulkMoveClass} onChange={e => setBulkMoveClass(e.target.value)} className="w-full rounded-xl bg-white/50 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm px-3 py-2 focus:border-primary-400/50">
                                    <option value="">اختر الصف</option>
                                    {gradeFilters.map(grade => <option key={grade} value={grade}>{grade}</option>)}
                                </select>
                                <select value={bulkMoveSection} onChange={e => setBulkMoveSection(e.target.value)} className="w-full rounded-xl bg-white/50 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-sm px-3 py-2 focus:border-primary-400/50">
                                    <option value="">اختر الفصل</option>
                                    {bulkMoveSections.map(section => <option key={section} value={section}>{section}</option>)}
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={handleBulkMoveStudents} className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-100 hover:bg-emerald-500/30 transition"><MoveRight className="w-4 h-4" /> نقل إلى الصف/الفصل</button>
                            </div>
                            <div className="text-xs text-primary-100/80">استخدم شريط الإجراءات السريع لإدارة التحديدات دون فقد البحث أو الفرز.</div>
                        </div>
                    </div>
                </div>
            )}
            <div className="max-w-full overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/45 backdrop-blur-xl">
                <div className="max-h-[72dvh] max-w-full overflow-auto overscroll-x-contain">
                <table className="w-full min-w-[760px] text-right border-collapse sm:min-w-[920px]">
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-950/95 text-gray-400 text-sm backdrop-blur">
                            <th className="p-4 w-12 text-center">
                                <input type="checkbox" checked={allStudentsSelected} onChange={toggleSelectAllFiltered} className="accent-primary-500 w-4 h-4" />
                            </th>
                            <th className="p-4">المعرف</th>
                            <th className="p-4">الإسم</th>
                            <th className="p-4">الصف</th>
                            <th className="p-4">الفصل</th>
                            <th className="p-4">رقم ولي الأمر</th>
                            <th className="p-4 w-40">الإجراءات</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {sortedStudents.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="p-10 text-center">
                                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-slate-400">
                                        <Search className="h-10 w-10 text-slate-600" />
                                        <div className="text-base font-bold text-slate-200">لا توجد نتائج مطابقة</div>
                                        <div className="text-sm">جرّب تعديل البحث أو إعادة الفلاتر الحالية.</div>
                                    </div>
                                </td>
                            </tr>
                        ) : sortedStudents.map(s => (
                            <tr key={s.id} className="hover:bg-white/5 transition-colors text-gray-300 group">
                                <td className="p-4 text-center">
                                    <input type="checkbox" checked={selectedStudentIds.has(s.id)} onChange={() => toggleStudentSelection(s.id)} className="accent-primary-500 w-4 h-4" />
                                </td>
                                <td className="p-4 font-mono text-primary-300">{s.id}</td>
                                <td className="p-4 font-bold text-white">{s.name}</td>
                                <td className="p-4"><span className="bg-white/5 px-2 py-1 rounded text-xs">{s.class_name}</span></td>
                                <td className="p-4"><span className="bg-primary-500/10 text-primary-400 px-2 py-1 rounded text-xs">{s.section}</span></td>
                                <td className="p-4 font-mono text-sm">{s.guardian_phone}</td>
                                <td className="p-4">
                                    <div className="flex flex-wrap items-center gap-1">
                                        <button
                                            onClick={() => setSelectedStudentProfile(s)}
                                            className="p-2 bg-primary-500/10 hover:bg-primary-500/20 rounded-lg text-primary-400 transition-colors"
                                            title="عرض الملف الشخصي"
                                        >
                                            <UserIcon className="w-4 h-4" />
                                        </button>
                                        {allowStudentIdEdit && (
                                            <button
                                                onClick={() => { setIdEditTarget(s); setIdEditValue(''); setIdEditError(null); }}
                                                className="p-2 bg-primary-500/10 hover:bg-primary-500/20 rounded-lg text-primary-300 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                                                title="تعديل المعرّف"
                                            >
                                                <Hash className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => { setEditingStudent(s); setShowEditStudentModal(true); }}
                                            className="p-2 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg text-amber-400 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                                            title="تعديل الطالب"
                                        >
                                            <SettingsIcon className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteStudent(s.id, s.name)}
                                            className="p-2 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-red-400 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                                            title="حذف الطالب"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>
            </>
            )}
        </div>
    );
};

export default AdminStudentsTab;
