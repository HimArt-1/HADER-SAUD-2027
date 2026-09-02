// ═══════════════════════════════════════════════════════════════
// AdminBackupTab - Backup & Restore operations
// ═══════════════════════════════════════════════════════════════
import React from 'react';
import { ImportIdMode, ImportIdPattern } from '../../services/fileService';
import {
    Download, Upload, AlertCircle, Loader2,
    Check, CheckCircle, Database, ShieldCheck, HardDrive, Table2, AlertTriangle
} from 'lucide-react';

interface RestoreFieldOption {
    field: string;
    label: string;
    required?: boolean;
}

export interface AdminBackupTabProps {
    storageMode: string;
    backupError: string | null;
    backupBusy: boolean;
    backupSummary: {
        students: number;
        attendance: number;
        violations: number;
        exits: number;
        classes: number;
        users: number;
    } | null;
    restoreFile: File | null;
    restorePreview: { summary: { students: number; attendance: number; classes: number; users: number; violations: number; exits: number } } | null;
    restoreColumns: string[];
    restoreFieldOptions: RestoreFieldOption[];
    restoreMapping: Record<string, string>;
    restoreIdMode: ImportIdMode;
    restoreIdPattern: ImportIdPattern;
    restorePreviewRows: Record<string, any>[];
    handleDownloadBackup: () => void;
    handleRestoreFile: (file: File | null) => void;
    handleApplyRestore: () => void;
    handleRestoreMappingChange: (field: string, value: string) => void;
    setRestoreIdMode: (mode: ImportIdMode) => void;
    setRestoreIdPattern: React.Dispatch<React.SetStateAction<ImportIdPattern>>;
}

