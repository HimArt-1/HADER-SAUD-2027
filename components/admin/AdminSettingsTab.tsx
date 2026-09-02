// ═══════════════════════════════════════════════════════════════
// AdminSettingsTab - Attendance mode, work days, student ID settings
// ═══════════════════════════════════════════════════════════════
import React, { useState, useRef, useEffect } from 'react';
import { AcademicHoliday, Student, StudentIdSettings, KioskSettings, ATTENDANCE_DEFAULTS } from '../../types';
import { Hash, Edit3, Loader2, Clock, AlertTriangle, Zap, CheckCircle, ArrowRight, RefreshCw, CalendarDays, Settings2, Fingerprint, Save } from 'lucide-react';
import { db, getLocalISODate } from '../../services/db';
import { appSettings } from '../../services/settings';
import { isDateHoliday } from '../../services/academicCalendarService';
import { logError } from '../../types/errors';
import {
    AttendanceSettingsDraft,
    validateAttendanceTiming,
    validateWorkDays
} from './attendanceSettingsRules';

export interface AdminSettingsTabProps {
    // Attendance settings
    attendanceSettings: AttendanceSettingsDraft;
    setAttendanceSettings: React.Dispatch<React.SetStateAction<AttendanceSettingsDraft>>;
    attendanceSettingsSaving: boolean;
    saveAttendanceSettingsToCloud: (settings: AttendanceSettingsDraft) => Promise<boolean>;
    academicHolidays: AcademicHoliday[];
    showToast: (message: string, type: string) => void;

    // Student ID settings
    studentIdSettings: StudentIdSettings;
    setStudentIdSettings: React.Dispatch<React.SetStateAction<StudentIdSettings>>;
    studentIdSettingsSaving: boolean;
    studentIdPolicy: { charset: string; length?: number; prefix?: string };
    studentIdPolicyHint: string;
    handleSaveStudentIdSettings: () => void;

    // ID Rename
    allowStudentIdEdit: boolean;
    settingsRenameQuery: string;
    setSettingsRenameQuery: (val: string) => void;
    settingsRenameTargetId: string;
    setSettingsRenameTargetId: (val: string) => void;
    settingsRenameNewId: string;
    setSettingsRenameNewId: (val: string) => void;
    settingsRenameError: string | null;
    setSettingsRenameError: (val: string | null) => void;
    settingsRenameCandidates: Student[];
    settingsRenameTarget: Student | undefined;
    requestStudentIdRename: (target: Student, newId: string, setError: (e: string | null) => void) => void;

    // Kiosk settings for timing
    kiosk_settings: KioskSettings;
    setKioskSettings: React.Dispatch<React.SetStateAction<KioskSettings>>;
    fetchKioskSettings: () => Promise<void>;
}

