import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/db';
import { dismissals } from '../services/dismissals';
import { auth } from '../services/auth';
import { Student, Role } from '../types';
import {
  Mic,
  Scan,
  Hash,
  Users,
  ChevronLeft,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Wifi,
  Battery
} from 'lucide-react';
import GuardListSelector from '../components/guard/GuardListSelector';
import GuardScanner from '../components/guard/GuardScanner';
import { useToast } from '../components/Toast';
import CyberRadar from '../components/cyber/CyberRadar';
import CyberStatsCard from '../components/cyber/CyberStatsCard';
import CyberOverlay from '../components/cyber/CyberOverlay';
import { motion, AnimatePresence } from 'framer-motion';
import { buildDismissalStudentDirectory, resolveDismissalStudent } from '../components/dismissal/dismissalUiRules';
import { logError } from '../types/errors';

const GuardDispatcher: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'numpad' | 'scanner' | 'list'>('numpad');
  const [inputCode, setInputCode] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [lastCall, setLastCall] = useState<{ name: string; time: string } | null>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }));
  const [showGlitch, setShowGlitch] = useState(false);
  const [dataError, setDataError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const glitchTimerRef = useRef<number | null>(null);
  const directory = useMemo(() => buildDismissalStudentDirectory(students), [students]);

  useEffect(() => {
    // 1. Auth Guard
    const user = auth.getSession();
    if (!user) {
      navigate('/login');
      return;
    }

    // 2. Fetch Students
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const allStudents = await db.getStudents();
        if (cancelled) return;
        setStudents(buildDismissalStudentDirectory(allStudents).students);
        setDataError('');
      } catch (err) {
        if (cancelled) return;
        logError(err, 'GuardDispatcher - Load Students');
        setDataError('تعذر تحميل دليل الطلاب. تحقق من الاتصال ثم أعد المحاولة.');
        toast.error('خطأ في تحميل البيانات');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchData();

    // 3. Time Update
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }));
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (glitchTimerRef.current) window.clearTimeout(glitchTimerRef.current);
    };
  }, [loadAttempt, navigate]);

  const handleSendCall = async (student: Student) => {
    if (sending) return;
    setSending(true);

    try {
      const user = auth.getSession();
      const result = await dismissals.execute({
        type: 'request-call',
        student,
        requester: {
          id: user?.id || 'guard-mobile',
          name: user?.name || 'حارس البوابة'
        }
      });

      // Feedback
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setLastCall({ name: student.name, time: new Date().toLocaleTimeString('ar-SA') });
      toast.success(result.outcome === 'already-requested'
        ? `يوجد نداء نشط مسبقًا: ${student.name}`
        : `تم إرسال نداء: ${student.name}`);

      // Reset input if was using numpad
      if (activeTab === 'numpad') setInputCode('');

    } catch (err) {
      logError(err, 'GuardDispatcher - Send Call');
      toast.error('فشل في إرسال النداء');
    } finally {
      setSending(false);
    }
  };

  const handleNumpadPress = (num: string) => {
    if (inputCode.length < 10) {
      setInputCode(prev => prev + num);
      if (navigator.vibrate) navigator.vibrate(20);
    }
  };

  const handleNumpadClear = () => {
    setInputCode('');
    if (navigator.vibrate) navigator.vibrate(10);
  };

  const handleNumpadSubmit = async () => {
    if (!inputCode) return;
    const student = resolveDismissalStudent(directory.studentById, inputCode);
    if (student) {
      handleSendCall(student);
    } else {
      toast.error('طالب غير موجود');
      setShowGlitch(true);
      if (glitchTimerRef.current) window.clearTimeout(glitchTimerRef.current);
      glitchTimerRef.current = window.setTimeout(() => setShowGlitch(false), 1000);
      if (navigator.vibrate) navigator.vibrate(200);
    }
  };

  if (loading && students.length === 0) return (
    <div className="h-screen bg-black flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );

  return (
    <div dir="rtl" className="h-[100dvh] bg-[#050505] text-white flex flex-col overflow-hidden font-cairo select-none relative">
      <CyberOverlay />
      
      {/* Top Status Bar (Station Identity) - HUD Refactored */}
      <div className="bg-[#0a0a0a] border-b border-amber-500/20 px-4 py-3 pt-8 flex justify-between items-center shrink-0 relative z-10 hud-border">
        <div className="absolute inset-0 bg-cyber-grid opacity-5 pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
            <Mic className={`w-5 h-5 text-amber-500 ${showGlitch ? 'animate-cyber-glitch' : ''}`} />
          </div>
          <div>
            <h1 className="text-[10px] font-black tracking-[0.1em] text-amber-500/60">محطة النداء نشطة</h1>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-wide">بوابة المدرسة</span>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4].map(i => <div key={i} className="w-1 h-3 bg-amber-500/40 rounded-full animate-pulse" />)}
              </div>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono font-bold text-amber-500/80 tracking-tighter shadow-amber-500/20">{currentTime}</div>
          <div className="flex items-center gap-2 justify-end opacity-40">
            <Wifi className="w-3 h-3" />
            <Battery className="w-3 h-3" />
          </div>
        </div>
      </div>

      {/* Quick Telemetry HUD */}
      <div className="px-4 py-3 hidden sm:grid grid-cols-2 gap-4 bg-black/40 border-b border-white/5 relative z-10">
        <CyberStatsCard
          label="دليل الطلاب النشطين"
          value={directory.students.length}
          suffix="طالب"
          icon={<Users className="w-4 h-4" />}
          color="amber"
        />
        <CyberStatsCard
          label="حالة محطة النداء"
          value={dataError ? 0 : 100}
          suffix="% جاهزة"
          icon={<Wifi className="w-4 h-4" />}
          color={dataError ? 'amber' : 'cyan'}
        />
      </div>

      {dataError && (
        <div className="relative z-20 flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
          <span>{dataError}</span>
          <button onClick={() => setLoadAttempt(attempt => attempt + 1)} className="shrink-0 rounded-lg bg-red-500/20 px-3 py-1.5 font-bold">إعادة المحاولة</button>
        </div>
      )}

      {/* Main Screen Content */}
      <div className="flex-1 relative overflow-y-auto overflow-x-hidden flex flex-col scrollbar-hide">
        {activeTab === 'numpad' && (
          <div className="flex-1 flex flex-col p-4 animate-fade-in min-h-[400px]">
            {/* Input Display Area */}
            <div className="bg-black border-2 border-amber-500/20 rounded-3xl p-4 mb-4 shadow-[inset_0_0_20px_rgba(245,158,11,0.05)]">
              <div className="text-xs text-amber-500/60 mb-2 font-bold">بانتظار رقم الطالب</div>
              <div className="h-16 flex items-center justify-center">
                {inputCode ? (
                  <span className="text-4xl font-black font-mono tracking-widest text-white animate-pulse">
                    {inputCode}
                  </span>
                ) : (
                  <div className="flex gap-2">
                    {[1, 2, 3, 4].map(i => <div key={i} className="w-3 h-3 rounded-full bg-white/5" />)}
                  </div>
                )}
              </div>
            </div>

            {/* Numpad Grid */}
            <div className="grid grid-cols-3 gap-4 flex-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, '✖', 0, '✓'].map((key) => {
                const isAction = typeof key === 'string' && (key === '✖' || key === '✓');
                const isClear = key === '✖';
                const isConfirm = key === '✓';

                return (
                  <button
                    key={key.toString()}
                    onClick={() => {
                      if (isClear) handleNumpadClear();
                      else if (isConfirm) handleNumpadSubmit();
                      else handleNumpadPress(key.toString());
                    }}
                    className={`
                      rounded-2xl text-2xl font-black flex items-center justify-center transition-all active:scale-90
                      ${isConfirm ? 'bg-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.4)]' :
                        isClear ? 'bg-white/5 text-gray-400 border border-white/10' :
                          'bg-white/10 text-white border border-white/10 active:bg-white/20'}
                    `}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'list' && (
          <div className="flex-1 flex flex-col overflow-hidden animate-fade-in min-h-[400px]">
            <GuardListSelector
              students={directory.students}
              onSelect={handleSendCall}
              disabled={sending}
            />
          </div>
        )}

        {activeTab === 'scanner' && (
          <div className="flex-1 relative overflow-hidden bg-black animate-fade-in min-h-[400px]">
            {/* Background Radar */}
            <div className="absolute inset-0 z-0 scale-150 opacity-40">
              <CyberRadar color="var(--color-primary-500)" speed={0.03} />
            </div>
            
            <div className="relative z-10 h-full flex flex-col">
              <GuardScanner
                onScan={(code) => {
                  const student = resolveDismissalStudent(directory.studentById, code);
                  if (student) {
                    handleSendCall(student);
                    setActiveTab('numpad');
                  } else {
                    toast.error('كود غير صالح');
                    setShowGlitch(true);
                    if (glitchTimerRef.current) window.clearTimeout(glitchTimerRef.current);
                    glitchTimerRef.current = window.setTimeout(() => setShowGlitch(false), 1000);
                  }
                }}
                onClose={() => setActiveTab('numpad')}
              />
              <div className="absolute bottom-10 left-0 right-0 p-6">
                <div className="hud-border bg-black/60 backdrop-blur-md p-4 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                    <span className="text-xs font-bold text-primary-500">بانتظار مسح باركود الطالب</span>
                  </div>
                  <div className="text-[10px] font-bold text-primary-500/40">الكاميرا جاهزة</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Transmission Status Floating Indicator */}
        {sending && (
          <div className="absolute inset-x-0 top-0 h-1 bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.8)] animate-pulse z-50" />
        )}
      </div>

      {/* Footer Info (Last Call) */}
      <div className="bg-[#111] border-t border-white/5 p-3 flex items-center gap-4 shrink-0">
        <div className="p-3 bg-emerald-500/10 rounded-xl">
          <Volume2 className="w-5 h-5 text-emerald-500" />
        </div>
        <div>
          {lastCall ? (
            <div className="animate-fade-in">
              <p className="text-[10px] text-emerald-500 font-bold">آخر نداء مُرسل</p>
              <p className="text-sm font-bold text-white">{lastCall.name}</p>
              <p className="text-[10px] text-gray-500">{lastCall.time}</p>
            </div>
          ) : (
            <div>
              <p className="text-[10px] text-gray-500 font-bold">المحطة جاهزة للإرسال</p>
              <p className="text-sm font-bold text-gray-400">لا توجد نداءات حالية</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs / Radio Buttons */}
      <div className="bg-black pb-6 pt-2 px-3 flex items-center justify-between gap-2 shrink-0 border-t border-white/5">
        <button
          onClick={() => setActiveTab('numpad')}
          className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-2xl transition-all ${activeTab === 'numpad' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 'text-gray-500'}`}
        >
          <Hash className="w-5 h-5" />
          <span className="text-[10px] font-bold">كود</span>
        </button>
        <button
          onClick={() => setActiveTab('scanner')}
          className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-2xl transition-all ${activeTab === 'scanner' ? 'bg-primary-500/20 text-primary-500 border border-primary-500/30' : 'text-gray-500'}`}
        >
          <Scan className="w-5 h-5" />
          <span className="text-[10px] font-bold">مسح</span>
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-2xl transition-all ${activeTab === 'list' ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30' : 'text-gray-500'}`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-bold">القائمة</span>
        </button>
        <div className="w-12 flex justify-center border-l border-white/10 ml-2">
          <button
            onClick={() => {
              auth.logout();
            }}
            className="p-3 text-gray-500 active:text-white"
            title="تسجيل الخروج"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default GuardDispatcher;
