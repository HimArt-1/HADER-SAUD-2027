import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { dismissals } from '../services/dismissals';
import { roster } from '../services/roster';
import { auth } from '../services/auth';
import {
    Megaphone, Clock, Home, DoorOpen, Volume2,
    CheckCircle, Loader2, Sparkles, LogOut, AlertCircle, RefreshCcw
} from 'lucide-react';
import { DismissalCallRequest, User } from '../types';
import { accessPolicy } from '../modules/access';
import { resolveFullSessionUser } from '../services/sessionUserResolver';
import { useAutoReload } from '../hooks/useAutoReload';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useSyncRefresh } from '../hooks/useSyncRefresh';
import { logError } from '../types/errors';
import { splitDismissalCalls } from '../components/dismissal/dismissalUiRules';

const {
    filterDismissalCallsForUserScopeWithStudents,
    filterRowsByStudentScope
} = accessPolicy;

const CALL_BOARD_PARTICLES = Array.from({ length: 14 }, (_, index) => ({
    id: index,
    top: `${(index * 37 + 11) % 100}%`,
    left: `${(index * 61 + 7) % 100}%`,
    delay: `${(index % 5) * 0.8}s`,
    duration: `${3 + (index % 4)}s`
}));

// ═══════════════════════════════════════════════════════════════
// 📺 Call Board — لوحة النداءات
// Beautiful full-screen display for school hallways
// ═══════════════════════════════════════════════════════════════

