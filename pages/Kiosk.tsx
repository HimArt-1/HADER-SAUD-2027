import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/db';
import { appSettings } from '../services/settings';
import { notificationCenter } from '../services/notifications';
import { syncService } from '../services/syncService';
import { auth } from '../services/auth';
import { Scan, Loader2, Wifi, Home, CheckCircle, AlertTriangle, Clock, Calendar, Timer, X, LogOut, Keyboard, Building, UserCircle, RotateCw, RotateCcw, Monitor, Maximize2, Minimize2, Camera, Power, Zap, List, Trash2, Link, Check, Award } from 'lucide-react';
import { kioskPresenceService } from '../services/kioskPresenceService';
import { KioskSettings, KioskTheme, Student, KioskDisplaySize, Role, EmergencyEntry, STORAGE_KEYS, ATTENDANCE_DEFAULTS, SystemSettings } from '../types';
import BadgeShowcase from '../components/BadgeShowcase'; // New Import
import { logError } from '../types/errors';
import { logger } from '../services/logger';
import { useCleanup } from '../hooks/useResourceManagement';
import { useToast } from '../components/Toast';
import { getSyncedDate, getLocalISODate, normalizeStudentId } from '../services/dbHelpers';
import { cacheHolidays } from '../services/academicCalendarService';
import { useAutoReload } from '../hooks/useAutoReload';
import BarcodeWorker from '../utils/barcodeWorker?worker';
import {
  buildKioskOperationalConfig,
  KioskOperatingPolicy,
  resolveKioskDayState
} from '../components/kiosk/kioskOperationalState';

// Enhanced attendance result type
interface AttendanceResult {
  type: 'success' | 'error';
  message: string;
  student?: Student;
  isLate?: boolean;
  mode?: 'present' | 'late' | 'duplicate' | 'not_found' | 'closed' | 'emergency';
  minutesLate?: number;
  stats?: { late_count: number; todayMinutes: number; totalMinutes: number };
  deliveryState?: 'synced' | 'queued' | 'local';
}

// Size configuration helpers
const CLOCK_SIZE_CLASSES: Record<KioskDisplaySize, string> = {
  sm: 'text-4xl md:text-6xl',
  md: 'text-5xl md:text-7xl',
  lg: 'text-7xl md:text-9xl'
};

const TITLE_SIZE_CLASSES: Record<KioskDisplaySize, string> = {
  sm: 'text-3xl md:text-4xl',
  md: 'text-4xl md:text-5xl',
  lg: 'text-6xl md:text-7xl'
};

const INPUT_SIZE_CLASSES: Record<KioskDisplaySize, { text: string; padding: string }> = {
  sm: { text: 'text-3xl md:text-4xl', padding: 'py-4' },
  md: { text: 'text-4xl md:text-5xl', padding: 'py-6' },
  lg: { text: 'text-5xl md:text-6xl', padding: 'py-8' }
};

const CARD_SIZE_CLASSES: Record<KioskDisplaySize, { padding: string; text: string; icon: string }> = {
  sm: { padding: 'p-4', text: 'text-sm', icon: 'w-4 h-4' },
  md: { padding: 'p-5', text: 'text-base', icon: 'w-5 h-5' },
  lg: { padding: 'p-6', text: 'text-lg', icon: 'w-6 h-6' }
};

const KIOSK_SURFACE = 'border border-white/10 bg-slate-950/60 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.95),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl';
const KIOSK_MUTED_SURFACE = 'border border-white/10 bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl';
const KIOSK_LIGHT_SURFACE = 'border border-slate-200/70 bg-white/80 shadow-[0_22px_60px_-42px_rgba(15,23,42,0.35)] backdrop-blur-2xl';
const KIOSK_RESULT_SURFACE = 'border backdrop-blur-2xl';
const KIOSK_DOT_PATTERN = "bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.18)_1px,transparent_0)] [background-size:24px_24px]";
const KIOSK_DOT_PATTERN_LIGHT = "bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.10)_1px,transparent_0)] [background-size:24px_24px]";

// Theme configurations
const KIOSK_THEMES: Record<KioskTheme, {
  bg: string;
  blob1: string;
  blob2: string;
  accent: string;
  text: string;
  subText: string;
  inputBg: string;
  inputBorder: string;
  glowFrom: string;
  glowTo: string;
  isDark: boolean;
}> = {
  // ═══════════════════════════════════════════════════════════════
  // 🌟 DEFAULT THEME: Futuristic Glass & Dark Neon (Techno-Glassmorphism)
  // ═══════════════════════════════════════════════════════════════
  'dark-neon': {
    bg: 'bg-[#0f172a]', // Deep Slate/Navy - High contrast canvas
    blob1: 'bg-cyan-500/30', // Ambient glow - Cyan (Increased opacity)
    blob2: 'bg-blue-600/25', // Ambient glow - Blue (Increased opacity)
    accent: 'text-cyan-400', // Primary accent - Cyan
    text: 'text-white', // Pure white for headings
    subText: 'text-slate-300', // Light gray for body text
    inputBg: 'bg-slate-900/80', // Darker input background
    inputBorder: 'border-cyan-500/50', // Neon border
    glowFrom: 'from-cyan-400', // Gradient start - Cyan
    glowTo: 'to-blue-600', // Gradient end - Blue
    isDark: true
  },
  'dark-gradient': {
    bg: 'bg-gradient-to-br from-violet-950 via-purple-900 to-fuchsia-950',
    blob1: 'bg-violet-500/30',
    blob2: 'bg-pink-500/20',
    accent: 'text-violet-300',
    text: 'text-white',
    subText: 'text-purple-200',
    inputBg: 'bg-purple-950/60',
    inputBorder: 'border-violet-400/30',
    glowFrom: 'from-violet-400',
    glowTo: 'to-pink-400',
    isDark: true
  },
  'light-clean': {
    bg: 'bg-gradient-to-br from-gray-100 via-white to-blue-50',
    blob1: 'bg-blue-400/20',
    blob2: 'bg-indigo-400/20',
    accent: 'text-blue-600',
    text: 'text-gray-800',
    subText: 'text-blue-500',
    inputBg: 'bg-white/90',
    inputBorder: 'border-blue-300',
    glowFrom: 'from-blue-400',
    glowTo: 'to-indigo-400',
    isDark: false
  },
  'light-soft': {
    bg: 'bg-gradient-to-br from-rose-50 via-amber-50 to-sky-50',
    blob1: 'bg-rose-300/30',
    blob2: 'bg-amber-300/30',
    accent: 'text-rose-500',
    text: 'text-gray-700',
    subText: 'text-rose-400',
    inputBg: 'bg-white/80',
    inputBorder: 'border-rose-200',
    glowFrom: 'from-rose-300',
    glowTo: 'to-amber-300',
    isDark: false
  },
  'ocean-blue': {
    bg: 'bg-gradient-to-br from-sky-600 via-blue-700 to-indigo-900',
    blob1: 'bg-sky-400/30',
    blob2: 'bg-blue-400/20',
    accent: 'text-sky-200',
    text: 'text-white',
    subText: 'text-sky-300',
    inputBg: 'bg-blue-900/60',
    inputBorder: 'border-sky-400/30',
    glowFrom: 'from-sky-300',
    glowTo: 'to-blue-400',
    isDark: true
  },
  'sunset-warm': {
    bg: 'bg-gradient-to-br from-orange-500 via-rose-500 to-purple-700',
    blob1: 'bg-yellow-400/30',
    blob2: 'bg-rose-400/30',
    accent: 'text-yellow-200',
    text: 'text-white',
    subText: 'text-orange-200',
    inputBg: 'bg-orange-900/50',
    inputBorder: 'border-yellow-400/30',
    glowFrom: 'from-yellow-300',
    glowTo: 'to-rose-400',
    isDark: true
  },
  'forest-green': {
    bg: 'bg-gradient-to-br from-emerald-700 via-green-800 to-teal-900',
    blob1: 'bg-emerald-400/30',
    blob2: 'bg-teal-400/20',
    accent: 'text-emerald-300',
    text: 'text-white',
    subText: 'text-emerald-200',
    inputBg: 'bg-green-950/60',
    inputBorder: 'border-emerald-400/30',
    glowFrom: 'from-emerald-300',
    glowTo: 'to-teal-400',
    isDark: true
  },
  'royal-purple': {
    bg: 'bg-gradient-to-br from-purple-800 via-fuchsia-800 to-pink-900',
    blob1: 'bg-fuchsia-400/30',
    blob2: 'bg-pink-400/20',
    accent: 'text-fuchsia-300',
    text: 'text-white',
    subText: 'text-pink-200',
    inputBg: 'bg-purple-950/60',
    inputBorder: 'border-fuchsia-400/30',
    glowFrom: 'from-fuchsia-300',
    glowTo: 'to-pink-400',
    isDark: true
  },
  // New themes - 2026
  'cherry-blossom': {
    bg: 'bg-gradient-to-br from-pink-400 via-rose-400 to-purple-400',
    blob1: 'bg-pink-400/30',
    blob2: 'bg-purple-400/20',
    accent: 'text-pink-300',
    text: 'text-white',
    subText: 'text-pink-200',
    inputBg: 'bg-pink-950/60',
    inputBorder: 'border-pink-400/30',
    glowFrom: 'from-pink-300',
    glowTo: 'to-purple-400',
    isDark: true
  },
  'fire-ember': {
    bg: 'bg-gradient-to-br from-red-500 via-orange-500 to-amber-600',
    blob1: 'bg-red-400/30',
    blob2: 'bg-orange-400/20',
    accent: 'text-orange-300',
    text: 'text-white',
    subText: 'text-orange-200',
    inputBg: 'bg-red-950/60',
    inputBorder: 'border-orange-400/30',
    glowFrom: 'from-red-300',
    glowTo: 'to-orange-400',
    isDark: true
  },
  'electric-storm': {
    bg: 'bg-gradient-to-br from-yellow-400 via-purple-500 to-indigo-600',
    blob1: 'bg-yellow-400/30',
    blob2: 'bg-purple-400/20',
    accent: 'text-yellow-300',
    text: 'text-white',
    subText: 'text-purple-200',
    inputBg: 'bg-indigo-950/60',
    inputBorder: 'border-yellow-400/30',
    glowFrom: 'from-yellow-300',
    glowTo: 'to-purple-400',
    isDark: true
  },
  'deep-ocean': {
    bg: 'bg-gradient-to-br from-blue-900 via-indigo-900 to-teal-800',
    blob1: 'bg-blue-400/30',
    blob2: 'bg-teal-400/20',
    accent: 'text-blue-300',
    text: 'text-white',
    subText: 'text-blue-200',
    inputBg: 'bg-blue-950/60',
    inputBorder: 'border-blue-400/30',
    glowFrom: 'from-blue-300',
    glowTo: 'to-teal-400',
    isDark: true
  },
  'mint-fresh': {
    bg: 'bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400',
    blob1: 'bg-emerald-400/30',
    blob2: 'bg-cyan-400/20',
    accent: 'text-emerald-200',
    text: 'text-white',
    subText: 'text-teal-200',
    inputBg: 'bg-emerald-950/60',
    inputBorder: 'border-emerald-400/30',
    glowFrom: 'from-emerald-300',
    glowTo: 'to-cyan-400',
    isDark: true
  },
  'galaxy-purple': {
    bg: 'bg-gradient-to-br from-purple-600 via-violet-600 to-fuchsia-600',
    blob1: 'bg-purple-400/30',
    blob2: 'bg-fuchsia-400/20',
    accent: 'text-purple-300',
    text: 'text-white',
    subText: 'text-violet-200',
    inputBg: 'bg-purple-950/60',
    inputBorder: 'border-purple-400/30',
    glowFrom: 'from-purple-300',
    glowTo: 'to-fuchsia-400',
    isDark: true
  },
  'desert-sand': {
    bg: 'bg-gradient-to-br from-amber-600 via-orange-600 to-yellow-600',
    blob1: 'bg-amber-400/30',
    blob2: 'bg-yellow-400/20',
    accent: 'text-amber-300',
    text: 'text-white',
    subText: 'text-orange-200',
    inputBg: 'bg-amber-950/60',
    inputBorder: 'border-amber-400/30',
    glowFrom: 'from-amber-300',
    glowTo: 'to-yellow-400',
    isDark: true
  }
};

