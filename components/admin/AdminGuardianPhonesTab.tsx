// ═══════════════════════════════════════════════════════════════
// 📱 أداة جمع أرقام أولياء الأمور — Guardian Phone Collector
// ═══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Student } from '../../types';
import { db } from '../../services/db';
import { FileService, ImportMapping } from '../../services/fileService';
import { autoDetectPhoneImportColumns, getColumnSamples } from '../../services/import/autoMap';
import { logError } from '../../types/errors';
import { useToast } from '../Toast';
import {
    Smartphone, Camera, FileSpreadsheet, Wand2, Users, CheckCircle, AlertCircle,
    Search, X, Save, Upload, Check, Loader2, ChevronDown, Phone, UserCheck,
    Video, VideoOff, SwitchCamera, ScanLine
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════
interface Props {
    students: Student[];
    setStudents: (s: Student[]) => void;
    fetchStudents: () => Promise<void>;
    showToast: (msg: string, type: 'success' | 'error') => void;
}

type Mode = 'manual' | 'scanner' | 'import' | 'autofill';

// Phone validation
const normalizePhone = (raw: string): string => {
    let p = raw.replace(/[^\d+]/g, '');
    if (p.startsWith('00966')) p = '+966' + p.slice(5);
    else if (p.startsWith('966') && p.length > 9) p = '+' + p;
    else if (p.startsWith('05') && p.length === 10) p = '+966' + p.slice(1);
    else if (p.startsWith('5') && p.length === 9) p = '+966' + p;
    return p;
};
const isValidSAPhone = (p: string) => /^\+9665\d{8}$/.test(p);

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════
const AdminGuardianPhonesTab: React.FC<Props> = ({ students, setStudents, fetchStudents, showToast }) => {
    const toast = useToast();
    const [mode, setMode] = useState<Mode>('manual');
    const [search, setSearch] = useState('');
    const [gradeFilter, setGradeFilter] = useState('all');
    const [showOnlyMissing, setShowOnlyMissing] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [phoneInputs, setPhoneInputs] = useState<Record<string, string>>({});

    // Scanner state
    const [scannerActive, setScannerActive] = useState(false);
    const [scanInputMode, setScanInputMode] = useState<'camera' | 'manual'>('camera');
    const [scannedStudent, setScannedStudent] = useState<Student | null>(null);
    const [scanPhone, setScanPhone] = useState('');
    const [scanSaving, setScanSaving] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [cameraScanError, setCameraScanError] = useState<string | null>(null);
    const [scanCount, setScanCount] = useState(0);
    const cameraVideoRef = useRef<HTMLVideoElement>(null);
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const barcodeDetectorRef = useRef<any>(null);
    const scanFrameRef = useRef<number | null>(null);
    const lastScanValueRef = useRef<string | null>(null);
    const cameraScanCooldownRef = useRef<number>(0);
    const lastFrameTimeRef = useRef<number>(0);
    const scanInputRef = useRef<HTMLInputElement>(null);

    const isBarcodeDetectorSupported = useMemo(() => {
        if (typeof window === 'undefined') return false;
        return 'BarcodeDetector' in window;
    }, []);

    // Import state
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importRows, setImportRows] = useState<any[]>([]);
    const [importColumns, setImportColumns] = useState<string[]>([]);
    const [importMapping, setImportMapping] = useState<{ id: string; phone: string; name: string }>({ id: '', phone: '', name: '' });
    const [importPreview, setImportPreview] = useState<Array<{ student: Student | null; phone: string; rawId: string; rawName: string; matchType: 'id' | 'name' | 'none' }>>([]);
    const [importSaving, setImportSaving] = useState(false);
    const [importMatchMode, setImportMatchMode] = useState<'id' | 'name' | 'both'>('id');
    const [importOverwriteMode, setImportOverwriteMode] = useState<'skip' | 'overwrite'>('skip');
    const [importColumnSamples, setImportColumnSamples] = useState<Record<string, string[]>>({});
    const [importDetectionConfidence, setImportDetectionConfidence] = useState<Record<string, string>>({});

    // Autofill state
    const [siblingGroups, setSiblingGroups] = useState<Array<{ surname: string; hasPhone: Student[]; noPhone: Student[]; phone: string }>>([]);
    const [selectedSiblings, setSelectedSiblings] = useState<Set<string>>(new Set());
    const [autofillSaving, setAutofillSaving] = useState(false);

    // ═══════════════════════════════════════════════════════════════
    // Stats
    // ═══════════════════════════════════════════════════════════════
    const stats = useMemo(() => {
        const total = students.length;
        const withPhone = students.filter(s => s.guardian_phone?.trim()).length;
        const withoutPhone = total - withPhone;
        const coverage = total > 0 ? Math.round((withPhone / total) * 100) : 0;
        return { total, withPhone, withoutPhone, coverage };
    }, [students]);

    // Available grades
    const grades = useMemo(() => {
        const set = new Set(students.map(s => s.class_name).filter(Boolean));
        return Array.from(set).sort();
    }, [students]);

    // ═══════════════════════════════════════════════════════════════
    // Manual Mode: filtered students
    // ═══════════════════════════════════════════════════════════════
    const filteredStudents = useMemo(() => {
        let list = students;
        if (showOnlyMissing) list = list.filter(s => !s.guardian_phone?.trim());
        if (gradeFilter !== 'all') list = list.filter(s => s.class_name === gradeFilter);
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.id.toLowerCase().includes(q) ||
                s.class_name.toLowerCase().includes(q)
            );
        }
        return list;
    }, [students, showOnlyMissing, gradeFilter, search]);

    // Save phone for a student
    const savePhone = async (student: Student, phone: string) => {
        const normalized = normalizePhone(phone);
        if (phone.trim() && !isValidSAPhone(normalized)) {
            toast.warning('الرقم غير صحيح — يجب أن يكون رقم سعودي (05xxxxxxxx)');
            return;
        }
        setSaving(student.id);
        try {
            await db.updateStudent({ ...student, guardian_phone: normalized || '' });
            await fetchStudents();
            toast.success(`تم حفظ رقم ولي أمر ${student.name}`);
        } catch (e) {
            logError(e, 'GuardianPhones - Save');
            toast.error('فشل الحفظ');
        } finally {
            setSaving(null);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // Scanner Mode — Camera + USB Barcode
    // ═══════════════════════════════════════════════════════════════
    const handleScanResult = useCallback((value: string) => {
        const trimmed = value.trim().replace(/[^a-zA-Z0-9]/g, '');
        if (!trimmed) return;
        const found = students.find(s => s.id === trimmed || s.id.trim() === trimmed);
        if (found) {
            setScannedStudent(found);
            setScanPhone(found.guardian_phone || '');
            setScanCount(prev => prev + 1);
            try { new Audio('/beep.mp3').play(); } catch { /* silent */ }
            setTimeout(() => {
                const phoneInput = document.getElementById('scan-phone-input');
                if (phoneInput) (phoneInput as HTMLInputElement).focus();
            }, 100);
        } else {
            toast.error(`الطالب غير موجود: ${trimmed}`);
        }
    }, [students, toast]);

    // Keep a ref to always access latest handleScanResult
    const handleScanResultRef = useRef(handleScanResult);
    handleScanResultRef.current = handleScanResult;

    const stopCamera = useCallback(() => {
        if (scanFrameRef.current) {
            cancelAnimationFrame(scanFrameRef.current);
            scanFrameRef.current = null;
        }
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach(track => track.stop());
            cameraStreamRef.current = null;
        }
        if (cameraVideoRef.current) {
            cameraVideoRef.current.srcObject = null;
        }
        setCameraReady(false);
    }, []);

    const startCamera = useCallback(async () => {
        if (cameraStreamRef.current) return;
        setCameraScanError(null);
        lastScanValueRef.current = null;

        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraScanError('المتصفح لا يدعم تشغيل الكاميرا.');
            return;
        }
        if (!isBarcodeDetectorSupported) {
            setCameraScanError('المتصفح لا يدعم مسح الباركود بالكاميرا. جرّب Chrome أو Edge.');
            return;
        }

        try {
            let stream: MediaStream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false
                });
            } catch {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false
                });
            }

            cameraStreamRef.current = stream;
            if (cameraVideoRef.current) {
                cameraVideoRef.current.srcObject = stream;
                cameraVideoRef.current.setAttribute('playsinline', 'true');
                await cameraVideoRef.current.play();
            }

            barcodeDetectorRef.current = new (window as any).BarcodeDetector({
                formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'qr_code', 'upc_e', 'upc_a', 'itf']
            });
            setCameraReady(true);

            const scanFrame = async () => {
                if (!cameraVideoRef.current || !barcodeDetectorRef.current) return;
                if (cameraVideoRef.current.readyState < 2) {
                    scanFrameRef.current = requestAnimationFrame(scanFrame);
                    return;
                }
                const now = performance.now();
                if (now - lastFrameTimeRef.current < 180) {
                    scanFrameRef.current = requestAnimationFrame(scanFrame);
                    return;
                }
                lastFrameTimeRef.current = now;

                try {
                    const barcodes = await barcodeDetectorRef.current.detect(cameraVideoRef.current);
                    if (barcodes?.length) {
                        const rawValue = barcodes[0]?.rawValue?.trim();
                        if (rawValue) {
                            const ts = performance.now();
                            const isSame = rawValue === lastScanValueRef.current;
                            const cooldown = (ts - cameraScanCooldownRef.current) < 3000;
                            if (!isSame || !cooldown) {
                                lastScanValueRef.current = rawValue;
                                cameraScanCooldownRef.current = ts;
                                handleScanResultRef.current(rawValue);
                            }
                        }
                    }
                } catch (error) {
                    logError(error, 'GuardianPhones - Barcode Scan');
                }
                scanFrameRef.current = requestAnimationFrame(scanFrame);
            };
            scanFrameRef.current = requestAnimationFrame(scanFrame);
        } catch (error) {
            logError(error, 'GuardianPhones - Start Camera');
            setCameraScanError('تعذر تشغيل الكاميرا. تأكد من منح الإذن.');
            stopCamera();
        }
    }, [isBarcodeDetectorSupported, stopCamera]);

    const startScanner = () => {
        setScannerActive(true);
        setScanCount(0);
        if (scanInputMode === 'camera') {
            setTimeout(() => startCamera(), 200);
        } else {
            setTimeout(() => scanInputRef.current?.focus(), 200);
        }
    };

    const stopScanner = () => {
        setScannerActive(false);
        stopCamera();
        setScannedStudent(null);
        setScanPhone('');
        setCameraScanError(null);
    };

    // Auto start/stop camera when switching input mode while active
    useEffect(() => {
        if (!scannerActive) return;
        if (scanInputMode === 'camera') {
            startCamera();
        } else {
            stopCamera();
            setTimeout(() => scanInputRef.current?.focus(), 100);
        }
        return () => { if (scanInputMode === 'camera') stopCamera(); };
    }, [scanInputMode, scannerActive, startCamera, stopCamera]);

    // Cleanup camera on unmount
    useEffect(() => () => stopCamera(), [stopCamera]);

    const saveScanPhone = async () => {
        if (!scannedStudent) return;
        setScanSaving(true);
        await savePhone(scannedStudent, scanPhone);
        setScanSaving(false);
        setScannedStudent(null);
        setScanPhone('');
        // Refocus back to scanner input
        if (scanInputMode === 'manual') scanInputRef.current?.focus();
    };

    // ═══════════════════════════════════════════════════════════════
    // File Import Mode
    // ═══════════════════════════════════════════════════════════════
    const handleFileUpload = async (file: File) => {
        setImportFile(file);
        try {
            const rows = await FileService.parseImportFile(file);
            if (!rows?.length) {
                toast.error('الملف فارغ أو غير صالح');
                return;
            }
            setImportRows(rows);
            const cols = Object.keys(rows[0] || {});
            setImportColumns(cols);

            // Smart detect columns using autoMap engine
            const detected = autoDetectPhoneImportColumns(cols, rows);
            setImportMapping({ id: detected.id, phone: detected.phone, name: detected.name });
            setImportDetectionConfidence(detected.confidence);

            // Generate sample data for each column
            const samples = getColumnSamples(cols, rows, 3);
            setImportColumnSamples(samples);

            // Auto-select match mode based on detection
            if (detected.id && !detected.name) setImportMatchMode('id');
            else if (detected.name && !detected.id) setImportMatchMode('name');
            else if (detected.id && detected.name) setImportMatchMode('both');
        } catch (e) {
            logError(e, 'GuardianPhones - Parse File');
            toast.error('فشل قراءة الملف');
        }
    };

    // Generate match preview with multiple match modes
    useEffect(() => {
        if (!importRows.length || !importMapping.phone) {
            setImportPreview([]);
            return;
        }
        const needsId = importMatchMode === 'id' || importMatchMode === 'both';
        const needsName = importMatchMode === 'name' || importMatchMode === 'both';
        if (needsId && !importMapping.id && !needsName) { setImportPreview([]); return; }
        if (needsName && !importMapping.name && !needsId) { setImportPreview([]); return; }

        const preview = importRows.map(row => {
            const rawId = importMapping.id ? String(row[importMapping.id] || '').trim() : '';
            const rawName = importMapping.name ? String(row[importMapping.name] || '').trim() : '';
            const phone = String(row[importMapping.phone] || '').trim();
            let student: Student | null = null;
            let matchType: 'id' | 'name' | 'none' = 'none';

            // Try ID match first
            if (rawId && (importMatchMode === 'id' || importMatchMode === 'both')) {
                student = students.find(s => s.id === rawId || s.id.trim() === rawId) || null;
                if (student) matchType = 'id';
            }
            // Try name match if no ID match
            if (!student && rawName && (importMatchMode === 'name' || importMatchMode === 'both')) {
                const normalized = rawName.trim().toLowerCase();
                student = students.find(s => s.name.toLowerCase() === normalized) || null;
                if (!student) {
                    student = students.find(s => s.name.toLowerCase().includes(normalized) || normalized.includes(s.name.toLowerCase())) || null;
                }
                if (student) matchType = 'name';
            }
            return { student, phone, rawId, rawName, matchType };
        });
        setImportPreview(preview);
    }, [importRows, importMapping, students, importMatchMode]);

    // Import stats
    const importStats = useMemo(() => {
        const matched = importPreview.filter(p => p.student && p.phone);
        const unmatched = importPreview.filter(p => !p.student);
        const noPhone = importPreview.filter(p => p.student && !p.phone);
        const validPhones = matched.filter(p => isValidSAPhone(normalizePhone(p.phone)));
        const invalidPhones = matched.filter(p => p.phone && !isValidSAPhone(normalizePhone(p.phone)));
        const willSkip = importOverwriteMode === 'skip'
            ? matched.filter(p => p.student?.guardian_phone?.trim())
            : [];
        const willUpdate = importOverwriteMode === 'skip'
            ? matched.filter(p => !p.student?.guardian_phone?.trim())
            : matched;
        const byIdMatch = matched.filter(p => p.matchType === 'id').length;
        const byNameMatch = matched.filter(p => p.matchType === 'name').length;
        return { matched: matched.length, unmatched: unmatched.length, noPhone: noPhone.length, validPhones: validPhones.length, invalidPhones: invalidPhones.length, willSkip: willSkip.length, willUpdate: willUpdate.length, byIdMatch, byNameMatch };
    }, [importPreview, importOverwriteMode]);

    const applyImport = async () => {
        let toUpdate = importPreview.filter(p => p.student && p.phone);
        // Respect overwrite mode
        if (importOverwriteMode === 'skip') {
            toUpdate = toUpdate.filter(p => !p.student?.guardian_phone?.trim());
        }
        if (!toUpdate.length) {
            toast.warning('لا يوجد أرقام لتحديثها');
            return;
        }
        setImportSaving(true);
        try {
            let updated = 0;
            for (const { student, phone } of toUpdate) {
                if (!student) continue;
                const normalized = normalizePhone(phone);
                if (normalized && isValidSAPhone(normalized)) {
                    await db.updateStudent({ ...student, guardian_phone: normalized });
                    updated++;
                }
            }
            await fetchStudents();
            toast.success(`تم تحديث ${updated} رقم بنجاح`);
            setImportFile(null);
            setImportRows([]);
            setImportPreview([]);
            setImportColumnSamples({});
        } catch (e) {
            logError(e, 'GuardianPhones - Apply Import');
            toast.error('فشل الاستيراد');
        } finally {
            setImportSaving(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // Auto-Fill Siblings Mode
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (mode !== 'autofill') return;
        // Group students by last word in name (surname)
        const groups = new Map<string, Student[]>();
        students.forEach(s => {
            const parts = s.name.trim().split(/\s+/);
            if (parts.length < 2) return;
            const surname = parts[parts.length - 1];
            if (!groups.has(surname)) groups.set(surname, []);
            groups.get(surname)!.push(s);
        });

        const result: typeof siblingGroups = [];
        groups.forEach((members, surname) => {
            if (members.length < 2) return;
            const hasPhone = members.filter(s => s.guardian_phone?.trim());
            const noPhone = members.filter(s => !s.guardian_phone?.trim());
            if (hasPhone.length > 0 && noPhone.length > 0) {
                result.push({
                    surname,
                    hasPhone,
                    noPhone,
                    phone: hasPhone[0].guardian_phone!
                });
            }
        });
        setSiblingGroups(result.sort((a, b) => b.noPhone.length - a.noPhone.length));
        setSelectedSiblings(new Set(result.flatMap(g => g.noPhone.map(s => s.id))));
    }, [mode, students]);

    const applyAutofill = async () => {
        const toUpdate: { student: Student; phone: string }[] = [];
        siblingGroups.forEach(g => {
            g.noPhone.forEach(s => {
                if (selectedSiblings.has(s.id)) toUpdate.push({ student: s, phone: g.phone });
            });
        });
        if (!toUpdate.length) {
            toast.warning('لا يوجد طلاب محددين');
            return;
        }
        setAutofillSaving(true);
        try {
            for (const { student, phone } of toUpdate) {
                await db.updateStudent({ ...student, guardian_phone: phone });
            }
            await fetchStudents();
            toast.success(`تم تعبئة ${toUpdate.length} رقم تلقائياً`);
        } catch (e) {
            logError(e, 'GuardianPhones - Autofill');
            toast.error('فشل التعبئة التلقائية');
        } finally {
            setAutofillSaving(false);
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // Render
    // ═══════════════════════════════════════════════════════════════
    const modes: { id: Mode; label: string; icon: React.ElementType; desc: string }[] = [
        { id: 'manual', label: 'تعبئة يدوية', icon: Phone, desc: 'جدول مع بحث وفلترة' },
        { id: 'scanner', label: 'مسح الباركود', icon: Camera, desc: 'كاميرا أو ماسح USB' },
        { id: 'import', label: 'استيراد ملف', icon: FileSpreadsheet, desc: 'Excel أو CSV' },
        { id: 'autofill', label: 'تعبئة تلقائية', icon: Wand2, desc: 'نسخ بين الإخوة' },
    ];

    const coverageColor = stats.coverage >= 80 ? 'emerald' : stats.coverage >= 50 ? 'amber' : 'red';

    return (
        <div className="space-y-6">
            {/* ═══ Header ═══ */}
            <div className="glass-card rounded-3xl p-6 border border-primary-500/20">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary-500 to-secondary-600 shadow-lg">
                                <Smartphone className="w-6 h-6 text-white" />
                            </div>
                            أداة جمع أرقام أولياء الأمور
                        </h2>
                        <p className="text-sm text-slate-400 mt-1">جمع وربط أرقام الجوال بالطلاب من مصادر متعددة</p>
                    </div>
                </div>

                {/* ═══ Stats Cards ═══ */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="glass-card rounded-xl p-4 border border-primary-500/20">
                        <div className="flex items-center gap-2 mb-1">
                            <Users className="w-4 h-4 text-primary-400" />
                            <span className="text-xs text-slate-400">إجمالي الطلاب</span>
                        </div>
                        <p className="text-2xl font-bold text-white">{stats.total}</p>
                    </div>
                    <div className="glass-card rounded-xl p-4 border border-emerald-500/20">
                        <div className="flex items-center gap-2 mb-1">
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                            <span className="text-xs text-slate-400">لديهم رقم</span>
                        </div>
                        <p className="text-2xl font-bold text-emerald-400">{stats.withPhone}</p>
                    </div>
                    <div className="glass-card rounded-xl p-4 border border-red-500/20">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertCircle className="w-4 h-4 text-red-400" />
                            <span className="text-xs text-slate-400">بدون رقم</span>
                        </div>
                        <p className="text-2xl font-bold text-red-400">{stats.withoutPhone}</p>
                    </div>
                    <div className={`glass-card rounded-xl p-4 border border-${coverageColor}-500/20`}>
                        <div className="flex items-center gap-2 mb-1">
                            <Smartphone className="w-4 h-4" style={{ color: coverageColor === 'emerald' ? '#34d399' : coverageColor === 'amber' ? '#fbbf24' : '#f87171' }} />
                            <span className="text-xs text-slate-400">التغطية</span>
                        </div>
                        <p className="text-2xl font-bold" style={{ color: coverageColor === 'emerald' ? '#34d399' : coverageColor === 'amber' ? '#fbbf24' : '#f87171' }}>{stats.coverage}%</p>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-white/10">
                    <div
                        className={`h-full rounded-full transition-all duration-700 ${stats.coverage >= 80 ? 'bg-gradient-to-r from-emerald-500 to-green-400' :
                            stats.coverage >= 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
                                'bg-gradient-to-r from-red-500 to-rose-400'
                            }`}
                        style={{ width: `${stats.coverage}%` }}
                    />
                </div>
                <p className="text-xs text-slate-500 mt-1 text-center">
                    {stats.coverage < 50 ? '⚠️ التغطية منخفضة — يُنصح بجمع أرقام أولياء الأمور' :
                        stats.coverage < 80 ? '📊 تغطية متوسطة — واصل الجمع' :
                            '🎉 تغطية ممتازة!'}
                </p>
            </div>

            {/* ═══ Mode Selector ═══ */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {modes.map(m => (
                    <button
                        key={m.id}
                        onClick={() => setMode(m.id)}
                        className={`glass-card rounded-2xl p-4 border transition-all duration-300 text-right ${mode === m.id
                            ? 'border-primary-500/50 bg-primary-500/10 shadow-[0_0_20px_rgb(var(--color-primary-500)_/_0.15)]'
                            : 'border-white/5 hover:border-white/20'
                            }`}
                    >
                        <div className={`p-2 rounded-xl inline-block mb-2 ${mode === m.id ? 'bg-primary-500/20' : 'bg-white/5'}`}>
                            <m.icon className={`w-5 h-5 ${mode === m.id ? 'text-primary-400' : 'text-slate-400'}`} />
                        </div>
                        <p className={`text-sm font-bold ${mode === m.id ? 'text-white' : 'text-slate-300'}`}>{m.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{m.desc}</p>
                    </button>
                ))}
            </div>

            {/* ═══ Mode Content ═══ */}
            <div className="glass-card rounded-3xl p-6 border border-white/10 min-h-[400px]">

                {/* ─── Manual Mode ─── */}
                {mode === 'manual' && (
                    <div>
                        <div className="flex flex-col md:flex-row gap-3 mb-4">
                            <div className="relative flex-1">
                                <Search className="absolute right-3 top-3 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    placeholder="بحث باسم الطالب أو الرقم..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pr-10 pl-4 text-sm text-white focus:outline-none focus:border-primary-500/50"
                                />
                            </div>
                            <select
                                value={gradeFilter}
                                onChange={e => setGradeFilter(e.target.value)}
                                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500/50 min-w-[140px]"
                            >
                                <option value="all">كل الصفوف</option>
                                {grades.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                            <button
                                onClick={() => setShowOnlyMissing(!showOnlyMissing)}
                                className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${showOnlyMissing
                                    ? 'bg-red-500/15 border-red-500/30 text-red-300'
                                    : 'bg-white/5 border-white/10 text-slate-300'
                                    }`}
                            >
                                {showOnlyMissing ? '❌ بدون رقم فقط' : '📋 الكل'}
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 mb-3">عدد النتائج: {filteredStudents.length}</p>

                        <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                            {filteredStudents.map(s => (
                                <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-white text-sm truncate">{s.name}</p>
                                        <p className="text-xs text-slate-400">{s.class_name} - {s.section} • <span className="font-mono text-slate-500">{s.id}</span></p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="tel"
                                            placeholder="05xxxxxxxx"
                                            defaultValue={s.guardian_phone || ''}
                                            onChange={e => setPhoneInputs(prev => ({ ...prev, [s.id]: e.target.value }))}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') savePhone(s, phoneInputs[s.id] ?? s.guardian_phone ?? '');
                                            }}
                                            className="w-36 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-primary-500/50 text-left"
                                            dir="ltr"
                                        />
                                        <button
                                            onClick={() => savePhone(s, phoneInputs[s.id] ?? s.guardian_phone ?? '')}
                                            disabled={saving === s.id}
                                            className="p-2 rounded-lg bg-primary-500/10 text-primary-400 border border-primary-500/20 hover:bg-primary-500/20 transition-all disabled:opacity-50"
                                        >
                                            {saving === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {filteredStudents.length === 0 && (
                                <div className="text-center py-16 text-slate-500">
                                    <CheckCircle className="w-12 h-12 mx-auto mb-3 text-emerald-500/50" />
                                    <p className="text-lg font-bold text-emerald-400">ممتاز!</p>
                                    <p className="text-sm">كل الطلاب لديهم أرقام أولياء أمور</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ─── Scanner Mode ─── */}
                {mode === 'scanner' && (
                    <div>
                        {!scannerActive ? (
                            <div className="py-16 text-center">
                                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500/20 to-secondary-500/20 border border-primary-500/30 flex items-center justify-center mx-auto mb-4">
                                    <Camera className="w-10 h-10 text-primary-400" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">مسح باركود الطالب</h3>
                                <p className="text-sm text-slate-400 mb-2">استخدم كاميرا الجوال أو الكمبيوتر لمسح باركود بطاقة الطالب</p>
                                {!isBarcodeDetectorSupported && (
                                    <p className="text-xs text-amber-400 mb-4">⚠️ المتصفح لا يدعم مسح الكاميرا مباشرة — يمكنك استخدام الإدخال اليدوي أو ماسح USB</p>
                                )}
                                <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
                                    <button
                                        onClick={() => { setScanInputMode('camera'); startScanner(); }}
                                        disabled={!isBarcodeDetectorSupported}
                                        className="px-8 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-600 text-white font-bold shadow-lg hover:shadow-primary-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Video className="w-5 h-5" />
                                        مسح بالكاميرا
                                    </button>
                                    <button
                                        onClick={() => { setScanInputMode('manual'); startScanner(); }}
                                        className="px-8 py-3 rounded-xl bg-white/10 border border-white/20 text-white font-bold hover:bg-white/15 transition-all flex items-center justify-center gap-2"
                                    >
                                        <ScanLine className="w-5 h-5" />
                                        ماسح USB / إدخال يدوي
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-2xl mx-auto space-y-4">
                                {/* Header Controls */}
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                                        {scanInputMode === 'camera' ? 'مسح الكاميرا نشط' : 'ماسح USB / يدوي'}
                                        {scanCount > 0 && (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/15 text-primary-300 border border-primary-500/20 font-mono">
                                                {scanCount} تم مسحهم
                                            </span>
                                        )}
                                    </h3>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setScanInputMode(scanInputMode === 'camera' ? 'manual' : 'camera')}
                                            disabled={scanInputMode === 'manual' && !isBarcodeDetectorSupported}
                                            className="p-2 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition disabled:opacity-40"
                                            title={scanInputMode === 'camera' ? 'التبديل لماسح USB' : 'التبديل للكاميرا'}
                                        >
                                            {scanInputMode === 'camera' ? <ScanLine className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                                        </button>
                                        <button onClick={stopScanner} className="p-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition">
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Camera View */}
                                {scanInputMode === 'camera' && (
                                    <div className="relative rounded-2xl overflow-hidden border-2 border-primary-500/30 bg-black aspect-video shadow-[0_0_30px_rgb(var(--color-primary-500)_/_0.1)]">
                                        <video
                                            ref={cameraVideoRef}
                                            className="w-full h-full object-cover"
                                            playsInline
                                            muted
                                            autoPlay
                                        />
                                        {/* Scanner Overlay Corners */}
                                        {cameraReady && (
                                            <div className="absolute inset-0 pointer-events-none">
                                                {/* Center scanning zone */}
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] h-[50%]">
                                                    {/* Corner brackets */}
                                                    <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-primary-400 rounded-tl-lg" />
                                                    <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-primary-400 rounded-tr-lg" />
                                                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-primary-400 rounded-bl-lg" />
                                                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-primary-400 rounded-br-lg" />
                                                    {/* Scanning line animation */}
                                                    <div className="absolute inset-x-4 h-0.5 bg-gradient-to-r from-transparent via-primary-400 to-transparent animate-scan-line" />
                                                </div>
                                                {/* Label */}
                                                <div className="absolute bottom-4 inset-x-0 text-center">
                                                    <span className="text-xs text-white/70 bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">
                                                        وجّه الكاميرا نحو باركود الطالب
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        {/* Loading State */}
                                        {!cameraReady && !cameraScanError && (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80">
                                                <Loader2 className="w-8 h-8 text-primary-400 animate-spin mb-3" />
                                                <p className="text-sm text-white/70">جاري تشغيل الكاميرا...</p>
                                            </div>
                                        )}
                                        {/* Error State */}
                                        {cameraScanError && (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 p-6">
                                                <VideoOff className="w-10 h-10 text-red-400 mb-3" />
                                                <p className="text-sm text-red-300 text-center">{cameraScanError}</p>
                                                <button
                                                    onClick={() => { stopCamera(); startCamera(); }}
                                                    className="mt-4 px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 transition"
                                                >
                                                    إعادة المحاولة
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Manual / USB Input */}
                                {scanInputMode === 'manual' && (
                                    <div className="relative">
                                        <input
                                            ref={scanInputRef}
                                            type="text"
                                            placeholder="امسح الباركود أو أدخل رقم الطالب..."
                                            className="w-full bg-white/5 border-2 border-primary-500/30 rounded-xl py-4 px-4 text-lg text-white text-center font-mono focus:outline-none focus:border-primary-500/60 shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.1)]"
                                            autoFocus
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    handleScanResult((e.target as HTMLInputElement).value);
                                                    (e.target as HTMLInputElement).value = '';
                                                }
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Scanned Student Card */}
                                {scannedStudent && (
                                    <div className="glass-card rounded-2xl p-5 border border-emerald-500/30 bg-emerald-500/5 animate-slide-in-left text-right">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="p-2 rounded-xl bg-emerald-500/20">
                                                <UserCheck className="w-6 h-6 text-emerald-400" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-bold text-white text-lg">{scannedStudent.name}</p>
                                                <p className="text-xs text-emerald-300">{scannedStudent.class_name} - {scannedStudent.section}</p>
                                            </div>
                                            <button
                                                onClick={() => { setScannedStudent(null); setScanPhone(''); }}
                                                className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                id="scan-phone-input"
                                                type="tel"
                                                placeholder="رقم ولي الأمر (05xxxxxxxx)"
                                                value={scanPhone}
                                                onChange={e => setScanPhone(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') saveScanPhone(); }}
                                                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-left focus:outline-none focus:border-emerald-500/50"
                                                dir="ltr"
                                            />
                                            <button
                                                onClick={saveScanPhone}
                                                disabled={scanSaving || !scanPhone.trim()}
                                                className="px-6 py-3 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {scanSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                حفظ
                                            </button>
                                        </div>
                                        {scannedStudent.guardian_phone && (
                                            <p className="text-xs text-slate-400 mt-2">الرقم الحالي: <span className="font-mono text-slate-300" dir="ltr">{scannedStudent.guardian_phone}</span></p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ─── Import Mode ─── */}
                {mode === 'import' && (
                    <div>
                        {!importFile ? (
                            <div className="py-16 text-center">
                                <label className="cursor-pointer">
                                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-secondary-500/20 to-secondary-500/20 border-2 border-dashed border-secondary-500/30 flex items-center justify-center mx-auto mb-4 hover:border-secondary-500/50 transition-all">
                                        <Upload className="w-10 h-10 text-secondary-400" />
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-2">رفع ملف أرقام أولياء الأمور</h3>
                                    <p className="text-sm text-slate-400">Excel (.xlsx) أو CSV — يحتوي على عمود معرف/اسم الطالب وعمود رقم الجوال</p>
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls,.csv"
                                        className="hidden"
                                        onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                                    />
                                </label>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-bold text-white">📊 {importFile.name} <span className="text-xs text-slate-400 font-normal mr-2">({importRows.length} صف)</span></h3>
                                    <button onClick={() => { setImportFile(null); setImportRows([]); setImportPreview([]); setImportColumnSamples({}); }}
                                        className="p-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Match Mode Selector */}
                                <div className="p-4 rounded-2xl border border-white/10 bg-white/5">
                                    <p className="text-sm font-bold text-white mb-3">🔗 طريقة مطابقة الطلاب</p>
                                    <div className="flex flex-wrap gap-2">
                                        {([
                                            { key: 'id' as const, label: 'بالمعرف (ID)', icon: '🔢' },
                                            { key: 'name' as const, label: 'بالاسم', icon: '📝' },
                                            { key: 'both' as const, label: 'بالمعرف + الاسم', icon: '🔗' }
                                        ]).map(opt => (
                                            <button
                                                key={opt.key}
                                                onClick={() => setImportMatchMode(opt.key)}
                                                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${importMatchMode === opt.key
                                                    ? 'bg-primary-500/15 border-primary-500/40 text-primary-300'
                                                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
                                            >
                                                {opt.icon} {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Column Mapping with Sample Data */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {/* ID Column */}
                                    {(importMatchMode === 'id' || importMatchMode === 'both') && (
                                        <div className="p-4 rounded-2xl border border-white/10 bg-white/5">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-sm font-semibold text-white">🔢 عمود المعرف</label>
                                                {importDetectionConfidence.id && (
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${importDetectionConfidence.id === 'High' ? 'bg-emerald-500/20 text-emerald-400' :
                                                            importDetectionConfidence.id === 'Medium' ? 'bg-amber-500/20 text-amber-400' :
                                                                'bg-red-500/20 text-red-400'
                                                        }`}>{importDetectionConfidence.id === 'High' ? 'تلقائي ✓' : importDetectionConfidence.id === 'Medium' ? 'مقترح' : 'يدوي'}</span>
                                                )}
                                            </div>
                                            <select
                                                value={importMapping.id}
                                                onChange={e => setImportMapping(prev => ({ ...prev, id: e.target.value }))}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500/50"
                                            >
                                                <option value="">— اختر —</option>
                                                {importColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                            {importMapping.id && importColumnSamples[importMapping.id] && (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {importColumnSamples[importMapping.id].map((s, i) => (
                                                        <code key={i} className="px-2 py-0.5 rounded-md bg-slate-700/50 text-slate-300 text-[10px] font-mono">{s}</code>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Name Column */}
                                    {(importMatchMode === 'name' || importMatchMode === 'both') && (
                                        <div className="p-4 rounded-2xl border border-white/10 bg-white/5">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-sm font-semibold text-white">📝 عمود الاسم</label>
                                                {importDetectionConfidence.name && (
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${importDetectionConfidence.name === 'High' ? 'bg-emerald-500/20 text-emerald-400' :
                                                            importDetectionConfidence.name === 'Medium' ? 'bg-amber-500/20 text-amber-400' :
                                                                'bg-red-500/20 text-red-400'
                                                        }`}>{importDetectionConfidence.name === 'High' ? 'تلقائي ✓' : importDetectionConfidence.name === 'Medium' ? 'مقترح' : 'يدوي'}</span>
                                                )}
                                            </div>
                                            <select
                                                value={importMapping.name}
                                                onChange={e => setImportMapping(prev => ({ ...prev, name: e.target.value }))}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500/50"
                                            >
                                                <option value="">— اختر —</option>
                                                {importColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                            {importMapping.name && importColumnSamples[importMapping.name] && (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {importColumnSamples[importMapping.name].map((s, i) => (
                                                        <code key={i} className="px-2 py-0.5 rounded-md bg-slate-700/50 text-slate-300 text-[10px] font-mono truncate max-w-[120px]">{s}</code>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Phone Column */}
                                    <div className="p-4 rounded-2xl border border-white/10 bg-white/5">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-sm font-semibold text-white">📱 عمود الجوال</label>
                                            {importDetectionConfidence.phone && (
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${importDetectionConfidence.phone === 'High' ? 'bg-emerald-500/20 text-emerald-400' :
                                                        importDetectionConfidence.phone === 'Medium' ? 'bg-amber-500/20 text-amber-400' :
                                                            'bg-red-500/20 text-red-400'
                                                    }`}>{importDetectionConfidence.phone === 'High' ? 'تلقائي ✓' : importDetectionConfidence.phone === 'Medium' ? 'مقترح' : 'يدوي'}</span>
                                            )}
                                        </div>
                                        <select
                                            value={importMapping.phone}
                                            onChange={e => setImportMapping(prev => ({ ...prev, phone: e.target.value }))}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-500/50"
                                        >
                                            <option value="">— اختر —</option>
                                            {importColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        {importMapping.phone && importColumnSamples[importMapping.phone] && (
                                            <div className="mt-2 flex flex-wrap gap-1">
                                                {importColumnSamples[importMapping.phone].map((s, i) => (
                                                    <code key={i} className="px-2 py-0.5 rounded-md bg-slate-700/50 text-slate-300 text-[10px] font-mono" dir="ltr">{s}</code>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Overwrite Toggle */}
                                <div className="flex items-center gap-4 p-3 rounded-xl border border-white/10 bg-white/5">
                                    <span className="text-sm text-slate-300">الأرقام الموجودة:</span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setImportOverwriteMode('skip')}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${importOverwriteMode === 'skip'
                                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                                : 'bg-white/5 border-white/10 text-slate-400'}`}
                                        >
                                            ⏭️ تخطي (لا تحدّث)
                                        </button>
                                        <button
                                            onClick={() => setImportOverwriteMode('overwrite')}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${importOverwriteMode === 'overwrite'
                                                ? 'bg-secondary-500/15 border-secondary-500/40 text-secondary-300'
                                                : 'bg-white/5 border-white/10 text-slate-400'}`}
                                        >
                                            🔄 تحديث (استبدال)
                                        </button>
                                    </div>
                                </div>

                                {/* Smart Summary + Preview */}
                                {importPreview.length > 0 && (
                                    <>
                                        {/* Summary Cards */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                            <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center">
                                                <div className="text-lg font-bold text-emerald-400">{importStats.willUpdate}</div>
                                                <div className="text-[10px] text-emerald-300">سيتم تحديثهم</div>
                                            </div>
                                            <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-center">
                                                <div className="text-lg font-bold text-red-400">{importStats.unmatched}</div>
                                                <div className="text-[10px] text-red-300">غير مطابق</div>
                                            </div>
                                            <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-center">
                                                <div className="text-lg font-bold text-amber-400">{importStats.willSkip}</div>
                                                <div className="text-[10px] text-amber-300">سيتم تخطيهم</div>
                                            </div>
                                            <div className="p-3 rounded-xl border border-secondary-500/20 bg-secondary-500/5 text-center">
                                                <div className="text-lg font-bold text-secondary-400">{importStats.invalidPhones}</div>
                                                <div className="text-[10px] text-secondary-300">رقم غير صالح</div>
                                            </div>
                                        </div>

                                        {/* Match type breakdown */}
                                        {importMatchMode === 'both' && importStats.matched > 0 && (
                                            <div className="flex gap-3 text-xs text-slate-400">
                                                <span>🔢 مطابقة بالمعرف: <strong className="text-primary-300">{importStats.byIdMatch}</strong></span>
                                                <span>📝 مطابقة بالاسم: <strong className="text-secondary-300">{importStats.byNameMatch}</strong></span>
                                            </div>
                                        )}

                                        {/* Preview Table */}
                                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-1">
                                            {importPreview.slice(0, 50).map((row, i) => (
                                                <div key={i} className={`flex items-center gap-3 p-2 rounded-lg text-sm ${row.student && row.phone
                                                        ? (importOverwriteMode === 'skip' && row.student.guardian_phone?.trim()
                                                            ? 'bg-slate-500/5 border border-slate-500/10 opacity-50'
                                                            : 'bg-emerald-500/5 border border-emerald-500/10')
                                                        : !row.student ? 'bg-red-500/5 border border-red-500/10'
                                                            : 'bg-amber-500/5 border border-amber-500/10'
                                                    }`}>
                                                    <div className="w-5">
                                                        {row.student && row.phone ? (
                                                            importOverwriteMode === 'skip' && row.student.guardian_phone?.trim()
                                                                ? <span className="text-slate-500 text-xs">⏭</span>
                                                                : <Check className="w-4 h-4 text-emerald-400" />
                                                        ) : !row.student ? <X className="w-4 h-4 text-red-400" />
                                                            : <AlertCircle className="w-4 h-4 text-amber-400" />}
                                                    </div>
                                                    {row.rawId && <span className="font-mono text-xs text-slate-400 w-20 shrink-0">{row.rawId}</span>}
                                                    <span className="flex-1 text-white truncate">
                                                        {row.student?.name || row.rawName || 'غير موجود'}
                                                    </span>
                                                    {row.matchType === 'name' && row.student && (
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary-500/20 text-secondary-300 border border-secondary-500/20 shrink-0">بالاسم</span>
                                                    )}
                                                    <span className="font-mono text-xs text-slate-300 shrink-0" dir="ltr">{row.phone || '—'}</span>
                                                </div>
                                            ))}
                                            {importPreview.length > 50 && (
                                                <p className="text-center text-xs text-slate-500 py-2">... و {importPreview.length - 50} صف آخر</p>
                                            )}
                                        </div>

                                        {/* Apply Button */}
                                        <button
                                            onClick={applyImport}
                                            disabled={importSaving || importStats.willUpdate === 0}
                                            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold shadow-lg hover:shadow-emerald-500/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {importSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                                            تطبيق {importStats.willUpdate} رقم
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ─── Auto-Fill Mode ─── */}
                {mode === 'autofill' && (
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Wand2 className="w-5 h-5 text-secondary-400" />
                                    التعبئة التلقائية (الإخوة)
                                </h3>
                                <p className="text-sm text-slate-400 mt-1">
                                    نسخ أرقام أولياء الأمور من طالب لديه رقم إلى إخوته (نفس اسم العائلة)
                                </p>
                            </div>
                            {siblingGroups.length > 0 && (
                                <button
                                    onClick={applyAutofill}
                                    disabled={autofillSaving || selectedSiblings.size === 0}
                                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-secondary-500 to-fuchsia-600 text-white font-bold shadow-lg hover:shadow-secondary-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {autofillSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                    تعبئة {selectedSiblings.size} طالب
                                </button>
                            )}
                        </div>

                        {siblingGroups.length === 0 ? (
                            <div className="text-center py-16 text-slate-500">
                                <Wand2 className="w-12 h-12 mx-auto mb-3 text-secondary-500/30" />
                                <p className="text-lg font-bold text-slate-400">لا توجد مجموعات إخوة</p>
                                <p className="text-sm">لم يتم العثور على طلاب بنفس اسم العائلة حيث أحدهم لديه رقم والآخرين بدون</p>
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {siblingGroups.map(group => (
                                    <div key={group.surname} className="glass-card rounded-2xl p-4 border border-secondary-500/10">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <p className="font-bold text-white">عائلة «{group.surname}»</p>
                                                <p className="text-xs text-slate-400 font-mono" dir="ltr">{group.phone}</p>
                                            </div>
                                            <span className="text-xs px-2 py-1 rounded-lg bg-secondary-500/15 text-secondary-300 border border-secondary-500/20">
                                                {group.noPhone.length} بدون رقم
                                            </span>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xs text-emerald-400 mb-1">✅ لديه رقم:</p>
                                            {group.hasPhone.map(s => (
                                                <p key={s.id} className="text-xs text-slate-300 pr-4">{s.name} • {s.class_name} - {s.section}</p>
                                            ))}
                                            <p className="text-xs text-amber-400 mt-2 mb-1">📥 سيتم النسخ إلى:</p>
                                            {group.noPhone.map(s => (
                                                <label key={s.id} className="flex items-center gap-2 text-xs text-slate-300 pr-4 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedSiblings.has(s.id)}
                                                        onChange={e => {
                                                            setSelectedSiblings(prev => {
                                                                const next = new Set(prev);
                                                                if (e.target.checked) next.add(s.id);
                                                                else next.delete(s.id);
                                                                return next;
                                                            });
                                                        }}
                                                        className="rounded border-slate-600"
                                                    />
                                                    {s.name} • {s.class_name} - {s.section}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminGuardianPhonesTab;