const CallBoard: React.FC = () => {
    const navigate = useNavigate();
    const [calls, setCalls] = useState<DismissalCallRequest[]>([]);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [todayCount, setTodayCount] = useState(0);
    const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
    const prevCallIdsRef = useRef<Set<string>>(new Set());
    const audioRef = useRef<AudioContext | null>(null);
    const [dismissingId, setDismissingId] = useState<string | null>(null);
    const [callingId, setCallingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const dismissBusyRef = useRef(false);
    const refreshSeqRef = useRef(0);
    const animationTimerRef = useRef<number | null>(null);

    // Auto reload at midnight to prevent memory leaks
    useAutoReload(0, 0);

    // Clock
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Sound effect for new calls
    const playNotificationSound = useCallback(() => {
        try {
            if (!audioRef.current) {
                audioRef.current = new AudioContext();
            }
            const ctx = audioRef.current;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            // Pleasant two-tone chime
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);
        } catch {
            // Audio not available
        }
    }, []);

    // Load data
    const resolveCurrentUser = useCallback(async (): Promise<User | null> => {
        const sessionUser = await auth.getCurrentUser();
        return await resolveFullSessionUser(sessionUser);
    }, []);

    const refreshData = useCallback(async () => {
        const seq = ++refreshSeqRef.current;
        setRefreshing(true);
        try {
            const [overview, rosterSnapshot, currentUser] = await Promise.all([
                dismissals.load({ type: 'overview' }),
                roster.load(),
                resolveCurrentUser()
            ]);
            const filteredCalls = filterDismissalCallsForUserScopeWithStudents(
                overview.calls,
                rosterSnapshot.students,
                currentUser
            );
            const filteredDismissals = filterRowsByStudentScope(
                overview.records,
                rosterSnapshot.students,
                currentUser
            );

            // Check for new calls
            const currentIds = new Set(filteredCalls.map(c => c.id));
            const newIds = filteredCalls
                .filter(c => !prevCallIdsRef.current.has(c.id))
                .map(c => c.id);

            if (seq !== refreshSeqRef.current) return;
            if (newIds.length > 0 && prevCallIdsRef.current.size > 0) {
                playNotificationSound();
                setAnimatingIds(new Set(newIds));
                if (animationTimerRef.current) window.clearTimeout(animationTimerRef.current);
                animationTimerRef.current = window.setTimeout(() => setAnimatingIds(new Set()), 2000);
            }

            prevCallIdsRef.current = currentIds;
            setCalls(filteredCalls);
            setTodayCount(filteredDismissals.length);
            setErrorMessage('');
        } catch (err) {
            if (seq === refreshSeqRef.current) setErrorMessage('تعذر تحديث طلبات النداء. ستستمر المحاولة تلقائيًا.');
            logError(err, 'CallBoard - Refresh');
        } finally {
            if (seq === refreshSeqRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [playNotificationSound, resolveCurrentUser]);

    const handleRecordDismissal = useCallback(async (call: DismissalCallRequest) => {
        if (dismissBusyRef.current) return;
        dismissBusyRef.current = true;
        setDismissingId(call.id);
        try {
            const session = await auth.getCurrentUser();
            await dismissals.execute({
                type: 'record-dismissal',
                studentId: call.student_id,
                callId: call.id,
                // DB CHECK allows kiosk|watcher|scanner|admin — use kiosk + label for call board
                method: 'kiosk',
                recordedBy: session?.id ?? null,
                recordedByLabel: session?.name
                    ? `لوحة النداءات — ${session.name}`
                    : 'لوحة النداءات'
            });
            await refreshData();
        } catch (err) {
            setErrorMessage('تعذر تسجيل الانصراف. أعد المحاولة.');
            logError(err, 'CallBoard - Record Dismissal');
        } finally {
            dismissBusyRef.current = false;
            setDismissingId(null);
        }
    }, [refreshData]);

    const handleMarkCalled = useCallback(async (call: DismissalCallRequest) => {
        if (callingId || dismissBusyRef.current) return;
        setCallingId(call.id);
        try {
            await dismissals.execute({ type: 'transition-call', callId: call.id, status: 'called' });
            await refreshData();
        } catch (error) {
            setErrorMessage('تعذر اعتماد النداء. أعد المحاولة.');
            logError(error, 'CallBoard - Mark Called');
        } finally {
            setCallingId(null);
        }
    }, [callingId, refreshData]);

    // Cross-tab + sync service + hader:realtime-update; complements subscribeToDismissalCalls
    useLiveUpdates(() => {
        void refreshData();
    });
    useSyncRefresh(() => {
        void refreshData();
    }, 2000);

    // Fallback polling: other devices’ inserts may not fire postgres_changes (Realtime not enabled, RLS, or tab sleep)
    useEffect(() => {
        const POLL_MS = 4000;
        const tick = () => {
            if (document.visibilityState === 'visible') {
                void refreshData();
            }
        };
        const id = setInterval(tick, POLL_MS);
        return () => clearInterval(id);
    }, [refreshData]);

    useEffect(() => {
        refreshData();
        const sub = dismissals.subscribe(() => {
            void refreshData();
        });
        return () => {
            sub.unsubscribe();
            refreshSeqRef.current += 1;
            if (animationTimerRef.current) window.clearTimeout(animationTimerRef.current);
            audioRef.current?.close().catch(() => undefined);
        };
    }, [refreshData]);

    const timeStr = currentTime.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = currentTime.toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const { pending: pendingCalls, called: calledCalls } = useMemo(() => splitDismissalCalls(calls), [calls]);

    return (
        <div className="min-h-screen bg-[#0a0e1a] relative overflow-x-hidden overflow-y-auto select-none" dir="rtl">
            {/* Animated background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-30%] right-[-20%] w-[80vw] h-[80vw] rounded-full bg-amber-500/8 blur-[150px] animate-pulse" />
                <div className="absolute bottom-[-30%] left-[-20%] w-[70vw] h-[70vw] rounded-full bg-primary-500/8 blur-[130px] animate-pulse" style={{ animationDelay: '3s' }} />
                <div className="absolute top-[40%] left-[30%] w-[40vw] h-[40vw] rounded-full bg-secondary-500/5 blur-[100px] animate-pulse" style={{ animationDelay: '5s' }} />

                {/* Particle dots */}
                {CALL_BOARD_PARTICLES.map((particle) => (
                    <div
                        key={particle.id}
                        className="absolute w-1 h-1 rounded-full bg-primary-400/30 animate-ping"
                        style={{
                            top: particle.top,
                            left: particle.left,
                            animationDelay: particle.delay,
                            animationDuration: particle.duration
                        }}
                    />
                ))}
            </div>

            {/* Top Header Bar */}
            <header className="relative z-10 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/5 px-3 py-4 sm:px-5 lg:px-8 lg:py-5">
                {/* Left: Home & Logout */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => navigate('/')}
                        className="rounded-xl border border-white/10 bg-white/5 p-2.5 transition-all hover:bg-white/10 active:scale-[0.98] sm:rounded-2xl sm:p-3"
                        title="الرئيسية"
                    >
                        <Home className="w-6 h-6 text-primary-400" />
                    </button>
                    <button
                        onClick={() => auth.logout()}
                        className="group hidden rounded-2xl border border-white/10 bg-white/5 p-3 transition-all hover:bg-red-500/20 active:scale-[0.98] sm:block"
                        title="تسجيل خروج"
                    >
                        <LogOut className="w-6 h-6 text-red-400 group-hover:text-red-300" />
                    </button>
                </div>

                {/* Center: Title */}
                <div className="flex min-w-0 items-center justify-center gap-2 sm:gap-4">
                    <div className="relative">
                        <Megaphone className="h-7 w-7 text-amber-400 drop-shadow-[0_0_15px_rgba(245,158,11,0.5)] sm:h-10 sm:w-10" />
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full animate-ping opacity-50" />
                    </div>
                    <h1 className="truncate text-xl font-bold tracking-wide text-white sm:text-3xl md:text-4xl" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                        لوحة النداءات
                    </h1>
                    <div className="relative hidden sm:block">
                        <Megaphone className="w-10 h-10 text-amber-400 drop-shadow-[0_0_15px_rgba(245,158,11,0.5)] transform scale-x-[-1]" />
                    </div>
                </div>

                {/* Right: Stats + Clock */}
                <div className="flex items-center gap-2 lg:gap-6">
                    <div className="hidden items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 lg:flex">
                        <DoorOpen className="w-5 h-5 text-emerald-400" />
                        <span className="text-xl font-bold text-white">{todayCount}</span>
                        <span className="text-sm text-slate-400">منصرف اليوم</span>
                    </div>
                    <div className="hidden text-left sm:block">
                        <div className="text-2xl font-bold text-white tracking-wider" style={{ direction: 'ltr' }}>{timeStr}</div>
                        <p className="text-xs text-slate-500">{dateStr}</p>
                    </div>
                    <button onClick={() => void refreshData()} disabled={refreshing} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-40 sm:rounded-2xl sm:p-3" aria-label="تحديث لوحة النداءات">
                        <RefreshCcw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="relative z-10 min-h-[calc(100dvh-90px)] px-3 py-6 sm:px-6 md:px-10 md:py-8">
                {errorMessage && (
                    <div className="mx-auto mb-6 flex max-w-2xl items-center justify-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-red-100" role="alert">
                        <AlertCircle className="h-5 w-5 shrink-0" />
                        <span>{errorMessage}</span>
                    </div>
                )}
                {loading ? (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-3xl border border-white/5 bg-white/5" />)}
                    </div>
                ) : calls.length === 0 ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center h-[70vh]">
                        <div className="relative mb-8">
                            <div className="w-40 h-40 rounded-full bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                                <Sparkles className="w-20 h-20 text-primary-500/40" />
                            </div>
                            <div className="absolute inset-0 rounded-full bg-primary-500/5 animate-ping" style={{ animationDuration: '3s' }} />
                        </div>
                        <h2 className="text-3xl font-bold text-white/60 mb-3" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                            لا توجد نداءات حالياً
                        </h2>
                        <p className="text-lg text-slate-500">
                            ستظهر طلبات النداء هنا عند إرسالها من ولي الأمر أو المراقب
                        </p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* Pending Calls Section */}
                        {pendingCalls.length > 0 && (
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                                    <h2 className="text-xl font-bold text-amber-300">
                                        بانتظار النداء ({pendingCalls.length})
                                    </h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                                    {pendingCalls.map((call) => (
                                        <div
                                            key={call.id}
                                            className={`group relative rounded-3xl p-6 border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/5 backdrop-blur-xl transition-all duration-500 hover:scale-[1.02] hover:shadow-[0_0_60px_rgba(245,158,11,0.2)] ${animatingIds.has(call.id) ? 'animate-bounce scale-105 shadow-[0_0_80px_rgba(245,158,11,0.4)]' : ''
                                                }`}
                                        >
                                            {/* Glow effect */}
                                            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity" />

                                            <div className="relative z-10">
                                                {/* Status badge */}
                                                <div className="flex items-center justify-between mb-4">
                                                    <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold animate-pulse">
                                                        ⏳ بانتظار النداء
                                                    </span>
                                                    <Clock className="w-4 h-4 text-amber-400/60" />
                                                </div>

                                                {/* Student info */}
                                                <div className="mb-4">
                                                    <h3 className="text-2xl md:text-3xl font-bold text-white mb-2 leading-tight" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                                                        {call.student_name}
                                                    </h3>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm px-3 py-1 rounded-full bg-white/10 text-slate-300">
                                                            {call.class_name}
                                                        </span>
                                                        {call.section && (
                                                            <span className="text-sm px-3 py-1 rounded-full bg-white/10 text-slate-300">
                                                                {call.section}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Requester */}
                                                {call.requested_by_name && (
                                                    <p className="text-xs text-slate-500 mb-3">
                                                        👤 طلب من: <span className="text-slate-400">{call.requested_by_name}</span>
                                                    </p>
                                                )}

                                                {/* Time */}
                                                <div className="flex items-center gap-2 text-xs text-amber-400/60 mb-4">
                                                    <Clock className="w-3 h-3" />
                                                    <span>{new Date(call.request_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); void handleMarkCalled(call); }}
                                                    disabled={callingId === call.id || dismissingId !== null}
                                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm
                                                        bg-amber-500/20 text-amber-100 border border-amber-500/40 hover:bg-amber-500/35 hover:border-amber-400/60
                                                        transition-all disabled:opacity-50 disabled:pointer-events-none pointer-events-auto"
                                                >
                                                    {callingId === call.id ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <Volume2 className="w-4 h-4" />
                                                    )}
                                                    اعتماد النداء
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Called Section */}
                        {calledCalls.length > 0 && (
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                                    <h2 className="text-xl font-bold text-emerald-300">
                                        تم النداء — بانتظار الاستلام ({calledCalls.length})
                                    </h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                                    {calledCalls.map((call) => (
                                        <div
                                            key={call.id}
                                            className="group relative rounded-3xl p-6 border-2 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 backdrop-blur-xl transition-all duration-500 hover:scale-[1.02]"
                                        >
                                            <div className="relative z-10">
                                                <div className="flex items-center justify-between mb-4">
                                                    <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                                                        📢 تم النداء
                                                    </span>
                                                    <CheckCircle className="w-4 h-4 text-emerald-400/60" />
                                                </div>

                                                <div className="mb-4">
                                                    <h3 className="text-2xl md:text-3xl font-bold text-white mb-2 leading-tight" style={{ fontFamily: 'Tajawal, sans-serif' }}>
                                                        {call.student_name}
                                                    </h3>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm px-3 py-1 rounded-full bg-white/10 text-slate-300">
                                                            {call.class_name}
                                                        </span>
                                                        {call.section && (
                                                            <span className="text-sm px-3 py-1 rounded-full bg-white/10 text-slate-300">
                                                                {call.section}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {call.called_at && (
                                                    <div className="flex items-center gap-2 text-xs text-emerald-400/60 mb-4">
                                                        <Volume2 className="w-3 h-3" />
                                                        <span>نودي في {new Date(call.called_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); void handleRecordDismissal(call); }}
                                                    disabled={dismissingId === call.id || callingId !== null}
                                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm
                                                        bg-emerald-600/25 text-emerald-100 border border-emerald-500/45 hover:bg-emerald-500/40
                                                        transition-all disabled:opacity-50 disabled:pointer-events-none pointer-events-auto"
                                                >
                                                    {dismissingId === call.id ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <DoorOpen className="w-4 h-4" />
                                                    )}
                                                    تأكيد الاستلام والانصراف
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </main>

            {/* Bottom gradient bar */}
            <div className="fixed bottom-0 left-0 right-0 h-1.5 z-20">
                <div className="h-full bg-gradient-to-r from-amber-500 via-primary-500 to-secondary-500 opacity-60" />
            </div>
        </div>
    );
};

export default CallBoard;
