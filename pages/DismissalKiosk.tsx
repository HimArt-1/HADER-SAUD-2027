import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/db';
import { dismissals } from '../services/dismissals';
import { roster } from '../services/roster';
import { auth } from '../services/auth';
import {
    Scan, Loader2, Home, CheckCircle, AlertTriangle, Clock, X,
    Keyboard, DoorOpen, Megaphone, Volume2, VolumeX
} from 'lucide-react';
import {
    KioskTheme, Student, User, STORAGE_KEYS, DismissalCallRequest, DismissalSchedule, Role
} from '../types';
import { logError } from '../types/errors';
import { GlassCard } from '../components/ui/GlassCard';
import { accessPolicy } from '../modules/access';
import { resolveFullSessionUser } from '../services/sessionUserResolver';
import { useAutoReload } from '../hooks/useAutoReload';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useSyncRefresh } from '../hooks/useSyncRefresh';
import { findDismissalCallForStudent } from '../components/dismissal/dismissalUiRules';

const {
    filterDismissalCallsForUserScopeWithStudents,
    filterDismissalSchedulesForUserScope,
    filterRowsByStudentScope,
    isStudentAllowedForUserScope
} = accessPolicy;

// ═══════════════════════════════════════════════════════════════
// 🚪 Dismissal Kiosk — كشك الانصراف
// ═══════════════════════════════════════════════════════════════

