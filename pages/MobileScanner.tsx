import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5QrcodeScanner, Html5QrcodeScanType, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { db } from '../services/db';
import { dismissals } from '../services/dismissals';
import { auth } from '../services/auth';
import { syncService } from '../services/syncService';
import { getPendingSyncCount } from '../services/localDb';
import { GlassCard, NeonButton } from '../components/ui';
import {
  Camera,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Home,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  Loader2,
  Volume2,
  VolumeX,
  DoorOpen,
  CloudLightning,
  QrCode
} from 'lucide-react';
import { Student, Role } from '../types';

// ═══════════════════════════════════════════════════════════════
// Mobile Scanner Page - Professionally Refactored
// ═══════════════════════════════════════════════════════════════

interface ScanResult {
  type: 'success' | 'late' | 'duplicate' | 'error';
  message: string;
  student?: Student;
  minutesLate?: number;
}

const MobileScanner: React.FC = () => {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [studentCount, setStudentCount] = useState(0);
  const [todayScans, setTodayScans] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const resultTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScanRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const [scanMode, setScanMode] = useState<'attendance' | 'dismissal'>('attendance');

  // ═══════════════════════════════════════════════════════════════
  // Authentication Check
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const checkAuth = async () => {
      const user = await auth.getCurrentUser();
      if (!user) {
        navigate('/login');
        return;
      }

      // Allow supervisors, admins, and site admins
      const allowedRoles = [Role.SUPERVISOR_GLOBAL, Role.SUPERVISOR_CLASS, Role.SCHOOL_ADMIN, Role.SITE_ADMIN];
      if (!allowedRoles.includes(user.role)) {
        navigate('/');
        return;
      }

      setAuthorized(true);
      setAuthChecked(true);
    };

    checkAuth();
  }, [navigate]);

  // ═══════════════════════════════════════════════════════════════
  // Network Status Monitor
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // Batch Sync Pending Tracker
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const updatePending = async () => {
      try {
        const count = await getPendingSyncCount();
        setPendingCount(count);
      } catch {
        setPendingCount(0);
      }
    };
    
    updatePending();
    
    // Listen to local queue changes (incremental updates per scan)
    window.addEventListener('hader:sync-queue-change', updatePending);
    
    // Listen to backend sync completion to clear counters
    const unsubscribeSync = syncService.on(event => {
        if (event.type === 'sync:completed' || event.type === 'sync:progress' || event.type === 'sync:failed') {
            updatePending();
        }
    });

    return () => {
        window.removeEventListener('hader:sync-queue-change', updatePending);
        unsubscribeSync();
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // Preload Students for Offline-First
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!authChecked || !authorized) return;

    const preload = async () => {
      try {
        const result = await db.preloadForKiosk();
        setStudentCount(result.studentCount);
      } catch (error) {
        console.error('[MobileScanner] Preload error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    preload();
  }, [authChecked, authorized]);

  // ═══════════════════════════════════════════════════════════════
  // Sound & Haptic Effects
  // ═══════════════════════════════════════════════════════════════
  const playSound = useCallback((type: 'success' | 'error' | 'warning' | 'sync') => {
    // Vibration Feedback (if supported on mobile browser)
    if (typeof window.navigator.vibrate === 'function') {
        if (type === 'success' || type === 'sync') window.navigator.vibrate(50);
        else if (type === 'warning') window.navigator.vibrate([30, 50, 30]);
        else if (type === 'error') window.navigator.vibrate([50, 100, 50]);
    }

    if (!soundEnabled) return;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Different acoustic signatures
      if (type === 'success') {
        oscillator.frequency.value = 850;
        oscillator.type = 'sine';
      } else if (type === 'sync') {
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.1);
        oscillator.type = 'sine';
      } else if (type === 'warning') {
        oscillator.frequency.value = 600;
        oscillator.type = 'triangle';
      } else {
        oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(150, audioContext.currentTime + 0.2);
        oscillator.type = 'square';
      }

      gainNode.gain.value = 0.2;
      oscillator.start();

      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, type === 'error' ? 300 : 150);
    } catch (e) {
      // Audio fallback or ignored
    }
  }, [soundEnabled]);

  // ═══════════════════════════════════════════════════════════════
  // Force Sync Engine
  // ═══════════════════════════════════════════════════════════════
  const handleForceSync = async () => {
    if (pendingCount === 0 || isSyncing || !isOnline) return;
    
    setIsSyncing(true);
    playSound('sync');
    
    try {
        await syncService.syncNow('up');
    } catch (err) {
        console.error('[Scanner] Sync triggered error:', err);
    } finally {
        setIsSyncing(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Handle Scan Result
  // ═══════════════════════════════════════════════════════════════
  const handleScan = useCallback(async (decodedText: string) => {
    // Clear previous timeout smoothly
    if (resultTimeoutRef.current) {
      clearTimeout(resultTimeoutRef.current);
    }

    const studentId = decodedText.trim();
    if (!studentId) return;

    // Smart Debounce: prevent rapid duplicate scans physically (2 second cooldown)
    const now = Date.now();
    if (studentId === lastScanRef.current.id && (now - lastScanRef.current.time) < 2000) {
      return;
    }
    lastScanRef.current = { id: studentId, time: now };

    try {
      if (scanMode === 'dismissal') {
        const student = await db.getStudentByAnyId(studentId);
        if (!student) {
          setLastResult({ type: 'error', message: 'الطالب غير موجود' });
          playSound('error');
        } else {
          const dismissal = await dismissals.execute({
            type: 'record-dismissal',
            studentId: student.id,
            method: 'scanner',
            recordedByLabel: 'ماسح المحمول'
          });
          if (dismissal.outcome === 'already-dismissed') {
            setLastResult({ type: 'duplicate', message: 'تم تسجيل الانصراف مسبقاً', student });
            playSound('warning');
          } else {
            setLastResult({ type: 'success', message: 'تم تسجيل الانصراف بنجاح', student });
            playSound('success');
            setTodayScans(prev => prev + 1);
          }
        }
      } else {
        const result = await db.markAttendanceFast(studentId);

        if (result.ok) {
          if (result.code === 'duplicate') {
            setLastResult({
              type: 'duplicate',
              message: 'تم تسجيل الطالب مسبقاً',
              student: result.student,
              minutesLate: result.minutes_late
            });
            playSound('warning');
          } else if (result.code === 'late') {
            setLastResult({
              type: 'late',
              message: `تأخر ${result.minutes_late} دقيقة`,
              student: result.student,
              minutesLate: result.minutes_late
            });
            playSound('warning');
          } else {
            setLastResult({
              type: 'success',
              message: 'تم تسجيل الحضور بنجاح',
              student: result.student
            });
            playSound('success');
            setTodayScans(prev => prev + 1);
          }
        } else {
          setLastResult({
            type: 'error',
            message: result.message || 'الطالب غير موجود'
          });
          playSound('error');
        }
      }
    } catch (error: any) {
      setLastResult({
        type: 'error',
        message: error?.message || 'حدث خطأ أثناء التسجيل'
      });
      playSound('error');
    }

    // Auto-clear result display gracefully after 4 seconds
    resultTimeoutRef.current = setTimeout(() => {
      setLastResult(null);
    }, 4000);
  }, [playSound, scanMode]);

  // ═══════════════════════════════════════════════════════════════
  // Initialize Scanner (HTML5 Qrcode)
  // ═══════════════════════════════════════════════════════════════
  const startScanner = useCallback(() => {
    if (scannerRef.current) return;

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 360;
    const qrSize = Math.round(Math.min(280, Math.max(210, viewportWidth - 96)));
    const isMobileDevice = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

    const config = {
      fps: isMobileDevice ? 10 : 12,
      qrbox: { width: qrSize, height: qrSize },
      aspectRatio: 1.0,
      supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
      formatsToSupport: [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8
      ],
      rememberLastUsedCamera: true,
      showTorchButtonIfSupported: true,
      disableFlip: true,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    };

    const scanner = new Html5QrcodeScanner('scanner-container', config, false);

    scanner.render(
      (decodedText) => {
        handleScan(decodedText);
      },
      (errorMessage) => {
        // Suppress noisy output frame-by-frame
      }
    );

    scannerRef.current = scanner;
    setIsScanning(true);
  }, [handleScan]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear();
      } catch (e) {
        console.warn('[MobileScanner] Error stopping scanner:', e);
      }
      scannerRef.current = null;
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopScanner();
      if (resultTimeoutRef.current) {
        clearTimeout(resultTimeoutRef.current);
      }
    };
  }, [stopScanner]);

  useEffect(() => {
    if (!isLoading && authorized && !isScanning) {
      const timer = setTimeout(() => {
        startScanner();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, authorized, isScanning, startScanner]);

  // ═══════════════════════════════════════════════════════════════
  // Renders
  // ═══════════════════════════════════════════════════════════════
  if (!authChecked || isLoading) {
    return (
      <div className="min-h-[100dvh] bg-slate-900 flex items-center justify-center px-4">
        <div className="text-center text-white">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-smooth-spin text-primary-400" />
          <p className="text-lg font-bold">تجهيز الماسح...</p>
        </div>
      </div>
    );
  }

  const getResultStyles = (type: string) => {
    switch (type) {
      case 'success':
        return { bgIcon: 'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.4)]', glow: 'shadow-[0_4px_30px_rgba(16,185,129,0.15)] border-emerald-500/30', icon: CheckCircle, text: 'text-emerald-400' };
      case 'late':
        return { bgIcon: 'bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]', glow: 'shadow-[0_4px_30px_rgba(245,158,11,0.15)] border-amber-500/30', icon: Clock, text: 'text-amber-400' };
      case 'duplicate':
        return { bgIcon: 'bg-secondary-500 shadow-[0_0_20px_rgb(var(--color-secondary-400)_/_0.4)]', glow: 'shadow-[0_4px_30px_rgb(var(--color-secondary-400)_/_0.15)] border-secondary-500/30', icon: RefreshCw, text: 'text-secondary-400' };
      case 'error':
        return { bgIcon: 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]', glow: 'shadow-[0_4px_30px_rgba(239,68,68,0.15)] border-red-500/30', icon: XCircle, text: 'text-red-400' };
      default:
        return { bgIcon: 'bg-slate-500', glow: 'border-white/10', icon: AlertTriangle, text: 'text-slate-400' };
    }
  };

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-slate-950 flex flex-col font-sans" dir="rtl">
      
      {/* HEADER */}
      <header className="safe-top bg-slate-900 border-b border-white/5 px-4 pb-3 pt-3 flex items-center justify-between shadow-2xl relative z-20">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${scanMode === 'attendance' ? 'bg-primary-500/10 border-primary-500/30 shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.2)]' : 'bg-amber-500/10 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.2)]'} border transition-all duration-300`}>
             {scanMode === 'attendance' ? <QrCode className="w-5 h-5 text-primary-400" /> : <DoorOpen className="w-5 h-5 text-amber-400" />}
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              {scanMode === 'attendance' ? 'ماسح الحضور' : 'ماسح الانصراف'}
            </h1>
            <div className="flex items-center gap-1 mt-0.5">
               {isOnline ? (
                  <Wifi className="w-3 h-3 text-emerald-400" />
                ) : (
                  <WifiOff className="w-3 h-3 text-red-500 animate-pulse" />
                )}
               <span className={`text-[10px] uppercase font-bold ${isOnline ? 'text-emerald-400' : 'text-red-500'}`}>
                 {isOnline ? 'متصل' : 'أوفلاين - مخزن محلياً'}
               </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Audio Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2.5 rounded-xl transition-all ${soundEnabled ? 'bg-primary-500/10 text-primary-400' : 'bg-slate-800 text-slate-500'}`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Mode Switch (Attendance/Dismissal) */}
          <button
            onClick={() => setScanMode(scanMode === 'attendance' ? 'dismissal' : 'attendance')}
            className="p-2.5 rounded-xl bg-slate-800 border border-white/5 hover:bg-slate-700 transition"
            title="تغيير نمط المسح"
          >
             <RefreshCw className="w-4 h-4 text-slate-300" />
          </button>

          {/* Return Home */}
          <button
            onClick={() => navigate('/dashboard')}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/5 transition"
          >
            <Home className="w-4 h-4 text-white" />
          </button>
        </div>
      </header>

      {/* STATS ROW */}
      <div className="px-4 mt-4 grid grid-cols-2 gap-3 relative z-10">
          <GlassCard className="!p-3 sm:!p-4 !rounded-2xl flex flex-col items-center justify-center text-center gap-1 border-white/5" variant="panel">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">سجلات الجلسة</span>
              <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-br from-emerald-400 to-primary-400 bg-clip-text text-transparent transform translate-y-1">
                  {todayScans}
              </div>
          </GlassCard>

          <GlassCard className="!p-3 sm:!p-4 !rounded-2xl flex flex-col items-center justify-center text-center gap-1 border-white/5 relative overflow-hidden group" variant="panel">
              {pendingCount > 0 && <div className="absolute top-0 right-0 w-full h-1 bg-amber-500 animate-pulse"></div>}
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">قيد الانتظار</span>
              <div className={`text-2xl sm:text-3xl font-bold flex items-center gap-2 transform translate-y-1 ${pendingCount > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                  {pendingCount}
              </div>
          </GlassCard>
      </div>

      <main className="flex-1 flex flex-col overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4">
        
        {/* CAMERA VIEWPORT */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-[40vh] w-full">
          {/* Glass wrapped camera */}
          <GlassCard 
              className="w-full max-w-[min(24rem,calc(100vw-2rem))] !p-2 !rounded-3xl border-primary-500/30 overflow-hidden relative shadow-[0_0_40px_rgb(var(--color-primary-500)_/_0.1)]"
              variant="neon"
          >
            <div
              id="scanner-container"
              className="w-full rounded-[1.25rem] overflow-hidden bg-slate-950 aspect-square [&>div]:!border-0"
            />
            
            {/* Overlay instruction */}
            <div className="absolute bottom-4 left-0 right-0 px-4 pointer-events-none text-center">
               <div className="inline-block bg-slate-900/80 backdrop-blur border border-white/10 px-4 py-1.5 rounded-full text-xs text-white/80">
                 وجّه الكاميرا نحو بطاقة الطالب
               </div>
            </div>
          </GlassCard>

          {!isScanning && (
            <NeonButton
              variant="primary"
              onClick={startScanner}
              className="mt-6 w-full max-w-xs"
              startIcon={<Camera className="w-5 h-5" />}
            >
              تشغيل الكاميرا
            </NeonButton>
          )}
        </div>

        {/* RESULTS POPUP */}
        <div className="min-h-28 mt-4">
            {lastResult && (
            <GlassCard
                className={`w-full !p-4 !rounded-2xl border ${getResultStyles(lastResult.type).glow} bg-slate-900/90 backdrop-blur-xl transition-all duration-300`}
                style={{ animation: 'slideInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
                variant="panel"
            >
                <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${getResultStyles(lastResult.type).bgIcon}`}>
                    {React.createElement(getResultStyles(lastResult.type).icon, {
                        className: 'w-6 h-6 text-white'
                    })}
                </div>
                <div className="flex-1 min-w-0">
                    {lastResult.student && (
                    <h3 className="text-white font-bold text-base mb-0.5 truncate pr-1">
                        {lastResult.student.name}
                    </h3>
                    )}
                    <p className={`${getResultStyles(lastResult.type).text} font-medium text-sm pr-1`}>
                    {lastResult.message}
                    </p>
                    {lastResult.student && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
                        <span className="px-2 py-1 rounded bg-white/5 text-slate-300 font-mono border border-white/5 whitespace-nowrap">
                        {lastResult.student.class_name} {lastResult.student.section}
                        </span>
                        <span className="text-slate-500 tabular-nums">
                        {new Date().toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' })}
                        </span>
                    </div>
                    )}
                </div>
                </div>
            </GlassCard>
            )}
        </div>

        {/* FORCE SYNC ACTION */}
        <div className="mt-auto pt-6">
            <NeonButton 
                variant={pendingCount > 0 ? 'primary' : 'outline'}
                className={`w-full h-[3.5rem] tracking-wide`}
                disabled={pendingCount === 0 || isSyncing || !isOnline}
                onClick={handleForceSync}
                isLoading={isSyncing}
                startIcon={pendingCount > 0 ? <CloudLightning className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
            >
                {pendingCount > 0 
                  ? `قم بمزامنة الدفعة (${pendingCount}) للسحابة الآن` 
                  : (isOnline ? 'مزامنة السجلات محدثة 100% ✅' : 'أنت في وضع عدم الاتصال (Offline)')
                }
            </NeonButton>
        </div>
      </main>

    </div>
  );
};

export default MobileScanner;

// Include smooth animation CSS for popups dynamically
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes slideInUp {
    0% { opacity: 0; transform: translateY(20px) scale(0.95); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
`;
if (!document.getElementById('scanner-animations-modern')) {
  styleEl.id = 'scanner-animations-modern';
  document.head.appendChild(styleEl);
}