const Kiosk: React.FC = () => {
  const { addCleanup } = useCleanup();
  const navigate = useNavigate();
  const toast = useToast();

  // Auto reload at midnight to prevent memory leaks
  useAutoReload(0, 0);
  const [inputId, setInputId] = useState('');
  const [inputVisible, setInputVisible] = useState(false);
  const [attendanceResult, setAttendanceResult] = useState<AttendanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(getSyncedDate());
  const currentDayRef = useRef(getLocalISODate());
  const [isLateTime, setIsLateTime] = useState(false);
  const [isGraceTime, setIsGraceTime] = useState(false);
  const [isAbsentTime, setIsAbsentTime] = useState(false);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [commandPopup, setCommandPopup] = useState<string | null>(null);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [surveyStats, setSurveyStats] = useState<{ total: number; present: number; late: number; absent: number } | null>(null);
  const [kioskCardSize, setKioskCardSize] = useState({ width: 0, height: 0 });
  const [settings, setSettings] = useState<KioskSettings | null>(null);
  const [operatingPolicy, setOperatingPolicy] = useState<KioskOperatingPolicy>(
    () => buildKioskOperationalConfig().policy
  );
  const [screensaverIndex, setScreensaverIndex] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [initStatus, setInitStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [initMessage, setInitMessage] = useState<string | null>(null);
  const [syncState, setSyncState] = useState(() => db.getSyncStatus());
  const [syncRetrying, setSyncRetrying] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [rotation, setRotation] = useState<'none' | 'right' | 'left'>('none');
  const [controlPanelOpen, setControlPanelOpen] = useState(true);
  const [controlPanelMinimized, setControlPanelMinimized] = useState(false);
  const [controlPanelPosition, setControlPanelPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [headerImageSize, setHeaderImageSize] = useState<number>(80); // Default size in pixels
  const [cameraScanOpen, setCameraScanOpen] = useState(false);
  const [cameraScanError, setCameraScanError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'exit' | 'logout'; title: string; message: string } | null>(null);

  // Badge Showcase Mode
  const [showBadgeShowcase, setShowBadgeShowcase] = useState(false);

  // ═══════════════════════════════════════════════════════════════
  // 🚨 Emergency Mode State - وضع الطوارئ
  // ═══════════════════════════════════════════════════════════════
  const [emergencyMode, setEmergencyMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EMERGENCY_MODE);
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [emergencyQueue, setEmergencyQueue] = useState<EmergencyEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EMERGENCY_QUEUE);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [emergencyPanelOpen, setEmergencyPanelOpen] = useState(false);

  const activeDate = getLocalISODate();
  const kioskDayState = useMemo(
    () => resolveKioskDayState(activeDate, operatingPolicy),
    [activeDate, operatingPolicy]
  );
  const canAcceptScans = initStatus === 'ready' && kioskDayState.allowsAttendance && !loading;

  // Announcements Carousel State
  const [currentAnnouncementIndex, setCurrentAnnouncementIndex] = useState(0);
  const [announcementsPaused, setAnnouncementsPaused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const kioskRootRef = useRef<HTMLDivElement>(null);
  const controlPanelRef = useRef<HTMLDivElement>(null);
  const controlPanelHeaderRef = useRef<HTMLDivElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const barcodeDetectorRef = useRef<any>(null);
  const barcodeWorkerRef = useRef<Worker | null>(null);
  const barcodeWorkerReadyRef = useRef(false);
  const isWorkerScanningRef = useRef(false);
  const scanFrameRef = useRef<number | null>(null);
  const lastScanValueRef = useRef<string | null>(null);
  const lastScanTimeRef = useRef<{ id: string, time: number }>({ id: '', time: 0 });
  const lastFrameTimeRef = useRef<number>(0);
  const autoCameraOpenedRef = useRef(false);
  const cameraScanCooldownRef = useRef<number>(0); // timestamp of last camera scan

  // Check if in embedded mode
  const isEmbedded = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'embedded';
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // 🔐 Authentication & Authorization Check
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const checkAuth = async () => {
      const user = auth.getSession();

      if (!user) {
        // No session, redirect to login
        navigate('/');
        return;
      }

      // Check if user has permission to access kiosk
      const allowedRoles = [Role.SITE_ADMIN, Role.SCHOOL_ADMIN, Role.WATCHER, Role.KIOSK];
      if (!allowedRoles.includes(user.role)) {
        // User doesn't have permission, redirect to dashboard
        toast.error('عفواً، ليس لديك صلاحية للوصول لوضع الكشك.');
        navigate('/');
        return;
      }

      setAuthChecked(true);
    };

    checkAuth();
  }, [navigate]);

  // ═══════════════════════════════════════════════════════════════
  // 📡 Broadcast Kiosk Presence
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!authChecked) return;

    // Use a unique ID for this device session
    const deviceId = localStorage.getItem('hader:deviceId') || `kiosk-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem('hader:deviceId', deviceId);

    const getStatus = () => ({
      status: emergencyMode ? 'emergency' : (syncState.status === 'offline' ? 'offline' : 'online'),
      cameraReady,
      syncPending: syncState.pending
    });

    kioskPresenceService.startBroadcasting(deviceId, settings?.school_name || 'كشك الحضور', getStatus as any);

    return () => {
      kioskPresenceService.stopBroadcasting();
    };
  }, [authChecked, emergencyMode, syncState.status, syncState.pending, cameraReady, settings?.school_name]);

  // ═══════════════════════════════════════════════════════════════
  // 🚨 Emergency Mode - حفظ الحالة في localStorage
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.EMERGENCY_MODE, String(emergencyMode));
    } catch {
      // تجاهل أخطاء localStorage
    }
  }, [emergencyMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.EMERGENCY_QUEUE, JSON.stringify(emergencyQueue));
    } catch {
      // تجاهل أخطاء localStorage
    }
  }, [emergencyQueue]);

  // ═══════════════════════════════════════════════════════════════
  // 🔄 Rotation Management - Load saved preference
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    // Load saved rotation preference (only for full-screen kiosk, not embedded)
    if (!isEmbedded && typeof window !== 'undefined' && window.localStorage) {
      const savedRotation = localStorage.getItem('hader:kiosk:rotation') as typeof rotation | null;
      if (savedRotation && ['none', 'right', 'left'].includes(savedRotation)) {
        setRotation(savedRotation);
      }
    }
  }, [isEmbedded]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const saved = localStorage.getItem('hader:kiosk:card-size');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { width?: number; height?: number };
      setKioskCardSize({
        width: typeof parsed.width === 'number' ? parsed.width : 0,
        height: typeof parsed.height === 'number' ? parsed.height : 0
      });
    } catch (error) {
      logError(error, 'Kiosk - Parse Card Size');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!kioskCardSize.width && !kioskCardSize.height) {
      localStorage.removeItem('hader:kiosk:card-size');
      return;
    }
    localStorage.setItem('hader:kiosk:card-size', JSON.stringify(kioskCardSize));
  }, [kioskCardSize]);

  // ═══════════════════════════════════════════════════════════════
  // 🔄 Apply rotation to root element
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (kioskRootRef.current && !isEmbedded) {
      const root = kioskRootRef.current;

      // Remove all rotation classes
      root.classList.remove('kiosk-rotate-none', 'kiosk-rotate-right', 'kiosk-rotate-left');

      // Add current rotation class
      root.classList.add(`kiosk-rotate-${rotation}`);

      // Update body class for scroll prevention
      if (rotation !== 'none') {
        document.body.classList.add('kiosk-rotated');
      } else {
        document.body.classList.remove('kiosk-rotated');
      }

      // Save to localStorage
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('hader:kiosk:rotation', rotation);
      }
    }

    return () => {
      // Cleanup: remove body class on unmount
      document.body.classList.remove('kiosk-rotated');
    };
  }, [rotation, isEmbedded]);

  const handleRotation = (newRotation: typeof rotation) => {
    setRotation(newRotation);
  };

  // ═══════════════════════════════════════════════════════════════
  // 🎛️ Control Panel Drag Handler
  // ═══════════════════════════════════════════════════════════════
  const handlePanelDragStart = useCallback((e: React.MouseEvent) => {
    if (controlPanelHeaderRef.current && controlPanelHeaderRef.current.contains(e.target as Node)) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - controlPanelPosition.x,
        y: e.clientY - controlPanelPosition.y
      });
    }
  }, [controlPanelPosition]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = Math.max(0, Math.min(e.clientX - dragStart.x, window.innerWidth - 350));
        const newY = Math.max(0, Math.min(e.clientY - dragStart.y, window.innerHeight - (controlPanelMinimized ? 60 : 500)));
        setControlPanelPosition({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart, controlPanelMinimized]);

  // Handle exit to main system
  const handleExitRequest = () => {
    setConfirmAction({
      type: 'exit',
      title: 'الخروج من النظام',
      message: 'هل أنت متأكد أنك تريد الخروج من وضع الكشك والعودة للصفحة الرئيسية؟'
    });
  };

  // Handle logout request
  const handleLogoutRequest = () => {
    setConfirmAction({
      type: 'logout',
      title: 'تسجيل الخروج',
      message: 'هل تريد تسجيل الخروج من النظام نهائياً؟'
    });
  };

  const confirmActionHandler = () => {
    if (!confirmAction) return;

    if (confirmAction.type === 'exit') {
      navigate('/');
    } else if (confirmAction.type === 'logout') {
      auth.logout();
      window.location.href = '/'; // Hard reload to clear all state
    }
    setConfirmAction(null);
  };

  const applySystemSettings = useCallback((systemSettings: SystemSettings) => {
    const operationalConfig = buildKioskOperationalConfig(systemSettings);
    setSettings(operationalConfig.kioskSettings);
    setOperatingPolicy(operationalConfig.policy);
    cacheHolidays(operationalConfig.policy.holidays);
  }, []);

  const runPreload = useCallback(async () => {
    setInitStatus('loading');
    setInitMessage(null);
    try {
      const res = await db.preloadForKiosk();

      if (res.ok) {
        setInitStatus('ready');

        // ═══════════════════════════════════════════════════════════════
        // Show appropriate message based on preload result
        // ═══════════════════════════════════════════════════════════════
        if (res.cloudAvailable) {
          // Cloud available - normal operation
          if (res.studentCount === 0) {
            setInitMessage('لا يوجد طلاب مسجلين. يرجى إضافة الطلاب من لوحة الإدارة.');
          }
          // Otherwise no message needed (normal operation)
        } else if (res.usedLocalSnapshot) {
          // Using local snapshot - show warning
          const mode = db.getMode();
          if (mode !== 'local') {
            setInitMessage('يتم استخدام بيانات الطلاب المخزنة محلياً. ستستأنف المزامنة عند توفر الاتصال.');
          }
        } else if (res.message) {
          setInitMessage(res.message);
        }
      } else {
        // ═══════════════════════════════════════════════════════════════
        // Error state - blocking error
        // ═══════════════════════════════════════════════════════════════
        setInitStatus('error');
        setInitMessage(res.message || 'تعذر تهيئة وضع الكشك');
      }
    } catch (error: any) {
      setInitStatus('error');
      setInitMessage(error?.message || 'تعذر تهيئة وضع الكشك');
    }
  }, []);

  // Load kiosk settings and preload students for offline-first on mount
  useEffect(() => {
    // Only proceed if auth is checked and user is authorized
    if (!authChecked) return;

    runPreload();
    const unsubscribe = db.onSyncStatusChange((state) => setSyncState(state));
    setSyncState(db.getSyncStatus());

    const loadSettings = (refresh = false) => {
      appSettings.load({ refresh }).then(applySystemSettings).catch(error => {
        logError(error, 'Kiosk - Load Settings');
      });
    };

    // Load settings immediately
    loadSettings();

    // Periodic cross-device safety refresh; same-device changes arrive by subscription below.
    const settingsInterval = setInterval(() => loadSettings(true), 30000);

    return () => {
      unsubscribe();
      clearInterval(settingsInterval);
    };
  }, [applySystemSettings, runPreload, authChecked]);

  // Refresh kiosk data when the device wakes up or reconnects. Barcode scanners
  // can fire immediately after sleep, so the local student index must be fresh.
  useEffect(() => {
    if (!authChecked) return;

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        runPreload();
      }, 300);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', scheduleRefresh);
    window.addEventListener('focus', scheduleRefresh);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', scheduleRefresh);
      window.removeEventListener('focus', scheduleRefresh);
    };
  }, [runPreload, authChecked]);

  // Subscribe to cross-tab settings updates (when Admin saves settings in another tab)
  useEffect(() => {
    const unsubscribeSettings = appSettings.subscribe((updatedSettings) => {
      logger.debug('Kiosk', 'Received settings update from real-time stream');
      applySystemSettings(updatedSettings);
    });

    return () => {
      unsubscribeSettings();
    };
  }, [applySystemSettings]);

  // ═══════════════════════════════════════════════════════════════
  // 🔄 Auto-refresh stats after sync completes (cross-device)
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    let lastRefresh = 0;
    const unsubscribe = syncService.on((event) => {
      if (event.type === 'sync:completed') {
        const now = Date.now();
        if (now - lastRefresh < 2000) return;
        lastRefresh = now;
        // Refresh survey stats if the survey panel is open
        if (surveyOpen) {
          db.getDashboardStats().then(stats => {
            setSurveyStats({
              total: stats.total_students,
              present: stats.present_count,
              late: stats.late_count,
              absent: stats.absent_count
            });
            logger.debug('Kiosk', 'Survey stats refreshed after sync');
          }).catch(error => {
            logError(error, 'Kiosk - Post-sync stats refresh');
          });
        }
      }
    });
    return unsubscribe;
  }, [surveyOpen]);

  // Real-time clock and late status check
  useEffect(() => {
    const checkLateStatus = () => {
      const now = getSyncedDate();
      setCurrentTime(now);

      // Handle Midnight Rollover intelligently
      const activeDay = getLocalISODate();
      if (currentDayRef.current !== activeDay) {
          logger.debug('Kiosk', '🌙 Midnight rollover detected! Automatically refreshing today state...');
          currentDayRef.current = activeDay;
          runPreload();
      }

      if (settings) {
        // Late Cutoff
        const assembly_time = settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME;
        const rawGracePeriod = settings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD;
        const grace_period = Number.isFinite(Number(rawGracePeriod)) ? Math.max(0, Number(rawGracePeriod)) : ATTENDANCE_DEFAULTS.GRACE_PERIOD;
        const [h, m] = assembly_time.split(':').map(Number);
        const assemblyStart = new Date(now);
        assemblyStart.setHours(h, m, 0, 0);
        const lateCutoff = new Date(now);
        lateCutoff.setHours(h, m + grace_period, 0, 0);
        const nowMs = now.getTime();
        const lateCutoffMs = lateCutoff.getTime();
        setIsLateTime(nowMs > lateCutoffMs);
        setIsGraceTime(grace_period > 0 && nowMs >= assemblyStart.getTime() && nowMs <= lateCutoffMs);

        // Absence Cutoff
        if (settings.absence_time) {
          const [ah, am] = settings.absence_time.split(':').map(Number);
          const absenceCutoff = new Date(now);
          absenceCutoff.setHours(ah, am, 0, 0);
          setIsAbsentTime(now.getTime() > absenceCutoff.getTime());
        } else {
          setIsAbsentTime(false);
        }
      } else {
        setIsGraceTime(false);
      }
    };

    checkLateStatus(); // Initial check
    const timer = setInterval(checkLateStatus, 1000); // Update every second

    return () => clearInterval(timer);
  }, [settings]);

  // Screensaver image rotation effect
  useEffect(() => {
    let timer: any = null;
    if (screensaverActive && settings?.screensaver_images && settings.screensaver_images.length > 0) {
      timer = setInterval(() => {
        setScreensaverIndex(prev => (prev + 1) % settings.screensaver_images!.length);
      }, 4000);
    }
    return () => timer && clearInterval(timer);
  }, [screensaverActive, settings]);

  // Screensaver phrases rotation effect
  useEffect(() => {
    let timer: any = null;
    if (screensaverActive && settings?.screensaver_phrases && settings.screensaver_phrases.length > 0) {
      timer = setInterval(() => {
        setPhraseIndex(prev => (prev + 1) % settings.screensaver_phrases!.length);
      }, 5000); // Change phrase every 5 seconds
    }
    return () => timer && clearInterval(timer);
  }, [screensaverActive, settings]);

  // Screensaver inactivity detection effect
  useEffect(() => {
    if (!settings?.screensaver_enabled || !settings.screensaver_timeout) return;
    let timer: NodeJS.Timeout | null = null;
    const resetTimeout = () => {
      setScreensaverActive(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setScreensaverActive(true), settings.screensaver_timeout!);
    }
    // Reset timer on activities
    window.addEventListener('keydown', resetTimeout);
    window.addEventListener('mousedown', resetTimeout);
    window.addEventListener('touchstart', resetTimeout);
    resetTimeout();
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('keydown', resetTimeout);
      window.removeEventListener('mousedown', resetTimeout);
      window.removeEventListener('touchstart', resetTimeout);
    }
  }, [settings]);

  useEffect(() => {
    // Initial focus when ready
    if (canAcceptScans) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [canAcceptScans]);

  // Auto-submit on Enter key (useful for barcode scanners)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only auto-submit if input is focused and has value
      if (e.key === 'Enter' && document.activeElement === inputRef.current && inputId.trim() && canAcceptScans) {
        e.preventDefault();
        // Trigger form submit
        const form = inputRef.current?.closest('form');
        if (form) {
          form.requestSubmit();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canAcceptScans, inputId]);

  // Subscribe to admin remote control for the kiosk
  useEffect(() => {
    const unsub = notificationCenter.subscribe('kiosk', notif => {
      // force screensaver
      if (notif.type === 'command' && /force screensaver/i.test(notif.message)) {
        setScreensaverActive(true);
      }
      // popup command
      else if (notif.type === 'command' && /popup/i.test(notif.message)) {
        setCommandPopup(notif.message);
        setTimeout(() => setCommandPopup(null), 8000);
      }
      // Play audio/simple beep
      else if (notif.type === 'command' && /play audio/i.test(notif.message)) {
        try { new Audio('/beep.mp3').play(); } catch (e) { /* fallback beep */ window.navigator.vibrate?.(200); }
      }
    });
    const handleDismiss = (e: KeyboardEvent | MouseEvent) => screensaverActive && setScreensaverActive(false);
    window.addEventListener('keydown', handleDismiss);
    window.addEventListener('mousedown', handleDismiss);
    return () => {
      unsub.unsubscribe();
      window.removeEventListener('keydown', handleDismiss);
      window.removeEventListener('mousedown', handleDismiss);
    };
  }, [screensaverActive]);

  useEffect(() => {
    if (!commandPopup) {
      setSurveyOpen(false);
      setSurveyStats(null);
      setSurveyLoading(false);
    }
  }, [commandPopup]);

  // ═══════════════════════════════════════════════════════════════
  // 🎯 Auto-focus maintenance for Kiosk mode
  // Periodically checks and restores focus to input when appropriate
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    // Only run periodic focus check when kiosk is ready
    if (!canAcceptScans) return;

    const focusCheckInterval = setInterval(() => {
      // Skip focus restoration in these cases:
      // - Loading state
      // - Result card showing
      // - Confirmation modal open
      // - Manual input mode active
      // - Screensaver active
      // - Camera scan modal open
      // - Input already focused
      const shouldSkipFocus =
        loading ||
        attendanceResult ||
        confirmAction ||
        inputVisible ||
        screensaverActive ||
        cameraScanOpen ||
        document.activeElement === inputRef.current;

      if (!shouldSkipFocus) {
        inputRef.current?.focus();
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(focusCheckInterval);
  }, [canAcceptScans, loading, attendanceResult, confirmAction, inputVisible, screensaverActive, cameraScanOpen]);

  const handleBlur = () => {
    // Gentle Re-focus logic - but only if not clicking on result card or buttons
    if (canAcceptScans) {
      setTimeout(() => {
        // Only refocus if no modal/result card is showing
        if (!attendanceResult && !screensaverActive) {
          inputRef.current?.focus();
        }
      }, 150);
    }
  };

  const handleAttendance = useCallback(async (value: string) => {
    if (!value || loading || initStatus !== 'ready') return;

    if (!kioskDayState.allowsAttendance) {
      setAttendanceResult({
        type: 'error',
        mode: 'closed',
        message: kioskDayState.helper
      });
      setInputId('');
      setTimeout(() => setAttendanceResult(null), 6000);
      return;
    }

    setLoading(true);
    try {
      const resolvedStudent = await db.getStudentByAnyId(value);
      if (!resolvedStudent) {
        // ═══════════════════════════════════════════════════════════════
        // 🚨 Emergency Mode: إذا كان وضع الطوارئ مفعّل، أضف للقائمة
        // ═══════════════════════════════════════════════════════════════
        if (emergencyMode) {
          const newEntry: EmergencyEntry = {
            id: `emergency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            scanned_code: value,
            scanned_at: new Date().toISOString(),
            resolved: false
          };
          setEmergencyQueue(prev => [...prev, newEntry]);
          setLoading(false);
          setAttendanceResult({
            type: 'success',
            message: `حُفظ الرمز "${value}" في قائمة الطوارئ للمراجعة لاحقًا.`,
            mode: 'emergency',
            deliveryState: 'local'
          });
          setInputId('');
          inputRef.current?.focus();
          setTimeout(() => setAttendanceResult(null), 4000);
          return;
        }

        // الوضع العادي: رفض الباركود غير المعروف
        setLoading(false);
        setAttendanceResult({
          type: 'error',
          message: 'الطالب غير موجود. تحقق من المعرف أو الرمز.'
        });
        setInputId('');
        inputRef.current?.focus();
        setTimeout(() => setAttendanceResult(null), 5000);
        return;
      }
      // ═══════════════════════════════════════════════════════════════
      // Use markAttendanceFast for instant response (PURE LOCAL)
      // ═══════════════════════════════════════════════════════════════
      const result = await db.markAttendanceFast(resolvedStudent.id);
      setLoading(false);

      // ═══════════════════════════════════════════════════════════════
      // Handle result based on code
      // ═══════════════════════════════════════════════════════════════
      if (result.ok && result.student) {
        const isLate = result.status === 'late';
        const latestSyncState = db.getSyncStatus();
        setSyncState(latestSyncState);
        const deliveryState: AttendanceResult['deliveryState'] = result.code === 'duplicate'
          ? undefined
          : db.getMode() === 'local'
            ? 'local'
            : latestSyncState.pending > 0 || ['offline', 'error', 'syncing'].includes(latestSyncState.status)
              ? 'queued'
              : 'synced';

        // Determine result type based on code
        let resultType: 'success' | 'error' = 'success';
        if (result.code === 'not_found') {
          resultType = 'error';
        }

        setAttendanceResult({
          type: resultType,
          message: result.message,
          student: result.student,
          isLate,
          mode: result.code,
          minutesLate: result.minutes_late,
          stats: result.stats,
          deliveryState
        });

        // ═══════════════════════════════════════════════════════════════
        // Real-time survey stats update: Refresh attendance dashboard
        // after successful attendance recording (except duplicates)
        // ═══════════════════════════════════════════════════════════════
        if (result.code !== 'duplicate' && surveyOpen) {
          // Update survey stats in real-time
          db.getDashboardStats().then(stats => {
            setSurveyStats({
              total: stats.total_students,
              present: stats.present_count,
              late: stats.late_count,
              absent: stats.absent_count
            });
          }).catch(error => {
            logError(error, 'Kiosk - Real-time Survey Update');
          });
        }
      } else {
        // Error case
        setAttendanceResult({
          type: 'error',
          message: result.message,
          mode: result.code
        });
      }

      setInputId('');
      // Keep focus after submission
      inputRef.current?.focus();

      // Auto-dismiss after appropriate delay
      const dismissDelay = result.code === 'duplicate' ? 6000 : result.ok ? 8000 : 5000;
      setTimeout(() => setAttendanceResult(null), dismissDelay);
    } catch (error) {
      setLoading(false);
      logError(error, 'Kiosk - Register Attendance');
      setAttendanceResult({
        type: 'error',
        message: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.'
      });
      setInputId('');
      inputRef.current?.focus();
      setTimeout(() => setAttendanceResult(null), 5000);
    }
  }, [emergencyMode, initStatus, kioskDayState.allowsAttendance, kioskDayState.helper, loading, surveyOpen]);

  // Ref to always access latest handleAttendance without changing startCameraScan identity
  const handleAttendanceRef = useRef(handleAttendance);
  handleAttendanceRef.current = handleAttendance;

  // --- Handlers ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Normalize Arabic digits, casing, separators, and scanner whitespace exactly
    // as the roster lookup does. This keeps prefixed IDs such as SCH-000123 valid.
    const rawId = inputId.trim();
    if (!rawId) return;
    const cleanId = normalizeStudentId(rawId);
    if (!cleanId) return;

    // Debounce: prevent duplicate submissions of same ID within 2 seconds
    const now = Date.now();
    const lastScan = lastScanTimeRef.current;
    if (cleanId === lastScan.id && (now - lastScan.time) < 2000) {
      logger.debug('Kiosk', 'Skipping duplicate scan:', cleanId);
      setInputId('');
      return;
    }

    lastScanTimeRef.current = { id: cleanId, time: now };

    logger.debug('Kiosk', 'Processing scan:', cleanId);
    await handleAttendance(cleanId);

    // Clear and refocus
    setInputId('');
    // Keep focus
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 50);
  };

  const handleRetrySync = useCallback(async () => {
    if (syncRetrying) return;
    setSyncRetrying(true);
    try {
      await db.forceSyncNow();
      const nextState = db.getSyncStatus();
      setSyncState(nextState);
      if (nextState.pending > 0) {
        toast.warning(`بقي ${nextState.pending} سجل في انتظار المزامنة.`);
      } else {
        toast.success('اكتملت مزامنة سجلات الكشك.');
      }
    } catch (error) {
      logError(error, 'Kiosk - Manual Sync Retry');
      setSyncState(db.getSyncStatus());
      toast.error('تعذرت المزامنة. ستبقى السجلات محفوظة محليًا للمحاولة لاحقًا.');
    } finally {
      setSyncRetrying(false);
    }
  }, [syncRetrying, toast]);

  const isBarcodeDetectorSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return 'BarcodeDetector' in window;
  }, []);

  const stopCameraScan = useCallback(() => {
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
    if (barcodeWorkerRef.current) {
      barcodeWorkerRef.current.terminate();
      barcodeWorkerRef.current = null;
      barcodeWorkerReadyRef.current = false;
      isWorkerScanningRef.current = false;
    }
    setCameraReady(false);
  }, []);

  const startCameraScan = useCallback(async () => {
    // Prevent multiple simultaneous starts
    if (cameraStreamRef.current) return;
    setCameraScanError(null);
    lastScanValueRef.current = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraScanError('متصفح الجهاز لا يدعم تشغيل الكاميرا.');
      return;
    }
    if (!isBarcodeDetectorSupported) {
      setCameraScanError('هذه المتصفح لا يدعم مسح الباركود بالكاميرا.');
      return;
    }

    try {
      const mobileConstraints = {
        video: {
          facingMode: { exact: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      const fallbackConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(mobileConstraints);
      } catch (error) {
        stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      }

      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        cameraVideoRef.current.setAttribute('playsinline', 'true');
        await cameraVideoRef.current.play();
      }

      // Initialize Web Worker for Barcode Detection
      if (!barcodeWorkerRef.current) {
        barcodeWorkerRef.current = new BarcodeWorker();
        barcodeWorkerRef.current.onmessage = (e) => {
          if (e.data.type === 'INIT_SUCCESS') {
            barcodeWorkerReadyRef.current = true;
          } else if (e.data.type === 'INIT_ERROR') {
            barcodeWorkerReadyRef.current = false;
            // Fallback to main thread
            if (!barcodeDetectorRef.current && (window as any).BarcodeDetector) {
              barcodeDetectorRef.current = new (window as any).BarcodeDetector({
                formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'qr_code', 'upc_e', 'upc_a', 'itf']
              });
            }
          } else if (e.data.type === 'DETECT_SUCCESS') {
            const rawValues = e.data.barcodes;
            if (rawValues?.length) {
              const rawValue = rawValues[0]?.trim();
              if (rawValue) {
                const now = performance.now();
                const isSameBarcode = rawValue === lastScanValueRef.current;
                const cooldownActive = (now - cameraScanCooldownRef.current) < 2500;
                if (!isSameBarcode || !cooldownActive) {
                  lastScanValueRef.current = rawValue;
                  cameraScanCooldownRef.current = now;
                  try { new Audio('/beep.mp3').play(); } catch { /* silent */ }
                  setAttendanceResult(null);
                  handleAttendanceRef.current(rawValue);
                }
              }
            }
            isWorkerScanningRef.current = false;
          } else if (e.data.type === 'DETECT_ERROR') {
            isWorkerScanningRef.current = false;
          }
        };
        barcodeWorkerRef.current.postMessage({ type: 'INIT' });
      }

      setCameraReady(true);

      const scanFrame = async () => {
        if (!cameraVideoRef.current) return;
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
          if (barcodeWorkerReadyRef.current && barcodeWorkerRef.current) {
            if (!isWorkerScanningRef.current) {
              isWorkerScanningRef.current = true;
              createImageBitmap(cameraVideoRef.current).then(bmp => {
                barcodeWorkerRef.current?.postMessage({ type: 'DETECT', imageBitmap: bmp }, [bmp]);
              }).catch(() => {
                isWorkerScanningRef.current = false;
              });
            }
          } else if (barcodeDetectorRef.current) {
            const barcodes = await barcodeDetectorRef.current.detect(cameraVideoRef.current);
            if (barcodes?.length) {
              const rawValue = barcodes[0]?.rawValue?.trim();
              if (rawValue) {
                const now = performance.now();
                const isSameBarcode = rawValue === lastScanValueRef.current;
                const cooldownActive = (now - cameraScanCooldownRef.current) < 2500;
                if (!isSameBarcode || !cooldownActive) {
                  lastScanValueRef.current = rawValue;
                  cameraScanCooldownRef.current = now;
                  try { new Audio('/beep.mp3').play(); } catch { /* silent */ }
                  setAttendanceResult(null);
                  handleAttendanceRef.current(rawValue);
                }
              }
            }
          }
        } catch (error) {
          logError(error, 'Kiosk - Barcode Scan');
          isWorkerScanningRef.current = false;
        }

        scanFrameRef.current = requestAnimationFrame(scanFrame);
      };

      scanFrameRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      logError(error, 'Kiosk - Start Camera');
      setCameraScanError('تعذر تشغيل الكاميرا. تأكد من منح الإذن.');
      stopCameraScan();
    }
  }, [isBarcodeDetectorSupported, stopCameraScan]);

  useEffect(() => {
    if (cameraScanOpen) {
      startCameraScan();
    } else {
      stopCameraScan();
    }

    return () => stopCameraScan();
  }, [cameraScanOpen]);

  useEffect(() => {
    if (screensaverActive && cameraScanOpen) {
      setCameraScanOpen(false);
    }
  }, [screensaverActive, cameraScanOpen]);

  useEffect(() => {
    if (!kioskDayState.allowsAttendance && cameraScanOpen) {
      setCameraScanOpen(false);
    }
  }, [cameraScanOpen, kioskDayState.allowsAttendance]);

  useEffect(() => {
    if (!kioskDayState.allowsAttendance || !settings?.camera_scan_enabled || !settings.camera_scan_auto_open) return;
    if (!isBarcodeDetectorSupported || !navigator.mediaDevices?.getUserMedia) return;
    if (autoCameraOpenedRef.current) return;
    autoCameraOpenedRef.current = true;
    setCameraScanOpen(true);
  }, [isBarcodeDetectorSupported, kioskDayState.allowsAttendance, settings?.camera_scan_auto_open, settings?.camera_scan_enabled]);

  // Announcements Carousel Auto-play
  useEffect(() => {
    if (!settings?.announcements_enabled || !settings?.announcements_autoplay || announcementsPaused) {
      return;
    }

    const announcementsCount = settings?.announcements_images?.length || 0;
    if (announcementsCount === 0) {
      return;
    }

    const interval = setInterval(() => {
      setCurrentAnnouncementIndex((prev) => (prev + 1) % announcementsCount);
    }, (settings?.announcements_interval || 5) * 1000);

    return () => clearInterval(interval);
  }, [settings?.announcements_enabled, settings?.announcements_autoplay, settings?.announcements_interval, settings?.announcements_images?.length, announcementsPaused]);

  // Dismiss result card
  const dismissResult = () => setAttendanceResult(null);

  // Get current theme configuration (with fallback) - MUST be before screensaver
  const theme = useMemo(() => {
    const themeKey = settings?.theme || 'dark-neon';
    return KIOSK_THEMES[themeKey] || KIOSK_THEMES['dark-neon'];
  }, [settings?.theme]);

  const show_school_name = settings?.show_school_name !== false;
  const show_principal_name = settings?.show_principal_name !== false;
  const shouldShowSchoolInfo = (show_school_name && !!settings?.school_name) || (show_principal_name && !!settings?.principal_name);
  const syncMode = db.getMode();
  const kioskPhase = useMemo(() => {
    if (!kioskDayState.allowsAttendance) {
      return {
        label: kioskDayState.title,
        helper: kioskDayState.helper,
        dot: 'bg-sky-300',
        halo: 'bg-sky-400/15',
        badge: 'bg-sky-500/10 text-sky-100 border-sky-300/25',
        badgeLight: 'bg-sky-50 text-sky-700 border-sky-200',
        card: 'bg-slate-950/45 border-sky-300/20 shadow-[0_28px_110px_-58px_rgba(56,189,248,0.62),inset_0_1px_0_rgba(255,255,255,0.08)]',
        lightCard: 'bg-sky-50/80 border-sky-200/80 shadow-[0_28px_100px_-62px_rgba(56,189,248,0.35),inset_0_1px_0_rgba(255,255,255,0.9)]',
        time: 'text-sky-100',
        timeLight: 'text-sky-950',
        timeGlow: 'drop-shadow-[0_0_30px_rgba(125,211,252,0.36)]'
      };
    }

    if (isAbsentTime) {
      return {
        label: 'وقت الغياب',
        helper: 'تسجيل الغياب التلقائي نشط',
        dot: 'bg-red-400',
        halo: 'bg-red-500/20',
        badge: 'bg-red-500/10 text-red-100 border-red-300/25',
        badgeLight: 'bg-red-50 text-red-700 border-red-200',
        card: 'bg-red-950/40 border-red-300/25 shadow-[0_28px_110px_-58px_rgba(239,68,68,0.98),inset_0_1px_0_rgba(255,255,255,0.08)]',
        lightCard: 'bg-red-50/80 border-red-200/80 shadow-[0_28px_100px_-62px_rgba(239,68,68,0.55),inset_0_1px_0_rgba(255,255,255,0.9)]',
        time: 'text-red-100',
        timeLight: 'text-red-950',
        timeGlow: 'drop-shadow-[0_0_30px_rgba(248,113,113,0.52)]'
      };
    }

    if (isLateTime) {
      return {
        label: 'وقت التأخير',
        helper: 'يتم احتساب دقائق التأخير',
        dot: 'bg-red-400',
        halo: 'bg-red-500/20',
        badge: 'bg-red-500/10 text-red-100 border-red-300/25',
        badgeLight: 'bg-red-50 text-red-700 border-red-200',
        card: 'bg-red-950/40 border-red-300/25 shadow-[0_28px_110px_-58px_rgba(239,68,68,0.96),inset_0_1px_0_rgba(255,255,255,0.08)]',
        lightCard: 'bg-red-50/80 border-red-200/80 shadow-[0_28px_100px_-62px_rgba(239,68,68,0.52),inset_0_1px_0_rgba(255,255,255,0.9)]',
        time: 'text-red-100',
        timeLight: 'text-red-950',
        timeGlow: 'drop-shadow-[0_0_30px_rgba(248,113,113,0.50)]'
      };
    }

    if (isGraceTime) {
      return {
        label: 'وقت السماح',
        helper: 'ضمن مهلة السماح دون احتساب تأخير',
        dot: 'bg-amber-300',
        halo: 'bg-amber-400/25',
        badge: 'bg-amber-500/10 text-amber-100 border-amber-300/25',
        badgeLight: 'bg-amber-50 text-amber-700 border-amber-200',
        card: 'bg-amber-950/30 border-amber-300/25 shadow-[0_28px_110px_-58px_rgba(245,158,11,0.92),inset_0_1px_0_rgba(255,255,255,0.08)]',
        lightCard: 'bg-amber-50/80 border-amber-200/80 shadow-[0_28px_100px_-62px_rgba(245,158,11,0.50),inset_0_1px_0_rgba(255,255,255,0.9)]',
        time: 'text-amber-100',
        timeLight: 'text-amber-950',
        timeGlow: 'drop-shadow-[0_0_30px_rgba(251,191,36,0.50)]'
      };
    }

    return {
      label: 'وقت الحضور المبكر',
      helper: 'الحضور في الوقت المثالي',
      dot: 'bg-emerald-300',
      halo: 'bg-emerald-400/20',
      badge: 'bg-emerald-500/10 text-emerald-100 border-emerald-300/25',
      badgeLight: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      card: 'bg-emerald-950/25 border-emerald-300/20 shadow-[0_28px_110px_-58px_rgba(16,185,129,0.88),inset_0_1px_0_rgba(255,255,255,0.08)]',
      lightCard: 'bg-emerald-50/80 border-emerald-200/80 shadow-[0_28px_100px_-62px_rgba(16,185,129,0.50),inset_0_1px_0_rgba(255,255,255,0.9)]',
      time: 'text-emerald-50',
      timeLight: 'text-emerald-950',
      timeGlow: 'drop-shadow-[0_0_30px_rgba(52,211,153,0.48)]'
    };
  }, [isAbsentTime, isGraceTime, isLateTime, kioskDayState]);

  const kioskStatusTiles = useMemo(() => {
    const syncLabel = syncMode === 'local'
      ? 'محلي'
      : syncState.status === 'online'
        ? 'متصل'
        : syncState.status === 'syncing'
          ? 'مزامنة'
          : syncState.status === 'offline'
            ? 'محلي مؤقت'
            : syncState.status === 'error'
              ? 'تحتاج متابعة'
              : 'تهيئة';

    return [
      {
        label: 'جاهزية الكشك',
        value: initStatus === 'ready' && kioskDayState.allowsAttendance ? 'جاهز' : initStatus === 'loading' ? 'تهيئة' : 'متوقف',
        helper: initStatus === 'ready'
          ? kioskDayState.allowsAttendance ? 'مدخلات الباركود نشطة' : 'المسح مغلق حسب سياسة اليوم'
          : 'بانتظار تحميل البيانات',
        icon: Scan,
        tone: initStatus === 'ready' && kioskDayState.allowsAttendance ? 'text-emerald-200' : 'text-amber-200'
      },
      {
        label: 'المزامنة',
        value: syncLabel,
        helper: syncState.pending > 0 ? `${syncState.pending} سجل بالانتظار` : syncMode === 'local' ? 'حفظ محلي كامل' : 'لا توجد عمليات معلقة',
        icon: Wifi,
        tone: syncState.status === 'error' || syncState.status === 'offline' ? 'text-amber-200' : 'text-cyan-100'
      },
      {
        label: 'حالة اليوم',
        value: kioskPhase.label,
        helper: kioskPhase.helper,
        icon: Clock,
        tone: kioskPhase.time
      },
      {
        label: emergencyMode ? 'وضع الطوارئ' : 'طريقة الإدخال',
        value: emergencyMode ? 'طوارئ' : settings?.camera_scan_enabled ? 'بطاقة + كاميرا' : 'بطاقة',
        helper: emergencyMode
          ? 'قبول أي باركود للمراجعة'
          : settings?.camera_scan_enabled
            ? isBarcodeDetectorSupported ? 'الكاميرا جاهزة عند الطلب' : 'المتصفح لا يدعم المسح'
            : 'الماسح الخفي يعمل دائمًا',
        icon: emergencyMode ? Zap : settings?.camera_scan_enabled ? Camera : Keyboard,
        tone: emergencyMode ? 'text-orange-200' : settings?.camera_scan_enabled ? 'text-emerald-200' : 'text-slate-100'
      }
    ];
  }, [emergencyMode, initStatus, isBarcodeDetectorSupported, kioskDayState.allowsAttendance, kioskPhase, settings?.camera_scan_enabled, syncMode, syncState.pending, syncState.status]);

  // --- Screensaver overlay UI ---
  const screensaver = screensaverActive && (
    <div
      className={`fixed inset-0 z-[200] overflow-hidden flex flex-col items-center justify-center transition-all duration-500 ${theme.bg}`}
      onClick={() => {
        setScreensaverActive(false);
        // Refocus input after dismissing screensaver
        setTimeout(() => inputRef.current?.focus(), 100);
      }}
      onKeyDown={(e) => {
        // Dismiss on any key press
        if (e.key !== 'Tab') {
          setScreensaverActive(false);
          // Refocus input after key dismiss
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      }}
      dir="rtl"
      tabIndex={-1}
    >

      {/* Background effects - Using theme colors */}
      <div className="absolute inset-0 overflow-hidden">
        <div className={`absolute top-[-10%] left-[15%] w-[600px] h-[600px] ${theme.blob1} rounded-full blur-[180px] animate-blob`}></div>
        <div className={`absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] ${theme.blob2} rounded-full blur-[160px] animate-blob animation-delay-2000`}></div>
        <div className={`absolute top-[40%] left-[60%] w-[400px] h-[400px] ${theme.blob1} rounded-full blur-[140px] animate-blob animation-delay-4000`}></div>
        {theme.isDark && (
          <div className={`absolute inset-0 ${KIOSK_DOT_PATTERN} opacity-20`}></div>
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center w-full h-full p-8">

        {/* Time - Top Left Corner (small) */}
        <div className={`absolute top-6 left-6 ${theme.isDark ? 'bg-black/40' : 'bg-white/60'} px-5 py-3 rounded-2xl backdrop-blur-sm border ${theme.isDark ? 'border-white/10' : 'border-black/10'} z-20`}>
          <div className={`text-2xl md:text-3xl font-mono ${theme.text} font-bold`}>
            {new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Header Image - Top Right Corner */}
        {settings?.header_image && (
          <img src={settings.header_image} alt="header" className={`absolute top-6 right-6 max-h-14 md:max-h-16 drop-shadow-2xl rounded-xl border ${theme.isDark ? 'border-white/10 bg-white/10' : 'border-black/10 bg-black/5'} animate-fade-in z-20`} />
        )}

        {/* Custom Text - Top Position */}
        {settings?.screensaver_custom_text?.enabled &&
          settings.screensaver_custom_text.text &&
          settings.screensaver_custom_text.position === 'top' && (
            <div className={`
            absolute top-24 inset-x-0 text-center px-4 animate-fade-in
            ${settings.screensaver_custom_text.size === 'sm' ? 'text-xl md:text-2xl' : ''}
            ${settings.screensaver_custom_text.size === 'md' ? 'text-2xl md:text-4xl' : ''}
            ${settings.screensaver_custom_text.size === 'lg' ? 'text-4xl md:text-6xl' : ''}
            font-bold ${theme.text} drop-shadow-2xl tracking-tight
          `}>
              {settings.screensaver_custom_text.text}
            </div>
          )}

        {/* Center Content - Moved down a bit */}
        <div className="text-center max-w-4xl mx-auto flex flex-col items-center justify-center mt-16">

          {/* Screensaver images slider - Center */}
          {settings?.screensaver_images && settings.screensaver_images.length > 0 && (
            <div className={`relative w-[75vw] max-w-[650px] aspect-video rounded-3xl overflow-hidden shadow-2xl border-2 ${theme.isDark ? 'border-white/20' : 'border-black/10'}`}>
              {settings.screensaver_images.map((img, idx) => (
                <img
                  key={idx}
                  src={img}
                  alt={`slider_${idx}`}
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-1000 ease-in-out ${idx === screensaverIndex
                    ? 'opacity-100 scale-100'
                    : 'opacity-0 scale-105'
                    }`}
                />
              ))}
              {/* Image indicators */}
              {settings.screensaver_images.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                  {settings.screensaver_images.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${idx === screensaverIndex
                        ? `${theme.isDark ? 'bg-white' : 'bg-gray-800'} w-6`
                        : `${theme.isDark ? 'bg-white/40' : 'bg-gray-800/40'}`
                        }`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rotating Phrases - Below Images */}
          {settings?.screensaver_phrases && settings.screensaver_phrases.length > 0 && (
            <div className="relative h-20 md:h-24 flex items-center justify-center overflow-visible mt-12 mb-4">
              {settings.screensaver_phrases.map((phrase, idx) => (
                <p
                  key={idx}
                  className={`absolute text-2xl md:text-4xl font-bold transition-all duration-700 ease-in-out whitespace-nowrap ${idx === phraseIndex
                    ? 'opacity-100 translate-y-0 text-transparent bg-clip-text bg-gradient-to-r from-primary-400 via-pink-400 to-secondary-400'
                    : 'opacity-0 translate-y-8'
                    }`}
                >
                  {phrase}
                </p>
              ))}
              {/* Phrase indicators */}
              {settings.screensaver_phrases.length > 1 && (
                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                  {settings.screensaver_phrases.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${idx === phraseIndex
                        ? `${theme.accent.replace('text-', 'bg-')}`
                        : `${theme.isDark ? 'bg-white/20' : 'bg-black/20'}`
                        }`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Custom Text - Center Position */}
          {settings?.screensaver_custom_text?.enabled &&
            settings.screensaver_custom_text.text &&
            settings.screensaver_custom_text.position === 'center' && (
              <h1 className={`
              mt-6 font-bold ${theme.text} drop-shadow-2xl tracking-tight animate-fade-in
              ${settings.screensaver_custom_text.size === 'sm' ? 'text-2xl md:text-3xl' : ''}
              ${settings.screensaver_custom_text.size === 'md' ? 'text-3xl md:text-5xl' : ''}
              ${settings.screensaver_custom_text.size === 'lg' ? 'text-5xl md:text-7xl' : ''}
            `}>
                {settings.screensaver_custom_text.text}
              </h1>
            )}
        </div>

        {/* Exit hint - Bottom Right Corner (smaller) */}
        <div className={`absolute bottom-4 right-4 ${theme.subText} text-xs ${theme.isDark ? 'bg-black/40' : 'bg-white/60'} px-3 py-1.5 rounded-lg backdrop-blur-sm border ${theme.isDark ? 'border-white/10' : 'border-black/10'} z-20`}>
          المس الشاشة للخروج
        </div>

        {/* Custom Text - Bottom Position */}
        {settings?.screensaver_custom_text?.enabled &&
          settings.screensaver_custom_text.text &&
          settings.screensaver_custom_text.position === 'bottom' && (
            <div className={`
            absolute bottom-24 inset-x-0 text-center px-4 animate-fade-in
            ${settings.screensaver_custom_text.size === 'sm' ? 'text-xl md:text-2xl' : ''}
            ${settings.screensaver_custom_text.size === 'md' ? 'text-2xl md:text-4xl' : ''}
            ${settings.screensaver_custom_text.size === 'lg' ? 'text-4xl md:text-6xl' : ''}
            font-bold ${theme.text} drop-shadow-2xl tracking-tight
          `}>
              {settings.screensaver_custom_text.text}
            </div>
          )}
      </div>
    </div>
  );

  // --- Command popup overlay ---
  const handleToggleSurvey = async () => {
    if (surveyOpen) {
      setSurveyOpen(false);
      return;
    }
    setSurveyLoading(true);
    try {
      const stats = await db.getDashboardStats();
      setSurveyStats({
        total: stats.total_students,
        present: stats.present_count,
        late: stats.late_count,
        absent: stats.absent_count
      });
      setSurveyOpen(true);
    } catch (error) {
      logError(error, 'Kiosk - Operation');
      setSurveyStats(null);
      setSurveyOpen(true);
    } finally {
      setSurveyLoading(false);
    }
  };

  const handleCardDimensionChange = (key: 'width' | 'height', value: number) => {
    const clamped = Math.min(100, Math.max(0, value));
    setKioskCardSize((prev) => ({ ...prev, [key]: clamped }));
  };

  const handleCardDimensionReset = () => {
    setKioskCardSize({ width: 0, height: 0 });
  };

  const popupOverlay = commandPopup && (
    <div className="fixed top-8 inset-x-0 z-[170] flex justify-center pointer-events-none animate-fade-in-up">
      <div className="glass-card border border-pink-400/40 bg-primary-900/90 px-8 py-6 rounded-3xl shadow-2xl backdrop-blur-2xl text-center text-white font-bold pointer-events-auto">
        <div className="text-2xl md:text-3xl animate-pulse-slow">
          {commandPopup.replace(/popup:/i, '')}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs font-bold">
          <button
            className="px-4 py-1.5 rounded-xl bg-white/10 text-cyan-200 hover:bg-cyan-500/20 transition"
            onClick={handleToggleSurvey}
          >
            استطلاع
          </button>
          <button
            className="px-4 py-1.5 rounded-xl bg-white/10 text-pink-300 hover:bg-pink-600/10 transition"
            onClick={() => { setCommandPopup(null); setSurveyOpen(false); }}
          >
            إغلاق
          </button>
        </div>

        {surveyOpen && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-sm text-white/80">
            {surveyLoading ? (
              <div className="flex items-center justify-center gap-2 text-xs text-white/70">
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري تحميل بيانات الحضور...
              </div>
            ) : surveyStats ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-white/70">
                  <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">
                    إجمالي الطلاب: <span className="text-white font-mono">{surveyStats.total}</span>
                  </span>
                  <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/20">
                    حضور اليوم: <span className="text-emerald-200 font-mono">{surveyStats.present + surveyStats.late}</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-xs">
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3">
                    <div className="text-emerald-200">عدد المبكرين</div>
                    <div className="text-2xl font-bold text-white font-mono mt-1">{surveyStats.present}</div>
                  </div>
                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3">
                    <div className="text-amber-200">عدد المتأخرين</div>
                    <div className="text-2xl font-bold text-white font-mono mt-1">{surveyStats.late}</div>
                  </div>
                  <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-3">
                    <div className="text-red-200">عدد الغياب</div>
                    <div className="text-2xl font-bold text-white font-mono mt-1">{surveyStats.absent}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-red-200">تعذر تحميل بيانات الحضور حالياً.</div>
            )}
          </div>
        )}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/80">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
            <span className="font-semibold text-white">تحكم أبعاد بطاقة الكشك</span>
            <button
              type="button"
              onClick={handleCardDimensionReset}
              className="px-3 py-1 rounded-full border border-white/10 bg-white/10 text-[11px] text-white/70 hover:bg-white/20 transition"
            >
              استعادة الافتراضي
            </button>
          </div>
          <div className="mt-4 grid gap-4">
            <div>
              <div className="flex items-center justify-between text-xs text-white/70 mb-2">
                <span>العرض</span>
                <span className="font-mono">{kioskCardSize.width || 100}%</span>
              </div>
              <input
                type="range"
                min={60}
                max={100}
                step={1}
                value={kioskCardSize.width || 100}
                onChange={(e) => handleCardDimensionChange('width', Number(e.target.value))}
                className="w-full h-2 bg-white/10 rounded-full accent-cyan-300"
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-white/70 mb-2">
                <span>الطول</span>
                <span className="font-mono">{kioskCardSize.height || 0}vh</span>
              </div>
              <input
                type="range"
                min={0}
                max={120}
                step={5}
                value={kioskCardSize.height || 0}
                onChange={(e) => handleCardDimensionChange('height', Number(e.target.value))}
                className="w-full h-2 bg-white/10 rounded-full accent-pink-300"
              />
            </div>
            <p className="text-[11px] text-white/50">
              يتم تطبيق الأبعاد فوراً على بطاقة الساعة الرئيسية دون تعطيل العرض.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const buildResultStyles = (result: AttendanceResult | null) => {
    if (!result) return null;
    if (result.type !== 'success') {
      return {
        card: 'bg-rose-950/90 border-rose-300/25 shadow-[0_26px_85px_-48px_rgba(244,63,94,0.78)]',
        badge: 'bg-rose-400/10 text-rose-100 border border-rose-300/25',
        badgeText: 'خطأ',
        dot: 'bg-rose-300',
        iconColor: 'text-rose-200',
        iconType: AlertTriangle
      };
    }
    if (result.mode === 'duplicate') {
      return {
        card: 'bg-sky-950/90 border-sky-300/25 shadow-[0_26px_85px_-48px_rgba(14,165,233,0.72)]',
        badge: 'bg-sky-400/10 text-sky-100 border border-sky-300/25',
        badgeText: 'مسجل مسبقاً',
        dot: 'bg-sky-300',
        iconColor: 'text-sky-100',
        iconType: Clock
      };
    }
    if (result.isLate) {
      return {
        card: 'bg-amber-950/90 border-amber-300/25 shadow-[0_26px_85px_-48px_rgba(245,158,11,0.72)]',
        badge: 'bg-amber-400/10 text-amber-100 border border-amber-300/25',
        badgeText: 'متأخر',
        dot: 'bg-amber-300',
        iconColor: 'text-amber-200',
        iconType: AlertTriangle
      };
    }
    return {
      card: 'bg-emerald-950/90 border-emerald-300/25 shadow-[0_26px_85px_-48px_rgba(16,185,129,0.72)]',
      badge: 'bg-emerald-400/10 text-emerald-100 border border-emerald-300/25',
      badgeText: 'حضور مبكر',
      dot: 'bg-emerald-300',
      iconColor: 'text-emerald-200',
      iconType: CheckCircle
    };
  };

  const resultStyles = buildResultStyles(attendanceResult);

  const cameraScanModal = cameraScanOpen && (
    <div
      className="fixed inset-0 z-[160] flex flex-col bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={() => setCameraScanOpen(false)}
    >
      {/* Top: Camera Feed (compact when result showing) */}
      <div
        className="relative w-full flex-shrink-0 transition-all duration-500"
        style={{ height: attendanceResult ? '35vh' : '60vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setCameraScanOpen(false)}
          className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-all backdrop-blur-sm"
        >
          <X className="w-5 h-5" />
        </button>
        <video ref={cameraVideoRef} className="w-full h-full object-cover" playsInline muted />
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-4 border-2 border-emerald-400/30 rounded-2xl" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1/2 h-1/2 border-2 border-emerald-400/60 rounded-xl" />
          </div>
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          {!cameraReady && !cameraScanError ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm">
              <Loader2 className="w-4 h-4 animate-spin text-white/70" />
              <span className="text-sm text-white/70">جاري تشغيل الكاميرا...</span>
            </div>
          ) : cameraScanError ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 border border-red-500/40 backdrop-blur-sm">
              <span className="text-sm text-red-300">{cameraScanError}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm border border-emerald-500/30">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              <span className="text-sm text-emerald-200 font-medium">جاهز للمسح</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Student Result Card (slides up when available) */}
      {attendanceResult && (
        <div className="flex-1 overflow-auto p-4 animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
          <div className={`relative w-full max-w-lg mx-auto overflow-hidden rounded-[2rem] ${KIOSK_RESULT_SURFACE} ${resultStyles?.card || ''}`}>
            {attendanceResult.type === 'success' && attendanceResult.student ? (
              <>
                <div className="p-5 pb-3 text-center">
                  <div className={`w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center ${attendanceResult.mode === 'duplicate' ? 'bg-cyan-500/20 ring-4 ring-cyan-500/30' : attendanceResult.isLate ? 'bg-amber-500/20 ring-4 ring-amber-500/30' : 'bg-emerald-500/20 ring-4 ring-emerald-500/30'}`}>
                    {resultStyles?.iconType && <resultStyles.iconType className={`w-8 h-8 ${resultStyles.iconColor}`} />}
                  </div>
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold mb-3 ${resultStyles?.badge || ''}`}>
                    <span className={`w-2 h-2 rounded-full ${resultStyles?.dot} animate-pulse`} />
                    {resultStyles?.badgeText}
                  </div>
                  <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-white mb-1">{attendanceResult.student.name}</h2>
                  <p className="text-base text-white/70">{attendanceResult.student.class_name} - {attendanceResult.student.section}</p>
                </div>
                <div className={`mx-5 p-3 rounded-xl text-center mb-3 ${attendanceResult.mode === 'duplicate' ? 'bg-cyan-500/10 border border-cyan-500/20' : attendanceResult.isLate ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
                  <p className={`text-base font-medium ${attendanceResult.mode === 'duplicate' ? 'text-cyan-100' : attendanceResult.isLate ? 'text-amber-200' : 'text-emerald-200'}`}>{attendanceResult.message}</p>
                </div>
                {settings?.show_stats && attendanceResult.stats && (
                  <div className="px-5 pb-3 pt-1">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-black/20 border border-white/10">
                        <p className="text-xl font-bold text-white font-mono">{attendanceResult.stats.late_count}</p>
                        <p className="text-[10px] text-white/50">مرات التأخر</p>
                      </div>
                      <div className="p-2 rounded-lg bg-black/20 border border-white/10">
                        <p className="text-xl font-bold text-white font-mono">{attendanceResult.stats.todayMinutes}</p>
                        <p className="text-[10px] text-white/50">تأخر اليوم</p>
                      </div>
                      <div className="p-2 rounded-lg bg-black/20 border border-white/10">
                        <p className="text-xl font-bold text-white font-mono">{attendanceResult.stats.totalMinutes}</p>
                        <p className="text-[10px] text-white/50">إجمالي (د)</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="p-6 text-center">
                <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-red-500/20 ring-4 ring-red-500/30 flex items-center justify-center">
                  <X className="w-8 h-8 text-red-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">خطأ</h2>
                <p className="text-base text-red-200">{attendanceResult.message}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const toggleInputVisibility = () => {
    setInputVisible((prev) => !prev);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 p-6">
        <div className={`w-full max-w-sm rounded-[2rem] p-6 text-center text-white ${KIOSK_SURFACE}`}>
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-300/10">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-100" />
          </div>
          <p className="font-semibold tracking-tight">جاري التحقق من الصلاحيات...</p>
          <div className="mt-5 space-y-2">
            <div className="h-2 rounded-full bg-white/10" />
            <div className="mx-auto h-2 w-2/3 rounded-full bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (initStatus === 'loading') {
    return (
      <div className={`min-h-[100dvh] flex items-center justify-center p-6 ${theme.bg}`}>
        <div className={`w-full max-w-md rounded-[2rem] p-6 text-center ${theme.isDark ? `text-white ${KIOSK_SURFACE}` : `text-slate-900 ${KIOSK_LIGHT_SURFACE}`}`}>
          <div className={`mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border ${theme.isDark ? 'border-cyan-200/20 bg-cyan-300/10' : 'border-cyan-200 bg-cyan-50'}`}>
            <Loader2 className={`w-6 h-6 animate-spin ${theme.isDark ? 'text-cyan-100' : 'text-cyan-700'}`} />
          </div>
          <p className="font-semibold tracking-tight">جاري تهيئة وضع الكشك...</p>
          <div className="mt-5 grid gap-2">
            <div className={`${theme.isDark ? 'bg-white/10' : 'bg-slate-200'} h-2 rounded-full`} />
            <div className={`${theme.isDark ? 'bg-white/10' : 'bg-slate-200'} mx-auto h-2 w-3/4 rounded-full`} />
            <div className={`${theme.isDark ? 'bg-white/10' : 'bg-slate-200'} mx-auto h-2 w-1/2 rounded-full`} />
          </div>
        </div>
      </div>
    );
  }

  if (initStatus === 'error') {
    return (
      <div className={`min-h-[100dvh] flex items-center justify-center p-6 ${theme.bg}`}>
        <div className={`w-full max-w-md rounded-[2rem] p-6 text-center text-white space-y-4 ${KIOSK_SURFACE} border-rose-300/25 bg-rose-950/80`}>
          <AlertTriangle className="w-9 h-9 mx-auto text-rose-200" />
          <p className="font-semibold tracking-tight">تعذر تهيئة وضع الكشك</p>
          <p className="text-sm leading-6 text-rose-100/80">{initMessage || 'لا توجد بيانات محلية ولا يوجد اتصال متاح'}</p>
          <button
            onClick={runPreload}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 active:translate-y-px transition"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  // buildResultStyles and resultStyles are declared above cameraScanModal

  return (
    <div
      id="kiosk-root"
      ref={kioskRootRef}
      className={`min-h-[100dvh] flex flex-col items-center justify-center p-4 overflow-hidden relative ${theme.bg} kiosk-rotate-none`}
      onClick={() => inputRef.current?.focus()}
    >
      {screensaver}
      {popupOverlay}
      {cameraScanModal}

      {/* ═══════════════════════════════════════════════════════════════
          🎛️ FLOATING CONTROL PANEL - All Controls in One Place
          ═══════════════════════════════════════════════════════════════ */}
      {/* Toggle Button - Always Visible */}
      <button
        onClick={(e) => { e.stopPropagation(); setControlPanelOpen(!controlPanelOpen); }}
        className={`fixed top-4 right-4 z-[100] p-3 rounded-xl border backdrop-blur-md shadow-lg transition-all ${theme.isDark
          ? 'bg-slate-900/80 border-slate-700/50 text-cyan-400 hover:bg-slate-800/90 hover:border-cyan-500/50'
          : 'bg-white/90 border-slate-300 text-cyan-600 hover:bg-white hover:border-cyan-400'
          }`}
        title={controlPanelOpen ? 'إخفاء لوحة التحكم' : 'إظهار لوحة التحكم'}
      >
        {controlPanelOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <div className="relative">
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
            <Monitor className="w-5 h-5" />
          </div>
        )}
      </button>

      {/* Control Panel Window */}
      {controlPanelOpen && (
        <div
          ref={controlPanelRef}
          className={`fixed z-[90] rounded-2xl border backdrop-blur-2xl shadow-2xl transition-all duration-300 ${theme.isDark
            ? 'bg-slate-900/95 border-slate-700/50'
            : 'bg-white/95 border-slate-300'
            }`}
          style={{
            left: `${controlPanelPosition.x}px`,
            top: `${controlPanelPosition.y}px`,
            width: controlPanelMinimized ? '320px' : '340px',
            height: controlPanelMinimized ? '60px' : 'auto',
            maxHeight: controlPanelMinimized ? '60px' : '600px',
            overflow: controlPanelMinimized ? 'hidden' : 'visible'
          }}
        >
          {/* Header - Draggable */}
          <div
            ref={controlPanelHeaderRef}
            onMouseDown={handlePanelDragStart}
            className={`flex items-center justify-between p-4 border-b cursor-move ${theme.isDark ? 'border-slate-700/50' : 'border-slate-200'
              }`}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${theme.isDark ? 'bg-cyan-400' : 'bg-cyan-500'
                } animate-pulse`}></div>
              <h3 className={`font-bold text-sm ${theme.isDark ? 'text-white' : 'text-slate-900'
                }`}>
                لوحة التحكم
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setControlPanelMinimized(!controlPanelMinimized); }}
                className={`p-1.5 rounded-lg transition-all ${theme.isDark
                  ? 'hover:bg-slate-800 text-slate-400 hover:text-white'
                  : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                title={controlPanelMinimized ? 'تكبير' : 'تصغير'}
              >
                {controlPanelMinimized ? (
                  <Maximize2 className="w-4 h-4" />
                ) : (
                  <Minimize2 className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setControlPanelOpen(false); }}
                className={`p-1.5 rounded-lg transition-all ${theme.isDark
                  ? 'hover:bg-red-500/20 text-slate-400 hover:text-red-400'
                  : 'hover:bg-red-50 text-slate-600 hover:text-red-600'
                  }`}
                title="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content - Hidden when minimized */}
          {!controlPanelMinimized && (
            <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto">
              {/* Connection/Sync Status */}
              <div className={`p-3 rounded-xl border backdrop-blur-sm ${theme.isDark
                ? db.getMode() === 'local'
                  ? 'bg-blue-500/10 border-blue-500/30'
                  : 'bg-cyan-500/10 border-cyan-500/30'
                : db.getMode() === 'local'
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-sky-50 border-sky-200'
                }`}>
                {db.getMode() === 'local' ? (
                  <div className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></span>
                    <div className="flex flex-col flex-1">
                      <span className={`text-xs font-semibold flex items-center gap-2 ${theme.isDark ? 'text-blue-100' : 'text-blue-900'
                        }`}>
                        الوضع المحلي نشط
                        <Wifi className="w-3.5 h-3.5" />
                      </span>
                      <span className={`text-[10px] ${theme.isDark ? 'text-blue-200/70' : 'text-blue-700/70'
                        }`}>
                        جميع البيانات محفوظة محلياً
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full transition-all ${syncState.status === 'online'
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                      : syncState.status === 'syncing'
                        ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                        : 'bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.6)]'
                      }`}></span>
                    <div className="flex flex-col flex-1">
                      <span className={`text-xs font-semibold flex items-center gap-2 ${theme.isDark ? 'text-cyan-100' : 'text-sky-900'
                        }`}>
                        {syncState.status === 'online' && 'متصل – المزامنة فعّالة'}
                        {syncState.status === 'syncing' && 'جاري المزامنة...'}
                        {syncState.status === 'offline' && 'غير متصل – التسجيل محلياً فقط'}
                        {syncState.status === 'error' && 'خطأ في المزامنة'}
                        {syncState.status === 'idle' && 'تهيئة المزامنة'}
                        <Wifi className="w-3.5 h-3.5" />
                      </span>
                      {syncState.pending > 0 && (
                        <span className={`text-[10px] ${theme.isDark ? 'text-amber-200/80' : 'text-amber-700/80'
                          }`}>
                          {syncState.pending} سجل في الانتظار
                        </span>
                      )}
                    </div>
                    {(syncState.status === 'offline' || syncState.status === 'error') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleRetrySync(); }}
                        disabled={syncRetrying}
                        className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${theme.isDark
                          ? 'border-amber-400/40 hover:bg-amber-400/10 text-amber-300'
                          : 'border-amber-500/40 hover:bg-amber-100 text-amber-700'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {syncRetrying ? 'جاري الاتصال...' : 'إعادة المحاولة'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Survey Toggle */}
              <div className={`p-3 rounded-xl border backdrop-blur-sm ${theme.isDark
                ? 'bg-slate-800/50 border-slate-700/50'
                : 'bg-slate-50 border-slate-200'
                }`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className={`text-xs font-semibold ${theme.isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                      استطلاع الحضور
                    </span>
                    <span className={`text-[10px] ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      عرض مؤشرات الحضور اليومية
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleSurvey(); }}
                    className={`text-[10px] px-3 py-1.5 rounded-lg border transition-all ${theme.isDark
                      ? surveyOpen
                        ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
                        : 'border-slate-600 text-slate-300 hover:bg-slate-700/50'
                      : surveyOpen
                        ? 'border-cyan-400 bg-cyan-50 text-cyan-700'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                      }`}
                  >
                    {surveyOpen ? 'إخفاء' : 'تفعيل'}
                  </button>
                </div>
                {surveyOpen && (
                  <div className={`mt-3 rounded-xl border px-3 py-3 text-xs ${theme.isDark ? 'border-white/10 bg-black/30 text-white/80' : 'border-slate-200 bg-white text-slate-600'
                    }`}>
                    {surveyLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        جاري تحميل بيانات الحضور...
                      </div>
                    ) : surveyStats ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`px-2.5 py-1 rounded-full border ${theme.isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-100'}`}>
                            إجمالي الطلاب: <span className="font-mono">{surveyStats.total}</span>
                          </span>
                          <span className={`px-2.5 py-1 rounded-full border ${theme.isDark ? 'border-emerald-400/30 bg-emerald-500/10' : 'border-emerald-200 bg-emerald-50'}`}>
                            حضور اليوم: <span className="font-mono">{surveyStats.present + surveyStats.late}</span>
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                          <div className={`rounded-lg border px-2 py-2 ${theme.isDark ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                            <div>عدد المبكرين</div>
                            <div className={`text-lg font-bold ${theme.isDark ? 'text-white' : 'text-slate-900'} font-mono mt-1`}>{surveyStats.present}</div>
                          </div>
                          <div className={`rounded-lg border px-2 py-2 ${theme.isDark ? 'border-amber-400/20 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                            <div>عدد المتأخرين</div>
                            <div className={`text-lg font-bold ${theme.isDark ? 'text-white' : 'text-slate-900'} font-mono mt-1`}>{surveyStats.late}</div>
                          </div>
                          <div className={`rounded-lg border px-2 py-2 ${theme.isDark ? 'border-red-400/20 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
                            <div>عدد الغياب</div>
                            <div className={`text-lg font-bold ${theme.isDark ? 'text-white' : 'text-slate-900'} font-mono mt-1`}>{surveyStats.absent}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={theme.isDark ? 'text-red-200' : 'text-red-600'}>
                        تعذر تحميل بيانات الحضور حالياً.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {settings?.camera_scan_enabled && (
                <div className={`p-3 rounded-xl border backdrop-blur-sm ${theme.isDark
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-emerald-50 border-emerald-200'
                  }`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Camera className={`w-4 h-4 ${theme.isDark ? 'text-emerald-300' : 'text-emerald-600'}`} />
                      <div className="flex flex-col">
                        <span className={`text-xs font-semibold ${theme.isDark ? 'text-emerald-100' : 'text-emerald-900'}`}>
                          مسح بالكاميرا
                        </span>
                        <span className={`text-[10px] ${theme.isDark ? 'text-emerald-200/70' : 'text-emerald-700/70'}`}>
                          {isBarcodeDetectorSupported ? 'جاهز للمسح السريع' : 'المتصفح لا يدعم المسح'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setCameraScanOpen(true); }}
                      disabled={!isBarcodeDetectorSupported}
                      className={`text-[10px] px-3 py-1.5 rounded-lg border transition-all ${isBarcodeDetectorSupported
                        ? theme.isDark
                          ? 'border-emerald-400/40 hover:bg-emerald-400/10 text-emerald-200'
                          : 'border-emerald-300 hover:bg-emerald-100 text-emerald-700'
                        : theme.isDark
                          ? 'border-slate-600 text-slate-400 cursor-not-allowed'
                          : 'border-slate-300 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                      بدء المسح
                    </button>
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════════════════════════
                  🚨 Emergency Mode Control - وضع الطوارئ
                  ═══════════════════════════════════════════════════════════════ */}
              <div className={`p-3 rounded-xl border backdrop-blur-sm transition-all ${theme.isDark
                ? emergencyMode
                  ? 'bg-orange-500/20 border-orange-500/50 shadow-[0_0_15px_rgba(249,115,22,0.3)]'
                  : 'bg-slate-800/50 border-slate-700/50'
                : emergencyMode
                  ? 'bg-orange-100 border-orange-400 shadow-lg'
                  : 'bg-slate-50 border-slate-200'
                }`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Zap className={`w-4 h-4 ${emergencyMode
                      ? 'text-orange-400 animate-pulse'
                      : theme.isDark ? 'text-slate-400' : 'text-slate-500'
                      }`} />
                    <div className="flex flex-col">
                      <span className={`text-xs font-semibold ${emergencyMode
                        ? theme.isDark ? 'text-orange-200' : 'text-orange-800'
                        : theme.isDark ? 'text-slate-100' : 'text-slate-900'
                        }`}>
                        وضع الطوارئ
                      </span>
                      <span className={`text-[10px] ${emergencyMode
                        ? theme.isDark ? 'text-orange-300/70' : 'text-orange-600/70'
                        : theme.isDark ? 'text-slate-400' : 'text-slate-500'
                        }`}>
                        {emergencyMode ? 'مفعّل - يقبل أي باركود' : 'معطّل - الوضع الآمن'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {emergencyQueue.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEmergencyPanelOpen(true); }}
                        className={`relative text-[10px] px-2 py-1 rounded-lg border transition-all ${theme.isDark
                          ? 'border-orange-400/40 bg-orange-500/10 text-orange-200 hover:bg-orange-400/20'
                          : 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                          }`}
                        title="عرض قائمة الطوارئ"
                      >
                        <List className="w-3 h-3 inline-block ml-1" />
                        {emergencyQueue.filter(e => !e.resolved).length}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setEmergencyMode(!emergencyMode); }}
                      className={`text-[10px] px-3 py-1.5 rounded-lg border transition-all font-bold ${emergencyMode
                        ? theme.isDark
                          ? 'border-red-400/60 bg-red-500/20 text-red-200 hover:bg-red-500/30'
                          : 'border-red-400 bg-red-100 text-red-700 hover:bg-red-200'
                        : theme.isDark
                          ? 'border-orange-400/40 hover:bg-orange-400/10 text-orange-300'
                          : 'border-orange-300 hover:bg-orange-100 text-orange-700'
                        }`}
                    >
                      {emergencyMode ? 'إيقاف' : 'تفعيل'}
                    </button>
                  </div>
                </div>
                {emergencyMode && (
                  <div className={`mt-2 text-[10px] px-2 py-1.5 rounded-lg ${theme.isDark
                    ? 'bg-orange-500/10 text-orange-200/80'
                    : 'bg-orange-50 text-orange-700'
                    }`}>
                    <AlertTriangle className="w-3 h-3 inline-block ml-1" />
                    تنبيه: سيتم قبول جميع الباركودات حتى غير المسجلة
                  </div>
                )}
              </div>

              {/* Header Image Size Control */}
              {settings?.header_image && (
                <div className={`p-3 rounded-xl border backdrop-blur-sm ${theme.isDark
                  ? 'bg-slate-800/50 border-slate-700/50'
                  : 'bg-slate-50 border-slate-200'
                  }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-semibold ${theme.isDark ? 'text-slate-300' : 'text-slate-700'
                      }`}>
                      حجم صورة الهيدر
                    </span>
                    <span className={`text-xs font-mono ${theme.isDark ? 'text-cyan-400' : 'text-cyan-600'
                      }`}>
                      {headerImageSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="200"
                    step="10"
                    value={headerImageSize}
                    onChange={(e) => setHeaderImageSize(Number(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    style={{
                      background: theme.isDark
                        ? 'linear-gradient(to right, rgb(6 182 212 / 0.3) 0%, rgb(6 182 212 / 0.3) ' + (headerImageSize - 40) / 160 * 100 + '%, rgb(51 65 85) ' + (headerImageSize - 40) / 160 * 100 + '%, rgb(51 65 85) 100%)'
                        : 'linear-gradient(to right, rgb(6 182 212 / 0.5) 0%, rgb(6 182 212 / 0.5) ' + (headerImageSize - 40) / 160 * 100 + '%, rgb(226 232 240) ' + (headerImageSize - 40) / 160 * 100 + '%, rgb(226 232 240) 100%)'
                    }}
                  />
                  <div className="flex justify-between mt-1">
                    <span className={`text-[10px] ${theme.isDark ? 'text-slate-500' : 'text-slate-500'}`}>صغير</span>
                    <span className={`text-[10px] ${theme.isDark ? 'text-slate-500' : 'text-slate-500'}`}>كبير</span>
                  </div>
                </div>
              )}

              {/* Toggle Input Visibility */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleInputVisibility(); }}
                className={`w-full flex items-center justify-between p-3 rounded-xl border backdrop-blur-sm transition-all ${theme.isDark
                  ? inputVisible
                    ? 'bg-white/10 border-white/20 text-gray-100'
                    : 'bg-white/5 border-white/10 text-gray-300'
                  : inputVisible
                    ? 'bg-black/10 border-black/20 text-gray-700'
                    : 'bg-black/5 border-black/10 text-gray-500'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <Keyboard className="w-4 h-4" />
                  <span className="text-xs font-semibold">
                    {inputVisible ? 'إخفاء حقل الإدخال' : 'إظهار حقل الإدخال'}
                  </span>
                </div>
                <div className={`w-2 h-2 rounded-full transition-all ${inputVisible
                  ? theme.isDark ? 'bg-cyan-400' : 'bg-cyan-500'
                  : theme.isDark ? 'bg-slate-600' : 'bg-slate-400'
                  }`}></div>
              </button>

              {/* Badge Showcase Toggle */}
              <button
                onClick={() => setShowBadgeShowcase(!showBadgeShowcase)}
                className={`p-3 rounded-xl transition-all ${showBadgeShowcase
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.3)]'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-white/5'
                  }`}
                title={showBadgeShowcase ? "إيقاف عرض الأوسمة" : "عرض الأوسمة والإعلانات"}
              >
                <Award className={`w-5 h-5 ${showBadgeShowcase ? 'animate-pulse' : ''}`} />
              </button>

              {/* Control Buttons Section */}
              <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/5">
                {/* Action Buttons */}
                <div className="flex gap-2 w-full">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExitRequest(); }}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border backdrop-blur-sm transition-all group ${theme.isDark
                      ? 'bg-slate-700/50 hover:bg-slate-600/50 border-slate-600/50 text-slate-300 hover:text-white'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900'
                      }`}
                    title="الرئيسية"
                  >
                    <Home className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold">الرئيسية</span>
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleLogoutRequest(); }}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border backdrop-blur-sm transition-all group ${theme.isDark
                      ? 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20 text-red-400 hover:text-red-300'
                      : 'bg-red-50 hover:bg-red-100 border-red-200 text-red-600 hover:text-red-700'
                      }`}
                    title="تسجيل الخروج"
                  >
                    <LogOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold">خروج</span>
                  </button>
                </div>

                {/* Rotation Controls (Hidden in embedded mode) */}
                {!isEmbedded && (
                  <div className={`p-2 rounded-xl border backdrop-blur-sm ${theme.isDark
                    ? 'bg-slate-800/50 border-slate-700/50'
                    : 'bg-slate-50 border-slate-200'
                    }`}>
                    <p className={`text-[10px] font-semibold mb-2 px-2 ${theme.isDark ? 'text-slate-400' : 'text-slate-600'
                      }`}>
                      تدوير الشاشة
                    </p>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRotation('none'); }}
                        className={`flex-1 p-2 rounded-lg transition-all ${rotation === 'none'
                          ? theme.isDark ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'bg-cyan-100 text-cyan-600'
                          : theme.isDark ? 'text-slate-400 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        title="وضع عادي"
                      >
                        <Monitor className="w-4 h-4 mx-auto" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRotation('right'); }}
                        className={`flex-1 p-2 rounded-lg transition-all ${rotation === 'right'
                          ? theme.isDark ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'bg-cyan-100 text-cyan-600'
                          : theme.isDark ? 'text-slate-400 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        title="تدوير يمين (90°)"
                      >
                        <RotateCw className="w-4 h-4 mx-auto" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRotation('left'); }}
                        className={`flex-1 p-2 rounded-lg transition-all ${rotation === 'left'
                          ? theme.isDark ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'bg-cyan-100 text-cyan-600'
                          : theme.isDark ? 'text-slate-400 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        title="تدوير يسار (-90°)"
                      >
                        <RotateCcw className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div >
          )}
        </div>
      )}

      {/* Header Image (if exists) - Dynamic Size */}
      {
        settings?.header_image && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40">
            <img
              src={settings.header_image}
              alt="Header"
              className={`rounded-xl ${theme.isDark ? 'border-white/20' : 'border-black/10'} border shadow-lg transition-all duration-300`}
              style={{
                height: `${headerImageSize}px`,
                width: 'auto',
                maxWidth: '100vw'
              }}
            />
          </div>
        )
      }

      {/* Dynamic Background Blobs */}
      <div className="absolute inset-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className={`absolute -top-32 left-[8%] h-[42rem] w-[42rem] ${theme.blob1} rounded-full blur-[150px] opacity-60 animate-pulse-slow`}></div>
        <div className={`absolute -bottom-36 right-[6%] h-[34rem] w-[34rem] ${theme.blob2} rounded-full blur-[130px] opacity-50 animate-blob`}></div>
      </div>

      {/* Grid Pattern Overlay */}
      <div className={`absolute inset-0 ${theme.isDark ? KIOSK_DOT_PATTERN : KIOSK_DOT_PATTERN_LIGHT} ${theme.isDark ? 'opacity-20' : 'opacity-30'} z-[1] pointer-events-none`}></div>
      <div className={`absolute inset-0 z-[1] pointer-events-none ${theme.isDark ? 'bg-[linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.55))]' : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(248,250,252,0.70))]'}`}></div>

      {
        initStatus === 'ready' && initMessage && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40">
            <div className="glass-card border border-amber-400/40 bg-amber-900/50 text-amber-100 px-4 py-2 rounded-2xl text-sm">
              {initMessage}
            </div>
          </div>
        )
      }

      <div className="w-full max-w-6xl text-center space-y-9 relative z-10">
        <div className="space-y-4">
          {/* Logo with Glass Frame */}
          <div className="flex items-center justify-center mb-6">
            <div className={`relative overflow-hidden rounded-[2rem] ${theme.isDark ? KIOSK_SURFACE : KIOSK_LIGHT_SURFACE} ${settings?.display_settings?.title_size === 'sm' ? 'p-4' : 'p-5'}`}>
              <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"></div>
              <img
                src="/images/hader-logo.png"
                alt="حاضر"
                className={`relative object-contain drop-shadow-[0_18px_30px_rgba(15,23,42,0.38)] ${settings?.display_settings?.title_size === 'sm' ? 'h-14' : 'h-20'}`}
                onError={(e) => { e.currentTarget.parentElement!.style.display = 'none'; }}
              />
            </div>
          </div>

          {/* Dynamic Title Size */}
          <h1 className={`
            font-semibold mb-3 tracking-tight leading-tight
            ${TITLE_SIZE_CLASSES[settings?.display_settings?.title_size || 'lg']}
            ${theme.isDark
              ? 'text-white drop-shadow-[0_16px_38px_rgba(15,23,42,0.45)]'
              : `text-slate-950`
            }
            transition-all duration-300
          `}>
            {settings?.main_title || 'تسجيل الحضور'}
          </h1>
          <p className={`${theme.subText} mx-auto max-w-2xl font-medium leading-7 flex items-center justify-center gap-2 mb-7 ${settings?.display_settings?.title_size === 'sm' ? 'text-sm md:text-base' : 'text-lg md:text-xl'
            }`}>
            {settings?.sub_title || 'يرجى تمرير البطاقة أو إدخال الرقم المعرف'}
          </p>

          {shouldShowSchoolInfo && (
            <div className={`mx-auto max-w-xl rounded-3xl border backdrop-blur-xl px-6 py-4 mb-6 ${theme.isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-white/70'
              }`}>
              {show_school_name && settings?.school_name && (
                <div className={`flex items-center justify-center gap-2 text-xl font-bold mb-2 ${theme.isDark ? 'text-white' : 'text-slate-900'
                  }`}>
                  <Building className="w-5 h-5 text-cyan-300" />
                  <span>{settings.school_name}</span>
                </div>
              )}
              {show_principal_name && settings?.principal_name && (
                <div className={`flex items-center justify-center gap-2 text-sm ${theme.isDark ? 'text-cyan-100' : 'text-cyan-700'
                  }`}>
                  <UserCircle className={`w-4 h-4 ${theme.isDark ? 'text-blue-300' : 'text-blue-500'}`} />
                  <span>مدير المدرسة: <span className={`${theme.isDark ? 'text-white' : 'text-slate-900'} font-semibold`}>{settings.principal_name}</span></span>
                </div>
              )}
            </div>
          )}

          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 md:grid-cols-4">
            {kioskStatusTiles.map(({ label, value, helper, icon: StatusIcon, tone }) => (
              <div
                key={label}
                className={`min-h-[112px] rounded-2xl px-4 py-3 text-right transition duration-300 ${theme.isDark ? KIOSK_MUTED_SURFACE : 'border border-slate-200/70 bg-white/75 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.25)] backdrop-blur-xl'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <StatusIcon className={`h-4 w-4 ${tone}`} />
                  <span className={`text-[11px] font-semibold ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {label}
                  </span>
                </div>
                <p className={`mt-3 text-lg font-semibold tracking-tight ${theme.isDark ? tone : 'text-slate-950'}`}>
                  {value}
                </p>
                <p className={`mt-1 text-xs leading-5 ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {helper}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Large Clock Display - Dynamic Size */}
        {/* Large Clock Display - Dynamic Size (HERO STYLE) */}
        <div
          className={`w-full mx-auto mb-10 ${settings?.display_settings?.card_size === 'sm' ? 'max-w-md' : 'max-w-3xl'
            }`}
          style={{
            width: kioskCardSize.width ? `${kioskCardSize.width}%` : undefined,
            minHeight: kioskCardSize.height ? `${kioskCardSize.height}vh` : undefined
          }}
        >
          <div className={`
            relative text-center rounded-[2.25rem] border transition-all duration-500 backdrop-blur-2xl
            ${CARD_SIZE_CLASSES[settings?.display_settings?.card_size || 'md'].padding}
            ${theme.isDark ? kioskPhase.card : kioskPhase.lightCard}
            group overflow-hidden
          `}>
            <div className={`pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[70px] opacity-80 transition-all duration-700 animate-pulse-slow ${kioskPhase.halo}`}></div>

            {/* Glass Reflections */}
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-70"></div>
            <div className="absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-50"></div>
            <div className="absolute -inset-full bg-gradient-to-tr from-transparent via-white/[0.045] to-transparent rotate-45 pointer-events-none animation-shine"></div>

            {/* Status indicator */}
            <div className={`
              absolute top-4 right-4 md:top-6 md:right-6 flex items-center gap-2 px-4 py-1.5 rounded-full border font-semibold tracking-tight
              ${CARD_SIZE_CLASSES[settings?.display_settings?.card_size || 'md'].text}
              ${theme.isDark ? kioskPhase.badge : kioskPhase.badgeLight}
              backdrop-blur-md
            `}>
              <span className={`w-2.5 h-2.5 rounded-full ${kioskPhase.dot} animate-pulse`}></span>
              {kioskPhase.label}
            </div>

            {/* Time Display - Dynamic Size */}
            <div className={`
              font-mono font-black tracking-[0.08em] my-6 tabular-nums
              ${CLOCK_SIZE_CLASSES[settings?.display_settings?.clock_size || 'lg']}
              ${theme.isDark ? kioskPhase.time : kioskPhase.timeLight}
              ${kioskPhase.timeGlow}
              select-none
            `}>
              {currentTime.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>

            {/* Date Display */}
            <div className={`mt-2 font-medium ${CARD_SIZE_CLASSES[settings?.display_settings?.card_size || 'md'].text} ${theme.isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              {currentTime.toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>

            {/* Assembly Time Info */}
            {settings?.assembly_time && (
              <div className={`mt-6 inline-block rounded-xl border px-4 py-2 text-sm backdrop-blur-md ${theme.isDark ? kioskPhase.badge : kioskPhase.badgeLight}`}>
                الطابور: <span className="font-bold font-mono">{settings.assembly_time}</span>
                {settings.grace_period ? <span className="opacity-80"> • سماح: {settings.grace_period} د</span> : ''}
                {settings.absence_time ? <span className="mx-2 opacity-40">|</span> : ''}
                {settings.absence_time && <span>الغياب: <span className={`font-bold font-mono ${theme.isDark ? 'text-rose-200' : 'text-rose-600'}`}>{settings.absence_time}</span></span>}
              </div>
            )}
          </div>
        </div>

        {!kioskDayState.allowsAttendance && (
          <section className={`mx-auto max-w-3xl rounded-[1.75rem] border px-6 py-5 text-right backdrop-blur-xl ${theme.isDark ? 'border-sky-300/25 bg-sky-950/35 text-sky-50' : 'border-sky-200 bg-sky-50/90 text-sky-950'}`}>
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border ${theme.isDark ? 'border-sky-300/25 bg-sky-400/10' : 'border-sky-200 bg-white'}`}>
                <Calendar className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide opacity-70">استقبال الحضور متوقف اليوم</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight">{kioskDayState.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 opacity-80">{kioskDayState.helper}</p>
              </div>
            </div>
          </section>
        )}

        {/* Hidden barcode gun form - captures scanner input without showing manual input UI */}
        {kioskDayState.allowsAttendance && !inputVisible && (
          <form onSubmit={handleSubmit} className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none">
            <input
              ref={inputRef}
              type="text"
              value={inputId}
              onChange={(e) => setInputId(e.target.value)}
              onBlur={handleBlur}
              disabled={loading || initStatus !== 'ready'}
              className="h-px w-px"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              tabIndex={-1}
            />
          </form>
        )}

        {/* Input Form - Only rendered when inputVisible is true */}
        {kioskDayState.allowsAttendance && inputVisible && (
          <form onSubmit={handleSubmit} className={`w-full mx-auto relative group ${settings?.display_settings?.input_size === 'sm' ? 'max-w-md' : 'max-w-3xl'}`}>
            <div className={`absolute -inset-px rounded-[1.8rem] blur-md opacity-40 transition duration-300 group-focus-within:opacity-70 ${theme.isDark ? 'bg-cyan-200/20' : 'bg-slate-300/60'}`}></div>

            <div className={`relative rounded-[1.8rem] p-1.5 overflow-hidden transition duration-300 ${theme.isDark ? `${KIOSK_SURFACE} border-cyan-200/20` : KIOSK_LIGHT_SURFACE}`}>
              {/* Animated Scan Line */}
              <div className={`absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent ${theme.isDark ? 'via-cyan-200/70' : 'via-cyan-600/40'} to-transparent animate-scan`}></div>

              {/* Icon */}
              <div className={`absolute left-8 top-1/2 -translate-y-1/2 ${theme.isDark ? 'text-cyan-100/80' : 'text-slate-400'} z-10`}>
                {loading ? <Loader2 className={`${CARD_SIZE_CLASSES[settings?.display_settings?.input_size || 'lg'].icon} animate-spin`} /> : <Scan className={`${CARD_SIZE_CLASSES[settings?.display_settings?.input_size || 'lg'].icon}`} />}
              </div>

              <input
                ref={inputRef}
                type="text"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                onBlur={handleBlur}
                onFocus={(e) => e.target.select()}
                disabled={loading || initStatus !== 'ready'}
                className={`w-full bg-transparent ${theme.isDark ? 'text-white' : 'text-slate-950'} text-center font-mono ${INPUT_SIZE_CLASSES[settings?.display_settings?.input_size || 'lg'].text} ${INPUT_SIZE_CLASSES[settings?.display_settings?.input_size || 'lg'].padding} outline-none ${theme.isDark ? 'placeholder-slate-500/50 focus:text-cyan-100' : 'placeholder-slate-300 focus:text-slate-950'} tracking-[0.35em] disabled:opacity-50 transition-all duration-300`}
                placeholder="أدخل رقم الطالب"
                autoComplete="off"
                autoFocus
                spellCheck={false}
              />
            </div>
          </form>
        )}

        {kioskDayState.allowsAttendance && settings?.camera_scan_enabled && (
          <div className="flex justify-center mt-4">
            <button
              type="button"
              onClick={() => setCameraScanOpen(true)}
              disabled={!isBarcodeDetectorSupported}
              className={`inline-flex items-center gap-2 rounded-2xl border px-6 py-3 text-sm font-semibold transition duration-200 hover:-translate-y-0.5 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${theme.isDark ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
            >
              <Camera className="w-5 h-5" />
              مسح بالكاميرا
            </button>
          </div>
        )}

        {/* Enhanced Attendance Result Card - only show as overlay when camera is NOT open */}
        {attendanceResult && !cameraScanOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={dismissResult}>
            <div
              className={`relative w-full max-w-lg overflow-hidden rounded-[2rem] transform transition-all duration-500 ease-out animate-fade-in-up ${KIOSK_RESULT_SURFACE} ${resultStyles?.card || ''}`}
              onClick={e => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                onClick={dismissResult}
                className="absolute top-4 left-4 p-2 rounded-full bg-black/20 hover:bg-black/40 text-white/60 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              {attendanceResult.type === 'success' && attendanceResult.student ? (
                <>
                  {/* Success Header */}
                  <div className="p-6 pb-4 text-center">
                    {/* Status Icon */}
                    <div className={`
                      w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center
                      ${attendanceResult.mode === 'duplicate'
                        ? 'bg-cyan-500/20 ring-4 ring-cyan-500/30'
                        : attendanceResult.isLate
                          ? 'bg-amber-500/20 ring-4 ring-amber-500/30'
                          : 'bg-emerald-500/20 ring-4 ring-emerald-500/30'
                      }
                    `}>
                      {resultStyles?.iconType ? (
                        <resultStyles.iconType className={`w-10 h-10 ${resultStyles.iconColor}`} />
                      ) : null}
                    </div>

                    {/* Status Badge */}
                    <div className={`
                      inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-4
                      ${resultStyles?.badge || ''}
                    `}>
                      <span className={`w-2 h-2 rounded-full ${resultStyles?.dot} animate-pulse`}></span>
                      {resultStyles?.badgeText}
                    </div>

                    {/* Student Name */}
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white mb-2">
                      {attendanceResult.student.name}
                    </h2>

                    {/* Class & Section */}
                    <p className="text-lg text-white/70">
                      {attendanceResult.student.class_name} - {attendanceResult.student.section}
                    </p>
                  </div>

                  {/* Motivational Message */}
                  <div className={`
                    mx-6 p-4 rounded-2xl text-center mb-4
                    ${attendanceResult.mode === 'duplicate'
                      ? 'bg-cyan-500/10 border border-cyan-500/20'
                      : attendanceResult.isLate
                        ? 'bg-amber-500/10 border border-amber-500/20'
                        : 'bg-emerald-500/10 border border-emerald-500/20'
                    }
                  `}>
                    <p className={`text-lg font-medium ${attendanceResult.mode === 'duplicate' ? 'text-cyan-100' : attendanceResult.isLate ? 'text-amber-200' : 'text-emerald-200'}`}>
                      {attendanceResult.message}
                    </p>
                  </div>

                  {attendanceResult.deliveryState && (
                    <div className={`mx-6 mb-4 flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold ${attendanceResult.deliveryState === 'queued'
                      ? 'border-amber-400/25 bg-amber-500/10 text-amber-100'
                      : attendanceResult.deliveryState === 'local'
                        ? 'border-sky-400/25 bg-sky-500/10 text-sky-100'
                        : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                      }`}>
                      {attendanceResult.deliveryState === 'queued' ? <Wifi className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                      {attendanceResult.deliveryState === 'queued'
                        ? 'حُفظ السجل على الجهاز وسيُرسل تلقائيًا عند عودة الاتصال.'
                        : attendanceResult.deliveryState === 'local'
                          ? 'حُفظ السجل في قاعدة هذا الجهاز.'
                          : 'حُفظ السجل والمزامنة تعمل.'}
                    </div>
                  )}

                  {/* Stats Section */}
                  {settings?.show_stats && attendanceResult.stats && (
                    <div className="p-6 pt-2 border-t border-white/10">
                      <p className="text-xs text-white/40 text-center mb-3 uppercase tracking-wider">إحصائيات الانضباط</p>
                      <div className="grid grid-cols-3 gap-3">
                        {/* Late Count */}
                        <div className="p-3 rounded-xl bg-black/20 border border-white/10 text-center">
                          <div className="flex items-center justify-center gap-1 mb-1">
                            <Calendar className="w-4 h-4 text-amber-400" />
                          </div>
                          <p className="text-2xl font-bold text-white font-mono">{attendanceResult.stats.late_count}</p>
                          <p className="text-xs text-white/50">مرات التأخر</p>
                        </div>

                        {/* Today Minutes */}
                        <div className="p-3 rounded-xl bg-black/20 border border-white/10 text-center">
                          <div className="flex items-center justify-center gap-1 mb-1">
                            <Clock className="w-4 h-4 text-blue-400" />
                          </div>
                          <p className="text-2xl font-bold text-white font-mono">{attendanceResult.stats.todayMinutes}</p>
                          <p className="text-xs text-white/50">تأخر اليوم (د)</p>
                        </div>

                        {/* Total Minutes */}
                        <div className="p-3 rounded-xl bg-black/20 border border-white/10 text-center">
                          <div className="flex items-center justify-center gap-1 mb-1">
                            <Timer className="w-4 h-4 text-purple-400" />
                          </div>
                          <p className="text-2xl font-bold text-white font-mono">{attendanceResult.stats.totalMinutes}</p>
                          <p className="text-xs text-white/50">إجمالي (د)</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Time */}
                  <div className="px-6 pb-4 text-center">
                    <p className="text-sm text-white/40">
                      {new Date().toLocaleTimeString('ar-SA')} • {new Date().toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                </>
              ) : attendanceResult.type === 'success' ? (
                <div className="p-8 text-center">
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-500/20 ring-4 ring-orange-500/20">
                    <Zap className="h-10 w-10 text-orange-300" />
                  </div>
                  <h2 className="mb-2 text-2xl font-black text-white">حُفظ في قائمة الطوارئ</h2>
                  <p className="mb-4 text-base leading-7 text-orange-100">{attendanceResult.message}</p>
                  <div className="rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                    لم يُسجل حضور طالب بعد؛ يجب ربط الرمز بطالب من لوحة الطوارئ.
                  </div>
                </div>
              ) : (
                /* Error Card */
                <div className="p-8 text-center">
                  {/* Error Icon */}
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-500/20 ring-4 ring-red-500/30 flex items-center justify-center">
                    <X className="w-10 h-10 text-red-400" />
                  </div>

                  {/* Error Title */}
                  <h2 className="text-2xl font-bold text-white mb-2">
                    {attendanceResult.mode === 'closed' ? 'استقبال الحضور متوقف' : 'تعذر التسجيل'}
                  </h2>

                  {/* Error Message */}
                  <p className="text-lg text-red-200 mb-4">{attendanceResult.message}</p>

                  {/* Instructions */}
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                    <p className="text-sm text-red-300">
                      {attendanceResult.mode === 'closed'
                        ? 'راجع التقويم أو حالة المدرسة من لوحة الإدارة.'
                        : 'حاول مرة أخرى أو راجع الإدارة.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Announcements Carousel */}
        {settings?.announcements_enabled && settings?.announcements_images && settings?.announcements_images.length > 0 && (
          <div className={`
            fixed z-40 left-0 right-0
            ${settings?.announcements_position === 'top' ? 'top-0 pt-4' : ''}
            ${settings?.announcements_position === 'center' ? 'top-1/2 -translate-y-1/2' : ''}
            ${settings?.announcements_position === 'bottom' ? 'bottom-0 pb-4' : 'bottom-0 pb-4'}
            flex items-center justify-center px-4
          `}>
            <div className="relative max-w-4xl w-full">
              {/* Announcement Content with Transition */}
              <div className={`
                relative w-full bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl rounded-2xl border border-white/20 shadow-2xl overflow-hidden
                transition-all duration-500 ease-in-out
                ${settings?.announcements_transition === 'fade' ? 'animate-fade-in' : ''}
                ${settings?.announcements_transition === 'zoom' ? 'animate-scale-in' : ''}
              `}>
                {/* Announcement Image */}
                <div className="relative w-full aspect-video md:aspect-[21/9]">
                  <img
                    src={settings?.announcements_images[currentAnnouncementIndex]}
                    alt={`Announcement ${currentAnnouncementIndex + 1}`}
                    className="w-full h-full object-cover"
                    key={currentAnnouncementIndex}
                  />

                  {/* Gradient Overlay for Text Readability */}
                  {(settings?.announcements_titles?.[currentAnnouncementIndex] || settings?.announcements_descriptions?.[currentAnnouncementIndex]) && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  )}

                  {/* Text Overlay */}
                  {(settings?.announcements_titles?.[currentAnnouncementIndex] || settings?.announcements_descriptions?.[currentAnnouncementIndex]) && (
                    <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
                      {settings?.announcements_titles?.[currentAnnouncementIndex] && (
                        <h3 className="text-2xl md:text-3xl font-bold text-white mb-2 drop-shadow-lg">
                          {settings?.announcements_titles[currentAnnouncementIndex]}
                        </h3>
                      )}
                      {settings?.announcements_descriptions?.[currentAnnouncementIndex] && (
                        <p className="text-base md:text-lg text-white/90 drop-shadow-lg">
                          {settings?.announcements_descriptions[currentAnnouncementIndex]}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Counter Badge */}
                  <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-sm text-white text-sm px-3 py-1 rounded-full font-medium">
                    {currentAnnouncementIndex + 1} / {settings?.announcements_images.length}
                  </div>
                </div>

                {/* Navigation Dots */}
                {settings?.announcements_images.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full">
                    {settings?.announcements_images.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCurrentAnnouncementIndex(idx)}
                        className={`transition-all duration-300 rounded-full ${idx === currentAnnouncementIndex
                          ? 'w-8 h-2 bg-white'
                          : 'w-2 h-2 bg-white/40 hover:bg-white/60'
                          }`}
                        aria-label={`Go to announcement ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}

                {/* Play/Pause Button */}
                {settings?.announcements_autoplay && settings?.announcements_images.length > 1 && (
                  <button
                    onClick={() => setAnnouncementsPaused(!announcementsPaused)}
                    className="absolute top-4 left-4 p-2 bg-black/60 backdrop-blur-sm hover:bg-black/80 rounded-full text-white transition-colors"
                    aria-label={announcementsPaused ? 'Play announcements' : 'Pause announcements'}
                  >
                    {announcementsPaused ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Navigation Arrows (for manual control) */}
                {settings?.announcements_images.length > 1 && (
                  <>
                    <button
                      onClick={() => setCurrentAnnouncementIndex((prev) => (prev - 1 + settings?.announcements_images!.length) % settings?.announcements_images!.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-3 bg-black/60 backdrop-blur-sm hover:bg-black/80 rounded-full text-white transition-colors"
                      aria-label="Previous announcement"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setCurrentAnnouncementIndex((prev) => (prev + 1) % settings?.announcements_images!.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-black/60 backdrop-blur-sm hover:bg-black/80 rounded-full text-white transition-colors"
                      aria-label="Next announcement"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Badge Showcase Overlay */}
      {
        showBadgeShowcase && (
          <div className="fixed inset-0 z-[60]">
            <BadgeShowcase isActive={showBadgeShowcase} />

            {/* Exit Button for Showcase */}
            <button
              onClick={() => setShowBadgeShowcase(false)}
              className="absolute top-8 right-8 z-[70] p-4 bg-black/50 hover:bg-black/70 text-white/50 hover:text-white rounded-full transition-all border border-white/10 backdrop-blur-md group"
            >
              <X className="w-8 h-8 group-hover:scale-110 transition-transform" />
            </button>
          </div>
        )
      }

      {/* ═══════════════════════════════════════════════════════════════
          🚨 Emergency Queue Modal - مودال قائمة الطوارئ
          ═══════════════════════════════════════════════════════════════ */}
      {
        emergencyPanelOpen && (
          <div
            className="fixed inset-0 z-[180] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setEmergencyPanelOpen(false)}
          >
            <div
              className={`w-full max-w-2xl max-h-[80vh] rounded-3xl shadow-2xl overflow-hidden
              ${theme.isDark
                  ? 'bg-slate-900 border border-orange-500/30'
                  : 'bg-white border border-orange-300'
                }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className={`p-4 border-b ${theme.isDark ? 'border-slate-700 bg-orange-500/10' : 'border-slate-200 bg-orange-50'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${theme.isDark ? 'bg-orange-500/20' : 'bg-orange-100'}`}>
                      <Zap className={`w-5 h-5 ${theme.isDark ? 'text-orange-400' : 'text-orange-600'}`} />
                    </div>
                    <div>
                      <h3 className={`font-bold ${theme.isDark ? 'text-white' : 'text-slate-900'}`}>
                        قائمة الطوارئ
                      </h3>
                      <p className={`text-xs ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {emergencyQueue.filter(e => !e.resolved).length} سجل للمراجعة
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {emergencyQueue.length > 0 && (
                      <button
                        onClick={() => {
                          if (confirm('هل أنت متأكد من حذف جميع السجلات؟')) {
                            setEmergencyQueue([]);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${theme.isDark
                          ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                          : 'bg-red-100 text-red-600 hover:bg-red-200'
                          }`}
                      >
                        <Trash2 className="w-3 h-3 inline-block ml-1" />
                        حذف الكل
                      </button>
                    )}
                    <button
                      onClick={() => setEmergencyPanelOpen(false)}
                      className={`p-2 rounded-lg transition-all ${theme.isDark
                        ? 'hover:bg-slate-800 text-slate-400'
                        : 'hover:bg-slate-100 text-slate-500'
                        }`}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                {emergencyQueue.length === 0 ? (
                  <div className={`text-center py-12 ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>لا توجد سجلات طوارئ</p>
                    <p className="text-xs mt-1">السجلات ستظهر هنا عند مسح باركودات غير معروفة</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {emergencyQueue.map((entry, index) => (
                      <div
                        key={entry.id}
                        className={`p-4 rounded-xl border transition-all ${entry.resolved
                          ? theme.isDark
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-emerald-50 border-emerald-200'
                          : theme.isDark
                            ? 'bg-slate-800/50 border-slate-700'
                            : 'bg-slate-50 border-slate-200'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${theme.isDark
                                ? 'bg-slate-700 text-cyan-300'
                                : 'bg-slate-200 text-slate-700'
                                }`}>
                                #{index + 1}
                              </span>
                              <code className={`text-sm font-bold font-mono ${theme.isDark ? 'text-white' : 'text-slate-900'}`}>
                                {entry.scanned_code}
                              </code>
                              {entry.resolved && (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${theme.isDark
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-emerald-100 text-emerald-700'
                                  }`}>
                                  <Check className="w-3 h-3 inline-block ml-1" />
                                  تم الربط
                                </span>
                              )}
                            </div>
                            <div className={`text-xs ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                              <Clock className="w-3 h-3 inline-block ml-1" />
                              {new Date(entry.scanned_at).toLocaleString('ar-SA', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                day: '2-digit',
                                month: 'short'
                              })}
                            </div>
                            {entry.resolved_student_name && (
                              <div className={`mt-2 text-sm ${theme.isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                                <Link className="w-3 h-3 inline-block ml-1" />
                                مربوط بـ: {entry.resolved_student_name}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {!entry.resolved && (
                              <button
                                onClick={async () => {
                                  const studentId = prompt('أدخل معرف الطالب الصحيح:');
                                  if (studentId) {
                                    const student = await db.getStudentByAnyId(studentId);
                                    if (student) {
                                      // تحديث السجل
                                      setEmergencyQueue(prev => prev.map(e =>
                                        e.id === entry.id
                                          ? {
                                            ...e,
                                            resolved: true,
                                            resolved_at: new Date().toISOString(),
                                            resolved_student_id: student.id,
                                            resolved_student_name: student.name
                                          }
                                          : e
                                      ));
                                      // تسجيل الحضور للطالب
                                      await db.markAttendanceFast(student.id);
                                      toast.success(`تم ربط الباركود بـ ${student.name} وتسجيل حضوره`);
                                    } else {
                                      toast.error('الطالب غير موجود. تأكد من المعرف.');
                                    }
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${theme.isDark
                                  ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30'
                                  : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                                  }`}
                              >
                                <Link className="w-3 h-3 inline-block ml-1" />
                                ربط بطالب
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setEmergencyQueue(prev => prev.filter(e => e.id !== entry.id));
                              }}
                              className={`p-1.5 rounded-lg transition-all ${theme.isDark
                                ? 'hover:bg-red-500/20 text-slate-400 hover:text-red-400'
                                : 'hover:bg-red-100 text-slate-400 hover:text-red-600'
                                }`}
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              {emergencyQueue.length > 0 && (
                <div className={`p-4 border-t ${theme.isDark ? 'border-slate-700 bg-slate-800/50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className={`text-xs ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <AlertTriangle className="w-3 h-3 inline-block ml-1 text-amber-500" />
                    نصيحة: يمكنك ربط كل باركود بالطالب الصحيح لتسجيل حضوره تلقائياً
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      }

      {/* Custom Confirmation Modal */}
      {
        confirmAction && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className={`
              w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden
              transform transition-all duration-300 scale-100 animate-scale-in
              ${theme.isDark
                ? 'bg-slate-900 border border-slate-700'
                : 'bg-white border border-slate-200'
              }
           `}>
              <div className={`p-6 text-center ${theme.isDark ? 'text-white' : 'text-slate-900'}`}>
                <div className={`
                  w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center
                  ${confirmAction.type === 'logout'
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-blue-500/10 text-blue-500'
                  }
               `}>
                  {confirmAction.type === 'logout' ? <Power className="w-8 h-8" /> : <Home className="w-8 h-8" />}
                </div>

                <h3 className="text-xl font-bold mb-2">{confirmAction.title}</h3>
                <p className={`text-sm mb-6 ${theme.isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {confirmAction.message}
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmAction(null)}
                    className={`flex-1 py-3 rounded-xl font-medium transition-colors ${theme.isDark
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                      }`}
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={confirmActionHandler}
                    className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors shadow-lg ${confirmAction.type === 'logout'
                      ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                      : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
                      }`}
                  >
                    تأكيد
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};

export default Kiosk;