const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
    attendanceSettings, setAttendanceSettings, attendanceSettingsSaving,
    saveAttendanceSettingsToCloud, academicHolidays, showToast,
    studentIdSettings, setStudentIdSettings, studentIdSettingsSaving,
    studentIdPolicy, studentIdPolicyHint, handleSaveStudentIdSettings,
    allowStudentIdEdit, settingsRenameQuery, setSettingsRenameQuery,
    settingsRenameTargetId, setSettingsRenameTargetId,
    settingsRenameNewId, setSettingsRenameNewId,
    settingsRenameError, setSettingsRenameError,
    settingsRenameCandidates, settingsRenameTarget, requestStudentIdRename,
    kiosk_settings, setKioskSettings, fetchKioskSettings
}) => {
    // --- Timing & Recalculation Logic ---
    const [showRecalcModal, setShowRecalcModal] = useState(false);
    const [recalcSaving, setRecalcSaving] = useState(false);
    const [timingSaving, setTimingSaving] = useState(false);
    const [recalcResult, setRecalcResult] = useState<{
        total: number;
        updated: number;
        presentToLate: number;
        lateToPresent: number;
        toAbsent: number;
        fromAbsent: number;
    } | null>(null);
    const [recalcNewTime, setRecalcNewTime] = useState<{ assembly_time: string; grace_period: number; absence_time: string }>({
        assembly_time: kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
        grace_period: kiosk_settings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD,
        absence_time: kiosk_settings.absence_time || '09:00'
    });

    const savedTimingRef = useRef({
        assembly_time: kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
        grace_period: kiosk_settings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD,
        absence_time: kiosk_settings.absence_time || ATTENDANCE_DEFAULTS.ABSENCE_TIME
    });

    // Sync ref when kiosk_settings are fetched
    useEffect(() => {
        savedTimingRef.current = {
            assembly_time: kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
            grace_period: kiosk_settings.grace_period ?? 15,
            absence_time: kiosk_settings.absence_time || ATTENDANCE_DEFAULTS.ABSENCE_TIME
        };
    }, [kiosk_settings.assembly_time, kiosk_settings.grace_period, kiosk_settings.absence_time]);

    const doSaveKioskSettings = async (updatedSettings: KioskSettings): Promise<boolean> => {
        setTimingSaving(true);
        try {
            await appSettings.execute({
                type: 'patch',
                changes: {
                    kiosk_settings: updatedSettings,
                    assembly_time: updatedSettings.assembly_time,
                    grace_period: updatedSettings.grace_period,
                    absence_time: updatedSettings.absence_time
                }
            });
            
            savedTimingRef.current = {
                assembly_time: updatedSettings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
                grace_period: updatedSettings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD,
                absence_time: updatedSettings.absence_time || ATTENDANCE_DEFAULTS.ABSENCE_TIME
            };
            
            try {
                await fetchKioskSettings();
            } catch (refreshError) {
                logError(refreshError, 'AdminSettings - Refresh Timing After Save');
            }
            showToast('تم حفظ إعدادات التوقيت بنجاح', 'success');
            return true;
        } catch (e) {
            logError(e, 'AdminSettings - Save Timing');
            showToast('فشل في حفظ إعدادات التوقيت', 'error');
            return false;
        } finally {
            setTimingSaving(false);
        }
    };

    const handleSaveTimingSettings = async () => {
        const oldTime = savedTimingRef.current.assembly_time;
        const oldGrace = savedTimingRef.current.grace_period;
        const oldAbsence = savedTimingRef.current.absence_time;
        const newTime = kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME;
        const newGrace = kiosk_settings.grace_period ?? 15;
        const newAbsence = kiosk_settings.absence_time || ATTENDANCE_DEFAULTS.ABSENCE_TIME;
        const validation = validateAttendanceTiming({
            assembly_time: newTime,
            grace_period: newGrace,
            absence_time: newAbsence
        });
        if (validation.error) {
            showToast(validation.error, 'error');
            return;
        }

        if ((oldTime !== newTime || oldGrace !== newGrace || oldAbsence !== newAbsence) && !isTodayHoliday) {
            setRecalcNewTime({ assembly_time: newTime, grace_period: newGrace, absence_time: newAbsence });
            setRecalcResult(null);
            setShowRecalcModal(true);
            return;
        }

        await doSaveKioskSettings(kiosk_settings);
    };

    const handleSaveWithRecalc = async () => {
        setRecalcSaving(true);
        try {
            const saved = await doSaveKioskSettings(kiosk_settings);
            if (!saved) return;
            const result = await db.recalculateTodayAttendance(
                recalcNewTime.assembly_time,
                recalcNewTime.grace_period,
                recalcNewTime.absence_time
            );
            setRecalcResult(result);
            if (result.updated > 0) {
                showToast(`تم تحديث ${result.updated} سجل حضور`, 'success');
            }
        } catch (e) {
            logError(e, 'AdminSettings - Recalculate');
            showToast('تم حفظ التوقيت، لكن تعذرت إعادة احتساب سجلات اليوم', 'error');
        } finally {
            setRecalcSaving(false);
        }
    };

    const handleSaveWithoutRecalc = async () => {
        const saved = await doSaveKioskSettings(kiosk_settings);
        if (saved) setShowRecalcModal(false);
    };

    const workDays = attendanceSettings.work_days ?? [0, 1, 2, 3, 4];
    const timingValidation = validateAttendanceTiming({
        assembly_time: kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
        grace_period: kiosk_settings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD,
        absence_time: kiosk_settings.absence_time || ATTENDANCE_DEFAULTS.ABSENCE_TIME
    });
    const lateCutoffTime = timingValidation.lateCutoffTime ?? '—';
    const isTodayHoliday = isDateHoliday(getLocalISODate(), workDays, academicHolidays);

    const handleSaveAttendanceSettings = async () => {
        const workDaysError = validateWorkDays(workDays);
        if (workDaysError) {
            showToast(workDaysError, 'error');
            return;
        }
        await saveAttendanceSettingsToCloud({ ...attendanceSettings, work_days: workDays });
    };
    const modeMeta = attendanceSettings.mode === 'hybrid'
        ? { label: 'الكشك الذكي', detail: 'الكشك والمشرفان يعملون معًا', icon: Zap, className: 'border-primary-500/25 bg-primary-500/[0.08] text-primary-100' }
        : { label: 'التحضير اليدوي', detail: 'القوائم اليدوية هي المصدر الأساسي', icon: Edit3, className: 'border-secondary-500/25 bg-secondary-500/[0.08] text-secondary-100' };
    const settingsSummaryCards = [
        { label: 'وضع التحضير', value: modeMeta.label, hint: modeMeta.detail, icon: modeMeta.icon, className: modeMeta.className },
        { label: 'أيام العمل', value: `${workDays.length} أيام`, hint: 'الأيام التي يعمل فيها النظام', icon: CalendarDays, className: 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-100' },
        { label: 'حد التأخير', value: lateCutoffTime, hint: 'وقت بدء احتساب التأخير', icon: Clock, className: 'border-amber-500/25 bg-amber-500/[0.08] text-amber-100' },
        { label: 'سياسة المعرف', value: studentIdPolicy.charset === 'numeric' ? 'رقمية' : 'حروف وأرقام', hint: studentIdPolicyHint, icon: Fingerprint, className: 'border-sky-500/25 bg-sky-500/[0.08] text-sky-100' }
    ];

    return (
        <div className="animate-fade-in min-w-0 max-w-full space-y-6">
            <section className="relative max-w-full overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/65 p-4 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl sm:p-5 md:rounded-[1.75rem]">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <Settings2 className="h-4 w-4" />
                            مركز الضبط التشغيلي
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">إعدادات النظام</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            ضبط الحضور والتوقيت وسياسة معرفات الطلاب من مساحة واحدة دون تغيير مسارات الحفظ.
                        </p>
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:min-w-[620px]">
                        {settingsSummaryCards.map(card => (
                            <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <card.icon className="h-4 w-4 opacity-80" />
                                    <span className="text-[11px] font-semibold text-slate-400">{card.label}</span>
                                </div>
                                <div className="mt-3 truncate font-mono text-xl font-black">{card.value}</div>
                                <div className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Hybrid Mode Settings */}
            <div className="max-w-full rounded-[1.5rem] border border-primary-500/15 bg-slate-950/55 p-4 shadow-[0_20px_70px_-55px_rgb(var(--color-primary-500)_/_0.6)] backdrop-blur-xl sm:p-6 md:rounded-[1.75rem]">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
                    <div>
                        <h3 className="text-2xl font-black text-white">
                            إعدادات نظام التحضير
                        </h3>
                        <p className="text-sm text-gray-400 mt-2">
                            اختر نمط التحضير المناسب لليوم الدراسي (آلي أو يدوي)
                        </p>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-100">
                        <CheckCircle className="h-4 w-4" />
                        جاهز للتشغيل اليومي
                    </span>
                </div>

                <div className="space-y-6">
                    {/* Mode Selection */}
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-6">
                        <label className="text-sm font-bold text-white mb-4 block">وضع التحضير:</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className={`relative flex items-start gap-4 border-2 rounded-2xl p-5 cursor-pointer transition-all ${attendanceSettings.mode === 'traditional'
                                ? 'bg-white/10 border-secondary-400/50 shadow-[0_0_20px_rgb(var(--color-secondary-400)_/_0.2)]'
                                : 'bg-white/5 border-white/10 hover:bg-white/10 opacity-60 hover:opacity-100'
                                }`}>
                                <input
                                    type="radio"
                                    name="attendance-mode"
                                    value="traditional"
                                    checked={attendanceSettings.mode === 'traditional'}
                                    onChange={() => {
                                        const newSettings = { ...attendanceSettings, mode: 'traditional' as const };
                                        setAttendanceSettings(newSettings);
                                    }}
                                    disabled={attendanceSettingsSaving}
                                    className="mt-1 accent-secondary-400 w-5 h-5"
                                />
                                <div className="flex-1">
                                    <div className="text-base font-bold text-secondary-100 mb-1">التحضير اليدوي (Manual)</div>
                                    <div className="text-xs text-gray-400 leading-relaxed">
                                        يقوم المشرفون بتسجيل الحضور يدوياً عبر القوائم.
                                        <br />
                                        <span className="text-secondary-400/60 text-[10px]">(الكشك يكون غير مفعل أو ثانوي)</span>
                                    </div>
                                </div>
                            </label>

                            <label className={`relative flex items-start gap-4 border-2 rounded-2xl p-5 cursor-pointer transition-all ${attendanceSettings.mode === 'hybrid'
                                ? 'bg-gradient-to-br from-primary-500/20 to-secondary-500/20 border-primary-400/50 shadow-[0_0_20px_rgb(var(--color-primary-500)_/_0.2)]'
                                : 'bg-gradient-to-br from-primary-500/5 to-secondary-500/5 border-white/10 hover:from-primary-500/10 hover:to-secondary-500/10 opacity-60 hover:opacity-100'
                                }`}>
                                <input
                                    type="radio"
                                    name="attendance-mode"
                                    value="hybrid"
                                    checked={attendanceSettings.mode === 'hybrid'}
                                    onChange={() => {
                                        const newSettings = { ...attendanceSettings, mode: 'hybrid' as const };
                                        setAttendanceSettings(newSettings);
                                    }}
                                    disabled={attendanceSettingsSaving}
                                    className="mt-1 accent-primary-400 w-5 h-5"
                                />
                                <div className="flex-1">
                                    <div className="text-base font-bold text-primary-400 mb-1 flex items-center gap-2">
                                        الكشك الذكي (Smart Kiosk)
                                        {attendanceSettings.mode === 'hybrid' && (
                                        <span className="text-xs px-2 py-0.5 bg-primary-500/30 rounded-full text-white animate-pulse">نشط</span>
                                        )}
                                    </div>
                                    <div className="text-xs text-primary-300/70 leading-relaxed">
                                        يعمل الكشك لاستقبال الطلاب، وتتحدث البيانات فورياً عند المشرف.
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Attendance Timing Settings */}
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-6 mt-4">
                        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                            <label className="text-sm font-bold text-white flex items-center gap-2">
                                <Clock className="w-4 h-4 text-amber-400" />
                                توقيت الحضور والتأخير
                            </label>
                            <button
                                onClick={handleSaveTimingSettings}
                                disabled={timingSaving || recalcSaving || Boolean(timingValidation.error)}
                                className="text-[10px] px-3 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 transition-all font-bold disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {timingSaving ? 'جاري الحفظ...' : 'حفظ التوقيت'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">وقت بدء الطابور</label>
                                <input
                                    type="time"
                                    className="w-full input-glass p-3 rounded-xl text-white font-mono"
                                    value={kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME}
                                    onChange={e => setKioskSettings({ ...kiosk_settings, assembly_time: e.target.value })}
                                />
                                <p className="text-[10px] text-gray-500 mt-1">وقت بدء الدوام الرسمي واحتساب التأخير.</p>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">مدة السماح (بالدقائق)</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full input-glass p-3 rounded-xl text-white pr-12"
                                        value={kiosk_settings.grace_period ?? 15}
                                        onChange={e => setKioskSettings({ ...kiosk_settings, grace_period: Number(e.target.value) })}
                                        min="0"
                                        max="120"
                                    />
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs text-gray-500">دقيقة</span>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">تضاف لموعد الطابور قبل اعتبار الطالب متأخراً.</p>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-2">وقت احتساب الغياب</label>
                                <input
                                    type="time"
                                    className="w-full input-glass p-3 rounded-xl text-white font-mono"
                                    value={kiosk_settings.absence_time || '09:00'}
                                    onChange={e => setKioskSettings({ ...kiosk_settings, absence_time: e.target.value })}
                                />
                                <p className="text-[10px] text-gray-500 mt-1">الوقت الذي يعتبر فيه الطالب غائباً آلياً.</p>
                            </div>
                        </div>
                        <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-center gap-3">
                            <Zap className="w-4 h-4 text-amber-400" />
                            <p className="text-xs text-amber-200/80">
                                سيُحتسب التأخير آلياً من الكشك بعد الساعة:
                                <strong className="font-mono mx-2 text-amber-400">
                                    {lateCutoffTime}
                                </strong>
                            </p>
                        </div>
                        {timingValidation.error && (
                            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                {timingValidation.error}
                            </div>
                        )}
                        {isTodayHoliday && (
                            <div className="mt-3 rounded-xl border border-secondary-500/20 bg-secondary-500/10 px-3 py-2 text-xs text-secondary-200">
                                اليوم عطلة حسب التقويم؛ سيُحفظ التوقيت للمستقبل دون إعادة احتساب سجلات اليوم.
                            </div>
                        )}
                    </div>

                    {/* Work Days Settings */}
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-6 mt-4 mb-6">
                        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                            <label className="text-sm font-bold text-white flex items-center gap-2">
                                <CalendarDays className="h-4 w-4 text-primary-300" /> أيام العمل (الدوام المدرسي)
                            </label>
                            <button
                                onClick={handleSaveAttendanceSettings}
                                disabled={attendanceSettingsSaving}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-secondary-500/30 bg-secondary-500/15 px-4 py-2 text-xs font-bold text-secondary-100 transition hover:bg-secondary-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {attendanceSettingsSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                {attendanceSettingsSaving ? 'جاري الحفظ...' : 'حفظ وضع التحضير والأيام'}
                            </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day, index) => {
                                const isSelected = (attendanceSettings.work_days ?? [0, 1, 2, 3, 4]).includes(index);
                                return (
                                    <label key={index} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${isSelected
                                        ? 'bg-secondary-500/20 border-secondary-500/50'
                                        : 'bg-white/5 border-white/10 opacity-60 hover:opacity-100'
                                        }`}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => {
                                                const currentDays = attendanceSettings.work_days ?? [0, 1, 2, 3, 4];
                                                const newDays = e.target.checked
                                                    ? [...currentDays, index].sort()
                                                    : currentDays.filter(d => d !== index);

                                                const validationError = validateWorkDays(newDays);
                                                if (validationError) {
                                                    showToast(validationError, 'error');
                                                    return;
                                                }

                                                const newSettings = { ...attendanceSettings, work_days: newDays };
                                                setAttendanceSettings(newSettings);
                                            }}
                                            disabled={attendanceSettingsSaving}
                                            className="w-4 h-4 accent-secondary-500"
                                        />
                                        <span className={`text-sm ${isSelected ? 'text-white font-bold' : 'text-gray-400'}`}>{day}</span>
                                    </label>
                                );
                            })}
                        </div>
                        <p className="text-xs text-gray-400 mt-3">* الأيام غير المحددة تُعامل كعطلة أسبوعية. احفظ التغييرات لتطبيقها على الكشك والتقويم والتقارير.</p>
                    </div>


                    {/* Info Box */}
                    <div className="bg-gradient-to-r from-primary-500/10 to-secondary-500/10 border border-primary-500/30 rounded-2xl p-5">
                        <div className="flex items-start gap-3">
                            <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-300" />
                            <div>
                                <div className="text-sm font-bold text-primary-400 mb-2">كيف يعمل النظام الذكي؟</div>
                                <ul className="text-xs text-gray-300 space-y-1.5">
                                    <li className="flex items-start gap-2">
                                        <span className="text-primary-400">1.</span>
                                        <span>
                                            التسجيل يبدأ عند {kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME}،
                                            ويُحتسب التأخير بعد {lateCutoffTime}، والغياب بعد {kiosk_settings.absence_time || ATTENDANCE_DEFAULTS.ABSENCE_TIME}
                                        </span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-primary-400">2.</span>
                                        <span>المشرف يفتح الصف ويرى من سجل ومن لم يسجل</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-primary-400">3.</span>
                                        <span>خياران سريعان: "احتساب الجميع حاضر" أو "تسجيل الغيابات"</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-primary-400">4.</span>
                                        <span>يمكن التعديل لاحقاً في أي وقت</span>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-full rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-4 shadow-[0_18px_60px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-xl sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div>
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Hash className="w-5 h-5 text-primary-300" />
                            إعدادات معرّف الطالب
                        </h3>
                        <p className="text-xs text-gray-400">إدارة سياسة المعرّفات وإتاحة التعديل للطلاب.</p>
                    </div>
                    <span className="text-[11px] text-gray-500 bg-white/5 border border-white/10 px-2 py-1 rounded-lg">
                        {studentIdPolicyHint}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-4">
                        <input
                            type="checkbox"
                            checked={studentIdSettings.allow_edit ?? true}
                            onChange={(e) => setStudentIdSettings({ ...studentIdSettings, allow_edit: e.target.checked })}
                            className="accent-primary-400 w-5 h-5"
                        />
                        <div>
                            <div className="text-sm text-white font-semibold">السماح بتعديل المعرّف</div>
                            <div className="text-xs text-gray-400">إخفاء زر تعديل المعرّف عند التعطيل.</div>
                        </div>
                    </label>

                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
                        <div className="text-sm text-white font-semibold">سياسة المعرّف</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">نوع الحروف</label>
                                <select
                                    className="w-full input-glass p-2 rounded-xl"
                                    value={studentIdSettings.charset ?? studentIdPolicy.charset}
                                    onChange={(e) => setStudentIdSettings({ ...studentIdSettings, charset: e.target.value as StudentIdSettings['charset'] })}
                                >
                                    <option value="numeric">أرقام فقط</option>
                                    <option value="alphanumeric">حروف + أرقام</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">الطول الثابت</label>
                                <input
                                    type="number"
                                    min={2}
                                    className="w-full input-glass p-2 rounded-xl"
                                    value={studentIdSettings.length ?? studentIdPolicy.length ?? 6}
                                    onChange={(e) => setStudentIdSettings({ ...studentIdSettings, length: Number(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">البادئة (اختياري)</label>
                                <input
                                    type="text"
                                    className="w-full input-glass p-2 rounded-xl font-mono"
                                    value={studentIdSettings.prefix ?? studentIdPolicy.prefix ?? ''}
                                    onChange={(e) => setStudentIdSettings({ ...studentIdSettings, prefix: e.target.value })}
                                    placeholder="مثال: SCH-"
                                />
                            </div>
                        </div>
                        <p className="text-[11px] text-gray-400">سيتم تطبيق السياسة عند إضافة أو تعديل المعرّف لضمان عدم التكرار.</p>
                    </div>
                </div>

                <button
                    onClick={handleSaveStudentIdSettings}
                    disabled={studentIdSettingsSaving}
                    className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all ${studentIdSettingsSaving ? 'bg-primary-500/20 text-primary-200/60 cursor-not-allowed' : 'bg-primary-300 text-slate-950 hover:bg-primary-200 active:scale-[0.99]'
                        }`}
                >
                    {studentIdSettingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    حفظ إعدادات المعرّف
                </button>
            </div>

            <div className="max-w-full rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-4 shadow-[0_18px_60px_-50px_rgba(245,158,11,0.45)] backdrop-blur-xl sm:p-6">
                <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Edit3 className="w-5 h-5 text-amber-300" />
                            تغيير معرّف طالب
                        </h3>
                        <p className="text-xs text-gray-400">بحث سريع وتحديث مباشر مع تحقق من عدم التكرار.</p>
                    </div>
                    {!allowStudentIdEdit && (
                        <span className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-lg">
                            تعديل المعرّف معطل حالياً
                        </span>
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="block text-xs text-gray-400">بحث الطالب</label>
                        <input
                            type="text"
                            className="w-full input-glass p-2.5 rounded-xl"
                            placeholder="ابحث بالاسم أو المعرف..."
                            value={settingsRenameQuery}
                            onChange={(e) => {
                                setSettingsRenameQuery(e.target.value);
                                setSettingsRenameError(null);
                            }}
                        />
                        <select
                            className="w-full input-glass p-2.5 rounded-xl"
                            value={settingsRenameTargetId}
                            onChange={(e) => {
                                setSettingsRenameTargetId(e.target.value);
                                setSettingsRenameError(null);
                            }}
                        >
                            <option value="">اختر الطالب...</option>
                            {settingsRenameCandidates.map(student => (
                                <option key={student.id} value={student.id}>
                                    {student.name} • {student.id} • {student.class_name} - {student.section}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-xs text-gray-400">المعرّف الجديد</label>
                        <input
                            type="text"
                            className="w-full input-glass p-2.5 rounded-xl font-mono"
                            placeholder="مثال: 000123"
                            value={settingsRenameNewId}
                            onChange={(e) => {
                                setSettingsRenameNewId(e.target.value);
                                setSettingsRenameError(null);
                            }}
                        />
                        <p className="text-[11px] text-gray-500">سيتم تطبيق {studentIdPolicyHint}</p>
                    </div>
                </div>
                {settingsRenameError && (
                    <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                        {settingsRenameError}
                    </div>
                )}
                <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="text-xs text-gray-400">
                        {settingsRenameTarget ? `الطالب المحدد: ${settingsRenameTarget.name} (${settingsRenameTarget.id})` : 'اختر طالباً لبدء التعديل'}
                    </div>
                    <button
                        onClick={() => {
                            if (!settingsRenameTarget) {
                                setSettingsRenameError('يرجى اختيار الطالب أولاً.');
                                return;
                            }
                            requestStudentIdRename(settingsRenameTarget, settingsRenameNewId, setSettingsRenameError);
                        }}
                        disabled={!allowStudentIdEdit}
                        className={`px-4 py-2 rounded-xl font-bold transition-all ${allowStudentIdEdit ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white' : 'bg-slate-500/20 text-slate-300 cursor-not-allowed'
                            }`}
                    >
                        تنفيذ التغيير
                    </button>
                </div>
            </div>

            {/* Recalculation Modal */}
            {showRecalcModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
                    <div className="glass-card w-full max-w-lg rounded-3xl p-8 border-2 border-amber-500/30 shadow-[0_0_50px_rgba(245,158,11,0.2)] animate-scale-in">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 flex items-center justify-center border border-amber-500/40">
                                <AlertTriangle className="w-10 h-10 text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-2xl font-bold text-white mb-1">تحديث سجلات اليوم؟</h3>
                                <p className="text-gray-400 text-sm">لقد قمت بتغيير إعدادات التوقيت.</p>
                            </div>
                        </div>

                        <div className="space-y-4 mb-8">
                            <div className="p-4 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between">
                                <div className="text-right">
                                    <div className="text-xs text-gray-500 mb-1">التوقيت القديم</div>
                                    <div className="text-white font-mono">{savedTimingRef.current.assembly_time} (+{savedTimingRef.current.grace_period}د)</div>
                                </div>
                                <ArrowRight className="w-5 h-5 text-gray-600" />
                                <div className="text-left">
                                    <div className="text-xs text-gray-500 mb-1">التوقيت الجديد</div>
                                    <div className="text-amber-400 font-mono font-bold">{recalcNewTime.assembly_time} (+{recalcNewTime.grace_period}د)</div>
                                </div>
                            </div>

                            <p className="text-sm text-gray-300 leading-relaxed bg-black/20 p-4 rounded-xl border border-amber-500/20">
                                💡 هل تريد إعادة حساب حالة الحضور لطلاب اليوم بناءً على التوقيت الجديد؟ 
                                <br/>
                                <span className="text-xs text-secondary-400">(قد يتغير وضع البعض من "حاضر" إلى "متأخر" أو العكس)</span>
                            </p>

                            {recalcResult && (
                                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl animate-fade-in">
                                    <div className="flex items-center gap-2 mb-2 text-emerald-400">
                                        <CheckCircle className="w-4 h-4" />
                                        <span className="font-bold">تم التحديث بنجاح!</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs text-emerald-300/80">
                                        <div>إجمالي السجلات: {recalcResult.total}</div>
                                        <div>تم التعديل: {recalcResult.updated}</div>
                                        <div>من حاضر إلى متأخر: {recalcResult.presentToLate}</div>
                                        <div>من متأخر إلى حاضر: {recalcResult.lateToPresent}</div>
                                        <div>تحولوا إلى غياب: {recalcResult.toAbsent}</div>
                                        <div>إلغاء غياب (لحاضر/متأخر): {recalcResult.fromAbsent}</div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-3">
                            {!recalcResult ? (
                                <>
                                    <button
                                        onClick={handleSaveWithRecalc}
                                        disabled={recalcSaving}
                                        className="w-full py-4 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:from-amber-500 hover:to-orange-500 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                                    >
                                        {recalcSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                                        حفظ وإعادة احتساب سجلات اليوم
                                    </button>
                                    <button
                                        onClick={handleSaveWithoutRecalc}
                                        disabled={recalcSaving}
                                        className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl text-sm transition-all"
                                    >
                                        حفظ الإعدادات فقط (للمستقبل)
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => setShowRecalcModal(false)}
                                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-500 transition-all"
                                >
                                    إغلاق النافذة
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminSettingsTab;