// Reuse the same theme system from Kiosk
const KIOSK_THEMES: Record<KioskTheme, {
    bg: string; blob1: string; blob2: string; accent: string;
    text: string; subText: string; inputBg: string; inputBorder: string;
    glowFrom: string; glowTo: string; isDark: boolean;
}> = {
    'dark-neon': {
        bg: 'bg-[#0f172a]', blob1: 'bg-primary-500/30', blob2: 'bg-secondary-600/25',
        accent: 'text-primary-400', text: 'text-white', subText: 'text-slate-300',
        inputBg: 'bg-slate-900/80', inputBorder: 'border-primary-500/50',
        glowFrom: 'from-primary-400', glowTo: 'to-secondary-600', isDark: true
    },
    'dark-gradient': {
        bg: 'bg-gradient-to-br from-secondary-950 via-secondary-900 to-fuchsia-950',
        blob1: 'bg-secondary-500/30', blob2: 'bg-secondary-500/20',
        accent: 'text-secondary-300', text: 'text-white', subText: 'text-secondary-200',
        inputBg: 'bg-secondary-950/60', inputBorder: 'border-secondary-400/30',
        glowFrom: 'from-secondary-400', glowTo: 'to-secondary-400', isDark: true
    },
    'light-clean': {
        bg: 'bg-gradient-to-br from-gray-100 via-white to-secondary-50',
        blob1: 'bg-secondary-400/20', blob2: 'bg-indigo-400/20',
        accent: 'text-secondary-600', text: 'text-gray-800', subText: 'text-secondary-500',
        inputBg: 'bg-white/90', inputBorder: 'border-secondary-300',
        glowFrom: 'from-secondary-400', glowTo: 'to-indigo-400', isDark: false
    },
    'light-soft': {
        bg: 'bg-gradient-to-br from-rose-50 via-amber-50 to-sky-50',
        blob1: 'bg-rose-300/30', blob2: 'bg-amber-300/30',
        accent: 'text-rose-500', text: 'text-gray-700', subText: 'text-rose-400',
        inputBg: 'bg-white/80', inputBorder: 'border-rose-200',
        glowFrom: 'from-rose-300', glowTo: 'to-amber-300', isDark: false
    },
    'ocean-blue': {
        bg: 'bg-gradient-to-br from-sky-600 via-secondary-700 to-indigo-900',
        blob1: 'bg-sky-400/30', blob2: 'bg-secondary-400/20',
        accent: 'text-sky-200', text: 'text-white', subText: 'text-sky-300',
        inputBg: 'bg-secondary-900/60', inputBorder: 'border-sky-400/30',
        glowFrom: 'from-sky-300', glowTo: 'to-secondary-400', isDark: true
    },
    'sunset-warm': {
        bg: 'bg-gradient-to-br from-orange-500 via-rose-500 to-secondary-700',
        blob1: 'bg-yellow-400/30', blob2: 'bg-rose-400/30',
        accent: 'text-yellow-200', text: 'text-white', subText: 'text-orange-200',
        inputBg: 'bg-orange-900/50', inputBorder: 'border-yellow-400/30',
        glowFrom: 'from-yellow-300', glowTo: 'to-rose-400', isDark: true
    },
    'forest-green': {
        bg: 'bg-gradient-to-br from-emerald-700 via-green-800 to-teal-900',
        blob1: 'bg-emerald-400/30', blob2: 'bg-teal-400/20',
        accent: 'text-emerald-300', text: 'text-white', subText: 'text-emerald-200',
        inputBg: 'bg-green-950/60', inputBorder: 'border-emerald-400/30',
        glowFrom: 'from-emerald-300', glowTo: 'to-teal-400', isDark: true
    },
    'royal-purple': {
        bg: 'bg-gradient-to-br from-secondary-800 via-fuchsia-800 to-secondary-900',
        blob1: 'bg-fuchsia-400/30', blob2: 'bg-secondary-400/20',
        accent: 'text-fuchsia-300', text: 'text-white', subText: 'text-secondary-200',
        inputBg: 'bg-secondary-950/60', inputBorder: 'border-fuchsia-400/30',
        glowFrom: 'from-fuchsia-300', glowTo: 'to-secondary-400', isDark: true
    },
    'cherry-blossom': {
        bg: 'bg-gradient-to-br from-secondary-400 via-rose-400 to-secondary-400',
        blob1: 'bg-secondary-400/30', blob2: 'bg-secondary-400/20',
        accent: 'text-secondary-300', text: 'text-white', subText: 'text-secondary-200',
        inputBg: 'bg-secondary-950/60', inputBorder: 'border-secondary-400/30',
        glowFrom: 'from-secondary-300', glowTo: 'to-secondary-400', isDark: true
    },
    'fire-ember': {
        bg: 'bg-gradient-to-br from-red-500 via-orange-500 to-amber-600',
        blob1: 'bg-red-400/30', blob2: 'bg-orange-400/20',
        accent: 'text-orange-300', text: 'text-white', subText: 'text-orange-200',
        inputBg: 'bg-red-950/60', inputBorder: 'border-orange-400/30',
        glowFrom: 'from-red-300', glowTo: 'to-orange-400', isDark: true
    },
    'electric-storm': {
        bg: 'bg-gradient-to-br from-yellow-400 via-secondary-500 to-indigo-600',
        blob1: 'bg-yellow-400/30', blob2: 'bg-secondary-400/20',
        accent: 'text-yellow-300', text: 'text-white', subText: 'text-secondary-200',
        inputBg: 'bg-indigo-950/60', inputBorder: 'border-yellow-400/30',
        glowFrom: 'from-yellow-300', glowTo: 'to-secondary-400', isDark: true
    },
    'deep-ocean': {
        bg: 'bg-gradient-to-br from-secondary-900 via-indigo-900 to-teal-800',
        blob1: 'bg-secondary-400/30', blob2: 'bg-teal-400/20',
        accent: 'text-secondary-300', text: 'text-white', subText: 'text-secondary-200',
        inputBg: 'bg-secondary-950/60', inputBorder: 'border-secondary-400/30',
        glowFrom: 'from-secondary-300', glowTo: 'to-teal-400', isDark: true
    },
    'mint-fresh': {
        bg: 'bg-gradient-to-br from-emerald-400 via-teal-400 to-primary-400',
        blob1: 'bg-emerald-400/30', blob2: 'bg-primary-400/20',
        accent: 'text-emerald-200', text: 'text-white', subText: 'text-teal-200',
        inputBg: 'bg-emerald-950/60', inputBorder: 'border-emerald-400/30',
        glowFrom: 'from-emerald-300', glowTo: 'to-primary-400', isDark: true
    },
    'galaxy-purple': {
        bg: 'bg-gradient-to-br from-secondary-600 via-secondary-600 to-fuchsia-600',
        blob1: 'bg-secondary-400/30', blob2: 'bg-fuchsia-400/20',
        accent: 'text-secondary-300', text: 'text-white', subText: 'text-secondary-200',
        inputBg: 'bg-secondary-950/60', inputBorder: 'border-secondary-400/30',
        glowFrom: 'from-secondary-300', glowTo: 'to-fuchsia-400', isDark: true
    },
    'desert-sand': {
        bg: 'bg-gradient-to-br from-amber-600 via-orange-600 to-yellow-600',
        blob1: 'bg-amber-400/30', blob2: 'bg-yellow-400/20',
        accent: 'text-amber-300', text: 'text-white', subText: 'text-orange-200',
        inputBg: 'bg-amber-950/60', inputBorder: 'border-amber-400/30',
        glowFrom: 'from-amber-300', glowTo: 'to-yellow-400', isDark: true
    }
};

