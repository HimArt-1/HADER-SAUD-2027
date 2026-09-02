// ═══════════════════════════════════════════════════════════════
// AdminStructureTab - School Structure Management
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { Student, SchoolClass, ClassStatsSummary } from '../../types';
import {
    Search, Plus, Trash2, Edit3, ChevronDown,
    Database, Loader2, Building2, Layers3, Users, BarChart3,
    Check, ArrowLeft
} from 'lucide-react';
import { parseClassSections } from './classStructure';

const STAT_COLOR_MAP: Record<string, string> = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
    amber: 'border-amber-500/20 bg-amber-500/5',
    red: 'border-red-500/20 bg-red-500/5',
    cyan: 'border-primary-500/20 bg-primary-500/5',
    purple: 'border-secondary-500/20 bg-secondary-500/5',
    blue: 'border-secondary-500/20 bg-secondary-500/5'
};

interface AdminStructureTabProps {
    // Data
    students: Student[];
    classes: SchoolClass[];
    classStudents: Student[];
    selectedClassStats: ClassStatsSummary | null;
    classAttendanceRate: number;
    totalSections: number;
    gradeKeys: string[];
    sectionsForSelectedGrade: string[];
    filteredClassStudents: Student[];

    // State
    classLoading: boolean;
    selectedGrade: string;
    selectedSection: string;
    classRange: 'today' | 'week' | 'month';
    newClass: { name: string; sections: string };
    classStudentSearch: string;
    classStudentSortBy: 'name' | 'id';
    classStudentSortDir: 'asc' | 'desc';

    // Handlers
    setNewClass: (val: { name: string; sections: string }) => void;
    setClassStudentSearch: (val: string) => void;
    setClassStudentSortBy: (val: 'name' | 'id') => void;
    setClassStudentSortDir: (val: 'asc' | 'desc') => void;
    handleSelectGrade: (grade: string) => void;
    handleSelectSection: (section: string) => void;
    handleClassRangeChange: (range: 'today' | 'week' | 'month') => void;
    handleAddClass: () => void;
    handleEditSections: (cls: SchoolClass) => void;
    handleDeleteClass: (id: string, name: string) => void;
    handleRebuildStructure: () => void;
    onGoToStudents: () => void;
}

