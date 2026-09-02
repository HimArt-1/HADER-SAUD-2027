import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Play, Square, Terminal, AlertCircle, MessageSquare, Send, Clock, Moon, List, Edit, Settings, RotateCcw, CheckCircle, Paperclip, Pause, Trash2, Award, Zap, X, Volume2, VolumeX, Keyboard, Download, BookOpen } from 'lucide-react';
import { auth } from '../services/auth';
import { db, getLocalISODate } from '../services/db';
import { appSettings } from '../services/settings';
import { roster } from '../services/roster';
import { whatsappGateway } from '../services/whatsappGateway';
import { logger } from '../services/logger';
import { Role, Student, SchoolClass, AttendanceRecord } from '../types';
import type { WhatsAppQueueItem, WhatsAppStatus } from '../modules/whatsapp';
import { StudentSelectComponent, StudentSelectFilters, MultiStudentSelectComponent } from '../components/StudentSelect';
import { motion } from 'framer-motion';

// New Visual Components
import { TemplateManager } from '../components/whatsapp/TemplateManager';
import BadgeStudio from '../components/whatsapp/BadgeStudio';
import { WhatsAppTemplate, WhatsAppTriggers } from '../types';
import StatsPanel from '../components/whatsapp/StatsPanel';
import QueueVisualizer from '../components/whatsapp/QueueVisualizer';
import { useConfirm } from '../components/ConfirmDialog';

// ═══════════════════════════════════════════════════════════════
// 🆕 New Enhancement Hooks & Components
// ═══════════════════════════════════════════════════════════════
import useConnectionMonitor from '../hooks/useConnectionMonitor';
import {
  getWhatsAppLauncherZipHref,
  getWhatsAppMacZipHref,
  getWhatsAppWindowsZipHref,
  WHATSAPP_LAUNCHER_ZIP_FILENAME,
  WHATSAPP_LAUNCHER_MAC_FILENAME,
  WHATSAPP_LAUNCHER_WINDOWS_FILENAME,
} from '../constants/whatsappLauncher';
import ConnectionStatusBadge from '../components/whatsapp/ConnectionStatusBadge';
import SendingProgress from '../components/whatsapp/SendingProgress';
import { QueueListSkeleton, StatsSkeleton } from '../components/whatsapp/Skeletons';
import { useWhatsAppShortcuts, formatShortcut } from '../hooks/useKeyboardShortcuts';
import useSoundEffects from '../hooks/useSoundEffects';
import useQueuePersistence from '../hooks/useQueuePersistence';
import { useAdminTheme } from '../hooks/useAdminTheme';
import { UniversalGuideModal, GuideStep } from '../components/common/UniversalGuideModal';
import { Chrome, Smartphone, CheckCircle2 } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// ⌨️ مكون عرض الاختصار
// ═══════════════════════════════════════════════════════════════
const ShortcutItem: React.FC<{ keys: string; label: string }> = ({ keys, label }) => (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-800/50">
        <span className="text-gray-400">{label}</span>
        <kbd className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-gray-300 font-mono text-[10px]">
            {keys}
        </kbd>
    </div>
);

// ═══════════════════════════════════════════════════════════════
// 🔑 دالة توليد ID فريد وآمن
// ═══════════════════════════════════════════════════════════════
const generateSecureId = (): string => {
    // استخدام crypto API للأمان إن توفر، وإلا استخدام timestamp + random
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback آمن: timestamp + random hex
    const timestamp = Date.now().toString(36);
    const randomPart = Array.from({ length: 8 }, () =>
        Math.floor(Math.random() * 16).toString(16)
    ).join('');
    return `${timestamp}-${randomPart}`;
};

const formatAttendanceTime = (timestamp?: string | null): string => {
    if (!timestamp) return '-';

    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    }

    const timeMatch = String(timestamp).match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
        return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    }

    return '-';
};

type QueueItem = WhatsAppQueueItem;

const DEFAULT_TEMPLATES: WhatsAppTemplate[] = [
    {
        id: 'tpl_present',
        name: 'حضور طالب (إشعار لحظي)',
        content: 'السلام عليكم، وصل ابنكم/ابنتكم {StudentName} بسلامة الله في تمام الساعة {Time}.',
        category: 'present',
        is_default: true
    },
    {
        id: 'tpl_late',
        name: 'تأخر طالب',
        content: 'السلام عليكم، نفيدكم بتأخر الطالب {StudentName} عن الحضور اليوم {Date}. وقت الحضور: {Time}.',
        category: 'late',
        is_default: true
    },
    {
        id: 'tpl_absent',
        name: 'غياب طالب',
        content: 'السلام عليكم، نفيدكم بغياب الطالب {StudentName} اليوم {Date}. نرجو تزويدنا بسبب الغياب.',
        category: 'absence',
        is_default: true
    },
    {
        id: 'tpl_general',
        name: 'رسالة عامة',
        content: 'السلام عليكم، ولي أمر الطالب {StudentName} المحترم. {Message}',
        category: 'general',
        is_default: true
    },
    {
        id: 'tpl_dismissal',
        name: 'انصراف طالب',
        content: 'السلام عليكم، نفيدكم بأن الطالب {StudentName} من {Class} قد تم تسجيل انصرافه الساعة {Time} بتاريخ {Date}.',
        category: 'dismissal',
        is_default: true
    }
];