interface DismissalResult {
    type: 'success' | 'error' | 'already';
    message: string;
    student?: Student;
}

const DismissalKiosk: React.FC = () => {
    const navigate = useNavigate();
    
    // Auto reload at midnight to prevent memory leaks
    useAutoReload(0, 0);

    // Core state
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [barcodeInput, setBarcodeInput] = useState('');
    const [result, setResult] = useState<DismissalResult | null>(null);
    const [processing, setProcessing] = useState(false);
    const [todayCount, setTodayCount] = useState(0);
    const [showCallPanel, setShowCallPanel] = useState(false);
    const [activeCalls, setActiveCalls] = useState<DismissalCallRequest[]>([]);
    const [schedules, setSchedules] = useState<DismissalSchedule[]>([]);
    const [callActionId, setCallActionId] = useState<string | null>(null);
    const [dataError, setDataError] = useState('');

    // 🔴 Added for incoming call flash and TTS
    const [incomingCall, setIncomingCall] = useState<DismissalCallRequest | null>(null);
    const announcedCallsRef = useRef<Set<string>>(new Set());
    const currentUserRef = useRef<User | null>(null);

    // Theme
    const [currentTheme, setCurrentTheme] = useState<KioskTheme>(() => {
        return (localStorage.getItem(STORAGE_KEYS.DISMISSAL_KIOSK_THEME) as KioskTheme) || 'dark-neon';
    });
    const theme = KIOSK_THEMES[currentTheme] || KIOSK_THEMES['dark-neon'];

    const [soundEnabled, setSoundEnabled] = useState(() => {
        try {
            const v = localStorage.getItem(STORAGE_KEYS.DISMISSAL_KIOSK_SOUND);
            if (v === '0' || v === 'false') return false;
            return true;
        } catch {
            return true;
        }
    });
    const setSound = useCallback((on: boolean) => {
        setSoundEnabled(on);
        try {
            localStorage.setItem(STORAGE_KEYS.DISMISSAL_KIOSK_SOUND, on ? '1' : '0');
        } catch { /* ignore */ }
    }, []);

    // Refs
    const inputRef = useRef<HTMLInputElement>(null);
    const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const incomingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const processingRef = useRef(false);
    const refreshSeqRef = useRef(0);

    const resolveCurrentUser = useCallback(async (): Promise<User | null> => {
        const sessionUser = (await auth.getCurrentUser()) ?? auth.getSession();
        return await resolveFullSessionUser(sessionUser);
    }, []);

    // Clock
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Auth check
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const session = await auth.getSession();
                if (!session) {
                    navigate('/');
                    return;
                }
                // Preload students
                await db.preloadForKiosk();
                const currentUser = await resolveCurrentUser();
                currentUserRef.current = currentUser;

                const [overview, rosterSnapshot] = await Promise.all([
                    dismissals.load({ type: 'overview' }),
                    roster.load()
                ]);
                setTodayCount(filterRowsByStudentScope(
                    overview.records,
                    rosterSnapshot.students,
                    currentUser
                ).length);
                const filteredCalls = filterDismissalCallsForUserScopeWithStudents(
                    overview.calls,
                    rosterSnapshot.students,
                    currentUser
                );

                setActiveCalls(filteredCalls);
                // Pre-fill announced set so we don't announce existing calls on load
                filteredCalls.forEach(c => announcedCallsRef.current.add(c.id));

                setSchedules(filterDismissalSchedulesForUserScope(overview.schedules, currentUser));
            } catch (err) {
                logError(err, 'DismissalKiosk - Init');
                setDataError('تعذر تهيئة محطة الانصراف. يمكنك الاستمرار أو إعادة المحاولة بعد التحقق من الاتصال.');
            } finally {
                setLoading(false);
            }
        };
        checkAuth();
    }, [navigate, resolveCurrentUser]);

    // TTS & Modal pop-up (الصوت اختياري — الإشارة المرئية تبقى)
    const playCallAlert = useCallback((call: DismissalCallRequest) => {
        setIncomingCall(call);
        setShowCallPanel(true);
        
        if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current);
        incomingTimeoutRef.current = setTimeout(() => {
            setIncomingCall(prev => prev?.id === call.id ? null : prev);
        }, 8000);

        if (soundEnabled && 'speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(`نداء خروج للطالب... ${call.student_name}`);
            utterance.lang = 'ar-SA';
            utterance.rate = 0.85;
            utterance.pitch = 1.1;
            window.speechSynthesis.speak(utterance);
        }
    }, [soundEnabled]);

    const processCallsList = useCallback((filteredCalls: DismissalCallRequest[]) => {
        setActiveCalls(filteredCalls);
        const currentPending = filteredCalls.filter(c => c.status === 'pending');
        const newCalls = currentPending.filter(c => !announcedCallsRef.current.has(c.id));
        if (newCalls.length > 0) {
            const callToAnnounce = newCalls[newCalls.length - 1];
            playCallAlert(callToAnnounce);
            newCalls.forEach(c => announcedCallsRef.current.add(c.id));
        }
    }, [playCallAlert]);

    const refreshCalls = useCallback(async () => {
        try {
            const seq = ++refreshSeqRef.current;
            const [overview, rosterSnapshot, currentUser] = await Promise.all([
                dismissals.load({ type: 'overview' }),
                roster.load(),
                resolveCurrentUser()
            ]);
            if (seq !== refreshSeqRef.current) return;
            currentUserRef.current = currentUser;
            const filtered = filterDismissalCallsForUserScopeWithStudents(
                overview.calls,
                rosterSnapshot.students,
                currentUser
            );
            processCallsList(filtered);
            setTodayCount(filterRowsByStudentScope(
                overview.records,
                rosterSnapshot.students,
                currentUser
            ).length);
            setDataError('');
        } catch (e) {
            setDataError('تعذر تحديث بيانات الانصراف. ستستمر المحاولة تلقائيًا.');
            logError(e, 'DismissalKiosk - refreshCalls');
        }
    }, [processCallsList, resolveCurrentUser]);

    useLiveUpdates(() => {
        void refreshCalls();
    });
    useSyncRefresh(() => {
        void refreshCalls();
    }, 2000);

    useEffect(() => {
        const POLL_MS = 4000;
        const tick = () => {
            if (document.visibilityState === 'visible') {
                void refreshCalls();
            }
        };
        const id = setInterval(tick, POLL_MS);
        return () => clearInterval(id);
    }, [refreshCalls]);

    // Subscribe to call updates
    useEffect(() => {
        const sub = dismissals.subscribe((calls) => {
            void (async () => {
                const [rosterSnapshot, currentUser] = await Promise.all([
                    roster.load(),
                    resolveCurrentUser()
                ]);
                currentUserRef.current = currentUser;
                const filtered = filterDismissalCallsForUserScopeWithStudents(
                    calls,
                    rosterSnapshot.students,
                    currentUser
                );
                processCallsList(filtered);
            })();
        });
        return () => {
            sub.unsubscribe();
            refreshSeqRef.current += 1;
            if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
            if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current);
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        };
    }, [processCallsList, resolveCurrentUser]);

    // Focus input
    useEffect(() => {
        if (!loading && inputRef.current) {
            inputRef.current.focus();
        }
    }, [loading, result]);

    // Barcode scan handler
    const handleScan = useCallback(async (inputId: string) => {
        const trimmed = inputId.trim();
        if (!trimmed || processingRef.current) return;

        processingRef.current = true;
        setProcessing(true);
        setResult(null);

        try {
            // Look up student
            const student = await roster.findStudent(trimmed);
            if (!student) {
                setResult({
                    type: 'error',
                    message: 'الطالب غير موجود. تحقق من المعرف أو الرمز.'
                });
                return;
            }

            const currentUser = currentUserRef.current ?? auth.getSession();
            if (!isStudentAllowedForUserScope(student, currentUser)) {
                setResult({
                    type: 'error',
                    message: 'هذا الطالب خارج الصفوف أو الفصول المسندة لهذا المستخدم.'
                });
                return;
            }

            const matchingCall = findDismissalCallForStudent(activeCalls, student.id);
            const dismissal = await dismissals.execute({
                type: 'record-dismissal',
                studentId: student.id,
                callId: matchingCall?.id,
                method: 'kiosk',
                recordedByLabel: 'جهاز البصمة/الكشك'
            });

            if (dismissal.outcome === 'already-dismissed') {
                await refreshCalls();
                setResult({
                    type: 'already',
                    message: 'تم تسجيل انصراف الطالب مسبقاً لهذا اليوم',
                    student
                });
                return;
            }

            await refreshCalls();
            setResult({
                type: 'success',
                message: `تم تسجيل انصراف ${student.name} بنجاح ✅`,
                student
            });
        } catch (err) {
            logError(err, 'DismissalKiosk - Scan');
            setResult({
                type: 'error',
                message: 'حدث خطأ أثناء تسجيل الانصراف'
            });
        } finally {
            processingRef.current = false;
            setProcessing(false);
            setBarcodeInput('');
            // Clear result after 5 seconds
            if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
            resultTimeoutRef.current = setTimeout(() => {
                setResult(null);
                inputRef.current?.focus();
            }, 5000);
        }
    }, [activeCalls, refreshCalls]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBarcodeInput(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && barcodeInput.trim()) {
            handleScan(barcodeInput);
        }
    };

    // Mark call as "called" (announced)
    const handleMarkCalled = async (callId: string) => {
        if (callActionId) return;
        setCallActionId(callId);
        try {
            await dismissals.execute({ type: 'transition-call', callId, status: 'called' });
            await refreshCalls();
        } catch (error) {
            setDataError('تعذر اعتماد النداء. أعد المحاولة.');
            logError(error, 'DismissalKiosk - Mark Called');
        } finally {
            setCallActionId(null);
        }
    };

    // Cancel call
    const handleCancelCall = async (callId: string) => {
        if (callActionId) return;
        setCallActionId(callId);
        try {
            await dismissals.execute({ type: 'transition-call', callId, status: 'cancelled' });
            await refreshCalls();
        } catch (error) {
            setDataError('تعذر إلغاء طلب النداء. أعد المحاولة.');
            logError(error, 'DismissalKiosk - Cancel Call');
        } finally {
            setCallActionId(null);
        }
    };

    // Loading screen
    if (loading) {
        return (
            <div className={`min-h-screen flex items-center justify-center ${theme.bg}`}>
                <div className="text-center">
                    <Loader2 className={`w-16 h-16 animate-spin mx-auto mb-4 ${theme.accent}`} />
                    <p className={`text-xl ${theme.subText}`}>جاري تحميل كشك الانصراف...</p>
                </div>
            </div>
        );
    }

    const timeStr = currentTime.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = currentTime.toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <div
            className={`min-h-screen relative overflow-hidden select-none ${theme.bg}`}
            onClick={() => inputRef.current?.focus()}
        >
            {/* Animated background blobs */}
            <div className={`absolute top-[-20%] right-[-10%] w-[70vw] h-[70vw] rounded-full ${theme.blob1} blur-[120px] animate-pulse pointer-events-none`} />
            <div className={`absolute bottom-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full ${theme.blob2} blur-[100px] animate-pulse pointer-events-none`} style={{ animationDelay: '2s' }} />

            {/* Top bar */}
            <div className="relative z-10 flex items-center justify-between gap-2 p-3 sm:p-4 md:p-6">
                {/* Left: Home + sound (نداء) */}
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className={`p-3 rounded-2xl backdrop-blur-xl border transition-all hover:scale-105 ${theme.isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-black/5 border-black/10 hover:bg-black/10'}`}
                    >
                        <Home className={`w-6 h-6 ${theme.accent}`} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setSound(!soundEnabled)}
                        title={soundEnabled ? 'كتم نطق النداء' : 'تشغيل نطق النداء'}
                        className={`p-3 rounded-2xl backdrop-blur-xl border transition-all hover:scale-105 ${theme.isDark ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-black/5 border-black/10 hover:bg-black/10'} ${!soundEnabled ? 'opacity-70' : ''}`}
                    >
                        {soundEnabled ? (
                            <Volume2 className="w-6 h-6 text-primary-400" />
                        ) : (
                            <VolumeX className="w-6 h-6 text-slate-400" />
                        )}
                    </button>
                </div>

                {/* Center: Clock */}
                <div className="min-w-0 text-center">
                    <div className={`text-2xl font-bold tracking-tight sm:text-4xl md:text-7xl ${theme.text}`} style={{ fontFamily: 'Tajawal, sans-serif', direction: 'ltr' }}>
                        {timeStr}
                    </div>
                    <p className={`text-sm md:text-base mt-1 ${theme.subText}`}>{dateStr}</p>
                </div>

                {/* Right: Call Panel Toggle + Stats */}
                <div className="flex items-center gap-3">
                    {activeCalls.length > 0 && (
                        <button
                            onClick={() => setShowCallPanel(!showCallPanel)}
                            className={`relative p-3 rounded-2xl backdrop-blur-xl border transition-all hover:scale-105 ${theme.isDark ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20' : 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20'}`}
                        >
                            <Megaphone className="w-6 h-6 text-amber-400" />
                            <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center animate-pulse">
                                {activeCalls.length}
                            </span>
                        </button>
                    )}
                    <div className={`hidden items-center gap-2 rounded-2xl border px-4 py-2 backdrop-blur-xl sm:flex ${theme.isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                        <DoorOpen className={`w-5 h-5 ${theme.accent}`} />
                        <span className={`text-lg font-bold ${theme.text}`}>{todayCount}</span>
                        <span className={`text-sm ${theme.subText}`}>منصرف</span>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="relative z-10 flex min-h-[calc(100dvh-150px)] flex-col items-center justify-center px-3 pb-16 sm:px-4 md:px-8">
                {dataError && (
                    <div className="mb-5 flex w-full max-w-2xl items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100" role="alert">
                        <span>{dataError}</span>
                        <button onClick={() => void refreshCalls()} className="shrink-0 rounded-lg bg-red-500/15 px-3 py-1.5 font-bold hover:bg-red-500/25">إعادة المحاولة</button>
                    </div>
                )}
                {/* Title */}
                <div className="mb-6 text-center md:mb-12">
                    <div className="flex items-center justify-center gap-4 mb-4">
                        <DoorOpen className={`w-12 h-12 md:w-16 md:h-16 ${theme.accent} drop-shadow-lg`} />
                        <h1 className={`text-3xl font-bold sm:text-4xl md:text-6xl ${theme.text}`} style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            كشك الانصراف
                        </h1>
                    </div>
                    <p className={`text-lg md:text-xl ${theme.subText}`}>
                        امسح الباركود أو أدخل رقم الطالب لتسجيل الانصراف
                    </p>
                </div>

                {/* Input Area */}
                <div className="w-full max-w-2xl mb-8">
                    <GlassCard variant="neon" className="!p-0 overflow-hidden shadow-[0_0_40px_rgb(var(--color-primary-500)_/_0.15)]" hoverEffect={false}>
                        {/* Gradient glow bar */}
                        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${theme.glowFrom} ${theme.glowTo}`} />
                        <div className="flex items-center">
                            <div className="px-6">
                                {processing ? (
                                    <Loader2 className={`w-8 h-8 animate-spin ${theme.accent}`} />
                                ) : (
                                    <Scan className={`w-8 h-8 ${theme.accent}`} />
                                )}
                            </div>
                            <input
                                ref={inputRef}
                                type="text"
                                value={barcodeInput}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                placeholder="امسح الباركود أو أدخل الرقم..."
                                className={`min-w-0 flex-1 bg-transparent py-5 text-2xl outline-none sm:text-4xl md:py-6 md:text-5xl ${theme.text} placeholder:${theme.subText} placeholder:opacity-40`}
                                style={{ fontFamily: 'Tajawal, sans-serif', direction: 'ltr', textAlign: 'center' }}
                                autoFocus
                                autoComplete="off"
                                disabled={processing}
                            />
                            {barcodeInput && (
                                <button
                                    onClick={() => { setBarcodeInput(''); inputRef.current?.focus(); }}
                                    className="px-6"
                                >
                                    <X className={`w-8 h-8 ${theme.subText} hover:${theme.accent}`} />
                                </button>
                            )}
                        </div>
                    </GlassCard>
                </div>

                {/* Result Display */}
                {result && (
                    <div className={`w-full max-w-2xl animate-fade-in-up`}>
                        <GlassCard className={`transition-all duration-500 border-2 ${result.type === 'success'
                            ? 'border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_60px_rgba(16,185,129,0.3)]'
                            : result.type === 'already'
                                ? 'border-amber-500/50 bg-amber-500/10 shadow-[0_0_60px_rgba(245,158,11,0.3)]'
                                : 'border-red-500/50 bg-red-500/10 shadow-[0_0_60px_rgba(239,68,68,0.3)]'
                            }`}>
                            <div className="flex items-center justify-center gap-4 mb-4">
                                {result.type === 'success' ? (
                                    <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                        <CheckCircle className="w-12 h-12 text-emerald-400 animate-bounce" />
                                    </div>
                                ) : result.type === 'already' ? (
                                    <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center">
                                        <AlertTriangle className="w-12 h-12 text-amber-400" />
                                    </div>
                                ) : (
                                    <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center">
                                        <AlertTriangle className="w-12 h-12 text-red-400" />
                                    </div>
                                )}
                            </div>

                            {result.student && (
                                <div className="text-center mb-4">
                                    <h2 className={`text-3xl md:text-4xl font-bold ${theme.text} mb-2`}>
                                        {result.student.name}
                                    </h2>
                                    <div className="flex items-center justify-center gap-4">
                                        <span className={`text-lg px-4 py-1 rounded-full ${theme.isDark ? 'bg-white/10' : 'bg-black/10'} ${theme.subText}`}>
                                            {result.student.class_name}
                                        </span>
                                        {result.student.section && (
                                            <span className={`text-lg px-4 py-1 rounded-full ${theme.isDark ? 'bg-white/10' : 'bg-black/10'} ${theme.subText}`}>
                                                {result.student.section}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            <p className={`text-center text-xl md:text-2xl font-medium ${result.type === 'success' ? 'text-emerald-300' :
                                result.type === 'already' ? 'text-amber-300' : 'text-red-300'
                                }`}>
                                {result.message}
                            </p>

                            {result.type === 'success' && (
                                <div className="flex items-center justify-center gap-2 mt-4">
                                    <Clock className={`w-5 h-5 ${theme.subText}`} />
                                    <span className={`text-lg ${theme.subText}`}>
                                        {new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            )}
                        </GlassCard>
                    </div>
                )}

                {/* No result - show hint */}
                {!result && !processing && (
                    <div className={`flex items-center gap-3 ${theme.subText} opacity-60 mt-4`}>
                        <Keyboard className="w-5 h-5" />
                        <span className="text-sm">اضغط Enter بعد إدخال الرقم أو استخدم ماسح الباركود</span>
                    </div>
                )}
            </div>

            {/* Call Panel (Sidebar) */}
            {showCallPanel && activeCalls.length > 0 && (
                <div className="fixed inset-y-0 left-0 z-50 w-full overflow-y-auto border-r border-white/10 shadow-[0_0_80px_rgb(var(--color-primary-500)_/_0.2)] backdrop-blur-2xl animate-fade-in-up sm:w-96"
                    style={{ background: theme.isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-white/10">
                        <div className="flex items-center gap-3">
                            <Megaphone className="w-7 h-7 text-amber-400" />
                            <h2 className={`text-xl font-bold ${theme.text}`}>طلبات النداء</h2>
                        </div>
                        <button onClick={() => setShowCallPanel(false)} className="p-2 rounded-xl hover:bg-white/10 transition">
                            <X className={`w-5 h-5 ${theme.subText}`} />
                        </button>
                    </div>

                    {/* Call List */}
                    <div className="p-4 space-y-3">
                        {activeCalls.map((call) => (
                            <div
                                key={call.id}
                                className={`rounded-2xl p-4 border transition-all ${call.status === 'pending'
                                    ? 'border-amber-500/30 bg-amber-500/10 animate-pulse'
                                    : 'border-emerald-500/30 bg-emerald-500/10'
                                    }`}
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div>
                                        <h3 className={`text-lg font-bold ${theme.text}`}>{call.student_name}</h3>
                                        <p className={`text-sm ${theme.subText}`}>{call.class_name} - {call.section}</p>
                                    </div>
                                    <span className={`text-xs px-3 py-1 rounded-full font-bold ${call.status === 'pending'
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        }`}>
                                        {call.status === 'pending' ? '⏳ بانتظار النداء' : '📢 تم النداء'}
                                    </span>
                                </div>

                                {call.requested_by_name && (
                                    <p className={`text-xs ${theme.subText} mb-2`}>
                                        طلب من: {call.requested_by_name}
                                    </p>
                                )}

                                <div className="flex gap-2 mt-3">
                                    {call.status === 'pending' && (
                                        <button
                                            onClick={() => handleMarkCalled(call.id)}
                                            disabled={callActionId !== null}
                                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 transition-all text-sm font-bold"
                                        >
                                            {callActionId === call.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                                            تم النداء
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleCancelCall(call.id)}
                                        disabled={callActionId !== null}
                                        className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all text-sm"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Schedule Ticker Strip */}
            {schedules.length > 0 && (
                <div className="absolute bottom-3 left-0 right-0 z-10 flex items-center justify-start gap-4 overflow-x-auto px-4 py-2 sm:bottom-8 sm:justify-center">
                    {schedules
                        .filter(s => s.days.includes(currentTime.getDay()))
                        .map(s => {
                            const [h, m] = s.dismissal_time.split(':').map(Number);
                            const target = new Date(currentTime);
                            target.setHours(h, m, 0, 0);
                            const diffMs = target.getTime() - currentTime.getTime();
                            const diffMin = Math.ceil(diffMs / 60000);
                            const isPast = diffMin <= 0;
                            return (
                                <div key={s.id} className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl backdrop-blur-xl border text-sm font-bold transition-all ${isPast
                                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                        : 'border-white/10 bg-white/5 ' + theme.subText
                                    }`}>
                                    <Clock className="w-4 h-4" />
                                    <span>{s.class_name}</span>
                                    <span className="opacity-60">{s.dismissal_time}</span>
                                    <span className={isPast ? 'text-emerald-400' : 'text-amber-400'}>
                                        {isPast ? '✅ حان الوقت' : `⏳ باقي ${diffMin} د`}
                                    </span>
                                </div>
                            );
                        })}
                </div>
            )}

            {/* Footer gradient bar */}
            <div className="absolute bottom-0 left-0 right-0 h-2">
                <div className={`h-full bg-gradient-to-r ${theme.glowFrom} ${theme.glowTo} opacity-60`} />
            </div>

            {/* Incoming Call Massive Flash Overlay */}
            {incomingCall && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.3) 0%, transparent 80%)' }}>
                    <div className="bg-amber-500/95 backdrop-blur-3xl text-white p-12 md:p-24 rounded-[3rem] shadow-[0_0_120px_rgba(245,158,11,0.9)] border-4 border-amber-200 animate-[bounce_1s_ease-in-out_infinite] min-w-[50vw] text-center">
                        <Megaphone className="w-32 h-32 md:w-48 md:h-48 mx-auto mb-8 animate-pulse text-amber-100 drop-shadow-2xl" />
                        <h2 className="text-6xl md:text-8xl font-black mb-8 drop-shadow-xl" style={{ fontFamily: 'Tajawal, sans-serif' }}>نداء خروج</h2>
                        <h3 className="text-5xl md:text-7xl font-bold mb-4 drop-shadow-lg text-amber-50">{incomingCall.student_name}</h3>
                        <p className="text-3xl md:text-5xl opacity-90 drop-shadow-md text-amber-100">{incomingCall.class_name} {incomingCall.section && `- ${incomingCall.section}`}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DismissalKiosk;
