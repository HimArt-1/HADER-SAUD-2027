// ═══════════════════════════════════════════════════════════════
// AdminCalendarTab - التقويم الدراسي وإدارة العطل
// ═══════════════════════════════════════════════════════════════
import React, { useState, useMemo, useCallback } from 'react';
import { Calendar, Plus, Trash2, X, ChevronLeft, ChevronRight, Loader2, CalendarDays, CalendarCheck, ListChecks, Sparkles } from 'lucide-react';
import { AcademicHoliday, AcademicHolidayType } from '../../types';
import {
    formatDateKey,
    getDateRange,
    getDateRangeLength,
    HOLIDAY_TYPES
} from '../../services/academicCalendarService';

// ═══════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════
export interface AdminCalendarTabProps {
    holidays: AcademicHoliday[];
    workDays: number[];
    saving: boolean;
    onSaveHolidays: (holidays: AcademicHoliday[]) => Promise<boolean>;
    showToast: (message: string, type: string) => void;
}

// ═══════════════════════════════════════════════════════════════
// Arabic Helpers
// ═══════════════════════════════════════════════════════════════
const AR_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];
const AR_DAYS_SHORT = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمس', 'جمع', 'سبت'];
const MAX_HOLIDAY_RANGE_DAYS = 180;

const HOLIDAY_TYPE_OPTIONS: { value: AcademicHolidayType; label: string; emoji: string; color: string }[] = [
    { value: 'midterm', label: 'عطلة نصف العام', emoji: '🟠', color: 'orange' },
    { value: 'extended', label: 'عطلة مطوّلة', emoji: '🔵', color: 'blue' },
    { value: 'national', label: 'عطلة وطنية', emoji: '🟢', color: 'green' },
    { value: 'exceptional', label: 'عطلة استثنائية', emoji: '🔴', color: 'red' },
];

// Color maps for styling
const TYPE_COLORS: Record<AcademicHolidayType, { bg: string; border: string; text: string; dot: string }> = {
    midterm: { bg: 'bg-orange-500/20', border: 'border-orange-500/40', text: 'text-orange-300', dot: 'bg-orange-400' },
    extended: { bg: 'bg-secondary-500/20', border: 'border-secondary-500/40', text: 'text-secondary-300', dot: 'bg-secondary-400' },
    national: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-300', dot: 'bg-emerald-400' },
    exceptional: { bg: 'bg-red-500/20', border: 'border-red-500/40', text: 'text-red-300', dot: 'bg-red-400' },
};

// ═══════════════════════════════════════════════════════════════
// Month Grid Component
// ═══════════════════════════════════════════════════════════════
interface MonthGridProps {
    year: number;
    month: number; // 0-indexed
    holidays: AcademicHoliday[];
    workDays: number[];
    onDayClick: (date: string) => void;
    selectedDates: Set<string>;
}

