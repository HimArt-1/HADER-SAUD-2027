import React, { Suspense, useEffect, useState, useRef } from 'react';
import { User, AttendanceRecord, ViolationRecord, Student, ExitRecord, Notification, Role, GuardianExcuseRecord } from '../types';
import { db, getLocalISODate } from '../services/db';
import { dismissals } from '../services/dismissals';
import { notificationCenter } from '../services/notifications';
import { studentAffairs } from '../services/studentAffairs';
import { auth } from '../services/auth';
import { secureSessionStorage, SecureSessionPayload } from '../services/secureStorage';
import { supabase, supabaseStatus } from '../services/supabase';
import { User as UserIcon, AlertTriangle, Clock, Calendar, Loader2, DoorOpen, Bell, CheckCircle, ChevronDown, Settings, Send, FileText, Upload, Megaphone, Camera, ExternalLink } from 'lucide-react';
import { logError, getErrorMessage } from '../types/errors';
import { useToast } from '../components/Toast';
import { useAdminTheme } from '../hooks/useAdminTheme';
import { NeonButton } from '../components/ui/NeonButton';
import { NeonInput } from '../components/ui/NeonFormControls';
import { GlassCard } from '../components/ui/GlassCard';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { getExitRequesterRelationLabel } from '../services/exitRequester';
import {
    buildGuardianExcuseStoragePath,
    getGuardianExcuseStatusLabel,
    GUARDIAN_EXCUSE_BUCKET,
    GUARDIAN_EXCUSE_STATUS_STYLES,
    validateGuardianExcuseFile
} from '../services/guardianExcuses';

const SmartReportPDF = lazyWithRetry(() =>
    import('../components/reports/SmartReportPDF').then((module) => ({ default: module.SmartReportPDF }))
);