const AdminBackupTab: React.FC<AdminBackupTabProps> = ({
    storageMode, backupError, backupBusy, backupSummary,
    restoreFile, restorePreview, restoreColumns, restoreFieldOptions,
    restoreMapping, restoreIdMode, restoreIdPattern, restorePreviewRows,
    handleDownloadBackup, handleRestoreFile, handleApplyRestore,
    handleRestoreMappingChange, setRestoreIdMode, setRestoreIdPattern
}) => {
    const isLocalMode = storageMode === 'local';
    const backupMetricCards = [
        { label: 'الطلاب', value: backupSummary?.students ?? 0, icon: Database, className: 'border-primary-500/20 bg-primary-500/[0.07] text-primary-100' },
        { label: 'الحضور', value: backupSummary?.attendance ?? 0, icon: Table2, className: 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-100' },
        { label: 'المخالفات والخروج', value: (backupSummary?.violations ?? 0) + (backupSummary?.exits ?? 0), icon: AlertTriangle, className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-100' },
        { label: 'الصفوف والمستخدمون', value: (backupSummary?.classes ?? 0) + (backupSummary?.users ?? 0), icon: ShieldCheck, className: 'border-secondary-500/20 bg-secondary-500/[0.07] text-secondary-100' }
    ];
    const restoreTotalRecords = restorePreview
        ? restorePreview.summary.students + restorePreview.summary.attendance + restorePreview.summary.classes + restorePreview.summary.users + restorePreview.summary.violations + restorePreview.summary.exits
        : 0;
    const restoreModeLabel = restoreIdMode === 'keep'
        ? 'الاحتفاظ بالمعرفات'
        : restoreIdMode === 'generate'
            ? 'توليد معرفات جديدة'
            : 'استبدال المعرفات';

    return (
        <div className="space-y-6 animate-fade-in">
            <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/65 p-5 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-bold text-primary-100">
                            <HardDrive className="h-4 w-4" />
                            مركز الاستمرارية
                        </div>
                        <h2 className="text-2xl font-black text-white md:text-3xl">النسخ الاحتياطي والاستعادة</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
                            حفظ نسخة محلية منظمة واستعادة البيانات مع مطابقة الأعمدة وخيارات معرفات الطلاب.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:min-w-[620px]">
                        <div className={`rounded-2xl border p-4 ${isLocalMode ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-100' : 'border-amber-500/25 bg-amber-500/[0.08] text-amber-100'}`}>
                            <div className="flex items-center justify-between gap-2">
                                <ShieldCheck className="h-4 w-4 opacity-80" />
                                <span className="text-[11px] font-semibold text-slate-400">الوضع الحالي</span>
                            </div>
                            <div className="mt-3 font-black">{isLocalMode ? 'محلي' : 'سحابي'}</div>
                            <div className="mt-1 text-[11px] text-slate-500">{isLocalMode ? 'النسخ اليدوي متاح' : 'النسخ من مزود السحابة'}</div>
                        </div>
                        <div className="rounded-2xl border border-primary-500/20 bg-primary-500/[0.07] p-4 text-primary-100">
                            <div className="flex items-center justify-between gap-2">
                                <Upload className="h-4 w-4 opacity-80" />
                                <span className="text-[11px] font-semibold text-slate-400">ملف الاستعادة</span>
                            </div>
                            <div className="mt-3 truncate font-black">{restoreFile ? restoreFile.name : 'لم يتم اختيار ملف'}</div>
                            <div className="mt-1 text-[11px] text-slate-500">{restorePreview ? `${restoreTotalRecords} سجل في المعاينة` : 'بانتظار ملف JSON'}</div>
                        </div>
                        <div className="rounded-2xl border border-secondary-500/20 bg-secondary-500/[0.07] p-4 text-secondary-100">
                            <div className="flex items-center justify-between gap-2">
                                <Database className="h-4 w-4 opacity-80" />
                                <span className="text-[11px] font-semibold text-slate-400">الأعمدة المكتشفة</span>
                            </div>
                            <div className="mt-3 font-mono text-2xl font-black">{restoreColumns.length}</div>
                            <div className="mt-1 text-[11px] text-slate-500">بعد قراءة الملف</div>
                        </div>
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-amber-100">
                            <div className="flex items-center justify-between gap-2">
                                <CheckCircle className="h-4 w-4 opacity-80" />
                                <span className="text-[11px] font-semibold text-slate-400">نمط المعرفات</span>
                            </div>
                            <div className="mt-3 truncate font-black">{restoreModeLabel}</div>
                            <div className="mt-1 text-[11px] text-slate-500">يطبق عند الاستعادة</div>
                        </div>
                    </div>
                </div>
            </section>

            {backupError && (
                <div className="flex items-center gap-2 rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-red-200">
                    <AlertCircle className="w-5 h-5" />
                    <span>{backupError}</span>
                </div>
            )}

            {storageMode !== 'local' ? (
                <div className="rounded-[1.5rem] border border-amber-500/25 bg-amber-500/10 p-6 shadow-[0_18px_60px_-55px_rgba(245,158,11,0.55)] backdrop-blur-xl">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-6 h-6 text-amber-400 mt-1" />
                        <div>
                            <h3 className="text-lg font-bold text-amber-300 mb-1">النسخ الاحتياطي متاح في الوضع المحلي فقط</h3>
                            <p className="text-sm text-amber-200/80">
                                في الوضع السحابي يتم إدارة النسخ الاحتياطية من مزود قاعدة البيانات مباشرة. فعّل الوضع المحلي للاستفادة من النسخ اليدوي هنا.
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {backupMetricCards.map(card => (
                            <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <card.icon className="h-4 w-4 opacity-80" />
                                    <p className="text-xs text-slate-400">{card.label}</p>
                                </div>
                                <div className="mt-3 font-mono text-2xl font-black">{card.value}</div>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-6 shadow-[0_18px_60px_-52px_rgba(16,185,129,0.55)] backdrop-blur-xl space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                                    <Download className="w-5 h-5 text-emerald-300" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">تصدير نسخة احتياطية</h3>
                                    <p className="text-sm text-gray-400">يحفظ الطلاب، الحضور، المخالفات، الصفوف، المستخدمين والإعدادات.</p>
                                </div>
                            </div>
                            <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
                                <li>ملف JSON منظم مع بيانات التعريف</li>
                                <li>يشمل الملخص اليومي وإعدادات النظام</li>
                                <li>يمكن استعادته مباشرة من نفس التبويب</li>
                            </ul>
                            <button
                                onClick={handleDownloadBackup}
                                disabled={backupBusy}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary-300 px-4 text-sm font-black text-slate-950 transition hover:bg-primary-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {backupBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                                تنزيل النسخة الاحتياطية
                            </button>
                        </div>

                        <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-6 shadow-[0_18px_60px_-52px_rgb(var(--color-secondary-400)_/_0.55)] backdrop-blur-xl space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-secondary-500/20 flex items-center justify-center">
                                    <Upload className="w-5 h-5 text-secondary-300" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">استعادة نسخة احتياطية</h3>
                                    <p className="text-sm text-gray-400">سيتم استبدال البيانات الحالية بمحتوى الملف.</p>
                                </div>
                            </div>
                            <label className="block cursor-pointer">
                                <div className="border-2 border-dashed border-white/15 rounded-xl p-6 text-center hover:border-primary-500/60 transition-colors">
                                    <Upload className="w-7 h-7 text-gray-400 mx-auto mb-2" />
                                    <span className="text-gray-300 text-sm">اضغط لاختيار ملف النسخة الاحتياطية</span>
                                </div>
                                <input type="file" className="hidden" accept="application/json" onChange={e => handleRestoreFile(e.target.files?.[0] || null)} />
                            </label>
                            {restoreFile && (
                                <div className="text-sm text-emerald-400 flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4" />
                                    تم اختيار الملف: {restoreFile.name}
                                </div>
                            )}
                            {restorePreview && (
                                <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-sm text-gray-300 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Check className="w-4 h-4 text-emerald-400" />
                                        <span>تم التحقق من الملف</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                                        <div>طلاب: {restorePreview.summary.students}</div>
                                        <div>حضور: {restorePreview.summary.attendance}</div>
                                        <div>صفوف: {restorePreview.summary.classes}</div>
                                        <div>مستخدمين: {restorePreview.summary.users}</div>
                                        <div>مخالفات: {restorePreview.summary.violations}</div>
                                        <div>خروج: {restorePreview.summary.exits}</div>
                                    </div>
                                </div>
                            )}
                            {restoreColumns.length > 0 && (
                                <div className="space-y-4 p-4 rounded-2xl border border-white/10 bg-white/5">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div>
                                            <h4 className="text-white font-bold">لوحة مطابقة الأعمدة</h4>
                                            <p className="text-xs text-gray-400">اختر العمود المناسب لكل حقل لضمان التعرف على بيانات الطلاب.</p>
                                        </div>
                                        <span className="text-xs text-gray-400">الأعمدة المكتشفة: {restoreColumns.length}</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {restoreFieldOptions.map(option => (
                                            <label key={option.field} className="flex flex-col gap-2 text-xs text-gray-400">
                                                <span className="text-gray-300 font-medium">
                                                    {option.label} {option.required && <span className="text-red-400">*</span>}
                                                </span>
                                                <select
                                                    value={restoreMapping[option.field] || ''}
                                                    onChange={(e) => handleRestoreMappingChange(option.field, e.target.value)}
                                                    className="w-full input-glass p-3 rounded-xl text-sm"
                                                >
                                                    <option value="">-- اختر العمود --</option>
                                                    {restoreColumns.map(col => (
                                                        <option key={col} value={col}>{col}</option>
                                                    ))}
                                                </select>
                                            </label>
                                        ))}
                                    </div>
                                    {restorePreviewRows.length > 0 && (
                                        <div className="pt-3 border-t border-white/10">
                                            <div className="text-xs text-gray-400 mb-2">معاينة صفوف من الملف:</div>
                                            <div className="overflow-auto rounded-xl border border-white/10">
                                                <table className="w-full text-xs text-gray-300">
                                                    <thead className="bg-white/5">
                                                        <tr>
                                                            {restoreColumns.map(col => (
                                                                <th key={col} className="px-3 py-2 text-right whitespace-nowrap">{col}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {restorePreviewRows.map((row, idx) => (
                                                            <tr key={idx} className="border-t border-white/5">
                                                                {restoreColumns.map(col => (
                                                                    <td key={col} className="px-3 py-2 whitespace-nowrap text-gray-400">{row?.[col]?.toString?.() || ''}</td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                    <div className="pt-4 border-t border-white/10 space-y-3">
                                        <div className="text-sm text-gray-300 font-medium">خيارات المعرفات عند الاستعادة</div>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            {[
                                                { key: 'keep', label: 'الاحتفاظ بالمعرفات' },
                                                { key: 'generate', label: 'توليد معرفات جديدة' },
                                                { key: 'replace', label: 'استبدال المعرفات' }
                                            ].map(option => (
                                                <label key={option.key} className={`p-3 rounded-xl border cursor-pointer transition ${restoreIdMode === option.key ? 'border-primary-400/60 bg-primary-500/10 text-white' : 'border-white/10 hover:border-primary-400/40'}`}>
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <input
                                                            type="radio"
                                                            name="restoreIdMode"
                                                            value={option.key}
                                                            checked={restoreIdMode === option.key}
                                                            onChange={() => setRestoreIdMode(option.key as ImportIdMode)}
                                                            className="accent-primary-500"
                                                        />
                                                        {option.label}
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                        {(restoreIdMode === 'generate' || restoreIdMode === 'replace') && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <label className="flex flex-col gap-2 text-xs text-gray-400">
                                                    <span className="text-gray-300 font-medium">بادئة المعرف</span>
                                                    <input value={restoreIdPattern.prefix || ''} onChange={e => setRestoreIdPattern({ ...restoreIdPattern, prefix: e.target.value })} className="w-full input-glass p-3 rounded-xl" placeholder="مثال: STU-" />
                                                </label>
                                                <label className="flex flex-col gap-2 text-xs text-gray-400">
                                                    <span className="text-gray-300 font-medium">عدد الخانات</span>
                                                    <input type="number" min={3} value={restoreIdPattern.length || 6} onChange={e => setRestoreIdPattern({ ...restoreIdPattern, length: Number(e.target.value) })} className="w-full input-glass p-3 rounded-xl" />
                                                </label>
                                                <label className="flex flex-col gap-2 text-xs text-gray-400">
                                                    <span className="text-gray-300 font-medium">نوع الأحرف</span>
                                                    <select value={restoreIdPattern.charset || 'numeric'} onChange={e => setRestoreIdPattern({ ...restoreIdPattern, charset: e.target.value as ImportIdPattern['charset'] })} className="w-full input-glass p-3 rounded-xl">
                                                        <option value="numeric">أرقام فقط</option>
                                                        <option value="alphanumeric">أحرف وأرقام</option>
                                                    </select>
                                                </label>
                                                <label className="flex flex-col gap-2 text-xs text-gray-400">
                                                    <span className="text-gray-300 font-medium">رقم البداية</span>
                                                    <input type="number" min={1} value={restoreIdPattern.start || 1} onChange={e => setRestoreIdPattern({ ...restoreIdPattern, start: Number(e.target.value) })} className="w-full input-glass p-3 rounded-xl" />
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <button
                                onClick={handleApplyRestore}
                                disabled={backupBusy || !restoreFile}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-secondary-400/30 bg-secondary-400/10 px-4 text-sm font-black text-secondary-100 transition hover:bg-secondary-400/15 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {backupBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                                استعادة البيانات الآن
                            </button>
                            <p className="text-xs text-amber-200/70">سيتم استبدال البيانات الحالية بالكامل بعد التأكيد.</p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AdminBackupTab;