const WhatsAppControl: React.FC = () => {
    // ═══════════════════════════════════════════════════════════════
    // 🪝 Hooks
    // ═══════════════════════════════════════════════════════════════
    const { confirm, ConfirmDialog } = useConfirm();

    // 🎨 Unified Theme
    useAdminTheme();

    // 🔔 Sound Effects (معطلة افتراضياً - يمكن تفعيلها من زر الصوت)
    const soundEffects = useSoundEffects({ enabled: false, volume: 0.3 });

    // --- State (must be declared before hooks that reference them) ---
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [serverError, setServerError] = useState<string | null>(null);
    const [localToast, setLocalToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [showGuide, setShowGuide] = useState(false);

    const whatsappGuideSteps: GuideStep[] = [
        {
            title: "الخطوة الأولى: تهيئة البيئة",
            description: "يجب التأكد من وجود المتطلبات الأساسية لتشغيل نظام الأتمتة على جهازك الشخصي.",
            icon: Chrome,
            color: "blue",
            details: [
                "تثبيت متصفح Google Chrome (إصدار حديث).",
                "تثبيت لغة Python (إصدار 3.10 أو أعلى).",
                "تفعيل خيار 'Add Python to PATH' أثناء التثبيت."
            ],
            externalLinks: [
                { label: "تحميل Python", href: "https://www.python.org/downloads/", icon: Chrome, color: "blue" },
                { label: "تحميل Chrome", href: "https://www.google.com/chrome/", icon: Chrome, color: "emerald" }
            ]
        },
        {
            title: "الخطوة الثانية: تحميل المشغل",
            description: "اختر الحزمة المناسبة لنظام تشغيلك وفك ضغطها في مجلد خاص على جهازك.",
            icon: Download,
            color: "green",
            details: [
                "Mac / Linux: حمّل hader_whatsapp_mac.zip ثم شغّل run_mac.sh.",
                "Windows: حمّل hader_whatsapp_windows.zip ثم شغّل run_windows.bat.",
                "فك ضغط الملف في مكان يسهل الوصول إليه (مثل سطح المكتب).",
                "تأكد من وجود server.py وwhatsapp_pro_tool.py داخل المجلد."
            ],
            actionLabel: "تحميل حزمة Mac (ZIP)",
            actionHref: getWhatsAppMacZipHref(),
            isDownload: true,
            downloadFilename: WHATSAPP_LAUNCHER_MAC_FILENAME,
            secondaryActionLabel: "تحميل حزمة Windows (ZIP)",
            secondaryActionHref: getWhatsAppWindowsZipHref(),
            secondaryDownloadFilename: WHATSAPP_LAUNCHER_WINDOWS_FILENAME,
        },
        {
            title: "الخطوة الثالثة: تشغيل الخادم",
            description: "نقوم الآن بتشغيل المحرك المحلي الذي سيتواصل مع الواتساب.",
            icon: Terminal,
            color: "purple",
            details: [
                "اضغط مرتين على ملف run_windows.bat.",
                "انتظر حتى يتم تثبيت المكتبات (للمرة الأولى فقط).",
                "سيفتح نافذة تيرمنال جديدة، لا تقم بإغلاقها أبداً."
            ]
        },
        {
            title: "الخطوة الرابعة: الربط والتحقق",
            description: "ربط حساب الواتساب الخاص بك بالمحرك الذكي.",
            icon: Smartphone,
            color: "emerald",
            details: [
                "ستفتح نافذة كروم جديدة تطلب مسح رمز QR.",
                "افتح واتساب على جوالك > الأجهزة المرتبطة > ربط جهاز.",
                "بعد المسح، ستتحول الحالة في الموقع إلى 'متصل'."
            ]
        },
        {
            title: "الخطوة الخامسة: الإرسال الذكي",
            description: "أنت الآن جاهز لإرسال الرسائل والأوسمة للطلاب.",
            icon: CheckCircle2,
            color: "amber",
            details: [
                "اختر الطلاب من القوائم أو الإرسال اليدوي.",
                "حدد قالب الرسالة المناسب.",
                "اضغط 'إرسال' وراقب تقدم العملية في الطابور."
            ]
        }
    ];

    // ═══════════════════════════════════════════════════════════════
    // 🔔 Toast Helper - بديل لـ alert()
    // ═══════════════════════════════════════════════════════════════
    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setLocalToast({ message, type });
    }, []);

    // 🔌 Connection Monitor - ⚡ تم زيادة الفترة لتقليل الحمل
    const connectionOptions = useMemo(() => ({
        checkInterval: 30000, // 30 ثانية
        maxRetries: 5,
        onReconnected: () => {
            setLocalToast({ message: 'تم إعادة الاتصال بالخادم', type: 'success' });
            soundEffects.playSuccess();
        },
        onDisconnected: () => {
            setLocalToast({ message: 'انقطع الاتصال بالخادم', type: 'error' });
            soundEffects.playError();
        },
    }), [soundEffects]); // Add dependencies as needed

    const connection = useConnectionMonitor(connectionOptions);

    // 💾 Queue Persistence
    const queuePersistence = useQueuePersistence({
        enabled: true,
        autoSaveInterval: 5000,
        saveOnChange: true,
    });

    // Auto-hide toast
    useEffect(() => {
        if (localToast) {
            const timer = setTimeout(() => setLocalToast(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [localToast]);

    // Data
    const [students, setStudents] = useState<Student[]>([]);
    const [classes, setClasses] = useState<SchoolClass[]>([]);
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [attendanceError, setAttendanceError] = useState<string | null>(null);

    // View State

    // View State
    const [mainView, setMainView] = useState<'compose' | 'templates' | 'badges' | 'automation'>('badges'); // Default to badges as requested

    const [templates, setTemplates] = useState<WhatsAppTemplate[]>(DEFAULT_TEMPLATES);

    // Ref لتخزين selectedTemplateId لتجنب dependency loop
    const selectedTemplateIdRef = useRef<string>('tpl_general');

    // Load templates from settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const settings = await appSettings.load();
                if (settings?.whatsapp_templates && settings.whatsapp_templates.length > 0) {
                    setTemplates(settings.whatsapp_templates);
                    // If selected template is not in new list, select first one
                    if (!settings.whatsapp_templates.find(t => t.id === selectedTemplateIdRef.current)) {
                        setSelectedTemplateId(settings.whatsapp_templates[0]?.id || '');
                    }
                }
            } catch (error) {
                console.error('فشل تحميل الإعدادات:', error);
            }
        };
        loadSettings();
    }, []);

    const handleSaveTemplates = async (newTemplates: WhatsAppTemplate[]) => {
        setTemplates(newTemplates);
        await appSettings.execute({
            type: 'patch',
            changes: { whatsapp_templates: newTemplates }
        });
    };

    // UI Logic
    const [activeTab, setActiveTab] = useState<'single' | 'late' | 'absence'>('single');
    const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
    const [manualSelectedIds, setManualSelectedIds] = useState<string[]>([]); // New: Manual Multi Select
    const [filters, setFilters] = useState<StudentSelectFilters>({ class_name: '', section: '', search: '' });

    // Message Config
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl_general');
    const [messageText, setMessageText] = useState('');

    // تحديث الـ ref عند تغيير selectedTemplateId
    useEffect(() => {
        selectedTemplateIdRef.current = selectedTemplateId;
    }, [selectedTemplateId]);

    // Simulation & Execution
    const [isSimulationMode, setIsSimulationMode] = useState(false);
    const [executionQueue, setExecutionQueue] = useState<QueueItem[]>([]);
    const [processingId, setProcessingId] = useState<string | undefined>(undefined);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPaused, setIsPaused] = useState(false); // New: Paused State
    const [startStopLoading, setStartStopLoading] = useState(false);

    // Refs لمنع Race Conditions والطلبات المتزامنة
    const isFetchingStatusRef = useRef(false);
    const isFetchingQueueRef = useRef(false);
    const isProcessingRef = useRef(false);

    // Auto-Pilot State
    const [autoPilot, setAutoPilot] = useState(false);
    const [autoPilotTime, setAutoPilotTime] = useState('09:00');

    // Live Notifications State (On Present)
    const [onPresentEnabled, setOnPresentEnabled] = useState(false);

    // Stats
    const stats = useMemo(() => ({
        total: executionQueue.length,
        success: executionQueue.filter(i => i.status === 'sent').length,
        pending: executionQueue.filter(i => i.status === 'pending' || i.status === 'sending').length,
        failed: executionQueue.filter(i => i.status === 'failed').length
    }), [executionQueue]);

    // Attachments
    const [attachment, setAttachment] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [attachmentPath, setAttachmentPath] = useState<string | null>(null);

    const user = auth.getSession();
    const hasPermission = user?.role === Role.SITE_ADMIN || user?.can_use_whatsapp;

    // --- Effects & fetchers ---
    const fetchStatus = async () => {
        // منع الطلبات المتزامنة
        if (isFetchingStatusRef.current) return;
        isFetchingStatusRef.current = true;

        try {
            setStatus(await whatsappGateway.getStatus());
            setServerError(null);
        } catch {
            if (!isSimulationMode) setServerError('الخادم غير متصل');
        } finally {
            isFetchingStatusRef.current = false;
        }
    };

    const fetchQueue = async () => {
        // منع الطلبات المتزامنة
        if (isFetchingQueueRef.current) return;
        isFetchingQueueRef.current = true;
        try {
            const queue = await whatsappGateway.getQueue();
            if (!isSimulationMode) {
                setExecutionQueue(queue);
                // 💾 حفظ الطابور محلياً
                queuePersistence.updateQueue(queue);
            }
            setIsLoading(false);
        } catch (e) {
            console.error(e);
            setIsLoading(false);
        } finally {
            isFetchingQueueRef.current = false;
        }
    };

    // Badge Sending Handler
    const handleBadgeSend = async (file: File, message: string) => {
        // For badges, we use the FIRST selected student from manual list
        if (manualSelectedIds.length !== 1) {
            showToast("يرجى اختيار طالب واحد فقط لإرسال الوسام", "error");
            return;
        }

        const student = students.find(s => s.id === manualSelectedIds[0]);
        if (!student) return;

        try {
            const path = await whatsappGateway.upload(file);

            // 2. Queue
            const phone = student.whatsapp_phone || student.parent_phone || student.guardian_phone;
            if (!phone) throw new Error("لا يوجد رقم هاتف");

            const payload = {
                phone,
                message,
                student_name: student.name,
                attachment: path,
                status_label: 'وسام'
            };

            await whatsappGateway.enqueue([payload]);
            showToast("تم إرسال الوسام بنجاح! 🏆", "success");
            fetchQueue();
            setManualSelectedIds([]);

        } catch (e) {
            console.error(e);
            showToast("حدث خطأ أثناء الإرسال", "error");
        }
    };


    const loadAttendanceLists = useCallback(async (forceSync = false) => {
        if (!hasPermission) return;

        setAttendanceLoading(true);
        setAttendanceError(null);

        try {
            if (forceSync) {
                await db.forceSyncNow();
            }

            const today = getLocalISODate();
            const [rosterSnapshot, todayAttendance] = await Promise.all([
                roster.load({ forceSync }),
                db.getAttendance(today)
            ]);

            setStudents(rosterSnapshot.students);
            setClasses(rosterSnapshot.classes);
            setAttendance(todayAttendance);
        } catch (error) {
            console.error('فشل تحميل قوائم الغياب والتأخر:', error);
            setAttendanceError('تعذر تحميل قوائم الغياب والتأخر');
            showToast('تعذر تحميل قوائم الغياب والتأخر', 'error');
        } finally {
            setAttendanceLoading(false);
        }
    }, [hasPermission, showToast]);

    useEffect(() => {
        if (hasPermission) {
            void loadAttendanceLists(false);

            // Load Settings including AutoPilot and Live Notifications
            appSettings.load().then(s => {
                if (s) {
                    if (s.whatsapp_templates) setTemplates(s.whatsapp_templates);
                    if (s.whatsapp_autopilot !== undefined) setAutoPilot(s.whatsapp_autopilot);
                    if (s.whatsapp_autopilot_time) setAutoPilotTime(s.whatsapp_autopilot_time);
                    if (s.whatsapp_triggers?.on_present !== undefined) setOnPresentEnabled(s.whatsapp_triggers.on_present);
                }
            });

            // 💾 استرداد الطابور من الحفظ المحلي
            const savedQueue = queuePersistence.loadQueue();
            if (savedQueue && savedQueue.length > 0) {
                setExecutionQueue(savedQueue);
                if (queuePersistence.recoveredFromBackup) {
                    showToast('تم استرداد الطابور من النسخة الاحتياطية', 'success');
                }
            }

            // Poll status only if NOT in simulation
            // ⚡ تم زيادة فترة الـ polling إلى 10 ثوان لتقليل الحمل على الخادم
            // useConnectionMonitor يتحقق من حالة الاتصال بشكل منفصل
            if (!isSimulationMode) {
                fetchStatus();
                fetchQueue();
                const i = setInterval(() => {
                    fetchQueue();
                }, 10000); // زيادة من 3000 إلى 10000 مللي ثانية
                return () => clearInterval(i);
            } else {
                setIsLoading(false);
            }
        }
    }, [hasPermission, isSimulationMode, loadAttendanceLists]);

    useEffect(() => {
        if (!hasPermission) return;

        const sub = db.subscribeToAttendance((newRecord) => {
            if (newRecord.date !== getLocalISODate()) return;

            setAttendance(prev => {
                const idx = prev.findIndex(r => r.student_id === newRecord.student_id && r.date === newRecord.date);
                if (idx === -1) return [newRecord, ...prev];

                const next = [...prev];
                next[idx] = { ...next[idx], ...newRecord };
                return next;
            });
        });

        return () => sub.unsubscribe();
    }, [hasPermission]);

    // ⌨️ Keyboard Shortcuts
    useWhatsAppShortcuts({
        onSend: () => {
            if (selectedStudents.length > 0) {
                addToQueue();
                soundEffects.playSend();
            }
        },
        onPause: () => {
            setIsPaused(prev => !prev);
            soundEffects.playClick();
        },
        onRefresh: () => {
            fetchQueue();
            fetchStatus();
            void loadAttendanceLists(true);
            soundEffects.playClick();
        },
        onToggleAutoPilot: () => {
            saveAutoPilotSettings(!autoPilot, autoPilotTime);
            soundEffects.playNotification();
        },
    }, hasPermission);

    // Save AutoPilot Settings
    const saveAutoPilotSettings = async (enabled: boolean, time: string) => {
        setAutoPilot(enabled);
        setAutoPilotTime(time);
        await appSettings.execute({
            type: 'patch',
            changes: { whatsapp_autopilot: enabled, whatsapp_autopilot_time: time }
        });
    };

    // Save Live Notifications (On Present) Settings
    const saveOnPresentSettings = async (enabled: boolean) => {
        setOnPresentEnabled(enabled);
        const current = await appSettings.load();
        await appSettings.execute({
            type: 'patch',
            changes: {
                whatsapp_triggers: {
                    ...(current.whatsapp_triggers || {}),
                    on_present: enabled
                }
            }
        });
        showToast(enabled ? 'تم تفعيل الإشعار المباشر للحضور' : 'تم إيقاف الإشعار المباشر للحضور', 'success');
    };



    // --- Lists Computation ---
    const lateList = useMemo(() => {
        const today = getLocalISODate();
        const studentById = new Map(students.filter(s => s.is_active !== false).map(s => [s.id, s]));

        return attendance
            .filter(r => r.date === today && r.status === 'late')
            .map(r => {
                const s = studentById.get(r.student_id);
                return s ? { ...s, record: r } : null;
            }).filter((s): s is Student & { record: AttendanceRecord } => !!s);
    }, [attendance, students]);

    const absentList = useMemo(() => {
        const today = getLocalISODate();
        const recordByStudent = new Map<string, AttendanceRecord>();

        for (const record of attendance) {
            if (record.date === today) {
                recordByStudent.set(record.student_id, record);
            }
        }

        return students.filter(s => s.is_active !== false).filter(s => {
            const record = recordByStudent.get(s.id);
            return !record || record.status === 'absent';
        }).map(s => {
            const existingRecord = recordByStudent.get(s.id);
            const record = existingRecord || {
                id: `implicit_${s.id}`,
                student_id: s.id,
                date: today,
                timestamp: new Date().toISOString(),
                status: 'absent',
                minutes_late: 0
            } as AttendanceRecord;
            return { ...s, record };
        });
    }, [attendance, students]);

    // Auto-Pilot Scheduler
    useEffect(() => {
        if (!autoPilot || !lateList.length) return;

        const checkTime = () => {
            const now = new Date();
            const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            if (currentTime === autoPilotTime) {
                const today = getLocalISODate();
                const lastRun = localStorage.getItem('hader_autopilot_last_run');

                if (lastRun !== today) {
                    logger.debug('WhatsApp', '🤖 Auto-Pilot Triggered!');
                    const template = templates.find(t => t.category === 'late') || templates[0];
                    const msg = template.content; // Default late message

                    const newItems = lateList.filter(s => s.guardian_phone).map(s => {
                        const timeLabel = formatAttendanceTime(s.record.timestamp);

                        return {
                            id: generateSecureId(),
                            studentName: s.name,
                            phone: s.guardian_phone!,
                            message: msg.replace('{StudentName}', s.name).replace('{Date}', today).replace('{Time}', timeLabel === '-' ? '07:30' : timeLabel),
                            status: 'pending' as const,
                            timestamp: Date.now(),
                            statusLabel: 'تأخر'
                        };
                    });

                    if (newItems.length > 0) {
                        void whatsappGateway.enqueue(newItems.map(item => ({
                                phone: item.phone,
                                message: item.message,
                                student_name: item.studentName,
                                status_label: item.statusLabel
                            }))).then(() => {
                            localStorage.setItem('hader_autopilot_last_run', today);
                            fetchQueue();
                            showToast(`🤖 تم تشغيل الطيار الآلي: تم إرسال ${newItems.length} رسالة تأخر.`, "success");
                        }).catch((error) => {
                            console.error('فشل الطيار الآلي:', error);
                            showToast("فشل إرسال رسائل الطيار الآلي", "error");
                        });
                    }
                }
            }
        };

        const timer = setInterval(checkTime, 60000); // Check every minute
        checkTime(); // Check immediately too

        return () => clearInterval(timer);
    }, [autoPilot, autoPilotTime, lateList, templates]);

    const handleSend = async () => {
        // handleSend delegates entirely to addToQueue which handles all tabs
        addToQueue();
    };

    const processMessage = (student: Student, record?: AttendanceRecord, templateId?: string, customText?: string) => {
        const tpl = templates.find(t => t.id === templateId) || templates[0];
        let content = tpl?.content || '';
        const dateStr = getLocalISODate();
        const formattedTime = record?.timestamp ? formatAttendanceTime(record.timestamp) : '-';
        const timeStr = formattedTime === '-' ? '07:30' : formattedTime;

        // استبدال المتغيرات مع دعم أسماء متعددة (case-insensitive)
        const replacements: [RegExp, string][] = [
            [/\{(StudentName|student_name|name|student|اسم|الطالب|اسم_الطالب)\}/gi, student.name],
            [/\{(Date|date|تاريخ|التاريخ)\}/gi, dateStr],
            [/\{(Time|time|وقت|الوقت)\}/gi, timeStr],
            [/\{(Message|message|msg|text|رسالة|الرسالة|نص)\}/gi, customText || ''],
            [/\{(Class|class|class_name|فصل|الفصل|الصف)\}/gi, student.class_name || ''],
            [/\{(Section|section|شعبة|الشعبة|القسم)\}/gi, student.section || ''],
        ];

        for (const [regex, value] of replacements) {
            content = content.replace(regex, value);
        }
        return content;
    };

    const currentList = useMemo(() => {
        if (activeTab === 'late') return lateList;
        if (activeTab === 'absence') return absentList; // Fix: activeTab check
        return [];
    }, [activeTab, lateList, absentList]);

    useEffect(() => {
        if (activeTab === 'single') return;

        const allowedIds = new Set(currentList.map(s => s.id));
        setSelectedStudents(prev => prev.filter(id => allowedIds.has(id)));
    }, [activeTab, currentList]);

    const allCurrentSelected = currentList.length > 0 && selectedStudents.length === currentList.length;

    const addToQueue = useCallback(() => {
        let newItems: QueueItem[] = [];

        if (activeTab === 'single') {
            const targets = students.filter(s => manualSelectedIds.includes(s.id));
            if (targets.length === 0) {
                showToast('يرجى اختيار طالب واحد على الأقل', 'error');
                return;
            }

            newItems = targets.filter(s => s.guardian_phone).map(s => ({
                id: generateSecureId(),
                studentName: s.name,
                phone: s.guardian_phone!,
                message: processMessage(s, undefined, selectedTemplateId, messageText),
                status: 'pending' as const,
                timestamp: Date.now(),
                statusLabel: 'يدوي'
            }));
        } else {
            const targets = currentList.filter(s => selectedStudents.includes(s.id));
            if (targets.length === 0) {
                showToast('لم يتم تحديد أي طالب', 'error');
                return;
            }

            newItems = targets.filter(s => s.guardian_phone).map(s => ({
                id: generateSecureId(),
                studentName: s.name,
                phone: s.guardian_phone!,
                message: processMessage(s, s.record, selectedTemplateId, messageText),
                status: 'pending' as const,
                timestamp: Date.now(),
                statusLabel: activeTab === 'late' ? 'تأخر' : 'غائب'
            }));
        }

        if (newItems.length === 0) {
            showToast('لا يوجد طلاب لديهم أرقام هواتف صالحة في القائمة المختارة', 'error');
            return;
        }

        if (!isSimulationMode) {
            // Direct send to server (Real Mode)
            void whatsappGateway.enqueue(newItems.map(item => ({
                    phone: item.phone,
                    message: item.message,
                    attachment: attachmentPath,
                    student_name: item.studentName,
                    status_label: item.statusLabel
                }))).then(() => {
                showToast(`تم إرسال ${newItems.length} رسالة للطابور`, 'success');
                if (activeTab === 'single') setManualSelectedIds([]);
                else setSelectedStudents([]);
                fetchQueue();
            }).catch(() => showToast('خطأ في الاتصال بالخادم', 'error'));
        } else {
            // Simulation Mode
            setExecutionQueue(prev => [...prev, ...newItems]);
            if (activeTab === 'single') setManualSelectedIds([]);
            else setSelectedStudents([]);
            showToast(`تمت إضافة ${newItems.length} رسالة لمحاكاة الطابور`, 'success');
        }
    }, [activeTab, students, manualSelectedIds, selectedStudents, currentList, selectedTemplateId, messageText, isSimulationMode, attachmentPath, showToast]);

    // ═══════════════════════════════════════════════════════════════
    // 🔄 معالجة الطابور (Simulation Mode Only)
    // ═══════════════════════════════════════════════════════════════
    const processQueue = useCallback(async () => {
        // ONLY FOR SIMULATION MODE
        if (!isSimulationMode) return;

        // استخدام ref لمنع التشغيل المتزامن بدلاً من state
        if (isProcessingRef.current || isPaused) return;
        isProcessingRef.current = true;
        setIsProcessing(true);

        try {
            const pendingItems = executionQueue.filter(i => i.status === 'pending');

            for (const item of pendingItems) {
                if (isPaused || !isProcessingRef.current) {
                    break;
                }

                setProcessingId(item.id);
                setExecutionQueue(q => q.map(x => x.id === item.id ? { ...x, status: 'sending' } : x));

                await new Promise(r => setTimeout(r, 1500));

                // Simulation result
                const success = Math.random() > 0.1;
                setExecutionQueue(q => q.map(x => x.id === item.id ? { ...x, status: success ? 'sent' : 'failed' } : x));
            }
        } finally {
            setProcessingId(undefined);
            setIsProcessing(false);
            isProcessingRef.current = false;
        }
    }, [isSimulationMode, isPaused, executionQueue]);

    // تشغيل معالجة الطابور تلقائياً عند وجود عناصر معلقة
    useEffect(() => {
        // استخدام ref للتحقق بدلاً من state لمنع الحلقة اللانهائية
        if (isSimulationMode &&
            executionQueue.some(i => i.status === 'pending') &&
            !isProcessingRef.current &&
            !isPaused) {
            processQueue();
        }
    }, [isSimulationMode, executionQueue, isPaused, processQueue]);

    const removeFromQueue = async (id: string) => {
        const confirmed = await confirm({
            title: 'حذف الرسالة',
            message: 'هل أنت متأكد من حذف هذه الرسالة من الطابور؟',
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            variant: 'danger'
        });

        if (confirmed) {
            // حفظ العنصر للـ rollback إذا فشل الحذف
            const itemToDelete = executionQueue.find(item => item.id === id);

            // Optimistic update
            setExecutionQueue(prev => prev.filter(item => item.id !== id));

            if (!isSimulationMode) {
                try {
                    await whatsappGateway.control({ type: 'remove', id });
                } catch (error) {
                    console.error('Failed to delete from server:', error);
                    setLocalToast({ message: 'فشل الحذف من الخادم', type: 'error' });
                    // Rollback: إعادة العنصر إلى الطابور
                    if (itemToDelete) {
                        setExecutionQueue(prev => [...prev, itemToDelete]);
                    }
                }
            }
        }
    };
    const handleBotAction = useCallback(async (action: 'start' | 'stop') => {
        if (isSimulationMode) {
            showToast('لا يمكن التحكم في البوت في وضع المحاكاة', 'error');
            return;
        }
        setStartStopLoading(true);
        try {
            await whatsappGateway.control(action);
            fetchStatus();
            showToast(`تم ${action === 'start' ? 'تشغيل' : 'إيقاف'} البوت بنجاح`, 'success');
        } catch {
            showToast('خطأ في الاتصال', 'error');
        } finally {
            setStartStopLoading(false);
        }
    }, [isSimulationMode, showToast]);

    if (!hasPermission) return <div className="p-8 text-center text-white">غير مصرح...</div>;

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8 animate-fade-in text-right" dir="rtl">
            {/* رأس الصفحة */}
            <div className="flex flex-col items-stretch justify-between gap-4 mb-8 md:flex-row md:items-center">
                <div className="min-w-0">
                    <h1 className="flex items-center gap-3 text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-600 sm:text-4xl">
                        <MessageSquare className="w-9 h-9 shrink-0 text-green-500 sm:h-10 sm:w-10" />
                        منصة واتساب الذكية
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                        <p className="text-gray-400 text-lg">مركز القيادة والتحكم بالاتصال</p>
                        {/* 🔌 Connection Status Badge */}
                        <ConnectionStatusBadge
                            status={connection.status}
                            latency={connection.latency}
                            reconnectAttempts={connection.reconnectAttempts}
                            isOnline={connection.isOnline}
                            onReconnect={connection.reconnect}
                        />
                    </div>
                </div>

                <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto md:justify-end">
                    {/* 🔊 Sound Toggle */}
                    <button
                        onClick={() => {
                            soundEffects.toggleMute();
                            soundEffects.playClick();
                        }}
                        className={`p-2 rounded-xl border transition-all ${soundEffects.isMuted
                            ? 'bg-gray-800 border-gray-700 text-gray-500'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            }`}
                        title={soundEffects.isMuted ? 'تشغيل الأصوات' : 'كتم الأصوات'}
                    >
                        {soundEffects.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>

                    {/* ⌨️ Shortcuts Toggle */}
                    <button
                        onClick={() => setShowShortcuts(!showShortcuts)}
                        className={`p-2 rounded-xl border transition-all ${showShortcuts
                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                            : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                            }`}
                        title="اختصارات لوحة المفاتيح"
                    >
                        <Keyboard className="w-4 h-4" />
                    </button>
                    {/* View Switcher */}
                    <div className="grid min-w-0 flex-1 grid-cols-3 rounded-xl border border-gray-700 bg-gray-800/50 p-1 sm:flex sm:flex-none">
                        <button
                            onClick={() => setMainView('compose')}
                            className={`rounded-lg px-2 py-2 text-sm font-bold transition-all sm:px-4 ${mainView === 'compose' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            إرسال
                        </button>
                        <button
                            onClick={() => setMainView('badges')}
                            className={`rounded-lg px-2 py-2 text-sm font-bold transition-all sm:px-4 ${mainView === 'badges' ? 'bg-amber-500 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            <Zap className="w-3 h-3 inline-block ml-1" />
                            استوديو الأوسمة
                        </button>
                        <button
                            onClick={() => setMainView('templates')}
                            className={`rounded-lg px-2 py-2 text-sm font-bold transition-all sm:px-4 ${mainView === 'templates' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            القوالب
                        </button>
                    </div>

                    {/* Simulation Toggle */}
                    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-700 bg-gray-800/50 p-2">
                        <span className={`text-xs font-bold ${isSimulationMode ? 'text-blue-400' : 'text-gray-500'}`}>وضع المحاكاة</span>
                        <button
                            onClick={() => setIsSimulationMode(!isSimulationMode)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${isSimulationMode ? 'bg-blue-600' : 'bg-gray-600'}`}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${isSimulationMode ? 'left-1' : 'right-1'}`} />
                        </button>
                    </div>

                    <div className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 sm:px-4 ${status?.running ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-gray-800/50 border-gray-700 text-gray-400'}`}>
                        <div className={`w-3 h-3 rounded-full ${status?.running ? 'bg-green-500' : 'bg-gray-500'}`} />
                        {status?.running ? 'متصل (Live)' : 'غير متصل'}
                    </div>

                    {/* Download Buttons — platform-specific */}
                    <div className="flex gap-2 flex-wrap">
                        <a
                            href={getWhatsAppMacZipHref()}
                            download={WHATSAPP_LAUNCHER_MAC_FILENAME}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold bg-slate-800 border border-slate-700 text-emerald-400 rounded-xl hover:bg-slate-700 transition-all shadow-lg"
                            title="تحميل خادم التشغيل (Mac)"
                        >
                            <Download className="w-4 h-4" />
                            <span className="hidden sm:inline">Mac</span>
                        </a>
                        <a
                            href={getWhatsAppWindowsZipHref()}
                            download={WHATSAPP_LAUNCHER_WINDOWS_FILENAME}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold bg-slate-800 border border-slate-700 text-sky-400 rounded-xl hover:bg-slate-700 transition-all shadow-lg"
                            title="تحميل خادم التشغيل (Windows)"
                        >
                            <Download className="w-4 h-4" />
                            <span className="hidden sm:inline">Windows</span>
                        </a>
                        <button
                            onClick={() => setShowGuide(true)}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold bg-slate-800 border border-slate-700 text-blue-400 rounded-xl hover:bg-slate-700 transition-all"
                            title="دليل التشغيل"
                        >
                            <BookOpen className="w-4 h-4" />
                            <span className="hidden sm:inline">الدليل</span>
                        </button>
                    </div>
                </div>
            </div>
            {/* Error Banner */}
            {serverError && !isSimulationMode && (
                <div className="mb-6 bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-4 animate-fade-in-up">
                    <AlertCircle className="w-6 h-6 text-red-400" />
                    <span className="text-red-200">الخادم غير متصل. يرجى تشغيل السكربت `server.py`</span>
                    <button onClick={fetchStatus} className="mr-auto text-sm bg-red-500/20 px-3 py-1 rounded-lg hover:bg-red-500/30 transition-colors">إعادة المحاولة</button>
                </div>
            )}

            {/* Success/Error Toast (Bottom Left) */}
            {localToast && (
                <div className="fixed bottom-6 left-6 z-50 animate-fade-in-up">
                    <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md border ${localToast.type === 'success'
                        ? 'bg-emerald-500/90 text-white border-emerald-400/30'
                        : 'bg-red-500/90 text-white border-red-400/30'
                        }`}>
                        {localToast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                        <span className="font-bold text-sm">{localToast.message}</span>
                        <button onClick={() => setLocalToast(null)} className="mr-2 hover:bg-white/20 rounded-full p-1"><X className="w-3 h-3" /></button>
                    </div>
                </div>
            )}

            {/* ⌨️ Keyboard Shortcuts Panel */}
            {showShortcuts && (
                <div className="fixed top-20 left-6 z-50 animate-fade-in-up">
                    <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 shadow-2xl w-72">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                <Keyboard className="w-4 h-4 text-blue-400" />
                                اختصارات لوحة المفاتيح
                            </h4>
                            <button
                                onClick={() => setShowShortcuts(false)}
                                className="text-gray-500 hover:text-white transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="space-y-2 text-xs">
                            <ShortcutItem keys="Ctrl+S" label="إرسال الرسائل المحددة" />
                            <ShortcutItem keys="Ctrl+P" label="إيقاف مؤقت / استكمال" />
                            <ShortcutItem keys="Ctrl+R" label="تحديث الطابور" />
                            <ShortcutItem keys="Ctrl+Shift+A" label="تشغيل/إيقاف Auto-Pilot" />
                            <ShortcutItem keys="Ctrl+Shift+Del" label="حذف جميع الرسائل" />
                        </div>
                    </div>
                </div>
            )}

            {/* 📊 Sending Progress Bar (Fixed at bottom when queue is active) */}
            {executionQueue.length > 0 && (
                <div className="mb-6">
                    <SendingProgress
                        queue={executionQueue}
                        isPaused={isPaused}
                    />
                </div>
            )}

            {/* Main Content Area */}
            {mainView === 'templates' ? (
                <TemplateManager templates={templates} onUpdate={handleSaveTemplates} />
            ) : mainView === 'badges' ? (
                // --- BADGE STUDIO VIEW ---
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[800px]">
                    {/* Left: Student Selector */}
                    <div className="lg:col-span-4 h-full flex flex-col">
                        <div className="glass-card flex-1 p-4 rounded-2xl border border-white/10 overflow-hidden">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <List className="w-5 h-5 text-gray-400" />
                                اختر طالباً للتتويج
                            </h3>
                            <StudentSelectComponent
                                value={manualSelectedIds[0] || ''}
                                onChange={(id) => setManualSelectedIds([id])}
                                students={students}
                                classes={classes}
                                filters={filters}
                                onFilterChange={(f) => setFilters(prev => ({ ...prev, ...f }))}
                            />
                        </div>
                    </div>

                    {/* Right: Badge Studio */}
                    <div className="lg:col-span-8 h-full">
                        {manualSelectedIds.length === 1 ? (
                            <BadgeStudio
                                studentName={students.find(s => s.id === manualSelectedIds[0])?.name || 'طالب غير معروف'}
                                onSend={handleBadgeSend}
                                onCancel={() => setManualSelectedIds([])}
                            />
                        ) : (
                            <div className="h-full glass-card rounded-2xl border border-white/10 flex flex-col items-center justify-center text-gray-400">
                                <Award className="w-24 h-24 mb-6 opacity-20" />
                                <h3 className="text-xl font-bold mb-2">استوديو الأوسمة</h3>
                                <p>يرجى اختيار طالب من القائمة اليسرى للبدء في تصميم الوسام</p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {/* Stats & Queue (Only show in Compose mode) */}
                    <StatsPanel total={stats.total} success={stats.success} pending={stats.pending} failed={stats.failed} />

                    {/* Queue Visualization */}
                    <div className="mb-8">
                        {/* رأس قسم الطابور */}
                        <div className="flex items-center justify-between mb-4 px-2">
                            <h3 className="text-gray-400 font-bold flex items-center gap-2">
                                <Clock className="w-5 h-5" /> طابور الإرسال ({executionQueue.filter(i => i.status === 'pending' || i.status === 'sending').length})
                            </h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setIsPaused(!isPaused)}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${isPaused
                                        ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                                        : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700'
                                        }`}
                                >
                                    {isPaused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3 fill-current" />}
                                    {isPaused ? 'استكمال الإرسال' : 'إيقاف مؤقت'}
                                </button>

                                {executionQueue.length > 0 && (
                                    <button
                                        onClick={async () => {
                                            const confirmed = await confirm({
                                                title: 'حذف جميع الرسائل',
                                                message: 'هل أنت متأكد من حذف كل الرسائل في الطابور؟ هذا الإجراء لا يمكن التراجع عنه.',
                                                confirmText: 'حذف الكل',
                                                cancelText: 'إلغاء',
                                                variant: 'danger'
                                            });

                                            if (confirmed) {
                                                setStartStopLoading(true);
                                                try {
                                                    await whatsappGateway.control('clear');
                                                    setExecutionQueue([]);
                                                    setLocalToast({ message: 'تم حذف الطابور بنجاح', type: 'success' });
                                                } catch {
                                                    setLocalToast({ message: 'فشل الاتصال بالخادم', type: 'error' });
                                                } finally {
                                                    setStartStopLoading(false);
                                                }
                                            }
                                        }}
                                        disabled={startStopLoading}
                                        className="p-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white transition-colors disabled:opacity-50"
                                        title="حذف جميع الرسائل"
                                    >
                                        {startStopLoading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    </button>
                                )}
                            </div>
                        </div>
                        <QueueVisualizer
                            queue={executionQueue}
                            processingId={processingId}
                            onRemove={removeFromQueue}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Left: Controls & Logs */}
                        <div className="lg:col-span-4 space-y-6">
                            {/* لوحة التحكم بالنظام */}
                            <div className="glass-card p-6 rounded-3xl border border-white/10 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -z-10" />
                                <h3 className="text-xl font-bold text-white mb-6">التحكم بالنظام</h3>

                                <div className="space-y-3">
                                    <button onClick={() => handleBotAction('start')} disabled={status?.running || isSimulationMode} className="w-full py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-3">
                                        <Play className="w-5 h-5 fill-current" /> تشغيل المحرك
                                    </button>
                                    <button onClick={() => handleBotAction('stop')} disabled={(!status?.running && !isSimulationMode)} className="w-full py-4 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/30 font-bold hover:bg-red-500/20 disabled:opacity-50 flex items-center justify-center gap-3">
                                        <Square className="w-5 h-5 fill-current" /> إيقاف اضطراري
                                    </button>
                                    <button onClick={() => setExecutionQueue([])} className="w-full py-2 text-sm text-gray-400 hover:text-white flex items-center justify-center gap-2 mt-4">
                                        <RotateCcw className="w-4 h-4" /> تصفير العدادات
                                    </button>
                                </div>
                            </div>
                            
                            {/* Live Notifications (On Present) Quick Settings */}
                            <div className="glass-card p-6 rounded-3xl border border-white/10 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -z-10" />
                                <h3 className="text-xl font-bold text-white mb-4">الإشعار الفوري للحضور</h3>
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between p-3 bg-gray-900/50 rounded-xl border border-gray-700/50">
                                        <div>
                                            <div className="text-sm font-bold text-white">إرسال لحظي عند مسح البطاقة</div>
                                            <div className="text-xs text-gray-500 mt-1">يجب توفر محرك WhattONE. يعمل بشكل معزول</div>
                                        </div>
                                        <button
                                            onClick={() => saveOnPresentSettings(!onPresentEnabled)}
                                            className={`w-12 h-6 rounded-full transition-colors relative ${onPresentEnabled ? 'bg-blue-600' : 'bg-gray-600'}`}
                                        >
                                            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${onPresentEnabled ? 'left-1' : 'right-1'}`} />
                                        </button>
                                    </div>
                                    <button onClick={() => setMainView('templates')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center justify-center gap-1">
                                        <Edit className="w-3 h-3" /> تعديل قالب الرسالة
                                    </button>
                                </div>
                            </div>
                            {/* Logs */}
                            <div className="glass-card p-4 rounded-3xl border border-white/10 h-[300px] flex flex-col bg-black/40 font-mono text-xs">
                                <div className="flex items-center gap-2 text-gray-500 mb-2 border-b border-white/5 pb-2">
                                    <Terminal className="w-4 h-4" /> System Logs
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                                    {(isSimulationMode ? ['[SIM] Simulation Mode Active', '[SIM] Ready for requests...'] : (status?.logs || [])).map((l, i) => (
                                        <div key={`log-${i}-${l.slice(0, 20).replace(/\s/g, '_')}`} className="text-gray-300 break-all"><span className="text-green-500 mr-2">$</span>{l}</div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Right: Input Deck */}
                        <div className="lg:col-span-8 space-y-6">
                            <div className="glass-card p-6 rounded-3xl border border-white/10 min-h-[500px] flex flex-col">
                                {/* Tabs */}
                                <div className="flex flex-wrap gap-2 mb-6 border-b border-white/10 pb-4">
                                    {[
                                        { id: 'single', label: 'إرسال يدوي (متعدد)', icon: Edit, color: 'blue' },
                                        { id: 'late', label: `قائمة التأخير (${lateList.length || 0})`, icon: Clock, color: 'orange' },
                                        { id: 'absence', label: `قائمة الغياب (${absentList.length || 0})`, icon: Moon, color: 'red' }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id as any)}
                                            className={`px-4 py-3 rounded-2xl flex items-center gap-2 transition-all font-bold ${activeTab === tab.id
                                                ? `bg-${tab.color}-500 text-white shadow-lg shadow-${tab.color}-500/20`
                                                : 'hover:bg-white/5 text-gray-400'
                                                }`}
                                        >
                                            <tab.icon className="w-4 h-4" /> {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Manual Selection Content */}
                                {activeTab === 'single' ? (
                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-full">
                                        <div className="md:col-span-7 h-full min-h-[400px]">
                                            <MultiStudentSelectComponent
                                                value={manualSelectedIds}
                                                onChange={setManualSelectedIds}
                                                students={students}
                                                classes={classes}
                                                filters={filters}
                                                onFilterChange={(f) => setFilters(prev => ({ ...prev, ...f }))}
                                                label="قائمة الطلاب"
                                            />
                                        </div>
                                        <div className="md:col-span-5 space-y-6 flex flex-col h-full">
                                            <div>
                                                <label className="text-sm font-medium text-gray-400 mb-2 block">نوع الرسالة</label>
                                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                                                    {templates.map(t => (
                                                        <button
                                                            key={t.id}
                                                            onClick={() => setSelectedTemplateId(t.id)}
                                                            className={`p-3 rounded-xl border text-right transition-all group relative overflow-hidden ${selectedTemplateId === t.id
                                                                ? 'bg-blue-500/20 border-blue-500 text-white'
                                                                : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'
                                                                }`}
                                                        >
                                                            <div className="text-xs font-bold mb-1">{t.name}</div>
                                                            <div className="text-[10px] opacity-60 line-clamp-2">{t.content}</div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Custom Message Field */}
                                            {/* Show textarea for all templates for customization or only generic? Let's show relevant preview/edit? */}
                                            {/* Original logic only showed for 'tpl_general'. Now we can let user edit messageText which is {Message} placeholder. */}
                                            {/* Actually, processMessage replaces {Message} with messageText. So only useful if template has {Message}. */}

                                            <div className="animate-in fade-in slide-in-from-top-2">
                                                <textarea
                                                    value={messageText}
                                                    onChange={e => setMessageText(e.target.value)}
                                                    placeholder="رسالة إضافية (تظهر مكان {Message})..."
                                                    className="w-full h-32 input-glass p-3 rounded-xl resize-none text-sm leading-relaxed"
                                                />
                                            </div>

                                            {/* File Picker */}
                                            <div className="bg-black/20 rounded-xl p-3 border border-white/5 flex items-center justify-between group hover:border-white/10 transition-colors">
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${attachment ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-gray-600'}`}>
                                                        <Paperclip className="w-5 h-5" />
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-xs font-bold text-gray-300 truncate max-w-[150px]">
                                                            {uploading ? 'جاري الرفع...' : (attachment ? attachment.name : 'إرفاق ملف (اختياري)')}
                                                        </span>
                                                        <span className="text-[10px] text-gray-500">صور أو PDF</span>
                                                    </div>
                                                </div>
                                                <label className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg cursor-pointer transition-colors text-white">
                                                    {attachment ? 'تغيير' : 'استعراض'}
                                                    <input
                                                        type="file"
                                                        className="hidden"
                                                        accept="image/*,application/pdf"
                                                        onChange={async (e) => {
                                                            if (e.target.files?.[0]) {
                                                                const file = e.target.files[0];
                                                                setAttachment(file);
                                                                setUploading(true);
                                                                try {
                                                                    setAttachmentPath(await whatsappGateway.upload(file));
                                                                    showToast('تم رفع الملف بنجاح', 'success');
                                                                } catch {
                                                                    showToast('خطأ في الاتصال', 'error');
                                                                } finally {
                                                                    setUploading(false);
                                                                }
                                                            }
                                                        }}
                                                    />
                                                </label>
                                            </div>

                                            <div className="flex-1 bg-transparent"></div>

                                            <button
                                                onClick={addToQueue}
                                                disabled={manualSelectedIds.length === 0}
                                                className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-lg shadow-lg shadow-blue-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                <Send className="w-5 h-5" />
                                                <span>إرسال إلى ({manualSelectedIds.length})</span>
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col h-full">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                            <div>
                                                <label className="text-sm font-medium text-gray-400 mb-2 block">قالب الرسالة</label>
                                                <div className="relative">
                                                    <select
                                                        value={selectedTemplateId}
                                                        onChange={e => setSelectedTemplateId(e.target.value)}
                                                        className="w-full input-glass p-3 rounded-xl text-white appearance-none pr-10"
                                                    >
                                                        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                                    </select>
                                                    <Settings className="w-4 h-4 text-gray-500 absolute left-3 top-3.5 pointer-events-none" />
                                                </div>
                                            </div>

                                            <div className="flex flex-col justify-end">
                                                <div className="flex items-center justify-between gap-3 bg-gray-800/50 p-3 rounded-xl border border-white/5">
                                                    <span className="text-gray-300 font-bold">المحدد: {selectedStudents.length}</span>
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() => void loadAttendanceLists(true)}
                                                            disabled={attendanceLoading}
                                                            className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 disabled:opacity-50"
                                                        >
                                                            <RotateCcw className={`h-3.5 w-3.5 ${attendanceLoading ? 'animate-spin' : ''}`} />
                                                            تحديث
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (allCurrentSelected) setSelectedStudents([]);
                                                                else setSelectedStudents(currentList.map(s => s.id));
                                                            }}
                                                            disabled={currentList.length === 0}
                                                            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40"
                                                        >
                                                            {allCurrentSelected ? 'إلغاء الكل' : 'تحديد الكل'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex-1 bg-black/20 rounded-2xl border border-white/5 overflow-hidden flex flex-col min-h-[250px] mb-6">
                                            <div className="overflow-y-auto p-2 space-y-1 custom-scrollbar">
                                                {attendanceLoading && (
                                                    <div className="flex h-48 items-center justify-center text-sm font-bold text-cyan-200">
                                                        جاري تحميل قوائم اليوم...
                                                    </div>
                                                )}
                                                {!attendanceLoading && attendanceError && (
                                                    <div className="flex h-48 flex-col items-center justify-center gap-3 text-center text-sm text-red-200">
                                                        <AlertCircle className="h-8 w-8 text-red-300" />
                                                        <span>{attendanceError}</span>
                                                        <button
                                                            onClick={() => void loadAttendanceLists(true)}
                                                            className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-100 hover:bg-red-500/20"
                                                        >
                                                            إعادة المحاولة
                                                        </button>
                                                    </div>
                                                )}
                                                {!attendanceLoading && !attendanceError && currentList.map(s => (
                                                    <div
                                                        key={s.id}
                                                        onClick={() => {
                                                            if (selectedStudents.includes(s.id)) setSelectedStudents(p => p.filter(id => id !== s.id));
                                                            else setSelectedStudents(p => [...p, s.id]);
                                                        }}
                                                        className={`p-3 rounded-xl flex items-center justify-between cursor-pointer border transition-all ${selectedStudents.includes(s.id) ? 'bg-blue-500/20 border-blue-500/50' : 'hover:bg-white/5 border-transparent'
                                                            }`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-4 h-4 rounded-md border flex items-center justify-center ${selectedStudents.includes(s.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-600'}`}>
                                                                {selectedStudents.includes(s.id) && <CheckCircle className="w-3 h-3 text-white" />}
                                                            </div>
                                                            <span className="font-bold text-gray-200">{s.name}</span>
                                                        </div>
                                                        <span className="text-xs font-mono text-gray-500">{formatAttendanceTime(s.record.timestamp)}</span>
                                                    </div>
                                                ))}
                                                {!attendanceLoading && !attendanceError && currentList.length === 0 && <div className="text-center py-10 text-gray-500">لا توجد بيانات اليوم</div>}
                                            </div>
                                        </div>

                                        <div className="mt-auto pt-6 border-t border-white/10">
                                            <button
                                                onClick={addToQueue}
                                                disabled={selectedStudents.length === 0}
                                                className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-lg shadow-xl shadow-blue-600/20 hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                                            >
                                                <Send className="w-6 h-6" />
                                                <span>إرسال إلى ({selectedStudents.length}) طلاب</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )
            }

            {/* Confirm Dialog Portal */}
            <ConfirmDialog />

            {/* Guide Modal */}
            <UniversalGuideModal 
                isOpen={showGuide} 
                onClose={() => setShowGuide(false)} 
                title="دليل أتمتة واتساب"
                steps={whatsappGuideSteps}
                heroImage="/images/whatsapp_guide_hero.webp"
            />
        </div >
    );
};

export default WhatsAppControl;