const Parents: React.FC<{ user: User }> = ({ user }) => {
    // 🎨 Unified Theme
    useAdminTheme();
    const [children, setChildren] = useState<Student[]>([]);
    const [selectedChild, setSelectedChild] = useState<Student | null>(null);
    const [guardianSession, setGuardianSession] = useState<SecureSessionPayload['guardian'] | null>(null);
    const toast = useToast();

    // Data States
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [exits, setExits] = useState<ExitRecord[]>([]);
    const [violations, setViolations] = useState<ViolationRecord[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [excuses, setExcuses] = useState<GuardianExcuseRecord[]>([]);

    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'attendance' | 'exits' | 'violations' | 'notifications' | 'excuses'>('attendance');
    const [showToast, setShowToast] = useState<Notification | null>(null);
    const toastTimeout = useRef<number | null>(null);
    const [guardianTarget, setGuardianTarget] = useState<'supervisor' | 'class'>('supervisor');
    const [guardianTitle, setGuardianTitle] = useState('');
    const [guardianMessage, setGuardianMessage] = useState('');
    const [sendingGuardianMessage, setSendingGuardianMessage] = useState(false);
    const [excuseReason, setExcuseReason] = useState('');
    const [excuseFile, setExcuseFile] = useState<File | null>(null);
    const [excuseDate, setExcuseDate] = useState(getLocalISODate());
    const [sendingExcuse, setSendingExcuse] = useState(false);
    const excuseFileInputRef = useRef<HTMLInputElement | null>(null);
    const excuseCameraInputRef = useRef<HTMLInputElement | null>(null);
    const [sendingDismissalCall, setSendingDismissalCall] = useState(false);
    const [dismissalCallSent, setDismissalCallSent] = useState(false);
    const [showSmartReport, setShowSmartReport] = useState(false);

    const handleSelectChild = (childId: string) => {
        const child = children.find(c => c.id === childId);
        if (!child) return;

        // Reset all data states immediately to prevent "ghost" data from the previous student
        setAttendance([]);
        setExits([]);
        setViolations([]);
        setNotifications([]);
        setExcuses([]);
        setDismissalCallSent(false);

        setSelectedChild(child);
        const session = secureSessionStorage.get();
        if (session?.guardian) {
            const nextGuardian = {
                ...session.guardian,
                activeStudentId: childId
            };
            secureSessionStorage.save({ ...session, guardian: nextGuardian });
            setGuardianSession(nextGuardian);
        }
    };

    useEffect(() => {
        // 1. Role Check
        auth.requireRole([Role.GUARDIAN]);

        // 2. Initial Load: Get all children associated with this parent
        const fetchChildren = async () => {
            try {
                const session = secureSessionStorage.get();
                setGuardianSession(session?.guardian ?? null);
                // Using username (guardian phone) to fetch linked students
                const myChildren = await db.getStudentsByGuardian(user.username);
                const activeChildren = myChildren.filter(child => child.is_active !== false);
                setChildren(activeChildren);

                const sessionChildren = session?.guardian?.children ?? activeChildren.map(child => ({
                    id: child.id,
                    name: child.name,
                    grade: child.class_name,
                    class: child.section
                }));

                if (session) {
                    secureSessionStorage.save({
                        ...session,
                        guardian: {
                            children: sessionChildren,
                            activeStudentId: session.guardian?.activeStudentId
                        }
                    });
                    setGuardianSession({
                        children: sessionChildren,
                        activeStudentId: session.guardian?.activeStudentId
                    });
                }

                if (session?.guardian?.activeStudentId) {
                    const matched = activeChildren.find(child => child.id === session.guardian?.activeStudentId);
                    if (matched) {
                        setSelectedChild(matched);
                        return;
                    }
                }

                if (activeChildren.length === 1) {
                    const onlyChild = activeChildren[0];
                    setSelectedChild(onlyChild);
                    if (session) {
                        secureSessionStorage.save({
                            ...session,
                            guardian: {
                                children: sessionChildren,
                                activeStudentId: onlyChild.id
                            }
                        });
                        setGuardianSession({
                            children: sessionChildren,
                            activeStudentId: onlyChild.id
                        });
                    }
                }
            } catch (error) {
                logError(error, 'Parents - Fetch Children');
            } finally {
                setLoading(false);
            }
        };
        void fetchChildren();
    }, [user]);

    // 3. Child Specific Data Load
    useEffect(() => {
        if (!selectedChild) return;

        const fetchChildData = async () => {
            setLoading(true);
            try {
                const [att, affairs, notif] = await Promise.all([
                    db.getStudentAttendance(selectedChild.id),
                    studentAffairs.load({
                        type: 'student',
                        studentId: selectedChild.id,
                        includeExcuses: true
                    }),
                    notificationCenter.load({
                        type: 'student',
                        studentId: selectedChild.id,
                        className: selectedChild.class_name
                    })
                ]);

                setAttendance(att);
                setExits(affairs.exits);
                setViolations(affairs.violations);
                setNotifications(notif);
                setExcuses(affairs.excuses);
            } catch (error) {
                logError(error, 'Parents - Fetch Child Data');
            } finally {
                setLoading(false);
            }
        };

        void fetchChildData();
    }, [selectedChild]);

    // ---- New effect for realtime notifications with toast ----
    useEffect(() => {
        if (!selectedChild) return;

        const unsub = notificationCenter.subscribe(user, (notif: Notification) => {
            // Add if relevant for the child
            const isRelevant = 
                notif.target_audience === 'all' ||
                (notif.target_audience === 'guardian' && (!notif.target_id || notif.target_id === selectedChild.id)) ||
                (notif.target_audience === 'student' && notif.target_id === selectedChild.id) ||
                (notif.target_audience === 'class' && notif.target_id === selectedChild.class_name);

            if (isRelevant) {
                setNotifications(prev => {
                    // Prevent duplicates (especially relevant after child switch)
                    const exists = prev.some(n => n.id === notif.id || (n.title === notif.title && n.created_at === notif.created_at));
                    if (exists) return prev;
                    return [notif, ...prev];
                });

                if (notif.is_popup) {
                    setShowToast(notif);
                    if (toastTimeout.current) clearTimeout(toastTimeout.current);
                    toastTimeout.current = window.setTimeout(() => setShowToast(null), 5000);
                }
            }
        });

        return () => {
            unsub.unsubscribe();
            if (toastTimeout.current) {
                clearTimeout(toastTimeout.current);
            }
        };
    }, [user, selectedChild]);

    if (loading && !selectedChild) return <div className="flex justify-center p-20"><Loader2 className="animate-spin text-white w-10 h-10" /></div>;

    if (children.length === 0 && !loading) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-8">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4 border border-white/10">
                    <UserIcon className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl font-bold text-white">عفواً</h2>
                <p className="text-gray-400 mt-2">لا يوجد طلاب مرتبطين برقم الجوال هذا.</p>
            </div>
        );
    }

    if (!selectedChild && !loading && children.length > 0) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-8">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4 border border-white/10">
                    <UserIcon className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl font-bold text-white">اختر الطالب</h2>
                <p className="text-gray-400 mt-2">يرجى اختيار الطالب لعرض التفاصيل.</p>
                <div className="mt-6 w-full max-w-xs">
                    <select
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-primary-500 outline-none"
                        defaultValue=""
                        onChange={(e) => handleSelectChild(e.target.value)}
                    >
                        <option value="" disabled>اختر الطالب...</option>
                        {children.map(child => (
                            <option key={child.id} value={child.id}>{child.name}</option>
                        ))}
                    </select>
                </div>
            </div>
        );
    }

    if (!selectedChild) return null;

    const handleSendGuardianNotification = async () => {
        if (!guardianMessage.trim()) {
            toast.warning('يرجى كتابة الرسالة قبل الإرسال.');
            return;
        }
        setSendingGuardianMessage(true);
        try {
            const payload: Notification = {
                id: '',
                title: guardianTitle.trim() || 'رسالة من ولي الأمر',
                message: `${selectedChild.name} (${selectedChild.class_name}/${selectedChild.section} - ${selectedChild.id}): ${guardianMessage.trim()}`,
                type: 'general',
                target_audience: guardianTarget === 'class' ? 'class' : 'supervisor',
                target_id: guardianTarget === 'class' ? selectedChild.class_name : selectedChild.id,
                created_at: new Date().toISOString(),
                is_popup: true,
                created_by: user.id
            };
            await notificationCenter.execute({ type: 'send', notification: payload });
            setGuardianTitle('');
            setGuardianMessage('');
            toast.success('تم إرسال رسالتك بنجاح.');
        } catch (error) {
            logError(error, 'Parents - Send Guardian Message');
            toast.error('حدث خطأ أثناء الإرسال. حاول مرة أخرى.');
        } finally {
            setSendingGuardianMessage(false);
        }
    };

    const buildAutoNotifications = () => {
        if (!selectedChild) return [] as Notification[];
        const attendanceNotifs = attendance
            .filter(record => record.status === 'late' || (record.status as string) === 'absent')
            .map(record => {
                const statusLabel = record.status === 'late' ? 'تأخر' : 'غياب';
                return {
                    id: `auto-attendance-${record.id}`,
                    title: `تنبيه ${statusLabel}`,
                    message: `${selectedChild.name} - ${statusLabel} بتاريخ ${record.date} (${new Date(record.timestamp).toLocaleTimeString('ar-SA')}).`,
                    type: 'attendance',
                    target_audience: 'guardian',
                    created_at: record.timestamp
                } as Notification;
            });

        const exitNotifs = exits.map(exit => ({
            id: `auto-exit-${exit.id}`,
            title: 'تنبيه استئذان',
            message: `${selectedChild.name} - تم تسجيل استئذان بتاريخ ${new Date(exit.exit_time).toLocaleString('ar-SA')} (السبب: ${exit.reason}، المستأذن: ${getExitRequesterRelationLabel(exit)}).`,
            type: 'attendance',
            target_audience: 'guardian',
            created_at: exit.exit_time
        } as Notification));

        const violationNotifs = violations.map(violation => ({
            id: `auto-violation-${violation.id}`,
            title: 'تنبيه مخالفة',
            message: `${selectedChild.name} - ${violation.type} (${violation.description || 'بدون تفاصيل'}) بتاريخ ${new Date(violation.created_at).toLocaleDateString('ar-SA')}.`,
            type: 'behavior',
            target_audience: 'guardian',
            created_at: violation.created_at
        } as Notification));

        return [...attendanceNotifs, ...exitNotifs, ...violationNotifs];
    };

    const handleExcuseFileSelected = (file?: File | null) => {
        if (!file) {
            setExcuseFile(null);
            return;
        }

        const validationMessage = validateGuardianExcuseFile(file);
        if (validationMessage) {
            toast.warning(validationMessage);
            if (excuseFileInputRef.current) excuseFileInputRef.current.value = '';
            if (excuseCameraInputRef.current) excuseCameraInputRef.current.value = '';
            return;
        }

        setExcuseFile(file);
    };

    const handleSubmitExcuse = async () => {
        if (!selectedChild) return;
        if (!excuseDate) {
            toast.warning('يرجى تحديد تاريخ الغياب.');
            return;
        }
        if (!excuseReason.trim()) {
            toast.warning('يرجى كتابة سبب الغياب قبل الإرسال.');
            return;
        }
        if (!excuseFile) {
            toast.warning('يرجى رفع ملف العذر قبل الإرسال.');
            return;
        }
        if (!supabaseStatus.isConfigured) {
            toast.warning('خدمة رفع الملفات غير مهيأة حالياً. يرجى التواصل مع إدارة النظام.');
            return;
        }

        setSendingExcuse(true);
        try {
            const path = buildGuardianExcuseStoragePath(selectedChild.id, excuseFile);
            const { error: uploadError } = await supabase.storage.from(GUARDIAN_EXCUSE_BUCKET).upload(path, excuseFile, {
                cacheControl: '3600',
                upsert: false
            });

            if (uploadError) {
                logError(uploadError, 'Parents - Upload File');
                throw uploadError;
            }

            const publicUrl = supabase.storage.from(GUARDIAN_EXCUSE_BUCKET).getPublicUrl(path).data?.publicUrl;
            if (!publicUrl) {
                throw new Error('تم رفع الملف لكن تعذر إنشاء رابط المرفق.');
            }

            const result = await studentAffairs.execute({
                type: 'submit-excuse',
                excuse: {
                    student_id: selectedChild.id,
                    student_name: selectedChild.name,
                    class_name: selectedChild.class_name,
                    section: selectedChild.section,
                    guardian_id: user.id,
                    guardian_name: user.name,
                    guardian_phone: user.username,
                    absence_date: excuseDate,
                    reason: excuseReason,
                    attachment_url: publicUrl,
                    attachment_path: path,
                    attachment_name: excuseFile.name,
                    attachment_type: excuseFile.type,
                    attachment_size: excuseFile.size
                }
            });
            if (!result.excuse) throw new Error('Excuse record was not returned');

            setExcuses(prev => [result.excuse!, ...prev]);
            setExcuseReason('');
            setExcuseFile(null);
            setExcuseDate(getLocalISODate());
            if (excuseFileInputRef.current) excuseFileInputRef.current.value = '';
            if (excuseCameraInputRef.current) excuseCameraInputRef.current.value = '';
            toast.success('تم إرسال عذر الغياب بنجاح.');
        } catch (error) {
            logError(error, 'Parents - Send Excuse');

            // Provide more specific error messages
            const errorMessage = error instanceof Error ? error.message : 'حدث خطأ أثناء رفع العذر';

            if (errorMessage.includes('Bucket not found') || errorMessage.includes(GUARDIAN_EXCUSE_BUCKET)) {
                toast.error('نظام رفع الأعذار غير مهيأ. يجب تطبيق تحديث قاعدة البيانات والتخزين الخاص بالأعذار.');
            } else if (errorMessage.includes('not authorized') || errorMessage.includes('permission')) {
                toast.error('خطأ في الصلاحيات. لا يوجد صلاحية لرفع الملفات. يرجى التواصل مع الدعم الفني.');
            } else {
                toast.error(`حدث خطأ أثناء رفع العذر: ${errorMessage}`);
            }
        } finally {
            setSendingExcuse(false);
        }
    };

    // ---- Overlay Toast markup ----
    const Toast = showToast && (
        <div className="fixed z-[140] bottom-8 right-8 md:right-10 max-w-xs w-[340px] glass-card border border-secondary-400/30 bg-secondary-500/10 shadow-2xl animate-fade-in-up backdrop-blur-2xl rounded-2xl p-5 flex items-center animate-pulse-slow" dir="rtl">
            <div className="flex-shrink-0 mr-3">{getNotifIcon(showToast)}</div>
            <div className="flex-1 text-right">
                <div className="text-lg font-bold text-white mb-1">{showToast.title || "تنبيه جديد"}</div>
                <div className="text-sm text-primary-300 mb-1">{showToast.message}</div>
                <button onClick={() => setShowToast(null)} className="text-xs bg-white/10 text-secondary-400 font-bold rounded-xl px-4 py-1 mt-1 hover:bg-secondary-600/10 transition">إغلاق</button>
            </div>
        </div>
    );

    function getNotifIcon(n: Notification) {
        if (n.type === 'behavior') return <AlertTriangle className="w-6 h-6 text-red-400" />;
        if (n.type === 'attendance') return <CheckCircle className="w-6 h-6 text-amber-400" />;
        if (n.type === 'general' || n.type === 'announcement') return <Bell className="w-6 h-6 text-primary-400 " />;
        if (n.type === 'command') return <Settings className="w-6 h-6 text-secondary-500" />;
        return <Bell className="w-6 h-6 text-primary-400" />;
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6 pb-12">
            {Toast}

            {showSmartReport && selectedChild && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl relative animate-fade-in-up">
                        <Suspense fallback={<div className="rounded-3xl bg-slate-900 p-8 text-center text-white">جاري تحميل التقرير...</div>}>
                            <SmartReportPDF studentId={selectedChild.id} onClose={() => setShowSmartReport(false)} />
                        </Suspense>
                    </div>
                </div>
            )}

            {/* --- Multi-Child Selector --- */}
            {children.length > 1 && selectedChild && (
                <div className="glass-card p-6 rounded-3xl flex justify-between items-center relative z-20 border border-primary-500/20 shadow-xl hover:shadow-2xl transition-all duration-300">
                    <label className="text-white text-base font-semibold flex items-center gap-2">
                        <UserIcon className="w-5 h-5 text-primary-400" />
                        اختر الابن:
                    </label>
                    <div className="relative w-72">
                        <select
                            className="w-full bg-gradient-to-r from-slate-900/90 to-slate-800/90 border-2 border-primary-500/30 rounded-2xl px-6 py-3 appearance-none text-white focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 outline-none transition-all duration-300 font-medium text-lg shadow-lg hover:shadow-primary-500/10"
                            value={selectedChild.id}
                            onChange={(e) => handleSelectChild(e.target.value)}
                        >
                            {children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <ChevronDown className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary-400 pointer-events-none" />
                    </div>
                </div>
            )}

            {/* --- Student Profile Header --- */}
            <div className="relative rounded-[2.5rem] p-10 overflow-hidden group shadow-2xl border border-primary-500/20 hover:border-primary-500/40 transition-all duration-500">
                <div className="absolute inset-0 bg-gradient-to-br from-primary-600/20 via-slate-900 to-secondary-600/20"></div>
                <div className="absolute top-0 right-0 w-80 h-80 bg-primary-500/20 rounded-full blur-[100px] animate-pulse-slow"></div>
                <div className="absolute bottom-0 left-0 w-80 h-80 bg-secondary-500/20 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1s' }}></div>

                <div className="relative z-10 flex items-center gap-10">
                    <div className="w-28 h-28 bg-gradient-to-br from-primary-500/30 to-secondary-500/30 backdrop-blur-xl rounded-[2rem] flex items-center justify-center text-5xl border-2 border-primary-400/40 shadow-2xl shadow-primary-500/20 group-hover:scale-105 transition-transform duration-300">
                        <span className="font-serif pt-2 text-white drop-shadow-lg">{selectedChild.name.charAt(0)}</span>
                    </div>
                    <div className="flex-1">
                        <h2 className="text-4xl font-bold font-serif bg-gradient-to-r from-white via-primary-200 to-white bg-clip-text text-transparent mb-3 drop-shadow-lg">{selectedChild.name}</h2>
                        <div className="flex flex-wrap gap-3 text-base">
                            <span className="px-5 py-2 rounded-2xl bg-gradient-to-r from-primary-500/20 to-secondary-500/20 border border-primary-400/30 text-white font-medium backdrop-blur-sm shadow-lg hover:shadow-primary-500/20 transition-all duration-300">
                                {selectedChild.class_name} - {selectedChild.section}
                            </span>
                            <span className="px-5 py-2 rounded-2xl bg-gradient-to-r from-secondary-500/20 to-primary-500/20 border border-secondary-400/30 text-white font-mono font-medium backdrop-blur-sm shadow-lg hover:shadow-secondary-500/20 transition-all duration-300">
                                #{selectedChild.id}
                            </span>
                            <button
                                onClick={() => setShowSmartReport(true)}
                                className="px-5 py-2 rounded-2xl bg-gradient-to-r from-primary-600 to-secondary-600 border border-primary-400/50 text-white font-medium shadow-lg shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.4)] hover:shadow-[0_0_25px_rgb(var(--color-primary-500)_/_0.6)] hover:scale-105 transition-all duration-300 flex items-center gap-2"
                            >
                                <FileText className="w-4 h-4" />
                                التقرير الذكي
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- 🚪 Dismissal Call Request Button --- */}
            <div className="glass-card rounded-3xl p-5 border border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-orange-500/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-amber-500/20 rounded-xl">
                            <Megaphone className="w-5 h-5 text-amber-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-base">طلب نداء انصراف</h3>
                            <p className="text-xs text-gray-400">سيتم إرسال نداء لاستلام الابن من المدرسة</p>
                        </div>
                    </div>
                    <NeonButton
                        variant={dismissalCallSent ? 'outline' : 'primary'}
                        onClick={async () => {
                            setSendingDismissalCall(true);
                            try {
                                const result = await dismissals.execute({
                                    type: 'request-call',
                                    student: selectedChild,
                                    requester: {
                                        id: user.id || 'guardian',
                                        name: user.username || 'ولي الأمر'
                                    }
                                });
                                toast.success(result.outcome === 'already-requested'
                                    ? 'يوجد طلب نداء نشط مسبقًا'
                                    : 'تم إرسال طلب النداء بنجاح ✅');
                                setDismissalCallSent(true);
                                setTimeout(() => setDismissalCallSent(false), 10000);
                            } catch (err) {
                                logError(err, 'Parents - Send Dismissal Call');
                                toast.error('حدث خطأ أثناء إرسال طلب النداء');
                            } finally {
                                setSendingDismissalCall(false);
                            }
                        }}
                        disabled={sendingDismissalCall || dismissalCallSent}
                        isLoading={sendingDismissalCall}
                        startIcon={dismissalCallSent ? <CheckCircle className="w-4 h-4" /> : <Megaphone className="w-4 h-4" />}
                    >
                        {dismissalCallSent ? 'تم الإرسال' : 'طلب نداء'}
                    </NeonButton>
                </div>
            </div>

            {/* --- Tabs --- */}
            <div className="flex overflow-x-auto gap-3 py-3 px-2 scrollbar-thin scrollbar-thumb-primary-500/50 scrollbar-track-transparent">
                {[
                    { id: 'attendance', label: 'سجل الحضور', icon: Calendar, color: 'emerald' },
                    { id: 'exits', label: 'الاستئذان', icon: DoorOpen, color: 'blue' },
                    { id: 'violations', label: 'السلوك', icon: AlertTriangle, color: 'red' },
                    { id: 'excuses', label: 'اعذار الغياب', icon: FileText, color: 'amber' },
                    { id: 'notifications', label: 'الإشعارات', icon: Bell, color: 'purple' },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex items-center gap-3 px-6 py-4 rounded-2xl whitespace-nowrap font-semibold transition-all duration-300 shadow-lg ${activeTab === tab.id
                            ? `bg-gradient-to-r from-${tab.color}-600 to-${tab.color}-500 text-white shadow-${tab.color}-500/30 shadow-2xl scale-105 border border-${tab.color}-400/50`
                            : 'glass-card text-gray-300 hover:bg-white/10 hover:text-white hover:scale-[1.02] hover:shadow-xl border border-white/10'
                            }`}
                    >
                        <tab.icon className="w-5 h-5" />
                        <span className="text-base">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* --- Content Area --- */}
            <div className="min-h-[400px]">
                {loading ? (
                    <div className="flex justify-center p-10"><Loader2 className="animate-spin text-primary-400" /></div>
                ) : (
                    <>
                        {/* 1. Attendance Tab */}
                        {activeTab === 'attendance' && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-3 gap-5">
                                    <div className="glass-card p-6 rounded-3xl text-center border border-emerald-500/30 hover:border-emerald-400/50 transition-all duration-300 shadow-xl hover:shadow-emerald-500/20 hover:scale-105 group">
                                        <div className="text-4xl font-bold bg-gradient-to-br from-emerald-400 to-emerald-300 bg-clip-text text-transparent font-mono mb-2 group-hover:scale-110 transition-transform">{attendance.filter(a => a.status === 'present').length}</div>
                                        <div className="text-sm text-emerald-300 font-semibold">حضور</div>
                                    </div>
                                    <div className="glass-card p-6 rounded-3xl text-center border border-amber-500/30 hover:border-amber-400/50 transition-all duration-300 shadow-xl hover:shadow-amber-500/20 hover:scale-105 group">
                                        <div className="text-4xl font-bold bg-gradient-to-br from-amber-400 to-amber-300 bg-clip-text text-transparent font-mono mb-2 group-hover:scale-110 transition-transform">{attendance.filter(a => a.status === 'late').length}</div>
                                        <div className="text-sm text-amber-300 font-semibold">تأخر</div>
                                    </div>
                                    <div className="glass-card p-6 rounded-3xl text-center border border-red-500/30 hover:border-red-400/50 transition-all duration-300 shadow-xl hover:shadow-red-500/20 hover:scale-105 group">
                                        <div className="text-4xl font-bold bg-gradient-to-br from-red-400 to-red-300 bg-clip-text text-transparent font-mono mb-2 group-hover:scale-110 transition-transform">{attendance.filter(a => (a.status as string) === 'absent').length}</div>
                                        <div className="text-sm text-red-300 font-semibold">غياب</div>
                                    </div>
                                </div>

                                <div className="glass-card rounded-3xl overflow-hidden border border-primary-500/20 shadow-2xl">
                                    <table className="w-full text-right text-base">
                                        <thead className="bg-gradient-to-r from-primary-600/20 to-secondary-600/20 text-white border-b-2 border-primary-500/30">
                                            <tr>
                                                <th className="p-5 font-semibold">التاريخ</th>
                                                <th className="p-5 font-semibold">الوقت</th>
                                                <th className="p-5 font-semibold">الحالة</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/10 text-gray-200">
                                            {attendance.map(record => (
                                                <tr key={record.id} className="hover:bg-white/5 transition-colors duration-200">
                                                    <td className="p-5 font-mono font-medium">{record.date}</td>
                                                    <td className="p-5 font-mono text-gray-400">{new Date(record.timestamp).toLocaleTimeString('ar-SA')}</td>
                                                    <td className="p-5">
                                                        {record.status === 'present' && <span className="text-emerald-400 flex items-center gap-2 font-semibold"><CheckCircle className="w-4 h-4" /> حضور</span>}
                                                        {record.status === 'late' && <span className="text-amber-400 flex items-center gap-2 font-semibold"><Clock className="w-4 h-4" /> متأخر</span>}
                                                    </td>
                                                </tr>
                                            ))}
                                            {attendance.length === 0 && <tr><td colSpan={3} className="p-10 text-center text-gray-500 font-medium">لا يوجد سجلات</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* 2. Exits Tab */}
                        {activeTab === 'exits' && (
                            <div className="glass-card rounded-3xl overflow-hidden border border-secondary-500/20 shadow-2xl">
                                <table className="w-full text-right text-base">
                                    <thead className="bg-gradient-to-r from-secondary-600/20 to-primary-600/20 text-white border-b-2 border-secondary-500/30">
                                        <tr>
                                            <th className="p-5 font-semibold">تاريخ الخروج</th>
                                            <th className="p-5 font-semibold">السبب</th>
                                            <th className="p-5 font-semibold">المستأذن</th>
                                            <th className="p-5 font-semibold">المشرف</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/10 text-gray-200">
                                        {exits.map(exit => (
                                            <tr key={exit.id} className="hover:bg-white/5 transition-colors duration-200">
                                                <td className="p-5 font-mono font-medium">{new Date(exit.exit_time).toLocaleString('ar-SA')}</td>
                                                <td className="p-5">{exit.reason}</td>
                                                <td className="p-5">{getExitRequesterRelationLabel(exit)}</td>
                                                <td className="p-5 text-sm text-secondary-400 font-medium">مشرف الفترة</td>
                                            </tr>
                                        ))}
                                        {exits.length === 0 && <tr><td colSpan={4} className="p-10 text-center text-gray-500 font-medium">لا يوجد سجلات استئذان</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* 3. Violations Tab */}
                        {activeTab === 'violations' && (
                            <div className="space-y-4">
                                {violations.map(v => (
                                    <div key={v.id} className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2 text-red-300 font-bold">
                                                <AlertTriangle className="w-5 h-5" />
                                                {v.type}
                                            </div>
                                            <span className="text-xs font-mono text-red-400 opacity-70">{new Date(v.created_at).toLocaleDateString('ar-SA')}</span>
                                        </div>
                                        <p className="text-gray-300 text-sm leading-relaxed bg-black/20 p-3 rounded-lg border border-red-500/10">
                                            {v.description}
                                        </p>
                                        <div className="mt-3 flex justify-end">
                                            <span className="text-xs bg-red-500/20 text-red-300 px-3 py-1 rounded-full border border-red-500/20">
                                                مستوى: {v.level}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {violations.length === 0 && (
                                    <div className="glass-card p-10 text-center flex flex-col items-center gap-4 text-gray-500">
                                        <CheckCircle className="w-12 h-12 text-emerald-500/20" />
                                        سجل الطالب نظيف وخالي من المخالفات
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 4. Notifications Tab */}
                        {activeTab === 'notifications' && (
                            <div className="space-y-4">
                                {(() => {
                                    const autoNotifications = buildAutoNotifications();
                                    const combinedNotifications = [...autoNotifications, ...notifications]
                                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

                                    return (
                                        <>
                                            <div className="glass-card p-5 rounded-2xl border border-white/10 space-y-4">
                                                <div className="flex items-center justify-between flex-wrap gap-3">
                                                    <div>
                                                        <h3 className="text-white font-bold">إرسال إشعار إلى المدرسة</h3>
                                                        <p className="text-xs text-gray-400">يمكنك التواصل مع المشرف العام أو مشرف الصف مباشرة.</p>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setGuardianTarget('supervisor')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${guardianTarget === 'supervisor'
                                                                ? 'bg-primary-500/20 text-primary-200 border border-primary-500/40'
                                                                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                                                                }`}
                                                        >
                                                            المشرف العام
                                                        </button>
                                                        <button
                                                            onClick={() => setGuardianTarget('class')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${guardianTarget === 'class'
                                                                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                                                                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                                                                }`}
                                                        >
                                                            مشرف الصف
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <NeonInput
                                                        label="العنوان"
                                                        type="text"
                                                        placeholder="مثال: استفسار عن الغياب"
                                                        value={guardianTitle}
                                                        onChange={(e) => setGuardianTitle(e.target.value)}
                                                    />
                                                    <label className="text-xs text-gray-400 flex flex-col gap-2">
                                                        <span className="text-gray-300 font-medium">الطالب</span>
                                                        <div className="w-full input-glass p-3 rounded-xl text-white text-sm">
                                                            {selectedChild.name} - {selectedChild.class_name}/{selectedChild.section}
                                                        </div>
                                                    </label>
                                                </div>
                                                <label className="text-xs text-gray-400 flex flex-col gap-2">
                                                    <span className="text-gray-300 font-medium">نص الرسالة</span>
                                                    <textarea
                                                        className="w-full input-glass p-3 rounded-xl resize-none"
                                                        rows={4}
                                                        placeholder="اكتب رسالتك هنا..."
                                                        value={guardianMessage}
                                                        onChange={(e) => setGuardianMessage(e.target.value)}
                                                    />
                                                </label>
                                                <NeonButton
                                                    variant="primary"
                                                    onClick={handleSendGuardianNotification}
                                                    disabled={sendingGuardianMessage}
                                                    startIcon={sendingGuardianMessage ? undefined : <Send className="w-5 h-5" />}
                                                    isLoading={sendingGuardianMessage}
                                                    className="w-full mt-2"
                                                >
                                                    إرسال الإشعار
                                                </NeonButton>
                                            </div>
                                            {combinedNotifications.map(notif => {
                                                let borderColor = 'border-secondary-500/20';
                                                let iconColor = 'text-secondary-400';
                                                let bgColor = 'bg-secondary-500/5';

                                                if (notif.type === 'behavior') { // Admin/Urgent usually behavior related
                                                    borderColor = 'border-red-500/30';
                                                    iconColor = 'text-red-400';
                                                    bgColor = 'bg-red-500/10';
                                                } else if (notif.type === 'attendance') { // Supervisor usually attendance
                                                    borderColor = 'border-amber-500/30';
                                                    iconColor = 'text-amber-400';
                                                    bgColor = 'bg-amber-500/10';
                                                }

                                                return (
                                                    <div key={notif.id} className={`relative glass-card p-6 rounded-2xl border ${borderColor} ${bgColor} overflow-hidden`}>
                                                        <div className="flex justify-between items-start mb-3">
                                                            <h4 className={`font-bold ${iconColor} flex items-center gap-2`}>
                                                                <Bell className="w-4 h-4" />
                                                                {notif.type === 'behavior' ? 'تنبيه إداري' : notif.type === 'attendance' ? 'تنبيه مشرف' : 'إشعار عام'}
                                                            </h4>
                                                            <span className="text-xs text-gray-500 font-mono">{new Date(notif.created_at).toLocaleDateString('ar-SA')}</span>
                                                        </div>
                                                        <p className="text-gray-300 text-sm leading-relaxed">
                                                            {notif.message}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                            {combinedNotifications.length === 0 && (
                                                <div className="glass-card p-10 text-center text-gray-500">
                                                    لا توجد إشعارات جديدة
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                        {/* 5. Excuses Tab */}
                        {activeTab === 'excuses' && (
                            <div className="space-y-4">
                                <div className="glass-card p-6 rounded-2xl border border-white/10 space-y-5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                                            <FileText className="w-5 h-5 text-primary-300" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold">رفع عذر الغياب</h3>
                                            <p className="text-xs text-gray-400">قم برفع المستند وكتابة سبب الغياب ليصل تلقائياً للمشرفين.</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <label className="text-xs text-gray-400 flex flex-col gap-2">
                                            <span className="text-gray-300 font-medium">تاريخ الغياب</span>
                                            <input
                                                type="date"
                                                className="w-full input-glass p-3 rounded-xl"
                                                value={excuseDate}
                                                onChange={(e) => setExcuseDate(e.target.value)}
                                            />
                                        </label>
                                        <label className="text-xs text-gray-400 flex flex-col gap-2">
                                            <span className="text-gray-300 font-medium">الطالب</span>
                                            <div className="w-full input-glass p-3 rounded-xl text-white text-sm">
                                                {selectedChild.name} - {selectedChild.class_name}/{selectedChild.section}
                                            </div>
                                        </label>
                                    </div>
                                    <label className="text-xs text-gray-400 flex flex-col gap-2">
                                        <span className="text-gray-300 font-medium">سبب الغياب</span>
                                        <textarea
                                            className="w-full input-glass p-3 rounded-xl resize-none"
                                            rows={4}
                                            placeholder="يرجى توضيح سبب الغياب..."
                                            value={excuseReason}
                                            onChange={(e) => setExcuseReason(e.target.value)}
                                        />
                                    </label>
                                    <div className="text-xs text-gray-400 flex flex-col gap-3">
                                        <span className="text-gray-300 font-medium">المرفق</span>
                                        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.04] p-4">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0 flex items-center gap-3">
                                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-400/20 bg-primary-400/10">
                                                        <Upload className="h-5 w-5 text-primary-200" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-bold text-white">
                                                            {excuseFile ? excuseFile.name : 'لم يتم اختيار مرفق'}
                                                        </div>
                                                        <div className="mt-1 text-[11px] text-slate-500">
                                                            صورة أو PDF، بحد أقصى 5MB
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 sm:w-auto">
                                                    <button
                                                        type="button"
                                                        onClick={() => excuseFileInputRef.current?.click()}
                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-slate-200 transition active:scale-[0.98] hover:bg-white/[0.09]"
                                                    >
                                                        <Upload className="h-4 w-4" />
                                                        ملف
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => excuseCameraInputRef.current?.click()}
                                                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary-400/25 bg-primary-400/10 px-3 py-2 text-xs font-bold text-primary-100 transition active:scale-[0.98] hover:bg-primary-400/15"
                                                    >
                                                        <Camera className="h-4 w-4" />
                                                        كاميرا
                                                    </button>
                                                </div>
                                            </div>
                                            <input
                                                ref={excuseFileInputRef}
                                                type="file"
                                                className="hidden"
                                                accept="image/*,application/pdf,.pdf"
                                                onChange={(e) => handleExcuseFileSelected(e.target.files?.[0] || null)}
                                            />
                                            <input
                                                ref={excuseCameraInputRef}
                                                type="file"
                                                className="hidden"
                                                accept="image/*"
                                                capture="environment"
                                                onChange={(e) => handleExcuseFileSelected(e.target.files?.[0] || null)}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSubmitExcuse}
                                        disabled={sendingExcuse || !excuseReason.trim() || !excuseFile || !excuseDate}
                                        className="w-full py-3 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary-500/25 transition-all disabled:opacity-60"
                                    >
                                        {sendingExcuse ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                        إرسال عذر الغياب
                                    </button>
                                </div>
                                <div className="glass-card p-5 rounded-2xl border border-white/10">
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-white font-bold">سجل الأعذار</h3>
                                            <p className="mt-1 text-xs text-gray-500">آخر الأعذار المرسلة لهذا الطالب وحالة مراجعتها.</p>
                                        </div>
                                        <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-mono text-slate-300">
                                            {excuses.length}
                                        </span>
                                    </div>
                                    {excuses.length === 0 ? (
                                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
                                            لا توجد أعذار مرسلة لهذا الطالب.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {excuses.map(excuse => (
                                                <div key={excuse.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className={`rounded-xl border px-2.5 py-1 text-[11px] font-bold ${GUARDIAN_EXCUSE_STATUS_STYLES[excuse.status]}`}>
                                                                    {getGuardianExcuseStatusLabel(excuse.status)}
                                                                </span>
                                                                <span className="font-mono text-xs text-slate-500">{excuse.absence_date}</span>
                                                            </div>
                                                            <p className="mt-2 text-sm leading-6 text-slate-300">{excuse.reason}</p>
                                                            {excuse.admin_notes && (
                                                                <p className="mt-2 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-xs leading-6 text-slate-400">
                                                                    ملاحظة الإدارة: {excuse.admin_notes}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <a
                                                            href={excuse.attachment_url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/[0.09]"
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                            المرفق
                                                        </a>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

        </div>
    );
};

export default Parents;