const AdminStructureTab: React.FC<AdminStructureTabProps> = ({
    students, classes, classStudents, selectedClassStats, classAttendanceRate,
    totalSections, gradeKeys, sectionsForSelectedGrade, filteredClassStudents,
    classLoading, selectedGrade, selectedSection, classRange,
    newClass, classStudentSearch, classStudentSortBy, classStudentSortDir,
    setNewClass, setClassStudentSearch, setClassStudentSortBy, setClassStudentSortDir,
    handleSelectGrade, handleSelectSection, handleClassRangeChange,
    handleAddClass, handleEditSections, handleDeleteClass, handleRebuildStructure,
    onGoToStudents
}) => {
    const parsedNewSections = parseClassSections(newClass.sections);
    const canAddClass = newClass.name.trim().length > 0 && parsedNewSections.length > 0 && !classLoading;
    const structureReady = classes.length > 0 && totalSections > 0;
    const selectedScope = selectedGrade
        ? `${selectedGrade}${selectedSection ? ` / فصل ${selectedSection}` : ''}`
        : 'لم يتم تحديد فصل';
    const structureSummaryCards = [
        { label: 'إجمالي الطلاب', value: students.length, hint: 'ضمن قاعدة البيانات', icon: Users, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'المراحل', value: classes.length, hint: 'صفوف نشطة', icon: Building2, className: 'border-secondary-500/20 bg-secondary-500/[0.07] text-secondary-100' },
        { label: 'الفصول', value: totalSections, hint: 'شُعب مسجلة', icon: Layers3, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' },
        { label: 'حضور النطاق', value: `${classAttendanceRate}%`, hint: selectedScope, icon: BarChart3, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' }
    ];

    return (
        <div className="animate-fade-in space-y-6">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <Database className="h-4 w-4" />
                            خريطة المدرسة
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">الهيكل المدرسي</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            إدارة الصفوف والفصول ومتابعة كثافة الطلاب ومؤشرات الحضور حسب النطاق المحدد.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        {structureSummaryCards.map(card => (
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
                <section className="overflow-hidden rounded-[1.5rem] border border-primary-400/20 bg-primary-500/[0.06] p-5">
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div>
                            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold">
                                <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${structureReady ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-primary-400/30 bg-primary-400/10 text-primary-100'}`}>
                                    {structureReady ? <Check className="h-4 w-4" /> : <span className="font-mono">01</span>}
                                    الصفوف والفصول
                                </span>
                                <span className="h-px w-6 bg-white/15" aria-hidden="true" />
                                <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-400">
                                    <span className="font-mono">02</span>
                                    إضافة الطلاب
                                </span>
                            </div>
                            <h3 className="text-xl font-black text-white">
                                {structureReady ? 'الهيكل جاهز لاستقبال الطلاب' : 'ابدأ بإنشاء أول صف وشُعبه'}
                            </h3>
                            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                                {structureReady
                                    ? `أنشأت ${classes.length} صفوف و${totalSections} شُعب. انتقل الآن لإضافة أول طالب أو استيراد القائمة كاملة.`
                                    : 'أدخل اسم الصف والشُعب في بطاقة الإضافة. نفصل بين الشُعب بفاصلة عربية أو إنجليزية.'}
                            </p>
                        </div>
                        {structureReady && (
                            <button
                                type="button"
                                onClick={onGoToStudents}
                                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary-300 px-5 font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.98]"
                            >
                                الانتقال إلى الطلاب
                                <ArrowLeft className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </section>
            )}

            <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 space-y-4">
                    <div className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.65)] backdrop-blur-xl">
                        {classLoading && (
                            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-10">
                                <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
                            </div>
                        )}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Database className="w-5 h-5 text-primary-400" /> الهيكل المدرسي
                                </h3>
                                <p className="text-gray-400 text-sm">تصفح المراحل، الفصول، وإحصائيات الحضور لكل فصل.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {(['today', 'week', 'month'] as const).map(range => (
                                    <button
                                        key={range}
                                        onClick={() => handleClassRangeChange(range)}
                                        className={`px-3 py-1.5 rounded-full text-sm border ${classRange === range ? 'bg-primary-500/20 text-primary-200 border-primary-500/50' : 'text-gray-400 border-white/10 hover:border-primary-400/40 hover:text-white'}`}
                                    >
                                        {range === 'today' ? 'اليوم' : range === 'week' ? 'أسبوع' : 'شهر'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {gradeKeys.length === 0 ? (
                            <div className="p-6 text-center text-gray-400 bg-white/5 rounded-xl border border-dashed border-white/10 space-y-3">
                                <p>لا يوجد هيكل دراسي بعد. أضف صفوفاً أو قم باستيراد الطلاب لبناء الهيكل تلقائياً.</p>
                                {students.length > 0 && (
                                    <button
                                        onClick={handleRebuildStructure}
                                        className="px-4 py-2 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-500"
                                    >
                                        بناء الهيكل تلقائيًا
                                    </button>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {gradeKeys.map(grade => (
                                        <button
                                            key={grade}
                                            onClick={() => handleSelectGrade(grade)}
                                            className={`px-4 py-2 rounded-xl border text-sm font-bold transition ${selectedGrade === grade ? 'bg-primary-600 text-white border-primary-400 shadow-lg shadow-primary-500/25' : 'border-white/10 text-gray-300 hover:text-white hover:border-primary-400/40'}`}
                                        >
                                            {grade}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex flex-wrap gap-2 mb-6">
                                    {sectionsForSelectedGrade.length > 0 ? (
                                        sectionsForSelectedGrade.map(section => (
                                            <button
                                                key={section}
                                                onClick={() => handleSelectSection(section)}
                                                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition ${selectedSection === section ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/60' : 'border-white/10 text-gray-300 hover:text-white hover:border-emerald-400/40'}`}
                                            >
                                                فصل {section}
                                            </button>
                                        ))
                                    ) : (
                                        <span className="text-gray-400 text-sm">لا توجد فصول مسجلة لهذه المرحلة</span>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                                    <div>
                                        <div className="text-xs text-gray-400">بروفايل الفصل</div>
                                        <div className="text-2xl font-bold text-white">{selectedGrade || 'اختر صفاً'} / {selectedSection || '---'}</div>
                                        <div className="text-sm text-gray-400">عدد الطلاب: {classStudents.length}</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-center">
                                            <div className="text-xs text-gray-400">نسبة الحضور</div>
                                            <div className="text-2xl font-bold text-primary-300">{classAttendanceRate}%</div>
                                        </div>
                                        <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-center">
                                            <div className="text-xs text-gray-400">نطاق البيانات</div>
                                            <div className="text-sm text-white">
                                                {classRange === 'today' ? 'اليوم' : classRange === 'week' ? 'آخر 7 أيام' : 'آخر 30 يوماً'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                    {[{ label: 'حضور', value: selectedClassStats?.present || 0, color: 'emerald' },
                                    { label: 'تأخر', value: selectedClassStats?.late || 0, color: 'amber' },
                                    { label: 'غياب', value: selectedClassStats?.absent || 0, color: 'red' },
                                    { label: 'استئذان', value: selectedClassStats?.exits || 0, color: 'cyan' },
                                    { label: 'مخالفات', value: selectedClassStats?.violations || 0, color: 'purple' },
                                    { label: 'إجمالي الطلاب', value: selectedClassStats?.totalStudents || classStudents.length || 0, color: 'blue' }
                                    ].map(card => (
                                        <div key={card.label} className={`glass-card p-4 rounded-xl border ${STAT_COLOR_MAP[card.color] || 'border-white/10 bg-white/5'}`}>
                                            <div className="text-xs text-gray-300 mb-1">{card.label}</div>
                                            <div className="text-2xl font-bold text-white">{card.value}</div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.5)] backdrop-blur-xl">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h4 className="text-lg font-bold text-white">قائمة الطلاب في الفصل</h4>
                                <p className="text-xs text-gray-400">عرض الطلاب وفقاً للصف والفصل المحدد.</p>
                            </div>
                            <div className="text-sm text-primary-300 font-mono">{filteredClassStudents.length} طالب</div>
                        </div>

                        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
                            <div className="relative w-full md:w-64">
                                <Search className="absolute right-3 top-3 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    value={classStudentSearch}
                                    onChange={(e) => setClassStudentSearch(e.target.value)}
                                    placeholder="بحث بالاسم أو المعرف"
                                    className="w-full bg-white/50 dark:bg-slate-900/60 border border-slate-200 dark:border-white/10 rounded-xl py-2 pr-10 pl-3 text-sm text-slate-900 dark:text-white focus:border-primary-400/50 focus:shadow-[0_0_12px_rgb(var(--color-primary-500)_/_0.2)]"
                                />
                            </div>
                            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-2 py-1">
                                <select
                                    value={classStudentSortBy}
                                    onChange={e => setClassStudentSortBy(e.target.value as 'name' | 'id')}
                                    className="bg-transparent text-sm text-white px-2 py-1 rounded-lg focus:outline-none"
                                >
                                    <option value="name">ترتيب حسب الاسم</option>
                                    <option value="id">ترتيب حسب المعرف</option>
                                </select>
                                <button
                                    onClick={() => setClassStudentSortDir(classStudentSortDir === 'asc' ? 'desc' : 'asc')}
                                    className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                                    title={classStudentSortDir === 'asc' ? 'تصاعدي' : 'تنازلي'}
                                >
                                    <ChevronDown className={`w-4 h-4 transition-transform ${classStudentSortDir === 'asc' ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                        </div>
                        {filteredClassStudents.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-center text-sm text-gray-400">
                                لا يوجد طلاب في هذا الفصل بعد.
                            </div>
                        ) : (
                            <>
                                <div className="max-h-[62dvh] space-y-2 overflow-y-auto pr-1 md:hidden">
                                    {filteredClassStudents.map(student => (
                                        <div key={student.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-base font-black text-white" title={student.name}>
                                                        {student.name}
                                                    </div>
                                                    <div className="mt-1 text-xs text-slate-400">
                                                        {student.class_name} / فصل {student.section}
                                                    </div>
                                                </div>
                                                <div className="shrink-0 rounded-lg border border-primary-400/20 bg-primary-400/10 px-2.5 py-1 font-mono text-xs text-primary-200">
                                                    {student.id}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="hidden overflow-hidden rounded-xl border border-white/10 md:block">
                                    <div className="max-h-[70dvh] overflow-auto">
                                        <table className="w-full min-w-[620px] text-right border-collapse">
                                            <thead className="sticky top-0 z-10">
                                                <tr className="bg-black/40 text-gray-400 text-xs">
                                                    <th className="p-3">المعرف</th>
                                                    <th className="p-3">الاسم</th>
                                                    <th className="p-3">الصف</th>
                                                    <th className="p-3">الفصل</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {filteredClassStudents.map(student => (
                                                    <tr key={student.id} className="hover:bg-white/5 transition-colors text-gray-200">
                                                        <td className="p-3 font-mono text-primary-300">{student.id}</td>
                                                        <td className="p-3 font-bold text-white">{student.name}</td>
                                                        <td className="p-3">{student.class_name}</td>
                                                        <td className="p-3 text-primary-300">{student.section}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="lg:w-80 space-y-4">
                    <div id="add-school-class" className="h-fit rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-6 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-400)_/_0.55)] backdrop-blur-xl">
                        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><Plus className="w-5 h-5" /> إضافة مرحلة دراسية</h3>
                        <form
                            className="space-y-4"
                            onSubmit={event => {
                                event.preventDefault();
                                if (canAddClass) handleAddClass();
                            }}
                        >
                            <label className="block space-y-2">
                                <span className="text-xs font-bold text-slate-400">اسم الصف</span>
                                <input type="text" placeholder="مثال: أول ثانوي" className="w-full input-glass p-3 rounded-xl" value={newClass.name} onChange={e => setNewClass({ ...newClass, name: e.target.value })} />
                            </label>
                            <label className="block space-y-2">
                                <span className="text-xs font-bold text-slate-400">الشُعب</span>
                                <input type="text" placeholder="مثال: أ، ب، ج، د" className="w-full input-glass p-3 rounded-xl" value={newClass.sections} onChange={e => setNewClass({ ...newClass, sections: e.target.value })} />
                            </label>
                            <div className="min-h-8">
                                {parsedNewSections.length > 0 ? (
                                    <div className="flex flex-wrap gap-2" aria-label="معاينة الشعب">
                                        {parsedNewSections.map(section => (
                                            <span key={section} className="rounded-lg border border-primary-400/20 bg-primary-400/10 px-2.5 py-1 text-xs font-bold text-primary-100">
                                                فصل {section}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs leading-6 text-slate-500">أضف شعبة واحدة على الأقل، وافصل بينها بفاصلة.</p>
                                )}
                            </div>
                            <button
                                type="submit"
                                disabled={!canAddClass}
                                className="w-full rounded-xl bg-primary-300 py-3 font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                            >
                                {classLoading ? 'جارٍ الحفظ...' : 'إضافة للهيكل'}
                            </button>
                        </form>
                    </div>

                    <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-4 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.45)] backdrop-blur-xl space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-white font-bold">الهيكل الحالي</h4>
                            <span className="text-xs text-gray-400">{classes.length} مرحلة</span>
                        </div>
                        <div className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                            {classes.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-center text-sm leading-6 text-slate-500">
                                    سيظهر هنا كل صف تضيفه مع شُعبه.
                                </div>
                            ) : classes.map(cls => (
                                <div key={cls.id} className="p-3 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <div className="text-white font-bold">{cls.name}</div>
                                            <div className="text-xs text-gray-400">{cls.sections.length} فصول</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleEditSections(cls)}
                                                className="p-2 text-primary-400 hover:bg-primary-500/10 rounded-lg transition-colors"
                                                title="تعديل الفصول"
                                            >
                                                <Edit3 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteClass(cls.id, cls.name)}
                                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                title="حذف الصف"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {cls.sections.map(sec => (
                                            <span key={sec} className="px-2 py-1 rounded-lg text-xs bg-primary-500/10 text-primary-200 border border-primary-500/30">
                                                فصل {sec}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminStructureTab;