const MonthGrid: React.FC<MonthGridProps> = React.memo(({ year, month, holidays, workDays, onDayClick, selectedDates }) => {
    const holidayMap = useMemo(() => {
        const map = new Map<string, AcademicHoliday>();
        holidays.forEach(h => map.set(h.date, h));
        return map;
    }, [holidays]);

    const days = useMemo(() => {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDayOfWeek = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        const cells: (null | { day: number; dateKey: string; isToday: boolean })[] = [];

        // Empty cells before first day
        for (let i = 0; i < startDayOfWeek; i++) {
            cells.push(null);
        }

        const today = formatDateKey(new Date());

        for (let d = 1; d <= daysInMonth; d++) {
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            cells.push({ day: d, dateKey, isToday: dateKey === today });
        }

        return cells;
    }, [year, month]);

    return (
        <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4 shadow-[0_16px_45px_-40px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-xl transition-all hover:border-primary-300/20">
            <h4 className="text-center text-sm font-bold text-white mb-3">{AR_MONTHS[month]} {year}</h4>
            <div className="grid grid-cols-7 gap-px mb-1">
                {AR_DAYS_SHORT.map(d => (
                    <div key={d} className="text-center text-[9px] text-gray-500 font-medium py-1">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
                {days.map((cell, i) => {
                    if (!cell) {
                        return <div key={`empty-${i}`} className="h-8" />;
                    }

                    const holiday = holidayMap.get(cell.dateKey);
                    const isWeeklyOff = !workDays.includes(new Date(cell.dateKey + 'T00:00:00').getDay());
                    const isSelected = selectedDates.has(cell.dateKey);
                    const isHoliday = !!holiday;

                    let cellClass = 'h-8 w-full rounded-lg text-[11px] font-medium flex items-center justify-center cursor-pointer transition-all duration-200 relative ';

                    if (isSelected) {
                        cellClass += 'bg-primary-500/30 border border-primary-400/60 text-white ring-2 ring-primary-400/30 scale-105 ';
                    } else if (isHoliday) {
                        const tc = TYPE_COLORS[holiday.type];
                        cellClass += `${tc.bg} ${tc.border} ${tc.text} border `;
                    } else if (isWeeklyOff) {
                        cellClass += 'bg-white/5 text-gray-500 ';
                    } else {
                        cellClass += 'hover:bg-white/10 text-gray-300 hover:text-white ';
                    }

                    if (cell.isToday) {
                        cellClass += 'ring-2 ring-primary-500/50 ';
                    }

                    return (
                        <button
                            key={cell.dateKey}
                            onClick={() => onDayClick(cell.dateKey)}
                            className={cellClass}
                            aria-label={holiday ? `${cell.dateKey}: ${holiday.label}` : cell.dateKey}
                            aria-pressed={isSelected}
                            title={holiday ? `${HOLIDAY_TYPES[holiday.type].emoji} ${holiday.label}` : isWeeklyOff ? 'عطلة أسبوعية' : ''}
                        >
                            {cell.day}
                            {isHoliday && (
                                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${TYPE_COLORS[holiday.type].dot}`} />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
});
MonthGrid.displayName = 'MonthGrid';

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
const AdminCalendarTab: React.FC<AdminCalendarTabProps> = ({
    holidays,
    workDays,
    saving,
    onSaveHolidays,
    showToast
}) => {
    const now = new Date();
    const [displayYear, setDisplayYear] = useState(now.getFullYear());
    const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

    // Add holiday modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [addMode, setAddMode] = useState<'single' | 'range' | 'selection'>('single');
    const [addDate, setAddDate] = useState('');
    const [addDateFrom, setAddDateFrom] = useState('');
    const [addDateTo, setAddDateTo] = useState('');
    const [addLabel, setAddLabel] = useState('');
    const [addType, setAddType] = useState<AcademicHolidayType>('exceptional');
    const [selectedDraftDates, setSelectedDraftDates] = useState<string[]>([]);
    const [deleteDates, setDeleteDates] = useState<string[]>([]);

    // Stats
    const stats = useMemo(() => {
        const byType: Record<AcademicHolidayType, number> = { midterm: 0, extended: 0, national: 0, exceptional: 0 };
        const thisYear = holidays.filter(h => h.date.startsWith(String(displayYear)));
        thisYear.forEach(h => { byType[h.type] = (byType[h.type] || 0) + 1; });
        return { total: thisYear.length, byType };
    }, [holidays, displayYear]);

    // Holiday lookup for quick access
    const holidaysByDate = useMemo(() => {
        const map = new Map<string, AcademicHoliday>();
        holidays.forEach(h => map.set(h.date, h));
        return map;
    }, [holidays]);

    // Handle day click: toggle selection or show info
    const handleDayClick = useCallback((dateKey: string) => {
        // If the date has an existing holiday, select it for potential deletion
        setSelectedDates(prev => {
            const next = new Set(prev);
            if (next.has(dateKey)) {
                next.delete(dateKey);
            } else {
                next.add(dateKey);
            }
            return next;
        });
    }, []);

    const rangeLength = useMemo(
        () => addMode === 'range' ? getDateRangeLength(addDateFrom, addDateTo) : 0,
        [addMode, addDateFrom, addDateTo]
    );

    const addValidationError = useMemo(() => {
        if (!addLabel.trim()) return 'اكتب اسم العطلة.';
        if (addLabel.trim().length > 80) return 'اسم العطلة يجب ألا يتجاوز 80 حرفًا.';
        if (addMode === 'single' && !addDate) return 'حدد تاريخ العطلة.';
        if (addMode === 'selection' && selectedDraftDates.length === 0) return 'لا توجد أيام محددة.';
        if (addMode === 'range') {
            if (!addDateFrom || !addDateTo) return 'حدد بداية النطاق ونهايته.';
            if (addDateFrom > addDateTo) return 'تاريخ البداية يجب أن يسبق تاريخ النهاية.';
            if (rangeLength === 0) return 'نطاق التواريخ غير صالح.';
            if (rangeLength > MAX_HOLIDAY_RANGE_DAYS) return `الحد الأقصى للنطاق هو ${MAX_HOLIDAY_RANGE_DAYS} يومًا.`;
        }
        return null;
    }, [addDate, addDateFrom, addDateTo, addLabel, addMode, rangeLength, selectedDraftDates.length]);

    const resetAddForm = useCallback(() => {
        setShowAddModal(false);
        setAddMode('single');
        setAddDate('');
        setAddDateFrom('');
        setAddDateTo('');
        setAddLabel('');
        setAddType('exceptional');
        setSelectedDraftDates([]);
    }, []);

    // Add holidays
    const handleAddHolidays = useCallback(async () => {
        let datesToAdd: string[] = [];

        if (addValidationError) {
            showToast(addValidationError, 'error');
            return;
        }

        if (addMode === 'single') {
            datesToAdd = [addDate];
        } else if (addMode === 'range') {
            datesToAdd = getDateRange(addDateFrom, addDateTo);
        } else {
            datesToAdd = selectedDraftDates;
        }

        // Merge with existing, avoiding duplicates
        const existingDates = new Set(holidays.map(h => h.date));
        const newHolidays: AcademicHoliday[] = datesToAdd
            .filter(d => !existingDates.has(d))
            .map(d => ({ date: d, label: addLabel.trim(), type: addType }));

        if (newHolidays.length === 0) {
            showToast('جميع التواريخ المحددة مسجلة بالفعل كعطلة', 'warning');
            return;
        }

        const merged = [...holidays, ...newHolidays].sort((a, b) => a.date.localeCompare(b.date));
        const saved = await onSaveHolidays(merged);
        if (!saved) return;

        resetAddForm();
        setSelectedDates(new Set());
        showToast(`تمت إضافة ${newHolidays.length} يوم عطلة بنجاح`, 'success');
    }, [addDate, addDateFrom, addDateTo, addLabel, addMode, addType, addValidationError, holidays, onSaveHolidays, resetAddForm, selectedDraftDates, showToast]);

    // Add selected days as holidays
    const handleAddSelectedAsHoliday = useCallback(() => {
        if (selectedDates.size === 0) return;
        // Pre-fill the range or single date
        const sorted = [...selectedDates].sort();
        if (sorted.length === 1) {
            setAddMode('single');
            setAddDate(sorted[0]);
        } else {
            setAddMode('selection');
            setSelectedDraftDates(sorted);
        }
        setShowAddModal(true);
    }, [selectedDates]);

    const handleConfirmDelete = useCallback(async () => {
        const toDelete = new Set(deleteDates);
        const filtered = holidays.filter(h => !toDelete.has(h.date));
        const deletedCount = holidays.length - filtered.length;
        if (deletedCount === 0) {
            setDeleteDates([]);
            return;
        }
        const saved = await onSaveHolidays(filtered);
        if (!saved) return;

        setSelectedDates(new Set());
        setDeleteDates([]);
        showToast(`تم حذف ${deletedCount} عطلة`, 'success');
    }, [deleteDates, holidays, onSaveHolidays, showToast]);

    // How many selected are existing holidays?
    const selectedExistingCount = useMemo(() => {
        let count = 0;
        selectedDates.forEach(d => { if (holidaysByDate.has(d)) count++; });
        return count;
    }, [selectedDates, holidaysByDate]);

    const selectedNewCount = selectedDates.size - selectedExistingCount;
    const selectedSummary = selectedDates.size > 0
        ? `${selectedDates.size} يوم محدد`
        : 'لا يوجد تحديد';
    const calendarSummaryCards = [
        { label: 'إجمالي العطل', value: stats.total, hint: `لسنة ${displayYear}`, icon: CalendarCheck, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'أيام العمل', value: workDays.length, hint: 'أيام الدوام الأسبوعي', icon: ListChecks, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' },
        { label: 'التحديد الحالي', value: selectedDates.size, hint: selectedSummary, icon: Sparkles, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' },
        { label: 'السنة المعروضة', value: displayYear, hint: 'تقويم كامل 12 شهر', icon: CalendarDays, className: 'border-secondary-500/20 bg-secondary-500/[0.07] text-secondary-100' }
    ];

    // Clear selection
    const clearSelection = useCallback(() => setSelectedDates(new Set()), []);

    return (
        <div className="animate-fade-in space-y-6">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <CalendarDays className="h-4 w-4" />
                            رزنامة العام الدراسي
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">التقويم الدراسي</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            تحديد العطل الرسمية والاستثنائية وربطها بسلوك الحضور الآلي خلال السنة الدراسية.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        {calendarSummaryCards.map(card => (
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

                <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap gap-2">
                        {HOLIDAY_TYPE_OPTIONS.map(opt => (
                            <span key={opt.value} className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${TYPE_COLORS[opt.value].bg} ${TYPE_COLORS[opt.value].border} ${TYPE_COLORS[opt.value].text}`}>
                                {opt.label}: {stats.byType[opt.value]}
                            </span>
                        ))}
                    </div>
                    <div className="flex items-center gap-3">
                        {saving && <span className="text-xs text-secondary-400 animate-pulse flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> جاري الحفظ...</span>}
                        <button
                            onClick={() => { setShowAddModal(true); setAddMode('single'); setSelectedDraftDates([]); }}
                            disabled={saving}
                            className="flex items-center gap-2 rounded-xl bg-primary-300 px-5 py-2.5 text-sm font-black text-slate-950 shadow-[0_16px_35px_-24px_rgb(var(--color-primary-400)_/_0.9)] transition hover:bg-primary-200 active:scale-[0.99]"
                        >
                            <Plus className="w-4 h-4" /> إضافة عطلة
                        </button>
                    </div>
                </div>
            </section>

            {/* ═══ Year Navigation ═══ */}
            <div className="flex items-center justify-between">
                <button
                    onClick={() => setDisplayYear(y => y - 1)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-gray-300 hover:bg-white/10 hover:text-white transition-all text-sm"
                >
                    <ChevronRight className="w-4 h-4" /> السنة السابقة
                </button>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary-400" />
                    {displayYear}
                </h3>
                <button
                    onClick={() => setDisplayYear(y => y + 1)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-gray-300 hover:bg-white/10 hover:text-white transition-all text-sm"
                >
                    السنة التالية <ChevronLeft className="w-4 h-4" />
                </button>
            </div>

            {/* ═══ Selection Actions Bar ═══ */}
            {selectedDates.size > 0 && (
                <div className="bg-primary-500/10 border border-primary-500/30 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-primary-300 font-bold">
                            محدد: {selectedDates.size} يوم
                        </span>
                        {selectedExistingCount > 0 && (
                            <span className="text-xs text-orange-300 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-lg">
                                {selectedExistingCount} عطلة موجودة
                            </span>
                        )}
                        {selectedNewCount > 0 && (
                            <span className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-lg">
                                {selectedNewCount} يوم جديد
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedNewCount > 0 && (
                            <button
                                onClick={handleAddSelectedAsHoliday}
                                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-xl text-xs font-bold transition-all hover:scale-105"
                            >
                                <Plus className="w-3.5 h-3.5" /> إضافة كعطلة
                            </button>
                        )}
                        {selectedExistingCount > 0 && (
                            <button
                                onClick={() => setDeleteDates([...selectedDates].filter(date => holidaysByDate.has(date)))}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 text-white rounded-xl text-xs font-bold transition-all hover:scale-105"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> حذف العطل
                            </button>
                        )}
                        <button
                            onClick={clearSelection}
                            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 text-gray-300 rounded-xl text-xs hover:bg-white/10 transition-all"
                        >
                            <X className="w-3.5 h-3.5" /> إلغاء
                        </button>
                    </div>
                </div>
            )}

            {/* ═══ Calendar Grid (12 months) ═══ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 12 }, (_, m) => (
                    <MonthGrid
                        key={`${displayYear}-${m}`}
                        year={displayYear}
                        month={m}
                        holidays={holidays}
                        workDays={workDays}
                        onDayClick={handleDayClick}
                        selectedDates={selectedDates}
                    />
                ))}
            </div>

            {/* ═══ Legend ═══ */}
            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-4 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-xl">
                <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-primary-300" /> دليل الألوان
                </h4>
                <div className="flex flex-wrap gap-4 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded bg-white/10 border border-white/20" />
                        <span className="text-gray-400">عطلة أسبوعية</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded border-2 border-primary-500/50 bg-primary-500/20" />
                        <span className="text-gray-400">اليوم</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded bg-primary-500/30 border border-primary-400/60" />
                        <span className="text-gray-400">محدد</span>
                    </div>
                    {HOLIDAY_TYPE_OPTIONS.map(opt => (
                        <div key={opt.value} className="flex items-center gap-2">
                            <span className={`w-4 h-4 rounded ${TYPE_COLORS[opt.value].bg} border ${TYPE_COLORS[opt.value].border}`} />
                            <span className="text-gray-400">{opt.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ═══ Holiday List ═══ */}
            {holidays.filter(h => h.date.startsWith(String(displayYear))).length > 0 && (
                <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-5 shadow-[0_18px_65px_-55px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-xl">
                    <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                        <CalendarCheck className="h-4 w-4 text-primary-300" /> قائمة العطل لسنة {displayYear}
                    </h4>
                    <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
                        {holidays
                            .filter(h => h.date.startsWith(String(displayYear)))
                            .sort((a, b) => a.date.localeCompare(b.date))
                            .map(h => {
                                const tc = TYPE_COLORS[h.type];
                                const d = new Date(h.date + 'T00:00:00');
                                const dayName = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][d.getDay()];
                                return (
                                    <div key={h.date} className={`flex items-center justify-between p-3 rounded-xl ${tc.bg} border ${tc.border} group`}>
                                        <div className="flex items-center gap-3">
                                            <span className={`w-2 h-2 rounded-full ${tc.dot}`} />
                                            <div>
                                                <span className={`text-sm font-bold ${tc.text}`}>{h.label}</span>
                                                <span className="text-xs text-gray-400 mr-3">{dayName} • {h.date}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-500">{HOLIDAY_TYPES[h.type].label}</span>
                                            <button
                                                onClick={() => setDeleteDates([h.date])}
                                                disabled={saving}
                                                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-1.5 hover:bg-red-500/20 rounded-lg text-red-400 transition-all"
                                                title="حذف"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}

            {/* ═══ Add Holiday Modal ═══ */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="glass-card w-full max-w-lg rounded-3xl p-6 border border-primary-500/30 animate-fade-in-up relative">
                        <button onClick={resetAddForm} disabled={saving} className="absolute left-4 top-4 text-gray-400 hover:text-white disabled:opacity-40">
                            <X className="w-5 h-5" />
                        </button>

                        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-primary-400" />
                            إضافة عطلة جديدة
                        </h3>

                        {/* Mode Toggle */}
                        <div className="flex gap-2 mb-5">
                            <button
                                onClick={() => { setAddMode('single'); setSelectedDraftDates([]); }}
                                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${addMode === 'single'
                                        ? 'bg-primary-500/20 border border-primary-500/40 text-primary-300'
                                        : 'bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10'
                                    }`}
                            >
                                يوم واحد
                            </button>
                            <button
                                onClick={() => { setAddMode('range'); setSelectedDraftDates([]); }}
                                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${addMode === 'range'
                                        ? 'bg-primary-500/20 border border-primary-500/40 text-primary-300'
                                        : 'bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10'
                                    }`}
                            >
                                نطاق تواريخ
                            </button>
                        </div>

                        {/* Date Input */}
                        {addMode === 'single' ? (
                            <div className="mb-4">
                                <label className="block text-xs text-gray-400 mb-1.5">التاريخ</label>
                                <input
                                    type="date"
                                    value={addDate}
                                    onChange={e => setAddDate(e.target.value)}
                                    className="w-full input-glass p-3 rounded-xl text-sm"
                                />
                            </div>
                        ) : addMode === 'range' ? (
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1.5">من تاريخ</label>
                                    <input
                                        type="date"
                                        value={addDateFrom}
                                        onChange={e => setAddDateFrom(e.target.value)}
                                        className="w-full input-glass p-3 rounded-xl text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1.5">إلى تاريخ</label>
                                    <input
                                        type="date"
                                        value={addDateTo}
                                        onChange={e => setAddDateTo(e.target.value)}
                                        className="w-full input-glass p-3 rounded-xl text-sm"
                                    />
                                </div>
                                {rangeLength > 0 && rangeLength <= MAX_HOLIDAY_RANGE_DAYS && (
                                    <div className="col-span-2 text-xs text-primary-300 bg-primary-500/10 border border-primary-500/20 rounded-lg px-3 py-2">
                                        سيتم إضافة {rangeLength} يومًا
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="mb-4 rounded-xl border border-primary-500/25 bg-primary-500/10 px-4 py-3 text-sm text-primary-100">
                                سيتم تسجيل الأيام المحددة فقط: <strong>{selectedDraftDates.length} يومًا</strong>، دون ملء الأيام الواقعة بينها.
                            </div>
                        )}

                        {/* Label */}
                        <div className="mb-4">
                            <label className="block text-xs text-gray-400 mb-1.5">اسم العطلة</label>
                            <input
                                type="text"
                                value={addLabel}
                                onChange={e => setAddLabel(e.target.value)}
                                maxLength={80}
                                placeholder="مثال: إجازة نصف العام الدراسي"
                                className="w-full input-glass p-3 rounded-xl text-sm"
                            />
                        </div>

                        {/* Type */}
                        <div className="mb-6">
                            <label className="block text-xs text-gray-400 mb-2">نوع العطلة</label>
                            <div className="grid grid-cols-2 gap-2">
                                {HOLIDAY_TYPE_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setAddType(opt.value)}
                                        className={`flex items-center gap-2 p-3 rounded-xl border text-sm transition-all ${addType === opt.value
                                                ? `${TYPE_COLORS[opt.value].bg} ${TYPE_COLORS[opt.value].border} ${TYPE_COLORS[opt.value].text} font-bold`
                                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                            }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {addValidationError && (
                            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                <CalendarDays className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                {addValidationError}
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            onClick={handleAddHolidays}
                            disabled={saving || Boolean(addValidationError)}
                            className="w-full py-3 bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-500 hover:to-secondary-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin inline ml-2" /> : null}
                            حفظ العطلة
                        </button>
                    </div>
                </div>
            )}

            {deleteDates.length > 0 && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-3xl border border-red-500/30 bg-slate-950 p-6 shadow-2xl">
                        <div className="mb-4 flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/15">
                                <Trash2 className="h-6 w-6 text-red-300" />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-white">تأكيد حذف العطل</h3>
                                <p className="mt-1 text-xs text-slate-400">سيؤثر الحذف فورًا على الكشك والتقارير.</p>
                            </div>
                        </div>
                        <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                            هل تريد حذف {deleteDates.length} {deleteDates.length === 1 ? 'عطلة' : 'عطلات'}؟
                        </p>
                        <div className="mt-5 grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setDeleteDates([])}
                                disabled={saving}
                                className="rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
                            >
                                إلغاء
                            </button>
                            <button
                                onClick={handleConfirmDelete}
                                disabled={saving}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                تأكيد الحذف
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminCalendarTab;
