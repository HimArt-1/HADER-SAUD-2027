import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, getLocalISODate } from '../services/db';
import { auth } from '../services/auth';
import {
  Role, Student, DailySummary, ExitRecord, ViolationRecord, ExitRequesterRelation,
  Notification, AttendanceRecord, User, SchoolClass, NotificationTemplates, SystemSettings
} from '../types';
import {
  Search, AlertTriangle, DoorOpen, Bell, LayoutDashboard, MessageCircle,
  X, Check, Loader2, Calendar, RefreshCcw, Users, FileText, Download,
  Printer, Eye, Send, CheckSquare, Square, Filter, ChevronDown,
  Clock, UserCheck, UserX, TrendingUp, AlertCircle, Shield, Phone,
  ChevronRight, BarChart3, FileSpreadsheet, GraduationCap, FileDown, Edit3, FileType, Monitor
} from 'lucide-react';
import { kioskPresenceService, KioskStatus } from '../services/kioskPresenceService';
import { FileService, ExportColumn } from '../services/fileService';
import { useCleanup, useSafeAsync } from '../hooks/useResourceManagement';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useIncrementalList } from '../hooks/useIncrementalList';
import { useSyncRefresh } from '../hooks/useSyncRefresh';
import { logError } from '../types/errors';
import { logger } from '../services/logger';
import { createDbSchoolDayWorkflow } from '../services/schoolDayWorkflow';
import { notificationCenter } from '../services/notifications';
import { studentAffairs } from '../services/studentAffairs';
import { useToast } from '../components/Toast';
import { useAdminTheme } from '../hooks/useAdminTheme';
import QuickSendModal from '../components/whatsapp/QuickSendModal';
import { BarcodeStudio } from '../components/BarcodeStudio';
import { ScanLine, QrCode, HelpCircle } from 'lucide-react';
import { UniversalGuideModal, GuideStep } from '../components/common/UniversalGuideModal';
import { printExitCard, printViolationNotice } from '../services/documentPrintTemplates';
import { EXIT_REQUESTER_RELATIONS, getExitRequesterRelationLabel } from '../services/exitRequester';
import { upsertAttendanceRecord } from '../modules/attendance';
import { appSettings } from '../services/settings';
import {
  buildSupervisorAttendanceIndex,
  getSupervisorAttendanceStatus,
  resolveSupervisorDayState,
  summarizeSupervisorAttendance,
  SupervisorAttendanceStatus
} from '../components/supervision/supervisionAttendanceRules';
import {
  buildStudentProfileSnapshot,
  filterStudentDirectory
} from '../components/supervision/supervisionStudentDirectory';
import {
  communicationStatusLabel,
  createGuardianNotificationDrafts,
  resolveStudentWhatsAppPhone,
  SupervisorCommunicationActivity
} from '../components/supervision/supervisionCommunication';

// Violation Types
const VIOLATION_TYPES = [
  { value: 'disruptive', label: 'سلوك مشاغب' },
  { value: 'uniform', label: 'مخالفة الزي' },
  { value: 'fighting', label: 'مشاجرة' },
  { value: 'late_class', label: 'تأخر عن الحصة' },
  { value: 'phone', label: 'استخدام الجوال' },
  { value: 'absence', label: 'تغيب بدون إذن' },
  { value: 'other', label: 'أخرى' }
];

// Exit Reasons
const EXIT_REASONS = [
  { value: 'sick', label: 'مرض' },
  { value: 'appointment', label: 'موعد طبي' },
  { value: 'family', label: 'ظرف عائلي' },
  { value: 'emergency', label: 'حالة طارئة' },
  { value: 'other', label: 'أخرى' }
];

const EMPTY_EXIT_FORM = {
  student_id: '',
  reason: '',
  reasonType: '',
  requesterRelation: '',
  requesterRelationOther: '',
  notes: ''
};

const EMPTY_VIOLATION_FORM = {
  student_id: '',
  type: '',
  level: 3,
  description: '',
  actionTaken: '',
  summonGuardian: false
};

// Default Notification Templates
const DEFAULT_TEMPLATES: NotificationTemplates = {
  late: {
    title: 'تنبيه تأخر',
    message: 'نود إعلامكم بتأخر ابنكم/ابنتكم عن الحضور للمدرسة اليوم. نأمل الحرص على الالتزام بالمواعيد.'
  },
  absent: {
    title: 'تنبيه غياب',
    message: 'نود إعلامكم بتغيب ابنكم/ابنتكم عن المدرسة اليوم. يرجى تبرير الغياب في أقرب وقت.'
  },
  behavior: {
    title: 'ملاحظة سلوكية',
    message: 'نود إعلامكم بتسجيل ملاحظة سلوكية على ابنكم/ابنتكم. يرجى مراجعة الإدارة للمتابعة.'
  },
  summon: {
    title: 'استدعاء ولي أمر',
    message: 'نرجو التكرم بمراجعة إدارة المدرسة لمناقشة موضوع يخص ابنكم/ابنتكم.'
  }
};

const normalizeLabel = (value?: string | null) =>
  (value ?? '')
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const formatLabel = (value?: string | null) => (value ?? '').toString().trim();

const collectUniqueLabels = (values: Array<string | null | undefined>) => {
  const map = new Map<string, string>();
  values.forEach(value => {
    const formatted = formatLabel(value);
    const norm = normalizeLabel(formatted);
    if (norm && !map.has(norm)) {
      map.set(norm, formatted);
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' })
  );
};

const compareLabels = (a: string, b: string) =>
  a.localeCompare(b, 'ar', { numeric: true, sensitivity: 'base' });

const labelsMatch = (a?: string | null, b?: string | null) =>
  normalizeLabel(a) === normalizeLabel(b);

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const isUuid = (value?: string | null) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const surfaceClass = 'border border-white/10 bg-slate-950/55 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.95)] backdrop-blur-2xl';
const mutedSurfaceClass = 'border border-white/10 bg-white/[0.035] backdrop-blur-xl';

const supervisionTabs = [
  {
    id: 'attendance',
    label: 'المتابعة',
    description: 'حضور وتأخر وغياب اليوم',
    icon: LayoutDashboard,
    activeClass: 'border-secondary-400/40 bg-secondary-500/15 text-secondary-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    markerClass: 'bg-secondary-300'
  },
  {
    id: 'exits',
    label: 'الاستئذان',
    description: 'تصاريح الخروج الحالية',
    icon: DoorOpen,
    activeClass: 'border-sky-400/40 bg-sky-500/15 text-sky-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    markerClass: 'bg-sky-300'
  },
  {
    id: 'violations',
    label: 'المخالفات',
    description: 'الملاحظات السلوكية',
    icon: AlertTriangle,
    activeClass: 'border-rose-400/40 bg-rose-500/15 text-rose-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    markerClass: 'bg-rose-300'
  },
  {
    id: 'students',
    label: 'الطلاب والتقارير',
    description: 'بحث وبطاقات وتصدير',
    icon: Users,
    activeClass: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    markerClass: 'bg-emerald-300'
  },
] as const;

const attendanceListTone = {
  present: {
    badgeClass: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
    panelClass: 'border-emerald-400/10',
    actionClass: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
  },
  late: {
    badgeClass: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
    panelClass: 'border-amber-400/10',
    actionClass: 'border-amber-400/20 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15'
  },
  absent: {
    badgeClass: 'border-rose-400/25 bg-rose-500/10 text-rose-200',
    panelClass: 'border-rose-400/10',
    actionClass: 'border-rose-400/20 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15'
  },
  unrecorded: {
    badgeClass: 'border-slate-400/25 bg-slate-500/10 text-slate-200',
    panelClass: 'border-slate-400/10',
    actionClass: 'border-slate-400/20 bg-slate-500/10 text-slate-100 hover:bg-slate-500/15'
  }
} as const;

type AttendanceExportType = 'all' | SupervisorAttendanceStatus;

const getAttendanceStatusLabel = (status: SupervisorAttendanceStatus) => {
  if (status === 'present') return 'حاضر';
  if (status === 'late') return 'متأخر';
  if (status === 'absent') return 'غائب';
  return 'غير مُحضّر';
};

interface Props {
  user?: User;
}

const Supervision: React.FC<Props> = ({ user: propUser }) => {
  // Get user from props or auth
  const currentUser = propUser || auth.getSession();
  const canUseWhatsAppGateway = currentUser?.role === Role.SITE_ADMIN || currentUser?.can_use_whatsapp === true;
  const { addCleanup } = useCleanup();

  // 🎨 Unified Theme
  useAdminTheme();
  const safeAsync = useSafeAsync();
  const toast = useToast();
  const showToast = toast.showToast;

  // Core State
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [manualAttendance, setManualAttendance] = useState<AttendanceRecord[]>([]);
  const [manualAttendanceLoading, setManualAttendanceLoading] = useState(false);
  const [manualAttendanceError, setManualAttendanceError] = useState('');
  const [todayExits, setTodayExits] = useState<ExitRecord[]>([]);
  const [todayViolations, setTodayViolations] = useState<ViolationRecord[]>([]);
  const [notification_templates, setNotificationTemplates] = useState<NotificationTemplates>(DEFAULT_TEMPLATES);
  const [documentSettings, setDocumentSettings] = useState<SystemSettings | null>(null);
  const [onlineKiosks, setOnlineKiosks] = useState<KioskStatus[]>([]);
  const schoolDayWorkflow = useMemo(() => createDbSchoolDayWorkflow(), []);
  const attendanceRef = React.useRef<AttendanceRecord[]>([]);
  const manualAttendanceRequestRef = React.useRef(0);
  attendanceRef.current = attendance;

  // Tab State
  const [activeTab, setActiveTab] = useState<'attendance' | 'exits' | 'violations' | 'students'>('attendance');
  const [attendanceSubView, setAttendanceSubView] = useState<'monitor' | 'manual'>('monitor');

  // Filters
  const [filterClass, setFilterClass] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SupervisorAttendanceStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [directoryClass, setDirectoryClass] = useState('');
  const [directorySection, setDirectorySection] = useState('');
  const [directoryStatus, setDirectoryStatus] = useState<'all' | SupervisorAttendanceStatus>('all');
  const [directoryQuery, setDirectoryQuery] = useState('');

  // Student selection filters (per form context)
  const [exitStudentFilters, setExitStudentFilters] = useState({
    class_name: '',
    section: ''
  });
  const [violationStudentFilters, setViolationStudentFilters] = useState({
    class_name: '',
    section: ''
  });

  // Bulk Selection
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkTemplate, setBulkTemplate] = useState<'late' | 'absent'>('late');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkError, setBulkError] = useState('');

  // Export Modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState<AttendanceExportType>('all');
  const [exportSortBy, setExportSortBy] = useState<'name' | 'id'>('name'); // ترتيب التصدير
  const [exportFilterClass, setExportFilterClass] = useState(''); // فلتر الصف للتصدير
  const [exportFilterSection, setExportFilterSection] = useState(''); // فلتر الفصل للتصدير

  // Exit Form
  const [exitForm, setExitForm] = useState(() => ({ ...EMPTY_EXIT_FORM }));
  const [exitSaving, setExitSaving] = useState(false);
  const [exitFormError, setExitFormError] = useState('');
  const [duplicateExitConfirmed, setDuplicateExitConfirmed] = useState(false);
  const [pendingDeleteExitId, setPendingDeleteExitId] = useState<string | null>(null);

  // Violation Form
  const [violationForm, setViolationForm] = useState(() => ({ ...EMPTY_VIOLATION_FORM }));
  const [violationSaving, setViolationSaving] = useState(false);
  const [violationFormError, setViolationFormError] = useState('');
  const [editingViolationId, setEditingViolationId] = useState<string | null>(null);
  const [pendingDeleteViolationId, setPendingDeleteViolationId] = useState<string | null>(null);

  // Exit Management State
  const [editingExitId, setEditingExitId] = useState<string | null>(null);
  const [lastExitForPrint, setLastExitForPrint] = useState<ExitRecord | null>(null);
  const [lastViolationForPrint, setLastViolationForPrint] = useState<ViolationRecord | null>(null);

  // Student Profile Modal
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);
  const [profileData, setProfileData] = useState<{
    attendance: AttendanceRecord[];
    exits: ExitRecord[];
    violations: ViolationRecord[];
  } | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const profileRequestRef = React.useRef(0);

  // Message Modal
  const [messageStudent, setMessageStudent] = useState<Student | null>(null);
  const [messageText, setMessageText] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [communicationActivity, setCommunicationActivity] = useState<SupervisorCommunicationActivity[]>([]);

  // Edit Student Modal
  const [editStudentTarget, setEditStudentTarget] = useState<Student | null>(null);
  const [editForm, setEditForm] = useState({
    guardian_phone: '',
    class_name: '',
    section: ''
  });

  // Quick Attendance - Late Marking State
  const [selectedLateStudents, setSelectedLateStudents] = useState<Set<string>>(new Set());
  const [showLateTimeModal, setShowLateTimeModal] = useState(false);
  const [lateTimeInput, setLateTimeInput] = useState({ time: '07:30', date: getLocalISODate() });
  const [lateRecordLoading, setLateRecordLoading] = useState(false);
  const [attendanceSettings, setAttendanceSettings] = useState<{
    enable_supervisor_quick_attendance?: boolean;
  }>({});

  // Edit/Delete Attendance State
  const [editAttendanceStudent, setEditAttendanceStudent] = useState<Student | null>(null);
  const [editAttendanceStatus, setEditAttendanceStatus] = useState<'present' | 'late' | 'absent'>('present');
  const [editAttendanceTime, setEditAttendanceTime] = useState('07:30');
  const [showResetDayModal, setShowResetDayModal] = useState(false);
  const [resetDayDate, setResetDayDate] = useState(getLocalISODate());
  const [resetDayLoading, setResetDayLoading] = useState(false);

  // Manual Attendance State
  const [manualClass, setManualClass] = useState('');
  const [manualSection, setManualSection] = useState('');
  const [manualDate, setManualDate] = useState(getLocalISODate());
  const [manualTime, setManualTime] = useState('07:00');
  const [manualSaving, setManualSaving] = useState<string | null>(null);
  const [manualSearch, setManualSearch] = useState('');

  // Quick Send Modal State
  const [showQuickSendModal, setShowQuickSendModal] = useState(false);
  const [selectedQuickSendStudent, setSelectedQuickSendStudent] = useState<Student | null>(null);
  const [quickSendTemplateId, setQuickSendTemplateId] = useState<string>('custom');

  // Local Toast for quick feedback
  const [localToast, setLocalToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({ show: false, message: '', type: 'success' });

  // Barcode Studio State
  const [showBarcodeStudio, setShowBarcodeStudio] = useState(false);
  const [barcodeSelectedIds, setBarcodeSelectedIds] = useState<Set<string>>(new Set());
  const [showGuide, setShowGuide] = useState(false);

  // 🛡️ Guard: prevents live-update refetches from stomping UI state
  // while bulk notifications are being sent.
  const isSendingNotificationsRef = React.useRef(false);

  const supervisionGuideSteps: GuideStep[] = [
    {
      title: "مرحباً في واجهة المراقبة اليومية",
      description: "هذه الواجهة مخصصة لمتابعة الانضباط المدرسي في الوقت الفعلي وضمان سلامة الطلاب.",
      icon: LayoutDashboard,
      color: "violet",
      details: [
        "مراقبة الحضور والغياب اللحظي.",
        "إدارة تصاريح الخروج والاستئذان.",
        "تسجيل الملاحظات السلوكية والمخالفات."
      ]
    },
    {
      title: "متابعة الحضور والغياب",
      description: "تتبع حالة الطلاب (حاضر، متأخر، غائب) بدقة عالية.",
      icon: Clock,
      color: "emerald",
      details: [
        "تحديث حالات الطلاب يدوياً عند الحاجة.",
        "فرز الطلاب حسب الصف أو الشعبة.",
        "رصد دقائق التأخر لكل طالب تلقائياً."
      ]
    },
    {
      title: "نظام الاستئذان الذكي",
      description: "تنظيم خروج الطلاب خلال اليوم الدراسي بطريقة رسمية وموثقة.",
      icon: DoorOpen,
      color: "sky",
      details: [
        "تسجيل سبب الخروج ووقت المغادرة.",
        "إشعار ولي الأمر تلقائياً عند اعتماد الاستئذان.",
        "طباعة تصريح خروج رسمي للطالب."
      ]
    },
    {
      title: "رصد السلوك والمخالفات",
      description: "توثيق الملاحظات التربوية والسلوكية للمتابعة المستمرة.",
      icon: AlertTriangle,
      color: "rose",
      details: [
        "اختيار نوع المخالفة ودرجة حدتها.",
        "إضافة وصف دقيق للواقعة.",
        "ربط المخالفة بملف الطالب الدائم."
      ]
    },
    {
      title: "التواصل السريع مع أولياء الأمور",
      description: "إبقاء الأهالي في قلب الحدث عبر إشعارات فورية.",
      icon: Bell,
      color: "amber",
      details: [
        "إرسال تنبيهات الغياب الجماعية بضغطة زر.",
        "التواصل المباشر عبر الواتساب في حالات الطوارئ.",
        "استخدام قوالب رسائل جاهزة ومخصصة."
      ]
    }
  ];

  const getSectionsForClass = useCallback(
    (class_name?: string) => {
      const normClass = normalizeLabel(class_name);
      const hasClass = Boolean(normClass);
      const sources: Array<string | null | undefined> = [];

      students.forEach(student => {
        if (!hasClass || normalizeLabel(student.class_name) === normClass) {
          sources.push(student.section);
        }
      });

      if (hasClass) {
        const classMatch = classes.find(c => normalizeLabel(c.name) === normClass);
        if (classMatch?.sections?.length) {
          sources.push(...classMatch.sections);
        }
      } else {
        classes.forEach(cls => sources.push(...(cls.sections || [])));
      }

      return collectUniqueLabels(sources);
    },
    [students, classes]
  );

  const canEditStudents = currentUser ? [
    Role.SITE_ADMIN,
    Role.SCHOOL_ADMIN,
    Role.SUPERVISOR_GLOBAL,
    Role.SUPERVISOR_CLASS
  ].includes(currentUser.role) : false;

  const editSections = useMemo(
    () => (editForm.class_name ? getSectionsForClass(editForm.class_name) : []),
    [getSectionsForClass, editForm.class_name]
  );



  // Load attendance settings
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hader:attendance:settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        setAttendanceSettings(parsed);
      }
    } catch (error) {
      logError(error, 'Supervision - Load Attendance Settings');
    }
  }, []);

  // Real-time Attendance Subscription
  useEffect(() => {
    const sub = db.subscribeToAttendance((newRecord) => {
      setAttendance(prev => {
        return upsertAttendanceRecord(prev, newRecord);
      });
      if (newRecord.date === manualDate) {
        setManualAttendance(prev => upsertAttendanceRecord(prev, newRecord));
      }
      // Optional: Toast for feedback
      // showToast('تم تحديث القائمة (تسجيل جديد)', 'success');
    });

    return () => {
      sub.unsubscribe();
    };
  }, [manualDate]);

  const fetchSchoolDayData = useCallback(async () => {
    try {
      const result = await schoolDayWorkflow.loadSnapshot({
        actor: propUser || auth.getSession(),
        date: getLocalISODate(),
        previousAttendance: attendanceRef.current
      });
      if (result.status === 'stale') return;

      const { snapshot } = result;
      setStudents(snapshot.students);
      setClasses(snapshot.classes);
      setDocumentSettings(snapshot.settings);
      setSummary(snapshot.summary);
      setTodayExits(snapshot.exits);
      setTodayViolations(snapshot.violations);
      setAttendance(snapshot.attendance);

      if (snapshot.settings.notification_templates) {
        setNotificationTemplates({
          ...DEFAULT_TEMPLATES,
          ...snapshot.settings.notification_templates
        });
      }
      if (result.attendancePreserved) {
        logger.warn(
          'Supervision',
          `Attendance regression prevented. Kept ${attendanceRef.current.length} records.`
        );
      }
      setLoading(false);
    } catch (error) {
      logError(error, 'Supervision - Fetch School Day Snapshot');
      setLoading(false);
    }
  }, [propUser, schoolDayWorkflow]);

  useEffect(() => {
    void fetchSchoolDayData();
  }, [fetchSchoolDayData]);

  useEffect(() => {
    const unsubscribe = appSettings.subscribe(updatedSettings => {
      setDocumentSettings(updatedSettings);
    });
    return unsubscribe;
  }, []);

  const refreshManualAttendance = useCallback(async (showLoading = false) => {
    const requestId = ++manualAttendanceRequestRef.current;
    if (showLoading) {
      setManualAttendanceLoading(true);
      setManualAttendance([]);
    }
    setManualAttendanceError('');

    try {
      const records = await db.getAttendance(manualDate);
      if (requestId !== manualAttendanceRequestRef.current) return;
      setManualAttendance(records);
      if (manualDate === getLocalISODate()) {
        setAttendance(records);
      }
    } catch (error) {
      if (requestId !== manualAttendanceRequestRef.current) return;
      logError(error, 'Supervision - Load Manual Attendance');
      setManualAttendanceError('تعذر تحميل سجلات هذا اليوم. أعد المحاولة.');
    } finally {
      if (requestId === manualAttendanceRequestRef.current) {
        setManualAttendanceLoading(false);
      }
    }
  }, [manualDate]);

  useEffect(() => {
    if (activeTab === 'attendance' && attendanceSubView === 'manual') {
      void refreshManualAttendance(true);
    }
  }, [activeTab, attendanceSubView, refreshManualAttendance]);

  useLiveUpdates(() => {
    // 🛡️ Skip re-fetch while bulk notifications are being sent.
    // Each saveNotification() fires a Supabase INSERT event → hader:realtime-update,
    // which would cause N concurrent re-fetches (one per student) that race to
    // overwrite the attendance state, making students "disappear" from the UI.
    if (isSendingNotificationsRef.current) {
      logger.debug('Supervision', 'Skipping re-fetch (bulk notification in progress)');
      return;
    }
    logger.debug('Supervision', 'Real-time update detected, Refreshing data...');
    void fetchSchoolDayData();
  });

  useSyncRefresh(() => {
    void fetchSchoolDayData();
  });

  // Listen for Kiosk Presence
  useEffect(() => {
    const unsubscribe = kioskPresenceService.listenForPresence((kiosks) => {
      setOnlineKiosks(kiosks);
    });
    return unsubscribe;
  }, []);

  const showLocalToast = (message: string, type: 'success' | 'error' = 'success') => {
    setLocalToast({ show: true, message, type });
    setTimeout(() => setLocalToast({ show: false, message: '', type: 'success' }), 3000);
  };

  const recordCommunicationActivity = useCallback((activity: Omit<SupervisorCommunicationActivity, 'id' | 'createdAt'>) => {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `communication-${Date.now()}`;
    setCommunicationActivity(previous => [{
      ...activity,
      id,
      createdAt: new Date().toISOString()
    }, ...previous].slice(0, 8));
  }, []);

  // Get unique classes and sections
  const uniqueClasses = useMemo(
    () => collectUniqueLabels([...students.map(s => s.class_name), ...classes.map(c => c.name)]),
    [students, classes]
  );

  const uniqueSections = useMemo(
    () => getSectionsForClass(filterClass || undefined),
    [getSectionsForClass, filterClass]
  );

  const studentsById = useMemo(
    () => new Map(students.map(student => [student.id, student])),
    [students]
  );


  const classTree = useMemo(() => {
    return uniqueClasses.map(name => {
      const classStudents = students.filter(student => labelsMatch(student.class_name, name));
      const sections = getSectionsForClass(name).map(sectionName => ({
        name: sectionName,
        count: classStudents.filter(student => labelsMatch(student.section, sectionName)).length
      }));
      return {
        name,
        count: classStudents.length,
        sections
      };
    });
  }, [uniqueClasses, students, getSectionsForClass]);

  const exportSections = useMemo(
    () => (exportFilterClass ? getSectionsForClass(exportFilterClass) : []),
    [exportFilterClass, getSectionsForClass]
  );

  const todayDate = getLocalISODate();
  const attendanceByStudentId = useMemo(
    () => buildSupervisorAttendanceIndex(attendance, todayDate),
    [attendance, todayDate]
  );
  const attendanceSummary = useMemo(
    () => summarizeSupervisorAttendance(students.map(student => student.id), attendanceByStudentId),
    [students, attendanceByStudentId]
  );
  const stats = useMemo(() => ({
    total: attendanceSummary.total,
    presentCount: attendanceSummary.present,
    lateCount: attendanceSummary.late,
    absentCount: attendanceSummary.absent,
    unrecordedCount: attendanceSummary.unrecorded,
    recordedCount: attendanceSummary.recorded,
    rate: attendanceSummary.attendanceRate,
    completionRate: attendanceSummary.completionRate
  }), [attendanceSummary]);
  const todayDayState = useMemo(
    () => resolveSupervisorDayState(todayDate, documentSettings || {}, todayDate),
    [documentSettings, todayDate]
  );
  const effectiveAssemblyTime = documentSettings?.assembly_time
    || documentSettings?.kiosk_settings?.assembly_time
    || '07:00';
  const effectiveGracePeriod = documentSettings?.grace_period
    ?? documentSettings?.kiosk_settings?.grace_period
    ?? 0;

  const activeTabMeta = supervisionTabs.find(tab => tab.id === activeTab) ?? supervisionTabs[0];
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' }),
    []
  );
  const operationTiles = useMemo(() => [
    { label: 'الطلاب ضمن النطاق', value: stats.total, hint: 'طالب', className: 'border-primary-400/15 bg-primary-500/10 text-primary-100' },
    { label: 'حضور اليوم', value: `${stats.rate}%`, hint: 'نسبة التسجيل', className: 'border-secondary-400/15 bg-secondary-500/10 text-secondary-100' },
    { label: 'استئذانات مفتوحة', value: todayExits.length, hint: 'سجل خروج', className: 'border-sky-400/15 bg-sky-500/10 text-sky-100' },
    { label: 'ملاحظات اليوم', value: todayViolations.length, hint: 'مخالفة', className: 'border-rose-400/15 bg-rose-500/10 text-rose-100' }
  ], [stats.total, stats.rate, todayExits.length, todayViolations.length]);

  const attendanceStatCards = useMemo(() => [
    {
      label: 'نسبة الحضور',
      value: `${stats.rate}%`,
      hint: `${stats.presentCount + stats.lateCount} من ${stats.total} حضروا`,
      icon: TrendingUp,
      cardClass: 'border-secondary-400/20 bg-secondary-500/[0.08]',
      iconClass: 'bg-secondary-500/15 text-secondary-200',
      valueClass: 'text-secondary-100',
      progressClass: 'bg-secondary-300',
      progress: stats.rate
    },
    {
      label: 'الحضور',
      value: stats.presentCount,
      hint: 'حضور دون تأخر',
      icon: UserCheck,
      cardClass: 'border-emerald-400/20 bg-emerald-500/[0.08]',
      iconClass: 'bg-emerald-500/15 text-emerald-200',
      valueClass: 'text-emerald-100'
    },
    {
      label: 'المتأخرون',
      value: stats.lateCount,
      hint: 'سجلوا بعد الوقت المحدد',
      icon: Clock,
      cardClass: 'border-amber-400/20 bg-amber-500/[0.08]',
      iconClass: 'bg-amber-500/15 text-amber-200',
      valueClass: 'text-amber-100'
    },
    {
      label: 'الغياب',
      value: stats.absentCount,
      hint: 'غياب مسجل صراحة',
      icon: UserX,
      cardClass: 'border-rose-400/20 bg-rose-500/[0.08]',
      iconClass: 'bg-rose-500/15 text-rose-200',
      valueClass: 'text-rose-100'
    },
    {
      label: 'غير مُحضّرين',
      value: stats.unrecordedCount,
      hint: `${stats.completionRate}% اكتمال التحضير`,
      icon: AlertCircle,
      cardClass: 'border-slate-400/20 bg-slate-500/[0.08]',
      iconClass: 'bg-slate-500/15 text-slate-200',
      valueClass: 'text-slate-100'
    }
  ], [stats]);

  // Filter students for attendance tab
  const filteredAttendanceList = useMemo(() => {
    let list = students;

    // Class filter
    if (filterClass) list = list.filter(s => labelsMatch(s.class_name, filterClass));
    if (filterSection) list = list.filter(s => labelsMatch(s.section, filterSection));

    // Status filter
    if (filterStatus !== 'all') {
      list = list.filter(student =>
        getSupervisorAttendanceStatus(student.id, attendanceByStudentId) === filterStatus
      );
    }

    // Search
    if (searchQuery) {
      list = list.filter(s =>
        s.name.includes(searchQuery) ||
        s.id.includes(searchQuery)
      );
    }

    return list.map(student => {
      const record = attendanceByStudentId.get(student.id);
      return {
        ...student,
        attendanceStatus: getSupervisorAttendanceStatus(student.id, attendanceByStudentId),
        timestamp: record?.timestamp,
        minutes_late: record?.minutes_late || 0
      };
    });
  }, [students, attendanceByStudentId, filterClass, filterSection, filterStatus, searchQuery]);

  const presentList = filteredAttendanceList.filter(s => s.attendanceStatus === 'present');
  const lateList = filteredAttendanceList.filter(s => s.attendanceStatus === 'late');
  const absentList = filteredAttendanceList.filter(s => s.attendanceStatus === 'absent');
  const unrecordedList = filteredAttendanceList.filter(s => s.attendanceStatus === 'unrecorded');

  // تصيير تدريجي لقائمة الحضور: يمنع تجمّد/انهيار الصفحة عند آلاف الطلاب
  // بعرض دفعة أولى ثم إضافة المزيد تلقائياً عند التمرير. يعاد الضبط عند
  // تغيير الفلاتر/البحث فقط (resetKey) لا مع كل تحديث خلفي للبيانات.
  const {
    visible: visibleAttendanceList,
    sentinelRef: attendanceSentinelRef,
    hasMore: attendanceHasMore,
    shownCount: attendanceShownCount,
    total: attendanceTotalCount
  } = useIncrementalList(filteredAttendanceList, {
    initial: 60,
    step: 60,
    resetKey: `${filterClass}|${filterSection}|${filterStatus}|${searchQuery}`
  });

  const directoryRows = useMemo(() => students.map(student => {
    const record = attendanceByStudentId.get(student.id);
    return {
      ...student,
      attendanceStatus: getSupervisorAttendanceStatus(student.id, attendanceByStudentId),
      timestamp: record?.timestamp,
      minutes_late: record?.minutes_late || 0
    };
  }), [students, attendanceByStudentId]);

  const filteredDirectoryList = useMemo(() => filterStudentDirectory(directoryRows, {
    query: directoryQuery,
    className: directoryClass,
    section: directorySection,
    status: directoryStatus
  }), [directoryRows, directoryQuery, directoryClass, directorySection, directoryStatus]);

  const {
    visible: visibleDirectoryList,
    sentinelRef: directorySentinelRef,
    hasMore: directoryHasMore,
    shownCount: directoryShownCount,
    total: directoryTotalCount
  } = useIncrementalList(filteredDirectoryList, {
    initial: 60,
    step: 60,
    resetKey: `${directoryClass}|${directorySection}|${directoryStatus}|${directoryQuery}`
  });

  const profileSnapshot = useMemo(
    () => profileData ? buildStudentProfileSnapshot(profileData) : null,
    [profileData]
  );

  const buildExportRows = (list: typeof filteredAttendanceList, label: string) => {
    return list.map(student => ({
      id: student.id,
      name: student.name,
      class_name: student.class_name,
      section: student.section,
      time: student.timestamp ? new Date(student.timestamp).toLocaleTimeString('ar-SA') : '-',
      status: label,
      minutes_late: student.minutes_late || 0
    }));
  };

  const attendanceExportColumns: ExportColumn[] = [
    { header: 'المعرف', key: 'id' },
    { header: 'اسم الطالب', key: 'name' },
    { header: 'الصف', key: 'class_name' },
    { header: 'الفصل', key: 'section' },
    { header: 'وقت التسجيل', key: 'time' },
    { header: 'الحالة', key: 'status' },
    { header: 'دقائق التأخر', key: 'minutes_late' }
  ];

  const attendanceListsConfig = [
    { key: 'present', label: 'الحضور', list: presentList, tone: attendanceListTone.present },
    { key: 'late', label: 'التأخر', list: lateList, tone: attendanceListTone.late },
    { key: 'absent', label: 'الغياب المسجل', list: absentList, tone: attendanceListTone.absent },
    { key: 'unrecorded', label: 'غير مُحضّرين', list: unrecordedList, tone: attendanceListTone.unrecorded }
  ] as const;

  // Handle bulk selection
  const toggleSelectAll = () => {
    if (selectedStudents.size === filteredAttendanceList.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(filteredAttendanceList.map(s => s.id)));
    }
  };

  const toggleSelectStudent = (id: string) => {
    const newSet = new Set(selectedStudents);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedStudents(newSet);
  };

  // Send bulk notifications
  const sendBulkNotifications = async () => {
    if (selectedStudents.size === 0 || bulkSending) return;

    const template = notification_templates[bulkTemplate];
    const message = (bulkMessage || template.message).trim();
    if (!message) {
      setBulkError('اكتب نص الإشعار قبل الحفظ.');
      return;
    }
    const { drafts, missingStudentIds } = createGuardianNotificationDrafts({
      studentIds: selectedStudents,
      studentsById,
      title: template.title,
      message,
      createdBy: currentUser?.id
    });
    if (drafts.length === 0) {
      setBulkError('لم يعد أي طالب من القائمة المحددة ضمن نطاقك الحالي.');
      return;
    }

    // Keep the attendance snapshot stable until the batch has been persisted.
    isSendingNotificationsRef.current = true;
    setBulkSending(true);
    setBulkError('');

    try {
      const result = await notificationCenter.execute({ type: 'send-many', notifications: drafts });
      const successCount = result.notifications.length;

      if (successCount > 0) {
        showToast(`تم حفظ ${successCount} إشعار في المنصة`, 'success');
        recordCommunicationActivity({
          channel: 'portal',
          status: 'stored',
          title: template.title,
          recipientLabel: `${successCount} ولي أمر`,
          recipientCount: successCount,
          detail: missingStudentIds.length > 0 ? `تم تجاوز ${missingStudentIds.length} تحديد قديم` : undefined
        });
      }
      setShowBulkModal(false);
      setSelectedStudents(new Set());
      setBulkMessage('');
    } catch (error) {
      logError(error, 'Supervision - Store Bulk Notifications');
      setBulkError('تعذر حفظ الإشعارات. لم تُغلق النافذة كي تتمكن من إعادة المحاولة.');
      recordCommunicationActivity({
        channel: 'portal',
        status: 'failed',
        title: template.title,
        recipientLabel: `${drafts.length} ولي أمر`,
        recipientCount: drafts.length,
        detail: error instanceof Error ? error.message : undefined
      });
    } finally {
      // 🛡️ Deactivate guard and perform a single clean refresh
      isSendingNotificationsRef.current = false;
      setBulkSending(false);
      void fetchSchoolDayData();
    }
  };

  // Open one reviewed composer for late or absent lists instead of sending immediately.
  const sendBulkNotificationsForList = (list: typeof filteredAttendanceList, templateType: 'late' | 'absent') => {
    if (list.length === 0) {
      toast.warning('لا يوجد طلاب في هذه القائمة');
      return;
    }
    const template = notification_templates[templateType];
    setSelectedStudents(new Set(list.map(student => student.id)));
    setBulkTemplate(templateType);
    setBulkMessage(template.message);
    setBulkError('');
    setShowBulkModal(true);
  };

  const openEditStudentModal = (student: Student) => {
    setEditStudentTarget(student);
    setEditForm({
      guardian_phone: student.guardian_phone || '',
      class_name: student.class_name || '',
      section: student.section || ''
    });
  };

  const handleSaveStudentEdit = async () => {
    if (!editStudentTarget) return;
    if (!editForm.class_name || !editForm.section) {
      showToast('يرجى تحديد الصف والفصل', 'error');
      return;
    }

    try {
      const updatedStudent: Student = {
        ...editStudentTarget,
        class_name: editForm.class_name,
        section: editForm.section,
        guardian_phone: editForm.guardian_phone
      };

      await db.updateStudent(updatedStudent);
      await notificationCenter.execute({ type: 'send', notification: {
        id: '',
        title: 'تعديل بيانات طالب',
        message: `${currentUser?.name || 'مشرف'} قام بتحديث بيانات ${updatedStudent.name}`,
        type: 'general',
        target_audience: 'admin',
        created_at: new Date().toISOString(),
        is_popup: true,
        created_by: currentUser?.id
      } });

      showToast('تم تحديث بيانات الطالب', 'success');
      setEditStudentTarget(null);
      void fetchSchoolDayData();
    } catch (error) {
      logError(error, 'Supervision - Update Student');
      showToast('حدث خطأ أثناء حفظ البيانات', 'error');
    }
  };

  const notifyGuardianPortal = async (student: Student | undefined, violation: ViolationRecord) => {
    if (!student) {
      showToast('تعذر العثور على بيانات الطالب', 'error');
      return;
    }

    try {
      await notificationCenter.execute({ type: 'send', notification: {
        id: '',
        title: `مخالفة سلوكية - ${student.name}`,
        message: `تم تسجيل مخالفة ${violation.type}${violation.description ? `: ${violation.description}` : ''}`,
        type: 'behavior',
        target_audience: 'guardian',
        target_id: student.id,
        created_at: new Date().toISOString(),
        is_popup: true,
        created_by: currentUser?.id
      } });

      if (!violation.guardian_notified) {
        const updatedViolation = { ...violation, guardian_notified: true };
        await db.addViolation(updatedViolation);
        setTodayViolations(previous => previous.map(item =>
          item.id === updatedViolation.id ? updatedViolation : item
        ));
      }

      showToast('تم إرسال إشعار المنصة لولي الأمر', 'success');
    } catch (error) {
      logError(error, 'Supervision - Send Parent Notification');
      showToast('تعذر إرسال إشعار المنصة', 'error');
    }
  };

  const currentUserLabel = currentUser?.name || currentUser?.username || 'المشرف';
  const currentUserRecordId = isUuid(currentUser?.id) ? currentUser!.id : null;
  const isExitRequesterComplete = Boolean(
    exitForm.requesterRelation &&
    (exitForm.requesterRelation !== 'other' || exitForm.requesterRelationOther.trim())
  );
  const selectedTodayExit = useMemo(
    () => todayExits.find(exit =>
      exit.student_id === exitForm.student_id && exit.id !== editingExitId
    ) || null,
    [todayExits, exitForm.student_id, editingExitId]
  );

  const handlePrintExitCard = (exit: ExitRecord) => {
    const student = students.find(s => s.id === exit.student_id);
    const ok = printExitCard(exit, student, documentSettings, exit.supervisor_name || currentUserLabel);
    if (!ok) showToast('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح.', 'error');
  };

  const handlePrintViolationNotice = (violation: ViolationRecord) => {
    const student = students.find(s => s.id === violation.student_id);
    const ok = printViolationNotice(
      violation,
      student,
      documentSettings,
      violation.created_by_label || '-'
    );
    if (!ok) showToast('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح.', 'error');
  };

  // Handle Exit Form
  const handleSaveExit = async () => {
    const requesterRelation = exitForm.requesterRelation as ExitRequesterRelation | '';
    const requesterRelationOther = requesterRelation === 'other' ? exitForm.requesterRelationOther.trim() : null;

    setExitFormError('');
    if (!todayDayState.allowsEdits) {
      const message = `${todayDayState.title}: ${todayDayState.helper}`;
      setExitFormError(message);
      showToast(message, 'error');
      return;
    }
    if (!exitForm.student_id || !exitForm.reason.trim() || !requesterRelation) {
      setExitFormError('اختر الطالب والسبب وصلة المستأذن.');
      return;
    }

    if (requesterRelation === 'other' && !requesterRelationOther) {
      setExitFormError('اكتب صلة المستأذن عند اختيار «أخرى».');
      return;
    }
    if (selectedTodayExit && !duplicateExitConfirmed && !editingExitId) {
      setExitFormError('يوجد خروج مسجل لهذا الطالب اليوم. أكد أنك تريد إضافة خروج آخر.');
      return;
    }

    try {
      setExitSaving(true);
      const student = studentsById.get(exitForm.student_id);
      if (!student) throw new Error('تعذر العثور على الطالب المحدد');
      const result = await studentAffairs.execute({
        type: 'save-exit',
        exitId: editingExitId || undefined,
        studentId: student.id,
        reason: exitForm.reason,
        requesterRelation,
        requesterRelationOther,
        notes: exitForm.notes,
        supervisorName: currentUserLabel,
        createdBy: currentUserRecordId
      });
      if (!result.exit) throw new Error('Exit record was not returned');

      showToast(editingExitId ? 'تم تحديث سجل الخروج بنجاح' : 'تم تسجيل الخروج بنجاح', 'success');
      setTodayExits(previous => editingExitId
        ? previous.map(exit => exit.id === result.exit!.id ? result.exit! : exit)
        : [result.exit!, ...previous.filter(exit => exit.id !== result.exit!.id)]
      );
      setEditingExitId(null);
      setLastExitForPrint(result.exit);
      setDuplicateExitConfirmed(false);
      setExitForm({ ...EMPTY_EXIT_FORM });
    } catch (error) {
      logError(error, 'Supervision - Save Exit');
      const message = error instanceof Error ? error.message : 'تعذر حفظ سجل الخروج';
      setExitFormError(message);
      showToast(message, 'error');
    } finally {
      setExitSaving(false);
    }
  };

  const handleDeleteExit = async (exitId: string) => {
    try {
      await studentAffairs.execute({ type: 'delete-exit', exitId });
      setTodayExits(previous => previous.filter(exit => exit.id !== exitId));
      if (editingExitId === exitId) {
        setEditingExitId(null);
        setExitForm({ ...EMPTY_EXIT_FORM });
      }
      if (lastExitForPrint?.id === exitId) setLastExitForPrint(null);
      showToast('تم حذف سجل الخروج', 'success');
    } catch (error) {
      logError(error, 'Supervision - Delete Exit');
      showToast('تعذر حذف سجل الخروج', 'error');
    } finally {
      setPendingDeleteExitId(null);
    }
  };

  // Handle Violation Form
  const handleSaveViolation = async () => {
    setViolationFormError('');
    if (!todayDayState.allowsEdits) {
      const message = `${todayDayState.title}: ${todayDayState.helper}`;
      setViolationFormError(message);
      showToast(message, 'error');
      return;
    }
    if (!violationForm.student_id || !violationForm.type || violationForm.description.trim().length < 5) {
      setViolationFormError('اختر الطالب والنوع، واكتب وصفًا واضحًا من 5 أحرف على الأقل.');
      return;
    }

    try {
      setViolationSaving(true);
      const student = studentsById.get(violationForm.student_id);
      if (!student) throw new Error('تعذر العثور على الطالب المحدد');

      const result = await studentAffairs.execute({
        type: 'record-violation',
        violationId: editingViolationId || undefined,
        studentId: violationForm.student_id,
        violationType: VIOLATION_TYPES.find(v => v.value === violationForm.type)?.label || violationForm.type,
        description: violationForm.description,
        level: violationForm.level,
        actionTaken: violationForm.actionTaken,
        summonGuardian: violationForm.summonGuardian,
        createdBy: currentUserRecordId,
        createdByLabel: currentUserLabel,
        guardianNotification: violationForm.summonGuardian && student ? {
          title: notification_templates.summon.title,
          message: `${student.name}: ${notification_templates.summon.message}`
        } : undefined
      });
      if (!result.violation) throw new Error('Violation record was not returned');

      if (violationForm.summonGuardian && !result.violation.guardian_notified) {
        showToast('حُفظت المخالفة، لكن تعذر إرسال إشعار ولي الأمر', 'error');
      } else {
        showToast(editingViolationId ? 'تم تحديث المخالفة' : 'تم تسجيل المخالفة', 'success');
      }
      setLastViolationForPrint(result.violation);
      setTodayViolations(previous => editingViolationId
        ? previous.map(violation => violation.id === result.violation!.id ? result.violation! : violation)
        : [result.violation!, ...previous.filter(violation => violation.id !== result.violation!.id)]
      );
      setEditingViolationId(null);
      setViolationForm({ ...EMPTY_VIOLATION_FORM });
    } catch (error) {
      logError(error, 'Supervision - Save Violation');
      const message = error instanceof Error ? error.message : 'تعذر حفظ المخالفة';
      setViolationFormError(message);
      showToast(message, 'error');
    } finally {
      setViolationSaving(false);
    }
  };

  const handleEditViolation = (violation: ViolationRecord) => {
    const matchedType = VIOLATION_TYPES.find(type => type.label === violation.type);
    setEditingViolationId(violation.id);
    setViolationForm({
      student_id: violation.student_id,
      type: matchedType?.value || 'other',
      level: Math.max(1, Math.min(5, Number(violation.level) || 1)),
      description: violation.description || '',
      actionTaken: violation.action_taken || '',
      summonGuardian: Boolean(violation.summon_guardian)
    });
    setViolationFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteViolation = async (violationId: string) => {
    try {
      await studentAffairs.execute({ type: 'delete-violation', violationId });
      setTodayViolations(previous => previous.filter(violation => violation.id !== violationId));
      if (editingViolationId === violationId) {
        setEditingViolationId(null);
        setViolationForm({ ...EMPTY_VIOLATION_FORM });
      }
      if (lastViolationForPrint?.id === violationId) setLastViolationForPrint(null);
      showToast('تم حذف المخالفة', 'success');
    } catch (error) {
      logError(error, 'Supervision - Delete Violation');
      showToast('تعذر حذف المخالفة', 'error');
    } finally {
      setPendingDeleteViolationId(null);
    }
  };

  // Open student profile
  const openStudentProfile = async (student: Student) => {
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    setProfileStudent(student);
    setProfileData(null);
    setProfileError('');
    setProfileLoading(true);
    try {
      const [studentAttendance, affairs] = await Promise.all([
        db.getStudentAttendance(student.id),
        studentAffairs.load({ type: 'student', studentId: student.id })
      ]);
      if (profileRequestRef.current !== requestId) return;
      setProfileData({
        attendance: studentAttendance,
        exits: affairs.exits,
        violations: affairs.violations
      });
    } catch (error) {
      logError(error, 'Supervision - Load Profile Data');
      if (profileRequestRef.current === requestId) {
        setProfileError('تعذر تحميل سجل الطالب. تحقق من الاتصال ثم أعد المحاولة.');
      }
    } finally {
      if (profileRequestRef.current === requestId) {
        setProfileLoading(false);
      }
    }
  };

  const closeStudentProfile = () => {
    profileRequestRef.current += 1;
    setProfileStudent(null);
    setProfileData(null);
    setProfileError('');
    setProfileLoading(false);
  };

  // Send direct message
  const sendDirectMessage = async () => {
    if (!messageStudent || messageSending) return;
    const cleanMessage = messageText.trim();
    if (!cleanMessage) {
      setMessageError('اكتب نص الرسالة قبل الحفظ.');
      return;
    }

    setMessageSending(true);
    setMessageError('');
    try {
      await notificationCenter.execute({ type: 'send', notification: {
        id: '',
        title: 'رسالة من الإدارة',
        message: `${messageStudent.name}: ${cleanMessage}`,
        type: 'general',
        target_audience: 'guardian',
        target_id: messageStudent.id,
        created_at: new Date().toISOString(),
        is_popup: true,
        created_by: currentUser?.id
      } });

      showToast('تم حفظ الرسالة في مركز إشعارات المنصة', 'success');
      recordCommunicationActivity({
        channel: 'portal',
        status: 'stored',
        title: 'رسالة فردية',
        recipientLabel: messageStudent.name,
        recipientCount: 1
      });
      setMessageStudent(null);
      setMessageText('');
    } catch (error) {
      logError(error, 'Supervision - Store Direct Notification');
      setMessageError('تعذر حفظ الرسالة. راجع الاتصال ثم أعد المحاولة.');
      recordCommunicationActivity({
        channel: 'portal',
        status: 'failed',
        title: 'رسالة فردية',
        recipientLabel: messageStudent.name,
        recipientCount: 1,
        detail: error instanceof Error ? error.message : undefined
      });
    } finally {
      setMessageSending(false);
    }
  };

  // WhatsApp function
  const openWhatsApp = (student: Student, type: 'absent' | 'late' | 'violation') => {
    const phone = resolveStudentWhatsAppPhone(student);
    if (!phone) {
      showToast('لا يوجد رقم واتساب سعودي صالح لولي الأمر', 'error');
      return;
    }

    const messages = {
      absent: `السلام عليكم ولي أمر الطالب ${student.name}، نود إشعاركم بأن ابنكم تغيب عن المدرسة اليوم.`,
      late: `السلام عليكم ولي أمر الطالب ${student.name}، نود إشعاركم بأن ابنكم وصل متأخراً للمدرسة اليوم.`,
      violation: `السلام عليكم ولي أمر الطالب ${student.name}، نود إشعاركم بتسجيل ملاحظة سلوكية اليوم.`
    };

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(messages[type])}`, '_blank');
  };

  const openQuickSendModal = (student: Student, templateId: string = 'custom') => {
    if (!canUseWhatsAppGateway) {
      showToast('حسابك لا يملك صلاحية الإرسال عبر خادم واتساب', 'error');
      return;
    }
    setSelectedQuickSendStudent(student);
    setQuickSendTemplateId(templateId);
    setShowQuickSendModal(true);
  };

  // Quick Attendance - Late Marking Functions
  const toggleLateStudentSelection = (studentId: string) => {
    setSelectedLateStudents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(studentId)) {
        newSet.delete(studentId);
      } else {
        newSet.add(studentId);
      }
      return newSet;
    });
  };

  const handleMarkLateClick = () => {
    if (selectedLateStudents.size === 0) {
      showToast('يرجى تحديد طالب واحد على الأقل', 'error');
      return;
    }
    if (!todayDayState.allowsEdits) {
      showToast(`${todayDayState.title}: ${todayDayState.helper}`, 'error');
      return;
    }

    setLateTimeInput({ time: '07:30', date: getLocalISODate() });
    setShowLateTimeModal(true);
  };

  const handleConfirmMarkLate = async () => {
    if (selectedLateStudents.size === 0) return;

    const targetDayState = resolveSupervisorDayState(
      lateTimeInput.date,
      documentSettings || {},
      getLocalISODate()
    );
    if (!targetDayState.allowsEdits) {
      showToast(`${targetDayState.title}: ${targetDayState.helper}`, 'error');
      return;
    }

    try {
      setLateRecordLoading(true);
      const result = await db.bulkMarkLate({
        student_ids: Array.from(selectedLateStudents),
        date: lateTimeInput.date,
        time: lateTimeInput.time
      });

      if (result.success) {
        showToast(`✓ ${result.message}`, 'success');
        setShowLateTimeModal(false);
        setSelectedLateStudents(new Set());
        void fetchSchoolDayData();
      } else {
        showToast(result.message || 'فشل تسجيل التأخير', 'error');
      }
    } catch (error) {
      logError(error, 'Supervision - Confirm Mark Late');
      showToast('حدث خطأ أثناء التسجيل', 'error');
    } finally {
      setLateRecordLoading(false);
    }
  };

  // Edit Attendance - Open modal for editing
  const handleOpenEditAttendance = (student: Student) => {
    const record = attendanceByStudentId.get(student.id);
    if (record) {
      setEditAttendanceStudent(student);
      setEditAttendanceStatus(record.status);
      // Extract time from timestamp
      if (record.timestamp) {
        const date = new Date(record.timestamp);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        setEditAttendanceTime(`${hours}:${minutes}`);
      } else {
        setEditAttendanceTime('07:30');
      }
    }
  };

  // Save edited attendance
  const handleSaveEditAttendance = async () => {
    if (!editAttendanceStudent) return;
    if (!todayDayState.allowsEdits) {
      showToast(`${todayDayState.title}: ${todayDayState.helper}`, 'error');
      return;
    }

    try {
      setLateRecordLoading(true);
      let result: { success: boolean; message: string };
      if (editAttendanceStatus === 'absent') {
        result = await db.addManualAbsence({
          student_id: editAttendanceStudent.id,
          date: getLocalISODate()
        });
      } else if (editAttendanceStatus === 'late') {
        result = await db.bulkMarkLate({
          student_ids: [editAttendanceStudent.id],
          date: getLocalISODate(),
          time: editAttendanceTime
        });
      } else {
        result = await db.addManualAttendance({
          student_id: editAttendanceStudent.id,
          date: getLocalISODate(),
          time: editAttendanceTime
        });
      }

      if (!result.success) throw new Error(result.message);

      showToast('✓ تم تعديل الحضور بنجاح', 'success');
      setEditAttendanceStudent(null);
      void fetchSchoolDayData();
    } catch (error) {
      logError(error, 'Supervision - Edit Attendance');
      showToast(error instanceof Error ? error.message : 'فشل تعديل الحضور', 'error');
    } finally {
      setLateRecordLoading(false);
    }
  };

  // Delete Attendance Record
  const handleDeleteAttendance = async (studentId: string) => {
    if (!confirm('هل أنت متأكد من حذف تسجيل الحضور لهذا الطالب؟')) return;

    try {
      await db.deleteAttendance(studentId, getLocalISODate());
      showToast('✓ تم حذف التسجيل بنجاح', 'success');
      void fetchSchoolDayData();
    } catch (error) {
      logError(error, 'Supervision - Delete Attendance');
      showToast('فشل حذف التسجيل', 'error');
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Manual Attendance Functions
  // ═══════════════════════════════════════════════════════════════
  const manualSections = useMemo(
    () => getSectionsForClass(manualClass || undefined),
    [getSectionsForClass, manualClass]
  );

  const manualStudentList = useMemo(() => {
    let list = students;
    if (manualClass) list = list.filter(s => labelsMatch(s.class_name, manualClass));
    if (manualSection) list = list.filter(s => labelsMatch(s.section, manualSection));
    if (manualSearch.trim()) {
      const q = manualSearch.trim().toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    }
    return list.sort((a, b) => compareLabels(a.name || '', b.name || ''));
  }, [students, manualClass, manualSection, manualSearch]);

  const manualAttendanceByStudentId = useMemo(
    () => buildSupervisorAttendanceIndex(manualAttendance, manualDate),
    [manualAttendance, manualDate]
  );

  const manualDayState = useMemo(
    () => resolveSupervisorDayState(manualDate, documentSettings || {}, getLocalISODate()),
    [manualDate, documentSettings]
  );

  const manualStats = useMemo(() => {
    const summary = summarizeSupervisorAttendance(
      manualStudentList.map(student => student.id),
      manualAttendanceByStudentId
    );
    return { ...summary, progress: summary.completionRate };
  }, [manualStudentList, manualAttendanceByStudentId]);

  const ensureManualDayEditable = () => {
    if (manualDayState.allowsEdits) return true;
    showToast(`${manualDayState.title}: ${manualDayState.helper}`, 'error');
    return false;
  };

  const handleManualMark = async (studentId: string, status: 'present' | 'late' | 'absent') => {
    if (!ensureManualDayEditable()) return;
    setManualSaving(studentId);
    try {
      let result: { success: boolean; message: string; status?: 'present' | 'late' };
      if (status === 'absent') {
        result = await db.addManualAbsence({
          student_id: studentId,
          date: manualDate
        });
      } else if (status === 'late') {
        result = await db.bulkMarkLate({
          student_ids: [studentId],
          date: manualDate,
          time: manualTime
        });
      } else {
        result = await db.addManualAttendance({
          student_id: studentId,
          date: manualDate,
          time: manualTime
        });
      }

      if (!result.success) throw new Error(result.message);
      if (status === 'present' && result.status === 'late') {
        showToast('سُجّل الطالب متأخرًا وفق وقت الوصول المحدد', 'success');
      }
      await refreshManualAttendance();
    } catch (error) {
      logError(error, 'Supervision - Manual Attendance Mark');
      showToast(error instanceof Error ? error.message : 'فشل تسجيل الحضور', 'error');
    } finally {
      setManualSaving(null);
    }
  };

  const handleMarkAllPresent = async () => {
    if (!ensureManualDayEditable()) return;
    if (!manualStudentList.length) return;
    const unrecorded = manualStudentList.filter(s => !manualAttendanceByStudentId.has(s.id));
    if (!unrecorded.length) {
      showToast('جميع الطلاب محضّرون بالفعل', 'success');
      return;
    }
    if (!confirm(`تحضير ${unrecorded.length} طالب كحاضرين؟`)) return;

    setManualSaving('all');
    try {
      let count = 0;
      const batchSize = 20;
      for (let offset = 0; offset < unrecorded.length; offset += batchSize) {
        const batch = unrecorded.slice(offset, offset + batchSize);
        const results = await Promise.allSettled(batch.map(student =>
          db.addManualAttendance({ student_id: student.id, date: manualDate, time: manualTime })
        ));
        count += results.filter(result => result.status === 'fulfilled' && result.value.success).length;
      }
      const failedCount = unrecorded.length - count;
      showToast(
        failedCount > 0
          ? `تم تسجيل ${count} طالب، وتعذر تسجيل ${failedCount}`
          : `✓ تم تسجيل وصول ${count} طالب`,
        failedCount > 0 ? 'error' : 'success'
      );
      await refreshManualAttendance();
    } catch (error) {
      logError(error, 'Supervision - Mark All Present');
      showToast('حدث خطأ', 'error');
    } finally {
      setManualSaving(null);
    }
  };

  // Reset Day - Delete all attendance for a specific date
  const handleResetDay = async () => {
    if (!confirm(`هل أنت متأكد من مسح جميع تسجيلات الحضور ليوم ${resetDayDate}؟\n\nهذا الإجراء لا يمكن التراجع عنه!`)) {
      return;
    }

    try {
      setResetDayLoading(true);

      // Get all attendance records for the day
      const dayAttendance = await db.getAttendance(resetDayDate);

      // Delete each record
      for (const record of dayAttendance) {
        await db.deleteAttendance(record.student_id, resetDayDate);
      }

      showToast(`✓ تم مسح ${dayAttendance.length} تسجيل حضور`, 'success');
      setShowResetDayModal(false);
      void fetchSchoolDayData();
    } catch (error) {
      logError(error, 'Supervision - Reset Day');
      showToast('فشل مسح التسجيلات', 'error');
    } finally {
      setResetDayLoading(false);
    }
  };

  // Get data for export based on type, filters and sort
  const getExportData = (type: AttendanceExportType, sortBy: 'name' | 'id' = 'name') => {
    // Start with all students (not pre-filtered) so we can apply export-specific filters
    let list = students.map(student => {
      const record = attendanceByStudentId.get(student.id);
      return {
        ...student,
        attendanceStatus: getSupervisorAttendanceStatus(student.id, attendanceByStudentId),
        timestamp: record?.timestamp,
        minutes_late: record?.minutes_late || 0
      };
    });

    const normExportClass = normalizeLabel(exportFilterClass);
    const normExportSection = normalizeLabel(exportFilterSection);

    // Apply export-specific class/section filters
    if (normExportClass) {
      list = list.filter(s => labelsMatch(s.class_name, exportFilterClass));
    }
    if (normExportSection) {
      list = list.filter(s => labelsMatch(s.section, exportFilterSection));
    }

    // Apply status filter
    if (type !== 'all') {
      list = list.filter(s => s.attendanceStatus === type);
    }

    // Sort the data
    list = list.sort((a, b) => {
      // First sort by class
      const classCompare = compareLabels(a.class_name || '', b.class_name || '');
      if (classCompare !== 0) return classCompare;

      // Then by section
      const sectionCompare = compareLabels(a.section || '', b.section || '');
      if (sectionCompare !== 0) return sectionCompare;

      // Finally by name or id
      if (sortBy === 'name') {
        return compareLabels(a.name || '', b.name || '');
      } else {
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      }
    });

    return list;
  };

  // Export functions
  const exportToCSV = (type: AttendanceExportType = 'all', sortBy: 'name' | 'id' = 'name') => {
    const exportData = getExportData(type, sortBy);
    if (exportData.length === 0) {
      showToast('لا توجد سجلات مطابقة للتصدير', 'error');
      return;
    }
    const statusLabels: Record<string, string> = {
      all: 'الكل',
      present: 'الحضور',
      late: 'المتأخرون',
      absent: 'الغائبون',
      unrecorded: 'غير_المحضّرين'
    };

    const filterLabel = exportFilterClass
      ? `${exportFilterClass}${exportFilterSection ? `-${exportFilterSection}` : ''}_`
      : '';

    const data = exportData.map((s, i) => ({
      '#': i + 1,
      'الاسم': s.name,
      'المعرف': s.id,
      'الصف': s.class_name,
      'الفصل': s.section,
      'الحالة': getAttendanceStatusLabel(s.attendanceStatus),
      'وقت الحضور': s.timestamp ? new Date(s.timestamp).toLocaleTimeString('ar-SA') : '-',
      'دقائق التأخر': s.minutes_late || 0
    }));

    FileService.exportToCSV(data, `حضور_${filterLabel}${statusLabels[type]}_${getLocalISODate()}`);
    showToast('تم تصدير الملف بنجاح', 'success');
    setShowExportModal(false);
    // Reset export filters
    setExportFilterClass('');
    setExportFilterSection('');
  };

  const exportToXLSX = (type: AttendanceExportType = 'all', sortBy: 'name' | 'id' = 'name') => {
    const exportData = getExportData(type, sortBy);
    if (exportData.length === 0) {
      showToast('لا توجد سجلات مطابقة للتصدير', 'error');
      return;
    }
    const statusLabels: Record<string, string> = {
      all: 'الكل',
      present: 'الحضور',
      late: 'المتأخرون',
      absent: 'الغائبون',
      unrecorded: 'غير_المحضّرين'
    };

    const filterLabel = exportFilterClass
      ? `${exportFilterClass}${exportFilterSection ? `-${exportFilterSection}` : ''}_`
      : '';

    const data = exportData.map((s, i) => ({
      '#': i + 1,
      'الاسم': s.name,
      'المعرف': s.id,
      'الصف': s.class_name,
      'الفصل': s.section,
      'الحالة': getAttendanceStatusLabel(s.attendanceStatus),
      'وقت الحضور': s.timestamp ? new Date(s.timestamp).toLocaleTimeString('ar-SA') : '-',
      'دقائق التأخر': s.minutes_late || 0
    }));

    FileService.exportToXLSX(data, `حضور_${filterLabel}${statusLabels[type]}_${getLocalISODate()}`);
    showToast('تم تصدير الملف بنجاح', 'success');
    setShowExportModal(false);
    setExportFilterClass('');
    setExportFilterSection('');
  };

  const exportToPDF = (type: AttendanceExportType = 'all', sortBy: 'name' | 'id' = 'name') => {
    const exportData = getExportData(type, sortBy);
    if (exportData.length === 0) {
      showToast('لا توجد سجلات مطابقة للتصدير', 'error');
      return;
    }
    const statusLabels: Record<string, string> = {
      all: 'الكل',
      present: 'الحضور',
      late: 'المتأخرون',
      absent: 'الغائبون',
      unrecorded: 'غير_المحضّرين'
    };
    const filterLabel = exportFilterClass
      ? `${exportFilterClass}${exportFilterSection ? `-${exportFilterSection}` : ''}_`
      : '';
    const data = exportData.map((s, i) => ({
      '#': i + 1,
      name: s.name,
      id: s.id,
      class_name: s.class_name,
      section: s.section,
      status: getAttendanceStatusLabel(s.attendanceStatus),
      timestamp: s.timestamp ? new Date(s.timestamp).toLocaleTimeString('ar-SA') : '-',
      minutes_late: s.minutes_late || 0
    }));

    FileService.exportToPDF(attendanceExportColumns, data, `حضور_${filterLabel}${statusLabels[type]}_${getLocalISODate()}`, `قائمة ${statusLabels[type]}`);
    showToast('تم تصدير الملف بنجاح', 'success');
    setShowExportModal(false);
    setExportFilterClass('');
    setExportFilterSection('');
  };

  const printReport = (type: AttendanceExportType = 'all', sortBy: 'name' | 'id' = 'name') => {
    const exportData = getExportData(type, sortBy);
    if (exportData.length === 0) {
      showToast('لا توجد سجلات مطابقة للطباعة', 'error');
      return;
    }
    const statusLabels: Record<string, string> = {
      all: 'جميع الطلاب',
      present: 'الحاضرون',
      late: 'المتأخرون',
      absent: 'الغائبون',
      unrecorded: 'غير المُحضّرين'
    };

    const filterLabel = exportFilterClass || 'جميع الصفوف';
    const sectionLabel = exportFilterSection ? ` - ${exportFilterSection}` : '';

    // Calculate stats for filtered data
    const filteredStats = {
      present: exportData.filter(s => s.attendanceStatus === 'present').length,
      late: exportData.filter(s => s.attendanceStatus === 'late').length,
      absent: exportData.filter(s => s.attendanceStatus === 'absent').length,
      unrecorded: exportData.filter(s => s.attendanceStatus === 'unrecorded').length
    };

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('فشل فتح نافذة الطباعة', 'error');
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <title>تقرير ${escapeHtml(statusLabels[type])} - ${getLocalISODate()}</title>
        <style>
          * { font-family: 'Tajawal', Arial, sans-serif; }
          body { padding: 20px; }
          h1 { text-align: center; color: #333; margin-bottom: 10px; }
          h2 { text-align: center; color: #666; font-size: 14px; margin-bottom: 20px; }
          .sort-info { text-align: center; color: #888; font-size: 12px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 10px; text-align: right; }
          th { background-color: #7c3aed; color: white; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          .status-present { color: #10b981; font-weight: bold; }
          .status-late { color: #f59e0b; font-weight: bold; }
          .status-absent { color: #ef4444; font-weight: bold; }
          .status-unrecorded { color: #64748b; font-weight: bold; }
          .summary { display: flex; justify-content: center; gap: 30px; margin-bottom: 20px; }
          .summary-item { text-align: center; padding: 10px 20px; border-radius: 8px; }
          .summary-item.present { background: #d1fae5; }
          .summary-item.late { background: #fef3c7; }
          .summary-item.absent { background: #fee2e2; }
          .summary-item.unrecorded { background: #e2e8f0; }
          @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <h1>تقرير ${escapeHtml(statusLabels[type])}</h1>
        <h2>التاريخ: ${new Date().toLocaleDateString('ar-SA')} | ${escapeHtml(filterLabel)}${escapeHtml(sectionLabel)}</h2>
        <p class="sort-info">مرتب حسب: الصف > الفصل > ${sortBy === 'name' ? 'الاسم أبجدياً' : 'رقم المعرف'}</p>
        
        <div class="summary">
          <div class="summary-item present"><strong>${filteredStats.present}</strong><br>حاضر</div>
          <div class="summary-item late"><strong>${filteredStats.late}</strong><br>متأخر</div>
          <div class="summary-item absent"><strong>${filteredStats.absent}</strong><br>غائب</div>
          <div class="summary-item unrecorded"><strong>${filteredStats.unrecorded}</strong><br>غير مُحضّر</div>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>الاسم</th>
              <th>المعرف</th>
              <th>الصف</th>
              <th>الفصل</th>
              <th>الحالة</th>
              <th>وقت الحضور</th>
              <th>دقائق التأخر</th>
            </tr>
          </thead>
          <tbody>
            ${exportData.map((s, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.id)}</td>
                <td>${escapeHtml(s.class_name)}</td>
                <td>${escapeHtml(s.section)}</td>
                <td class="status-${s.attendanceStatus}">${getAttendanceStatusLabel(s.attendanceStatus)}</td>
                <td>${s.timestamp ? new Date(s.timestamp).toLocaleTimeString('ar-SA') : '-'}</td>
                <td>${s.minutes_late || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <script>window.onload = () => { window.print(); }</script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    setShowExportModal(false);
    // Reset export filters
    setExportFilterClass('');
    setExportFilterSection('');
  };

  const StudentSelectComponent = ({
    value,
    onChange,
    label = 'الطالب *',
    context,
    disabled = false
  }: {
    value: string;
    onChange: (id: string) => void;
    label?: string;
    context: 'exit' | 'violation';
    disabled?: boolean;
  }) => {
    const filters = context === 'exit' ? exitStudentFilters : violationStudentFilters;
    const [searchText, setSearchText] = useState('');
    const searchInputRef = React.useRef<HTMLInputElement>(null);
    const [caret, setCaret] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

    const availableSections = useMemo(
      () => getSectionsForClass(filters.class_name || undefined),
      [filters.class_name, getSectionsForClass]
    );

    const filteredStudents = useMemo(() => {
      let list = [...students];
      if (filters.class_name) {
        list = list.filter(student => labelsMatch(student.class_name, filters.class_name));
      }
      if (filters.section) {
        list = list.filter(student => labelsMatch(student.section, filters.section));
      }

      const query = searchText.trim().toLowerCase();
      if (query) {
        list = list.filter(s =>
          s.name.toLowerCase().includes(query) ||
          s.id.toLowerCase().includes(query)
        );
      }
      return list.sort((a, b) => compareLabels(a.name || '', b.name || ''));
    }, [students, filters.class_name, filters.section, searchText]);

    useEffect(() => {
      setSearchText('');
      setCaret({ start: 0, end: 0 });
    }, [filters.class_name, filters.section, context]);

    useEffect(() => {
      if (searchInputRef.current) {
        searchInputRef.current.setSelectionRange(caret.start, caret.end);
      }
    }, [caret, searchText]);

    const updateFilters = (partial: Partial<typeof filters>) => {
      const formatted: Partial<typeof filters> = { ...partial };
      if (partial.class_name !== undefined) {
        formatted.class_name = formatLabel(partial.class_name);
      }
      if (partial.section !== undefined) {
        formatted.section = formatLabel(partial.section);
      }
      if (context === 'exit') {
        setExitStudentFilters(prev => ({ ...prev, ...formatted }));
      } else {
        setViolationStudentFilters(prev => ({ ...prev, ...formatted }));
      }
    };

    return (
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-300">{label}</label>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={filters.class_name}
            onChange={e => updateFilters({ class_name: e.target.value, section: '' })}
            className="input-glass p-2 rounded-xl text-sm"
            disabled={disabled}
          >
            <option value="">كل الصفوف</option>
            {uniqueClasses.map(cls => (
              <option key={cls} value={cls}>{cls}</option>
            ))}
          </select>

          <select
            value={filters.section}
            onChange={e => updateFilters({ section: e.target.value })}
            className="input-glass p-2 rounded-xl text-sm"
            disabled={disabled || !filters.class_name}
          >
            <option value="">كل الفصول</option>
            {availableSections.map(section => (
              <option key={section} value={section}>{section}</option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="بحث بالاسم أو المعرف..."
            value={searchText}
            disabled={disabled}
            onChange={e => {
              const { selectionStart, selectionEnd } = e.currentTarget;
              setSearchText(e.target.value);
              setCaret({
                start: selectionStart ?? e.target.value.length,
                end: selectionEnd ?? e.target.value.length
              });
            }}
            className="w-full input-glass pr-10 p-2.5 rounded-xl text-sm"
          />
        </div>

        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full input-glass p-3 rounded-xl disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          size={6}
        >
          <option value="">اختر الطالب...</option>
          {filteredStudents.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} | {s.id} | {s.class_name}/{s.section}
            </option>
          ))}
        </select>

        <p className="text-xs text-gray-500">{filteredStudents.length} طالب</p>
      </div>
    );
  };

  // Loading State
  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-12 print:bg-white" dir="rtl">
        <div className={`rounded-[2rem] p-6 ${surfaceClass}`}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <div className="h-4 w-28 animate-pulse rounded-full bg-white/10" />
              <div className="h-10 w-64 animate-pulse rounded-2xl bg-white/10" />
              <div className="h-4 w-80 max-w-full animate-pulse rounded-full bg-white/10" />
            </div>
            <div className="grid w-full grid-cols-2 gap-3 lg:w-[420px]">
              {[0, 1, 2, 3].map(item => (
                <div key={item} className="h-20 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" />
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map(item => (
            <div key={item} className="h-32 animate-pulse rounded-[1.5rem] border border-white/10 bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12 print:bg-white" dir="rtl">

      {/* Header */}
      <div className={`relative overflow-hidden rounded-[2rem] p-5 sm:p-6 print:hidden ${surfaceClass}`}>
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary-200/45 to-transparent" />
        <div className="absolute -left-20 top-8 h-56 w-56 rounded-full bg-primary-400/10 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-secondary-500/10 blur-3xl" />

        <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary-300/15 bg-primary-400/10 px-3 py-1.5 text-xs font-semibold text-primary-100">
                <span className="h-2 w-2 rounded-full bg-primary-300 shadow-[0_0_16px_rgb(var(--color-primary-300)_/_0.55)]" />
                تشغيل مباشر
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-xs text-slate-300 tabular-nums">
                {todayLabel}
              </span>
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${activeTabMeta.activeClass}`}>
                {activeTabMeta.label}
              </span>
            </div>

            <div>
              <h1 className="flex items-center gap-3 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <Shield className="h-6 w-6 text-primary-200" />
                </span>
                بوابة الإشراف
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                مركز تشغيل يومي لمتابعة حضور الطلاب، تسجيل الاستئذان، ضبط الملاحظات السلوكية، وإرسال التنبيهات من شاشة واحدة.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {operationTiles.map(tile => (
              <div key={tile.label} className={`rounded-2xl border p-4 ${tile.className}`}>
                <p className="text-xs font-medium text-slate-300">{tile.label}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <p className="font-mono text-2xl font-semibold leading-none tabular-nums text-white">{tile.value}</p>
                  <span className="text-[11px] text-slate-400">{tile.hint}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Kiosk Presence Banner */}
        {onlineKiosks.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-3 border-t border-white/10 pt-4">
            <div className="flex w-full items-center gap-2 mb-2">
              <Monitor className="h-4 w-4 text-primary-400" />
              <h3 className="text-sm font-semibold text-white">أكشاك الحضور النشطة</h3>
            </div>
            {onlineKiosks.map(kiosk => (
              <div key={kiosk.kioskId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="relative flex h-2.5 w-2.5">
                  {kiosk.status === 'online' && (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </>
                  )}
                  {kiosk.status === 'emergency' && (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                    </>
                  )}
                  {kiosk.status === 'offline' && (
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-500"></span>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-slate-200">{kiosk.kioskName}</span>
                  <span className="text-[10px] text-slate-400">
                    {kiosk.status === 'online' ? 'متصل وجاهز' : kiosk.status === 'emergency' ? 'وضع الطوارئ' : 'غير متصل'}
                    {kiosk.syncPending > 0 && ` • ${kiosk.syncPending} سجل معلق`}
                    {!kiosk.cameraReady && kiosk.status !== 'offline' && ' • الكاميرا مغلقة'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="relative mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-xs text-slate-500">
            آخر تحديث يعتمد على المزامنة المباشرة والتحديث اليدوي عند الحاجة.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { void fetchSchoolDayData(); }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-slate-200 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.1] active:translate-y-0"
              title="تحديث"
            >
              <RefreshCcw className="h-4 w-4" />
              تحديث
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={`grid grid-cols-1 gap-3 rounded-[1.5rem] p-2 sm:grid-cols-2 lg:grid-cols-4 print:hidden ${mutedSurfaceClass}`}>
        {supervisionTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`group relative flex min-h-[76px] items-center gap-3 rounded-2xl border px-4 py-3 text-right transition duration-200 hover:-translate-y-0.5 active:translate-y-0 ${isActive
              ? tab.activeClass
              : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-white'
              }`}
          >
            <span className={`h-10 w-1 rounded-full transition ${isActive ? tab.markerClass : 'bg-white/10 group-hover:bg-white/25'}`} />
            <Icon className="h-5 w-5 flex-shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{tab.label}</span>
              <span className="mt-1 block truncate text-xs text-slate-500 group-hover:text-slate-400">{tab.description}</span>
            </span>
          </button>
          );
        })}
      </div>

      {/* ===================== TAB 1: ATTENDANCE ===================== */}
      {activeTab === 'attendance' && (
        <div className="space-y-6">
          {/* Sub-tab toggle: Monitor vs Manual Attendance */}
          <div className={`flex w-fit gap-1.5 rounded-2xl p-1.5 ${mutedSurfaceClass}`}>
            <button
              onClick={() => setAttendanceSubView('monitor')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition duration-200 active:scale-[0.98] ${attendanceSubView === 'monitor'
                ? 'border border-secondary-400/30 bg-secondary-500/15 text-secondary-50'
                : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'}`}
            >
              <LayoutDashboard className="w-4 h-4" />
              المتابعة
            </button>
            <button
              onClick={() => setAttendanceSubView('manual')}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition duration-200 active:scale-[0.98] ${attendanceSubView === 'manual'
                ? 'border border-primary-400/30 bg-primary-500/15 text-primary-50'
                : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'}`}
            >
              <CheckSquare className="w-4 h-4" />
              التحضير اليدوي
            </button>
          </div>

          {/* ═══ Manual Attendance Sub-View ═══ */}
          {attendanceSubView === 'manual' && (
            <div className="space-y-5">
              {/* Controls */}
              <div className={`rounded-[1.5rem] p-5 ${surfaceClass} border-primary-400/20`}>
                <div className="flex flex-col md:flex-row items-start md:items-end gap-4">
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">الصف</label>
                      <select
                        value={manualClass}
                        onChange={e => { setManualClass(formatLabel(e.target.value)); setManualSection(''); }}
                        className="w-full input-glass p-2.5 rounded-xl text-sm"
                      >
                        <option value="">كل الصفوف</option>
                        {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">الفصل</label>
                      <select
                        value={manualSection}
                        onChange={e => setManualSection(formatLabel(e.target.value))}
                        className="w-full input-glass p-2.5 rounded-xl text-sm"
                        disabled={!manualClass}
                      >
                        <option value="">كل الفصول</option>
                        {manualSections.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">التاريخ</label>
                      <input
                        type="date"
                        value={manualDate}
                        onChange={e => setManualDate(e.target.value)}
                        max={todayDate}
                        className="w-full input-glass p-2.5 rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">الوقت</label>
                      <input
                        type="time"
                        value={manualTime}
                        onChange={e => setManualTime(e.target.value)}
                        className="w-full input-glass p-2.5 rounded-xl text-sm"
                      />
                    </div>
                  </div>
                </div>
                {/* Search + Quick Actions */}
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      placeholder="بحث بالاسم أو المعرف..."
                      value={manualSearch}
                      onChange={e => setManualSearch(e.target.value)}
                      className="w-full input-glass pr-10 py-2.5 rounded-xl text-sm"
                    />
                  </div>
                  <button
                    onClick={handleMarkAllPresent}
                    disabled={manualSaving === 'all' || !manualStudentList.length || !manualDayState.allowsEdits || manualAttendanceLoading}
                    className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/15 px-5 py-2.5 text-sm font-bold text-emerald-50 transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-500/20 active:translate-y-0 disabled:opacity-50"
                  >
                    {manualSaving === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                    تسجيل وصول غير المُحضّرين
                  </button>
                </div>
              </div>

              {!manualDayState.allowsEdits && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-amber-100">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">{manualDayState.title}</p>
                    <p className="mt-1 text-sm text-amber-100/75">{manualDayState.helper} يمكنك مراجعة السجلات دون تعديلها.</p>
                  </div>
                </div>
              )}

              {manualAttendanceError && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-rose-100">
                  <span>{manualAttendanceError}</span>
                  <button
                    onClick={() => void refreshManualAttendance(true)}
                    className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-xs font-bold hover:bg-rose-500/20"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              )}

              {/* Progress & Stats */}
              {manualStudentList.length > 0 && (
                <div className={`rounded-[1.5rem] p-4 ${surfaceClass} border-primary-400/15`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-white">تقدم التحضير</span>
                    <span className="text-sm font-mono text-primary-300">{manualStats.recorded}/{manualStats.total}</span>
                  </div>
                  <div className="h-3 bg-white/5 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-gradient-to-r from-primary-500 to-secondary-500 rounded-full transition-all duration-500"
                      style={{ width: `${manualStats.progress}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-4">
                    <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="text-lg font-bold text-emerald-400">{manualStats.present}</div>
                      <div className="text-[10px] text-emerald-300">حاضر</div>
                    </div>
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <div className="text-lg font-bold text-amber-400">{manualStats.late}</div>
                      <div className="text-[10px] text-amber-300">متأخر</div>
                    </div>
                    <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20">
                      <div className="text-lg font-bold text-red-400">{manualStats.absent}</div>
                      <div className="text-[10px] text-red-300">غائب مسجل</div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-500/10 border border-slate-500/20">
                      <div className="text-lg font-bold text-slate-300">{manualStats.unrecorded}</div>
                      <div className="text-[10px] text-slate-400">غير مُحضّر</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Student List */}
              {!manualClass ? (
                <div className={`rounded-[1.5rem] py-16 text-center ${surfaceClass}`}>
                  <GraduationCap className="w-16 h-16 text-primary-500/30 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-white mb-2">اختر الصف والفصل</h3>
                  <p className="text-sm text-gray-400">حدد الصف والفصل لعرض قائمة الطلاب والبدء بالتحضير</p>
                </div>
              ) : manualAttendanceLoading ? (
                <div className={`flex items-center justify-center gap-3 rounded-[1.5rem] py-16 text-slate-300 ${surfaceClass}`}>
                  <Loader2 className="h-5 w-5 animate-spin text-primary-300" />
                  جاري تحميل سجلات {manualDate}...
                </div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
                  {manualStudentList.map(student => {
                    const record = manualAttendanceByStudentId.get(student.id);
                    const status = record?.status || null;
                    const isSaving = manualSaving === student.id;

                    return (
                      <div
                        key={student.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${status === 'present' ? 'bg-emerald-500/5 border-emerald-500/20' :
                          status === 'late' ? 'bg-amber-500/5 border-amber-500/20' :
                            status === 'absent' ? 'bg-rose-500/5 border-rose-500/20' :
                              'bg-white/[0.02] border-white/5 hover:border-white/15'}`}
                      >
                        {/* Status Indicator */}
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${status === 'present' ? 'bg-emerald-400' :
                          status === 'late' ? 'bg-amber-400' :
                            status === 'absent' ? 'bg-rose-400' :
                              'bg-gray-600'}`}
                        />

                        {/* Student Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-white text-sm truncate">{student.name}</p>
                          <p className="text-[11px] text-gray-400">{student.class_name}/{student.section} • <span className="font-mono text-gray-500">{student.id}</span></p>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-1.5 shrink-0">
                          {isSaving ? (
                            <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
                          ) : (
                            <>
                              <button
                                onClick={() => handleManualMark(student.id, 'present')}
                                disabled={!manualDayState.allowsEdits}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${status === 'present'
                                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'} disabled:cursor-not-allowed disabled:opacity-40`}
                                title="تسجيل الوصول حسب الوقت المحدد"
                              >
                                <UserCheck className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleManualMark(student.id, 'late')}
                                disabled={!manualDayState.allowsEdits}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${status === 'late'
                                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20'} disabled:cursor-not-allowed disabled:opacity-40`}
                                title="متأخر"
                              >
                                <Clock className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleManualMark(student.id, 'absent')}
                                disabled={!manualDayState.allowsEdits}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${status === 'absent'
                                  ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                                  : 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'} disabled:cursor-not-allowed disabled:opacity-40`}
                                title="غائب"
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {manualStudentList.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <p>لا يوجد طلاب مطابقين</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══ Monitor Sub-View (existing attendance content) ═══ */}
          {attendanceSubView === 'monitor' && (<>
            {!todayDayState.allowsEdits && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-amber-100">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-bold">{todayDayState.title}</p>
                  <p className="mt-1 text-sm text-amber-100/75">{todayDayState.helper} المتابعة متاحة للقراءة فقط.</p>
                </div>
              </div>
            )}
            {/* Stats Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {attendanceStatCards.map(card => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    className={`group relative overflow-hidden rounded-[1.5rem] border p-5 transition duration-200 hover:-translate-y-1 ${surfaceClass} ${card.cardClass}`}
                  >
                    <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-white/25" />
                    <div className="relative flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-300">{card.label}</p>
                        <p className={`mt-3 font-mono text-4xl font-semibold leading-none tabular-nums ${card.valueClass}`}>
                          {card.value}
                        </p>
                        <p className="mt-2 text-xs text-slate-500">{card.hint}</p>
                      </div>
                      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 ${card.iconClass}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                    </div>
                    {'progress' in card && (
                      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${card.progressClass}`}
                          style={{ width: `${card.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Filters & Actions */}
            <div className={`rounded-[1.5rem] p-4 ${surfaceClass}`}>
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="بحث بالاسم أو المعرف..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full input-glass pr-10 py-2.5 rounded-xl text-sm"
                  />
                </div>

                {/* Class Filter */}
                <select
                  value={filterClass}
                  onChange={e => { setFilterClass(formatLabel(e.target.value)); setFilterSection(''); }}
                  className="input-glass py-2.5 px-4 rounded-xl text-sm min-w-[140px]"
                >
                  <option value="">كل الصفوف</option>
                  {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                {/* Section Filter */}
                <select
                  value={filterSection}
                  onChange={e => setFilterSection(formatLabel(e.target.value))}
                  className="input-glass py-2.5 px-4 rounded-xl text-sm min-w-[120px]"
                >
                  <option value="">كل الفصول</option>
                  {uniqueSections.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                {/* Status Filter */}
                <div className="flex gap-1 bg-black/20 p-1 rounded-xl">
                  {[
                    { value: 'all', label: 'الكل' },
                    { value: 'present', label: 'حضور' },
                    { value: 'late', label: 'متأخر' },
                    { value: 'absent', label: 'غائب' },
                    { value: 'unrecorded', label: 'غير مُحضّر' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFilterStatus(opt.value as 'all' | SupervisorAttendanceStatus)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterStatus === opt.value
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-400 hover:text-white'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Bulk Action Button */}
                {selectedStudents.size > 0 && (
                  <button
                    onClick={() => {
                      setBulkMessage(notification_templates[bulkTemplate].message);
                      setBulkError('');
                      setShowBulkModal(true);
                    }}
                    className="flex items-center gap-2 rounded-xl border border-primary-300/20 bg-primary-500/15 px-4 py-2.5 text-sm font-bold text-primary-50 transition duration-200 hover:-translate-y-0.5 hover:bg-primary-500/20 active:translate-y-0"
                  >
                    <Bell className="w-4 h-4" />
                    إشعار أولياء الأمور ({selectedStudents.size})
                  </button>
                )}
              </div>
            </div>

            {/* Student Table */}
            <div className="space-y-6">
              {attendanceListsConfig.map(config => (
                <div key={config.key} className={`overflow-hidden rounded-[1.5rem] ${surfaceClass} ${config.tone.panelClass}`}>
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 border-b border-white/5">
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        {config.label}
                        <span className={`rounded-full border px-3 py-1 text-sm ${config.tone.badgeClass}`}>
                          {config.list.length} طالب
                        </span>
                      </h3>
                      <p className="text-xs text-gray-400">يعرض الطلاب الحاليين في هذه الحالة مع الفلاتر المطبقة</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {/* Bulk Notification Button - Only for late and absent */}
                      {(config.key === 'late' || config.key === 'absent') && config.list.length > 0 && (
                        <button
                          onClick={() => sendBulkNotificationsForList(config.list, config.key)}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-xs transition duration-200 hover:-translate-y-0.5 active:translate-y-0 ${config.tone.actionClass}`}
                        >
                          <Bell className="w-4 h-4" /> تبليغ أولياء الأمور ({config.list.length})
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const rows = buildExportRows(config.list, config.label);
                          if (rows.length === 0) { toast.warning('لا توجد بيانات لتصديرها'); return; }
                          FileService.exportToCSV(rows, `قائمة_${config.label}_${getLocalISODate()}`);
                        }}
                        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-gray-200 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.08] active:translate-y-0"
                      >
                        <Download className="w-4 h-4" /> CSV
                      </button>
                      <button
                        onClick={() => {
                          const rows = buildExportRows(config.list, config.label);
                          if (rows.length === 0) { toast.warning('لا توجد بيانات لتصديرها'); return; }
                          FileService.exportToXLSX(rows, `قائمة_${config.label}_${getLocalISODate()}`);
                        }}
                        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-gray-200 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.08] active:translate-y-0"
                      >
                        <Download className="w-4 h-4" /> XLSX
                      </button>
                      <button
                        onClick={() => {
                          const rows = buildExportRows(config.list, config.label);
                          if (rows.length === 0) { toast.warning('لا توجد بيانات للطباعة'); return; }
                          FileService.exportToPDF(attendanceExportColumns, rows, `قائمة_${config.label}_${getLocalISODate()}`, `قائمة ${config.label}`);
                        }}
                        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-gray-200 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.08] active:translate-y-0"
                      >
                        <Printer className="w-4 h-4" /> طباعة
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right text-sm">
                      <thead className="text-gray-400 border-b border-white/10">
                        <tr>
                          <th className="p-3">الطالب</th>
                          <th className="p-3">الصف</th>
                          <th className="p-3">وقت الحضور</th>
                          <th className="p-3">الحالة</th>
                          <th className="p-3">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {config.list.map(student => (
                          <tr key={student.id} className="hover:bg-white/5 transition-colors">
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/20 to-secondary-500/20 flex items-center justify-center">
                                  <GraduationCap className="w-5 h-5 text-primary-400" />
                                </div>
                                <div>
                                  <p className="font-bold text-white">{student.name}</p>
                                  <p className="text-xs text-gray-500">{student.id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="p-3 text-gray-300">{student.class_name} - {student.section}</td>
                            <td className="p-3 font-mono text-gray-400">
                              {student.timestamp
                                ? new Date(student.timestamp).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
                                : '-'
                              }
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${student.attendanceStatus === 'present'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : student.attendanceStatus === 'late'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : student.attendanceStatus === 'absent'
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                                }`}>
                                {student.attendanceStatus === 'present'
                                  ? 'حاضر'
                                  : student.attendanceStatus === 'late'
                                    ? `متأخر ${student.minutes_late}د`
                                    : student.attendanceStatus === 'absent'
                                      ? 'غائب'
                                      : 'غير مُحضّر'}
                              </span>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                {canEditStudents && (
                                  <button
                                    onClick={() => openEditStudentModal(student)}
                                    className="p-2 bg-white/5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                                    title="تعديل بيانات الطالب"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => openStudentProfile(student)}
                                  className="p-2 bg-white/5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                                  title="الملف الشخصي"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                                {(student.attendanceStatus === 'late' || student.attendanceStatus === 'absent') && (<>
                                  <button
                                    onClick={() => openWhatsApp(student, student.attendanceStatus === 'absent' ? 'absent' : 'late')}
                                    className="p-2 bg-emerald-500/10 rounded-lg hover:bg-emerald-500/20 text-emerald-400 transition-all"
                                    title="واتساب"
                                  >
                                    <MessageCircle className="w-4 h-4" />
                                  </button>
                                  {canUseWhatsAppGateway && (
                                    <button
                                      onClick={() => openQuickSendModal(student, student.attendanceStatus === 'absent' ? 'absent_warning' : 'late_warning')}
                                      className="p-2 bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-lg hover:from-green-500/30 hover:to-emerald-500/30 text-green-400 transition-all border border-green-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                                      title="إضافة إلى طابور واتساب"
                                    >
                                      <div className="relative">
                                        <Send className="w-4 h-4" />
                                        <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                        </span>
                                      </div>
                                    </button>
                                  )}
                                </>)}
                                <button
                                  onClick={() => { setExitForm({ ...exitForm, student_id: student.id }); setActiveTab('exits'); }}
                                  className="p-2 bg-secondary-500/10 rounded-lg hover:bg-secondary-500/20 text-secondary-400 transition-all"
                                  title="تسجيل خروج"
                                >
                                  <DoorOpen className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {config.list.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-gray-500">
                              لا توجد بيانات مطابقة
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

          </>)}
        </div>
      )}

      {/* ===================== TAB 2: EXITS ===================== */}
      {activeTab === 'exits' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Exit Form */}
          <div className={`rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-500/10">
                <DoorOpen className="w-6 h-6 text-sky-100" />
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-white">تسجيل خروج</h3>
                <p className="text-sm text-gray-400">إصدار إذن خروج للطالب</p>
              </div>
            </div>

            {!todayDayState.allowsEdits && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-amber-100">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-bold">{todayDayState.title}</p>
                  <p className="mt-1 text-xs text-amber-100/75">{todayDayState.helper}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {/* Enhanced Student Select */}
              <StudentSelectComponent
                value={exitForm.student_id}
                onChange={(id) => {
                  setExitForm({ ...exitForm, student_id: id });
                  setDuplicateExitConfirmed(false);
                  setExitFormError('');
                }}
                context="exit"
                disabled={Boolean(editingExitId)}
              />

              {selectedTodayExit && !editingExitId && (
                <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <p className="font-bold">للطالب خروج مسجل اليوم</p>
                  <p className="mt-1 text-xs text-amber-100/70">
                    الساعة {new Date(selectedTodayExit.exit_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })} بسبب «{selectedTodayExit.reason}».
                  </p>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={duplicateExitConfirmed}
                      onChange={event => setDuplicateExitConfirmed(event.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                    أؤكد تسجيل خروج إضافي لهذا الطالب
                  </label>
                </div>
              )}

              {/* Reason Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">السبب *</label>
                <select
                  value={exitForm.reasonType}
                  onChange={e => {
                    const value = e.target.value;
                    const selectedReason = EXIT_REASONS.find(r => r.value === value);
                    setExitForm({
                      ...exitForm,
                      reasonType: value,
                      reason: value === 'other' ? '' : (selectedReason?.label || '')
                    });
                  }}
                  className="w-full input-glass p-3 rounded-xl"
                >
                  <option value="">اختر السبب...</option>
                  {EXIT_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Custom Reason - Only show when "other" is selected */}
              {exitForm.reasonType === 'other' && (
                <div className="animate-fade-in">
                  <label className="block text-sm font-medium text-gray-300 mb-2">حدد السبب *</label>
                  <input
                    type="text"
                    value={exitForm.reason}
                    onChange={e => setExitForm({ ...exitForm, reason: e.target.value })}
                    placeholder="أدخل سبب الخروج..."
                    className="w-full input-glass p-3 rounded-xl"
                    autoFocus
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">المستأذن للطالب *</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {EXIT_REQUESTER_RELATIONS.map(item => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setExitForm({
                        ...exitForm,
                        requesterRelation: item.value,
                        requesterRelationOther: item.value === 'other' ? exitForm.requesterRelationOther : ''
                      })}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition duration-200 active:scale-[0.98] ${exitForm.requesterRelation === item.value
                        ? 'border-sky-300/35 bg-sky-500/20 text-sky-50'
                        : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-sky-300/20 hover:bg-sky-500/10'
                        }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {exitForm.requesterRelation === 'other' && (
                <div className="animate-fade-in">
                  <label className="block text-sm font-medium text-gray-300 mb-2">حدد الصلة أو القرابة *</label>
                  <input
                    type="text"
                    value={exitForm.requesterRelationOther}
                    onChange={e => setExitForm({ ...exitForm, requesterRelationOther: e.target.value })}
                    placeholder="مثال: عم، خال، جار، قريب..."
                    className="w-full input-glass p-3 rounded-xl"
                    autoFocus
                  />
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">ملاحظات</label>
                <textarea
                  value={exitForm.notes}
                  onChange={e => setExitForm({ ...exitForm, notes: e.target.value })}
                  placeholder="ملاحظات إضافية..."
                  className="w-full input-glass p-3 rounded-xl h-20 resize-none"
                />
              </div>

              <button
                onClick={handleSaveExit}
                disabled={exitSaving || !todayDayState.allowsEdits || !exitForm.student_id || !exitForm.reason.trim() || !isExitRequesterComplete}
                className="w-full rounded-xl border border-sky-300/20 bg-sky-500/15 py-3 font-bold text-sky-50 transition duration-200 hover:-translate-y-0.5 hover:bg-sky-500/20 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exitSaving ? <Loader2 className="ml-2 inline h-5 w-5 animate-spin" /> : <Check className="ml-2 inline h-5 w-5" />}
                {exitSaving ? 'جاري الحفظ...' : editingExitId ? 'تحديث السجل' : 'حفظ وتسجيل الخروج'}
              </button>
              {exitFormError && (
                <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {exitFormError}
                </div>
              )}
              {lastExitForPrint && (
                <div className="rounded-2xl border border-sky-400/20 bg-sky-500/10 p-4">
                  <p className="text-sm font-semibold text-sky-100">تم تجهيز بطاقة الاستئذان للطباعة</p>
                  <p className="mt-1 text-xs text-sky-200/70">يمكن تسليم البطاقة للطالب عند البوابة بعد الطباعة.</p>
                  <button
                    onClick={() => handlePrintExitCard(lastExitForPrint)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-sky-300/25 bg-sky-400/15 px-4 py-2.5 text-sm font-bold text-sky-50 transition duration-200 hover:-translate-y-0.5 hover:bg-sky-400/20 active:translate-y-0"
                  >
                    <Printer className="h-4 w-4" />
                    طباعة بطاقة الاستئذان
                  </button>
                </div>
              )}
              {editingExitId && (
                <button
                  onClick={() => {
                    setEditingExitId(null);
                    setDuplicateExitConfirmed(false);
                    setExitFormError('');
                    setExitForm({ ...EMPTY_EXIT_FORM });
                  }}
                  className="w-full py-3 bg-white/5 border border-white/10 rounded-xl text-gray-300 font-bold hover:bg-white/10 transition-all"
                >
                  إلغاء التعديل
                </button>
              )}
            </div>
          </div>

          {/* Today's Exits */}
          <div className={`rounded-[1.75rem] p-6 lg:col-span-2 ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
                <Clock className="w-5 h-5 text-secondary-400" />
                سجلات خروج اليوم
              </h3>
              <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-sm font-bold text-sky-200">
                {todayExits.length} سجل
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="text-gray-500 border-b border-white/10">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">الطالب</th>
                    <th className="p-3">الوقت</th>
                    <th className="p-3">السبب</th>
                    <th className="p-3">المستأذن</th>
                    <th className="p-3">المسجل</th>
                    <th className="p-3">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {todayExits.map((exit, idx) => {
                    const student = studentsById.get(exit.student_id);
                    return (
                      <tr key={exit.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-3 text-gray-500">{idx + 1}</td>
                        <td className="p-3">
                          <p className="font-bold text-white">{student?.name || exit.student_id}</p>
                          <p className="text-xs text-gray-500">{student?.class_name} - {student?.section}</p>
                        </td>
                        <td className="p-3 font-mono text-gray-400">
                          {new Date(exit.exit_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-3 text-gray-300">{exit.reason}</td>
                        <td className="p-3 text-gray-300">{getExitRequesterRelationLabel(exit)}</td>
                        <td className="p-3 text-xs text-gray-400">{exit.supervisor_name || '-'}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePrintExitCard(exit)}
                              className="p-2 bg-sky-500/10 rounded-lg hover:bg-sky-500/20 text-sky-300 transition-all"
                              title="طباعة بطاقة الاستئذان"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setExitForm({
                                  student_id: exit.student_id,
                                  reason: exit.reason,
                                  reasonType: EXIT_REASONS.find(r => r.label === exit.reason)?.value || 'other',
                                  requesterRelation: exit.requester_relation || '',
                                  requesterRelationOther: exit.requester_relation_other || '',
                                  notes: exit.notes || ''
                                });
                                setEditingExitId(exit.id);
                                setDuplicateExitConfirmed(false);
                                setExitFormError('');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="p-2 bg-secondary-500/10 rounded-lg hover:bg-secondary-500/20 text-secondary-400 transition-all"
                              title="تعديل"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            {pendingDeleteExitId === exit.id ? (
                              <div className="flex items-center gap-1 rounded-xl border border-rose-400/20 bg-rose-500/10 p-1">
                                <button
                                  onClick={() => void handleDeleteExit(exit.id)}
                                  className="rounded-lg bg-rose-500 px-2 py-1.5 text-xs font-bold text-white"
                                >
                                  تأكيد
                                </button>
                                <button
                                  onClick={() => setPendingDeleteExitId(null)}
                                  className="rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPendingDeleteExitId(exit.id)}
                                className="p-2 bg-red-500/10 rounded-lg hover:bg-red-500/20 text-red-400 transition-all"
                                title="حذف"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {todayExits.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-gray-500">
                        <DoorOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>لا توجد سجلات خروج اليوم</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 3: VIOLATIONS ===================== */}
      {activeTab === 'violations' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Violation Form */}
          <div className={`rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10">
                <AlertTriangle className="w-6 h-6 text-rose-100" />
              </div>
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-white">تسجيل مخالفة</h3>
                <p className="text-sm text-gray-400">توثيق السلوكيات المخالفة</p>
              </div>
            </div>

            {!todayDayState.allowsEdits && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-amber-100">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-bold">{todayDayState.title}</p>
                  <p className="mt-1 text-xs text-amber-100/75">{todayDayState.helper}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {/* Enhanced Student Select */}
              <StudentSelectComponent
                value={violationForm.student_id}
                onChange={(id) => {
                  setViolationForm({ ...violationForm, student_id: id });
                  setViolationFormError('');
                }}
                context="violation"
                disabled={Boolean(editingViolationId)}
              />

              {/* Violation Type */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">نوع المخالفة *</label>
                <select
                  value={violationForm.type}
                  onChange={e => setViolationForm({ ...violationForm, type: e.target.value })}
                  className="w-full input-glass p-3 rounded-xl"
                >
                  <option value="">اختر النوع...</option>
                  {VIOLATION_TYPES.map(v => (
                    <option key={v.value} value={v.value}>{v.label}</option>
                  ))}
                </select>
              </div>

              {/* Severity Level */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">مستوى الخطورة: {violationForm.level}</label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map(level => (
                    <button
                      key={level}
                      onClick={() => setViolationForm({ ...violationForm, level })}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${violationForm.level >= level
                        ? level <= 2 ? 'bg-emerald-500 text-white' : level <= 3 ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
                        : 'bg-white/10 text-gray-500'
                        }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-1 text-center">
                  {violationForm.level <= 2 ? 'بسيط' : violationForm.level <= 3 ? 'متوسط' : 'خطير'}
                </p>
              </div>

              {/* Description */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-gray-300">وصف المخالفة *</label>
                  <span className="font-mono text-[11px] text-slate-500">{violationForm.description.length}/500</span>
                </div>
                <textarea
                  value={violationForm.description}
                  onChange={e => setViolationForm({ ...violationForm, description: e.target.value })}
                  placeholder="وصف تفصيلي للمخالفة..."
                  maxLength={500}
                  className="w-full input-glass p-3 rounded-xl h-16 resize-none"
                />
              </div>

              {/* Action Taken */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">الإجراء المتخذ</label>
                <textarea
                  value={violationForm.actionTaken}
                  onChange={e => setViolationForm({ ...violationForm, actionTaken: e.target.value })}
                  placeholder="مثال: تنبيه شفهي، إحالة للمرشد..."
                  maxLength={500}
                  className="w-full input-glass p-3 rounded-xl h-16 resize-none"
                />
              </div>

              {/* Summon Guardian */}
              <label className="flex items-center gap-3 p-4 bg-red-500/10 rounded-xl border border-red-500/20 cursor-pointer hover:bg-red-500/20 transition-all">
                <input
                  type="checkbox"
                  checked={violationForm.summonGuardian}
                  onChange={e => setViolationForm({ ...violationForm, summonGuardian: e.target.checked })}
                  className="w-5 h-5 rounded text-red-500"
                />
                <div>
                  <p className="text-red-300 font-bold">استدعاء ولي الأمر</p>
                  <p className="text-xs text-red-400/70">سيتم إرسال إشعار فوري لولي الأمر</p>
                </div>
              </label>

              <button
                onClick={handleSaveViolation}
                disabled={violationSaving || !todayDayState.allowsEdits || !violationForm.student_id || !violationForm.type || violationForm.description.trim().length < 5}
                className="w-full rounded-xl border border-rose-300/20 bg-rose-500/15 py-3 font-bold text-rose-50 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-500/20 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {violationSaving ? <Loader2 className="ml-2 inline h-5 w-5 animate-spin" /> : <Check className="ml-2 inline h-5 w-5" />}
                {violationSaving ? 'جاري الحفظ...' : editingViolationId ? 'تحديث المخالفة' : 'حفظ المخالفة'}
              </button>
              {violationFormError && (
                <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {violationFormError}
                </div>
              )}
              {editingViolationId && (
                <button
                  onClick={() => {
                    setEditingViolationId(null);
                    setViolationFormError('');
                    setViolationForm({ ...EMPTY_VIOLATION_FORM });
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-3 font-bold text-slate-300 transition hover:bg-white/10"
                >
                  إلغاء التعديل
                </button>
              )}
              {lastViolationForPrint && (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4">
                  <p className="text-sm font-semibold text-rose-100">تم تجهيز إشعار المخالفة للطباعة</p>
                  <p className="mt-1 text-xs text-rose-200/70">يمكن حفظ النسخة في ملف الطالب أو تسليمها للإدارة.</p>
                  <button
                    onClick={() => handlePrintViolationNotice(lastViolationForPrint)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300/25 bg-rose-400/15 px-4 py-2.5 text-sm font-bold text-rose-50 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-400/20 active:translate-y-0"
                  >
                    <Printer className="h-4 w-4" />
                    طباعة إشعار المخالفة
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Today's Violations */}
          <div className={`rounded-[1.75rem] p-6 lg:col-span-2 ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
                <AlertCircle className="w-5 h-5 text-red-400" />
                مخالفات اليوم
              </h3>
              <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-sm font-bold text-rose-200">
                {todayViolations.length} مخالفة
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="text-gray-500 border-b border-white/10">
                  <tr>
                    <th className="p-3">الطالب</th>
                    <th className="p-3">النوع</th>
                    <th className="p-3">المستوى</th>
                    <th className="p-3">الإجراء</th>
                    <th className="p-3">المسجل</th>
                    <th className="p-3">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {todayViolations.map(v => {
                    const student = studentsById.get(v.student_id);
                    const level = typeof v.level === 'number' ? v.level : v.level === 'low' ? 1 : v.level === 'medium' ? 3 : 5;
                    return (
                      <tr key={v.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-3">
                          <p className="font-bold text-white">{student?.name}</p>
                          <p className="text-xs text-gray-500">{student?.class_name} - {student?.section}</p>
                        </td>
                        <td className="p-3">
                          <p className="text-red-300">{v.type}</p>
                          <p className="mt-1 max-w-[220px] truncate text-xs text-slate-500" title={v.description}>{v.description || '-'}</p>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map(l => (
                              <div
                                key={l}
                                className={`w-2 h-4 rounded-sm ${level >= l
                                  ? l <= 2 ? 'bg-emerald-500' : l <= 3 ? 'bg-amber-500' : 'bg-red-500'
                                  : 'bg-white/10'
                                  }`}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-gray-400 text-xs max-w-[200px] truncate">
                          {v.action_taken || '-'}
                        </td>
                        <td className="p-3 text-xs text-gray-400">
                          {v.created_by_label || '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePrintViolationNotice(v)}
                              className="p-2 bg-rose-500/10 rounded-lg hover:bg-rose-500/20 text-rose-300 transition-all"
                              title="طباعة إشعار المخالفة"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => student && openWhatsApp(student, 'violation')}
                              className="p-2 bg-emerald-500/10 rounded-lg hover:bg-emerald-500/20 text-emerald-400 transition-all"
                              title="إبلاغ ولي الأمر"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => notifyGuardianPortal(student, v)}
                              disabled={Boolean(v.guardian_notified)}
                              className="p-2 bg-primary-500/10 rounded-lg hover:bg-primary-500/20 text-primary-300 transition-all disabled:cursor-default disabled:bg-emerald-500/10 disabled:text-emerald-300"
                              title={v.guardian_notified ? 'تم إشعار ولي الأمر' : 'إشعار المنصة'}
                            >
                              {v.guardian_notified ? <Check className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleEditViolation(v)}
                              className="p-2 bg-secondary-500/10 rounded-lg hover:bg-secondary-500/20 text-secondary-300 transition-all"
                              title="تعديل المخالفة"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            {pendingDeleteViolationId === v.id ? (
                              <div className="flex items-center gap-1 rounded-xl border border-rose-400/20 bg-rose-500/10 p-1">
                                <button
                                  onClick={() => void handleDeleteViolation(v.id)}
                                  className="rounded-lg bg-rose-500 px-2 py-1.5 text-xs font-bold text-white"
                                >
                                  تأكيد
                                </button>
                                <button
                                  onClick={() => setPendingDeleteViolationId(null)}
                                  className="rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPendingDeleteViolationId(v.id)}
                                className="p-2 bg-rose-500/10 rounded-lg hover:bg-rose-500/20 text-rose-300 transition-all"
                                title="حذف المخالفة"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                            {v.summon_guardian && (
                              <span className="bg-red-500/20 text-red-300 px-2 py-1 rounded text-xs">
                                استدعاء
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {todayViolations.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center text-gray-500">
                        <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>لا توجد مخالفات مسجلة اليوم</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: STUDENTS & REPORTS ===================== */}
      {activeTab === 'students' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar Filter */}
          <div className={`h-fit rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Filter className="w-5 h-5 text-emerald-400" />
              تصفية الصفوف
            </h3>

            {/* All Students */}
            <button
              onClick={() => { setDirectoryClass(''); setDirectorySection(''); }}
              className={`w-full text-right p-3 rounded-xl mb-2 transition-all flex items-center justify-between ${!directoryClass ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'hover:bg-white/5 text-gray-400'
                }`}
            >
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                جميع الطلاب
              </span>
              <span className="text-sm">{students.length}</span>
            </button>

            {/* Classes Tree */}
            <div className="space-y-1">
              {classTree.map(cls => {
                const isActiveClass = labelsMatch(directoryClass, cls.name) && !directorySection;
                return (
                  <div key={cls.name}>
                    <button
                      onClick={() => { setDirectoryClass(cls.name); setDirectorySection(''); }}
                      className={`w-full text-right p-3 rounded-xl transition-all flex items-center justify-between ${isActiveClass
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'hover:bg-white/5 text-gray-300'
                        }`}
                    >
                      <span className="flex items-center gap-2">
                        <ChevronDown className={`w-4 h-4 transition-transform ${labelsMatch(directoryClass, cls.name) ? 'rotate-180' : ''}`} />
                        {cls.name}
                      </span>
                      <span className="text-sm text-gray-500">
                        {cls.count}
                      </span>
                    </button>

                    {labelsMatch(directoryClass, cls.name) && (
                      <div className="mr-6 mt-1 space-y-1">
                        {cls.sections.map(section => (
                          <button
                            key={section.name}
                            onClick={() => setDirectorySection(formatLabel(section.name))}
                            className={`w-full text-right p-2 rounded-lg text-sm transition-all flex items-center justify-between ${labelsMatch(directorySection, section.name)
                              ? 'bg-white/10 text-white'
                              : 'hover:bg-white/5 text-gray-400'
                              }`}
                          >
                            <span>فصل {section.name}</span>
                            <span className="text-xs">
                              {section.count}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-4">
            {/* Quick Attendance Selection Actions */}
            {attendanceSettings.enable_supervisor_quick_attendance && selectedLateStudents.size > 0 && (
              <div className={`rounded-[1.5rem] p-5 ${surfaceClass} border-amber-400/25 bg-amber-500/10`}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
                      <span className="text-xl font-bold text-amber-300">{selectedLateStudents.size}</span>
                    </div>
                    <div>
                      <div className="text-base font-bold text-white">تم تحديد {selectedLateStudents.size} طالب</div>
                      <div className="text-sm text-amber-200">جاهز لتسجيل التأخر</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleMarkLateClick}
                      disabled={!todayDayState.allowsEdits}
                      className="flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-500/20 px-5 py-2.5 font-bold text-amber-50 transition duration-200 hover:-translate-y-0.5 hover:bg-amber-500/25 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Clock className="w-5 h-5" />
                      تسجيل تأخر
                    </button>
                    <button
                      onClick={() => setSelectedLateStudents(new Set())}
                      className="px-5 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all"
                    >
                      إلغاء التحديد
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Search & Actions */}
            <div className={`flex flex-wrap items-center gap-3 rounded-[1.5rem] p-4 ${surfaceClass}`}>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="بحث بالاسم أو المعرف..."
                  value={directoryQuery}
                  onChange={e => setDirectoryQuery(e.target.value)}
                  className="w-full input-glass pr-10 py-2.5 rounded-xl text-sm"
                />
              </div>

              <select
                value={directoryStatus}
                onChange={event => setDirectoryStatus(event.target.value as 'all' | SupervisorAttendanceStatus)}
                className="input-glass min-w-[150px] rounded-xl px-3 py-2.5 text-sm"
                aria-label="تصفية الطلاب حسب حالة حضور اليوم"
              >
                <option value="all">كل الحالات</option>
                <option value="present">حاضر</option>
                <option value="late">متأخر</option>
                <option value="absent">غائب مسجل</option>
                <option value="unrecorded">غير مُحضّر</option>
              </select>

              <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
                {filteredDirectoryList.length} طالب
              </span>

              <button
                onClick={() => {
                  setExportFilterClass(directoryClass);
                  setExportFilterSection(directorySection);
                  setExportType(directoryStatus);
                  setShowExportModal(true);
                }}
                className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-300 transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-500/15 active:translate-y-0"
              >
                <Download className="w-4 h-4" />
                تصدير / طباعة
              </button>

              {/* Reset Day Button - Only for supervisors with quick attendance */}
              {attendanceSettings.enable_supervisor_quick_attendance && (
                <button
                  onClick={() => {
                    setResetDayDate(getLocalISODate());
                    setShowResetDayModal(true);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2.5 text-sm font-bold text-rose-300 transition duration-200 hover:-translate-y-0.5 hover:bg-rose-500/15 active:translate-y-0"
                  title="مسح جميع تسجيلات اليوم"
                >
                  <RefreshCcw className="w-4 h-4" />
                  إعادة تعيين اليوم
                </button>
              )}

              {/* Barcode Studio Button */}
              <button
                onClick={() => {
                  const ids = new Set(filteredDirectoryList.map(student => student.id));
                  setBarcodeSelectedIds(ids);
                  setShowBarcodeStudio(true);
                }}
                disabled={filteredDirectoryList.length === 0}
                className="flex items-center gap-2 rounded-xl border border-secondary-400/20 bg-secondary-500/10 px-4 py-2.5 text-sm font-bold text-secondary-300 transition duration-200 hover:-translate-y-0.5 hover:bg-secondary-500/15 active:translate-y-0"
              >
                <QrCode className="w-4 h-4" />
                استوديو الباركود
              </button>
            </div>

            {/* Communication activity for this browser session */}
            <section className={`rounded-[1.5rem] p-5 ${surfaceClass}`} aria-labelledby="communication-activity-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="communication-activity-title" className="flex items-center gap-2 text-base font-bold text-white">
                    <Bell className="h-4 w-4 text-primary-300" />
                    نشاط التواصل في هذه الجلسة
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">نفرّق بين الحفظ في المنصة والإضافة لطابور واتساب؛ الوصول النهائي يُتابع من قناة الإرسال.</p>
                </div>
                {communicationActivity.length > 0 && (
                  <button
                    onClick={() => setCommunicationActivity([])}
                    className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-white/5 hover:text-white"
                  >
                    مسح السجل
                  </button>
                )}
              </div>

              {communicationActivity.length > 0 ? (
                <div className="mt-4 grid gap-2 lg:grid-cols-2">
                  {communicationActivity.map(activity => (
                    <article key={activity.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.035] p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-100">{activity.title}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {activity.recipientLabel} · {new Date(activity.createdAt).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${activity.status === 'failed'
                        ? 'bg-rose-500/10 text-rose-300'
                        : activity.channel === 'whatsapp'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-primary-500/10 text-primary-300'
                        }`}>
                        {communicationStatusLabel(activity)}
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-sm text-slate-500">
                  لا توجد عمليات تواصل بعد. ستظهر هنا الرسائل التي تحفظها أو تضيفها للطابور.
                </div>
              )}
            </section>

            {/* Students Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleDirectoryList.map(student => (
                <div
                  key={student.id}
                  className={`group rounded-[1.35rem] p-4 transition duration-200 hover:-translate-y-0.5 ${surfaceClass} ${attendanceSettings.enable_supervisor_quick_attendance && selectedLateStudents.has(student.id)
                    ? 'border-amber-400/50 bg-amber-500/10'
                    : 'hover:border-white/20'
                    }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      {/* Checkbox for Quick Attendance */}
                      {attendanceSettings.enable_supervisor_quick_attendance && (
                        <input
                          type="checkbox"
                          checked={selectedLateStudents.has(student.id)}
                          onChange={() => toggleLateStudentSelection(student.id)}
                          disabled={!todayDayState.allowsEdits}
                          className="w-5 h-5 rounded bg-white/10 border-2 border-white/20 checked:bg-amber-500 checked:border-amber-400 cursor-pointer flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}

                      <div className="w-12 h-12 rounded-xl border border-white/10 bg-white/[0.05] flex items-center justify-center flex-shrink-0">
                        <GraduationCap className="w-6 h-6 text-primary-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-white truncate">{student.name}</h4>
                        <p className="text-sm text-gray-400 truncate">{student.class_name} - {student.section}</p>
                        <p className="text-xs text-gray-500 font-mono">{student.id}</p>
                      </div>
                    </div>

                    <span className={`px-2 py-1 rounded-full text-xs font-bold flex-shrink-0 ${student.attendanceStatus === 'present'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : student.attendanceStatus === 'late'
                        ? 'bg-amber-500/20 text-amber-300'
                        : student.attendanceStatus === 'absent'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-slate-500/20 text-slate-300'
                      }`}>
                      {student.attendanceStatus === 'present'
                        ? 'حاضر'
                        : student.attendanceStatus === 'late'
                          ? 'متأخر'
                          : student.attendanceStatus === 'absent'
                            ? 'غائب'
                            : 'غير مُحضّر'}
                    </span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 flex flex-col gap-2">
                    {/* Quick Actions Row */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openStudentProfile(student)}
                        className="flex-1 py-2 bg-white/5 rounded-xl text-gray-300 hover:bg-white/10 hover:text-white text-sm font-medium flex items-center justify-center gap-1 transition-all"
                      >
                        <Eye className="w-4 h-4" />
                        الملف الشخصي
                      </button>
                      <button
                        onClick={() => { setMessageStudent(student); setMessageText(''); setMessageError(''); }}
                        className="p-2 bg-primary-500/10 rounded-xl text-primary-400 hover:bg-primary-500/20 transition-all"
                        title="إرسال رسالة"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openWhatsApp(student, 'late')}
                        className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400 hover:bg-emerald-500/20 transition-all"
                        title="واتساب"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      {canUseWhatsAppGateway && (
                        <button
                          onClick={() => openQuickSendModal(student, 'late_warning')}
                          className="p-2 bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl text-green-400 hover:from-green-500/30 hover:to-emerald-500/30 transition-all border border-green-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                          title="إضافة إلى طابور واتساب"
                        >
                          <div className="relative">
                            <Send className="w-4 h-4" />
                            <span className="absolute -top-1.5 -right-1.5 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                          </div>
                        </button>
                      )}
                    </div>

                    {/* Attendance Actions - Only if attendance is enabled and student has record */}
                    {attendanceSettings.enable_supervisor_quick_attendance && student.attendanceStatus !== 'unrecorded' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenEditAttendance(student)}
                          className="flex-1 py-2 bg-secondary-500/10 rounded-xl text-secondary-400 hover:bg-secondary-500/20 text-sm font-medium flex items-center justify-center gap-1 transition-all"
                        >
                          <Edit3 className="w-4 h-4" />
                          تعديل الحضور
                        </button>
                        <button
                          onClick={() => handleDeleteAttendance(student.id)}
                          className="p-2 bg-red-500/10 rounded-xl text-red-400 hover:bg-red-500/20 transition-all"
                          title="حذف التسجيل"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* فاصل التحميل التدريجي + مؤشر العدد */}
            {directoryHasMore && (
              <div ref={directorySentinelRef} className="flex items-center justify-center py-6 text-sm text-gray-500">
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-primary-400" />
                  جارٍ عرض {directoryShownCount} من {directoryTotalCount}…
                </span>
              </div>
            )}

            {filteredDirectoryList.length === 0 && (
              <div className={`rounded-[1.5rem] p-12 text-center ${surfaceClass}`}>
                <Users className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                <p className="text-gray-300">لا توجد نتائج مطابقة</p>
                <p className="mt-2 text-sm text-gray-500">غيّر عبارة البحث أو الصف أو حالة الحضور.</p>
                <button
                  onClick={() => {
                    setDirectoryQuery('');
                    setDirectoryClass('');
                    setDirectorySection('');
                    setDirectoryStatus('all');
                  }}
                  className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
                >
                  مسح الفلاتر
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== MODALS ===================== */}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-lg animate-fade-in-up rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
                  <FileDown className="w-6 h-6 text-emerald-400" />
                  تقرير حضور اليوم
                </h3>
                <p className="mt-1 text-xs text-slate-500">يعرض الغياب المسجل صراحة ويفصله عن غير المُحضّرين.</p>
              </div>
              <button onClick={() => { setShowExportModal(false); setExportFilterClass(''); setExportFilterSection(''); }} className="text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Filter by Class/Section */}
            <div className="mb-5 p-4 bg-white/5 rounded-xl border border-white/10">
              <label className="block text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary-400" />
                تحديد الصف والفصل (اختياري)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={exportFilterClass}
                  onChange={e => { setExportFilterClass(formatLabel(e.target.value)); setExportFilterSection(''); }}
                  className="input-glass p-3 rounded-xl text-sm"
                >
                  <option value="">جميع الصفوف</option>
                  {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={exportFilterSection}
                  onChange={e => setExportFilterSection(formatLabel(e.target.value))}
                  className="input-glass p-3 rounded-xl text-sm"
                  disabled={!exportFilterClass}
                >
                  <option value="">جميع الفصول</option>
                  {exportSections.map(section => (
                    <option key={section} value={section}>{section}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sort Options */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-300 mb-3">ترتيب البيانات</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setExportSortBy('name')}
                  className={`p-3 rounded-xl border transition-all text-center ${exportSortBy === 'name'
                    ? 'bg-primary-500/20 border-primary-500/50 text-primary-300'
                    : 'border-white/10 text-gray-400 hover:bg-white/5'
                    }`}
                >
                  <p className="font-bold text-sm">صف → فصل → الاسم</p>
                  <p className="text-xs opacity-70">ترتيب أبجدي</p>
                </button>
                <button
                  onClick={() => setExportSortBy('id')}
                  className={`p-3 rounded-xl border transition-all text-center ${exportSortBy === 'id'
                    ? 'bg-primary-500/20 border-primary-500/50 text-primary-300'
                    : 'border-white/10 text-gray-400 hover:bg-white/5'
                    }`}
                >
                  <p className="font-bold text-sm">صف → فصل → المعرف</p>
                  <p className="text-xs opacity-70">ترتيب رقمي</p>
                </button>
              </div>
            </div>

            {/* Export Type */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-300 mb-3">نوع البيانات</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { value: 'all', label: 'الكل', icon: Users, activeClass: 'bg-violet-500/20 border-violet-500/50 text-violet-300' },
                  { value: 'present', label: 'حضور', icon: UserCheck, activeClass: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' },
                  { value: 'late', label: 'متأخر', icon: Clock, activeClass: 'bg-amber-500/20 border-amber-500/50 text-amber-300' },
                  { value: 'absent', label: 'غائب', icon: UserX, activeClass: 'bg-red-500/20 border-red-500/50 text-red-300' },
                  { value: 'unrecorded', label: 'غير مُحضّر', icon: AlertCircle, activeClass: 'bg-slate-500/20 border-slate-500/50 text-slate-300' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setExportType(opt.value as AttendanceExportType)}
                    className={`p-3 rounded-xl border transition-all text-center ${exportType === opt.value
                      ? opt.activeClass
                      : 'border-white/10 text-gray-400 hover:bg-white/5'
                      }`}
                  >
                    <opt.icon className="w-4 h-4 mx-auto mb-1" />
                    <p className="text-xs font-bold">{opt.label}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview Count */}
            <div className="mb-5 p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-center">
              <p className="text-emerald-300 text-sm">
                سيتم تصدير <strong>{getExportData(exportType, exportSortBy).length}</strong> سجل
                {exportFilterClass && <span> من {exportFilterClass}{exportFilterSection ? ` - ${exportFilterSection}` : ''}</span>}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => exportToCSV(exportType, exportSortBy)}
                className="py-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-emerald-500/20 transition-all"
              >
                <FileSpreadsheet className="w-5 h-5" />
                تصدير CSV
              </button>
              <button
                onClick={() => exportToXLSX(exportType, exportSortBy)}
                className="py-3 bg-gradient-to-r from-sky-600 to-indigo-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-sky-500/20 transition-all"
              >
                <FileSpreadsheet className="w-5 h-5" />
                تصدير XLSX
              </button>
              <button
                onClick={() => exportToPDF(exportType, exportSortBy)}
                className="py-3 bg-gradient-to-r from-red-600 to-rose-600 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-red-500/20 transition-all"
              >
                <FileType className="w-5 h-5" />
                تصدير PDF
              </button>
              <button
                onClick={() => printReport(exportType, exportSortBy)}
                className="py-3 bg-white/10 border border-white/15 rounded-xl text-white font-bold flex items-center justify-center gap-2 hover:bg-white/15 transition-all"
              >
                <Printer className="w-5 h-5" />
                طباعة مباشرة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Notification Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-lg animate-fade-in-up rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center">
                  <Bell className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-white">إشعار أولياء الأمور</h3>
                  <p className="text-sm text-gray-400">{selectedStudents.size} طالب محدد</p>
                </div>
              </div>
              <button onClick={() => { setShowBulkModal(false); setBulkError(''); }} disabled={bulkSending} className="text-gray-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" aria-label="إغلاق نافذة الإشعارات">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Template Selection */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => { setBulkTemplate('late'); setBulkMessage(notification_templates.late.message); setBulkError(''); }}
                className={`p-4 rounded-xl border transition-all text-right ${bulkTemplate === 'late'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'border-white/10 text-gray-400 hover:bg-white/5'
                  }`}
              >
                <Clock className="w-5 h-5 mb-2" />
                <p className="font-bold">تنبيه تأخر</p>
              </button>
              <button
                onClick={() => { setBulkTemplate('absent'); setBulkMessage(notification_templates.absent.message); setBulkError(''); }}
                className={`p-4 rounded-xl border transition-all text-right ${bulkTemplate === 'absent'
                  ? 'bg-red-500/20 border-red-500/50 text-red-300'
                  : 'border-white/10 text-gray-400 hover:bg-white/5'
                  }`}
              >
                <UserX className="w-5 h-5 mb-2" />
                <p className="font-bold">تنبيه غياب</p>
              </button>
            </div>

            {/* Message */}
            <div className="mb-6">
              <label className="block text-sm text-gray-300 mb-2">نص الرسالة</label>
              <textarea
                value={bulkMessage}
                onChange={e => { setBulkMessage(e.target.value); setBulkError(''); }}
                className="w-full input-glass p-4 rounded-xl h-32 resize-none"
                placeholder="اكتب نص الرسالة..."
              />
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                <span>سيُحفظ الإشعار في منصة ولي الأمر.</span>
                <span className="font-mono tabular-nums">{bulkMessage.trim().length} حرف</span>
              </div>
            </div>

            {bulkError && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-100" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{bulkError}</span>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={sendBulkNotifications}
                disabled={bulkSending || !bulkMessage.trim() || selectedStudents.size === 0}
                className="flex-1 py-4 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl text-white font-bold shadow-lg hover:shadow-primary-500/25 transition-all disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkSending ? <Loader2 className="w-5 h-5 inline ml-2 animate-spin" /> : <Send className="w-5 h-5 inline ml-2" />}
                {bulkSending ? 'جارٍ الحفظ…' : bulkError ? 'إعادة المحاولة' : `حفظ ${selectedStudents.size} إشعار`}
              </button>
              <button
                onClick={() => { setShowBulkModal(false); setBulkError(''); }}
                disabled={bulkSending}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-slate-300 hover:bg-white/10 disabled:opacity-40"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Profile Modal */}
      {profileStudent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`my-8 w-full max-w-3xl animate-fade-in-up rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center">
                  <GraduationCap className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-white">{profileStudent.name}</h3>
                  <p className="text-gray-400">{profileStudent.class_name} - {profileStudent.section}</p>
                  <p className="text-sm text-gray-500 font-mono">{profileStudent.id}</p>
                </div>
              </div>
              <button onClick={closeStudentProfile} className="text-gray-400 hover:text-white" aria-label="إغلاق ملف الطالب">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Guardian Info */}
            <div className="bg-white/5 rounded-2xl p-4 mb-6">
              <h4 className="text-sm font-bold text-gray-400 mb-2 flex items-center gap-2">
                <Phone className="w-4 h-4" />
                معلومات ولي الأمر
              </h4>
              <p className={profileStudent.guardian_phone ? 'text-white font-mono' : 'text-sm text-slate-500'}>
                {profileStudent.guardian_phone || 'لا يوجد رقم مسجل لولي الأمر'}
              </p>
            </div>

            {profileSnapshot ? (
              <div className="space-y-6">
                {/* Stats Summary */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="bg-emerald-500/10 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-emerald-400">{profileSnapshot.stats.attended}</p>
                    <p className="text-sm text-emerald-300/70">أيام الحضور</p>
                  </div>
                  <div className="bg-amber-500/10 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-amber-400">{profileSnapshot.stats.late}</p>
                    <p className="text-sm text-amber-300/70">أيام التأخر</p>
                  </div>
                  <div className="bg-rose-500/10 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-rose-400">{profileSnapshot.stats.absent}</p>
                    <p className="text-sm text-rose-300/70">غياب مسجل</p>
                  </div>
                  <div className="bg-secondary-500/10 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-secondary-400">{profileSnapshot.stats.exits}</p>
                    <p className="text-sm text-secondary-300/70">مرات الخروج</p>
                  </div>
                  <div className="bg-red-500/10 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-red-400">{profileSnapshot.stats.violations}</p>
                    <p className="text-sm text-red-300/70">المخالفات</p>
                  </div>
                </div>

                {/* Recent Attendance */}
                <div>
                  <h4 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary-400" />
                    سجل الحضور الأخير
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {profileSnapshot.attendance.slice(0, 10).map(a => (
                      <div key={a.id} className="flex items-center justify-between bg-white/5 rounded-xl p-3">
                        <span className="text-gray-300">{new Date(a.date).toLocaleDateString('ar-SA')}</span>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${a.status === 'present' ? 'bg-emerald-500/20 text-emerald-300' :
                          a.status === 'late' ? 'bg-amber-500/20 text-amber-300' :
                            'bg-red-500/20 text-red-300'
                          }`}>
                          {a.status === 'present' ? 'حاضر' : a.status === 'late' ? `متأخر ${a.minutes_late || 0}د` : 'غائب'}
                        </span>
                      </div>
                    ))}
                    {profileSnapshot.attendance.length === 0 && (
                      <p className="text-gray-500 text-center py-4">لا توجد سجلات</p>
                    )}
                  </div>
                </div>

                {/* Exits History */}
                <div>
                  <h4 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    <DoorOpen className="w-5 h-5 text-secondary-400" />
                    سجل الاستئذان
                  </h4>
                  {profileSnapshot.exits.length > 0 ? (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {profileSnapshot.exits.map(exit => (
                        <div key={exit.id} className="flex items-center justify-between bg-secondary-500/10 rounded-xl p-3 border border-secondary-500/20">
                          <div>
                            <span className="text-secondary-300 font-bold">{exit.reason}</span>
                            <p className="text-xs text-sky-200/80">المستأذن: {getExitRequesterRelationLabel(exit)}</p>
                            <p className="text-xs text-gray-400">
                              {new Date(exit.exit_time).toLocaleDateString('ar-SA')} - {new Date(exit.exit_time).toLocaleTimeString('ar-SA')}
                            </p>
                          </div>
                          <button
                            onClick={async () => {
                              if (!confirm('هل أنت متأكد من حذف سجل الاستئذان من السجل؟')) return;
                              try {
                                await studentAffairs.execute({ type: 'delete-exit', exitId: exit.id });
                                showToast('تم الحذف بنجاح', 'success');
                                if (profileStudent) openStudentProfile(profileStudent);
                                void fetchSchoolDayData();
                              } catch (e) {
                                logError(e, 'Profile Delete Exit');
                                showToast('فشل الحذف', 'error');
                              }
                            }}
                            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-red-400 font-bold text-xs flex items-center gap-1 transition-all border border-red-500/20"
                            title="حذف من السجل"
                          >
                            <X className="w-3 h-3" />
                            حذف
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-4 text-sm bg-white/5 rounded-xl">
                      لا توجد سجلات استئذان
                    </p>
                  )}
                </div>

                {/* Violations */}
                <div>
                  <h4 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    المخالفات
                  </h4>
                  {profileSnapshot.violations.length > 0 ? (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {profileSnapshot.violations.map(v => (
                        <div key={v.id} className="flex items-center justify-between bg-red-500/10 rounded-xl p-3 border border-red-500/20">
                          <div>
                            <span className="text-red-300 font-bold">{v.type}</span>
                            <p className="text-xs text-gray-400">{v.description || 'لا توجد تفاصيل إضافية'}</p>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(v.created_at).toLocaleDateString('ar-SA')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-white/5 py-4 text-center text-sm text-gray-500">
                      لا توجد مخالفات مسجلة
                    </p>
                  )}
                </div>
              </div>
            ) : profileLoading ? (
              <div className="py-10 text-center" role="status">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto" />
                <p className="mt-3 text-sm text-slate-400">جارٍ تحميل سجل الطالب…</p>
              </div>
            ) : profileError ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-6 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-rose-300" />
                <p className="mt-3 text-sm text-rose-100">{profileError}</p>
                <button
                  onClick={() => void openStudentProfile(profileStudent)}
                  className="mt-4 rounded-xl bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:bg-rose-400"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : null}

            {/* Actions */}
            <div className="mt-6 pt-4 border-t border-white/10 flex gap-3">
              <button
                onClick={() => openWhatsApp(profileStudent, 'late')}
                disabled={!resolveStudentWhatsAppPhone(profileStudent)}
                className="flex-1 py-3 bg-emerald-500/10 rounded-xl text-emerald-400 font-bold flex items-center justify-center gap-2 hover:bg-emerald-500/20 transition-all disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MessageCircle className="w-5 h-5" />
                واتساب
              </button>
              <button
                onClick={() => { setMessageStudent(profileStudent); setMessageText(''); setMessageError(''); closeStudentProfile(); }}
                className="flex-1 py-3 bg-primary-500/10 rounded-xl text-primary-400 font-bold flex items-center justify-center gap-2 hover:bg-primary-500/20 transition-all"
              >
                <Send className="w-5 h-5" />
                إرسال رسالة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Direct Message Modal */}
      {messageStudent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md animate-fade-in-up rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold tracking-tight text-white">إرسال رسالة</h3>
              <button onClick={() => { setMessageStudent(null); setMessageError(''); }} disabled={messageSending} className="text-gray-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" aria-label="إغلاق الرسالة">
                <X className="w-6 h-6" />
              </button>
            </div>

            <p className="text-gray-400 mb-4">
              حفظ رسالة في منصة ولي أمر الطالب: <span className="text-white font-bold">{messageStudent.name}</span>
            </p>

            <textarea
              value={messageText}
              onChange={e => { setMessageText(e.target.value); setMessageError(''); }}
              placeholder="اكتب رسالتك هنا..."
              className="w-full input-glass p-4 rounded-xl h-32 resize-none mb-4"
              autoFocus
            />

            <div className="-mt-3 mb-4 flex items-center justify-between text-xs text-slate-500">
              <span>تظهر الرسالة داخل حساب ولي الأمر.</span>
              <span className="font-mono tabular-nums">{messageText.trim().length} حرف</span>
            </div>

            {messageError && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-100" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{messageError}</span>
              </div>
            )}

            <button
              onClick={sendDirectMessage}
              disabled={!messageText.trim() || messageSending}
              className="w-full py-3 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl text-white font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {messageSending ? <Loader2 className="w-5 h-5 inline ml-2 animate-spin" /> : <Send className="w-5 h-5 inline ml-2" />}
              {messageSending ? 'جارٍ الحفظ…' : messageError ? 'إعادة المحاولة' : 'حفظ في المنصة'}
            </button>
          </div>
        </div>
      )}

      {editStudentTarget && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-lg animate-fade-in-up rounded-[1.75rem] p-6 ${surfaceClass}`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center">
                  <Edit3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-white">تعديل بيانات الطالب</h3>
                  <p className="text-sm text-gray-400">{editStudentTarget.name} - {editStudentTarget.id}</p>
                </div>
              </div>
              <button onClick={() => setEditStudentTarget(null)} className="text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">رقم ولي الأمر</label>
                <input
                  type="text"
                  value={editForm.guardian_phone}
                  onChange={e => setEditForm({ ...editForm, guardian_phone: e.target.value })}
                  className="w-full input-glass p-3 rounded-xl"
                  placeholder="05xxxxxxxx"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-2">الصف</label>
                  <select
                    value={editForm.class_name}
                    onChange={e => setEditForm({ ...editForm, class_name: formatLabel(e.target.value), section: '' })}
                    className="w-full input-glass p-3 rounded-xl"
                  >
                    <option value="">اختر الصف...</option>
                    {uniqueClasses.map(cls => (
                      <option key={cls} value={cls}>{cls}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-2">الفصل</label>
                  {editSections.length > 0 ? (
                    <select
                      value={editForm.section}
                      onChange={e => setEditForm({ ...editForm, section: formatLabel(e.target.value) })}
                      className="w-full input-glass p-3 rounded-xl"
                    >
                      <option value="">اختر الفصل...</option>
                      {editSections.map(section => (
                        <option key={section} value={section}>{section}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={editForm.section}
                      onChange={e => setEditForm({ ...editForm, section: e.target.value })}
                      className="w-full input-glass p-3 rounded-xl"
                      placeholder="اكتب الفصل..."
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setEditStudentTarget(null)}
                className="flex-1 py-3 rounded-xl border border-white/10 text-gray-300 hover:border-white/30"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveStudentEdit}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary-600 to-secondary-600 text-white font-bold"
              >
                حفظ التعديلات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Late Time Input Modal */}
      {showLateTimeModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowLateTimeModal(false)}
        >
          <div
            className={`mx-4 w-full max-w-md rounded-[1.75rem] p-8 ${surfaceClass}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white">تسجيل وقت التأخر</h3>
                  <p className="text-sm text-gray-400">{selectedLateStudents.size} طالب محدد</p>
                </div>
              </div>
              <button
                onClick={() => setShowLateTimeModal(false)}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-gray-400 hover:text-white" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-300 mb-2 block">التاريخ</label>
                <input
                  type="date"
                  value={lateTimeInput.date}
                  onChange={(e) => setLateTimeInput(prev => ({ ...prev, date: e.target.value }))}
                  max={todayDate}
                  className="w-full input-glass p-3 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="text-sm text-gray-300 mb-2 block">وقت الوصول</label>
                <input
                  type="time"
                  value={lateTimeInput.time}
                  onChange={(e) => setLateTimeInput(prev => ({ ...prev, time: e.target.value }))}
                  className="w-full input-glass p-3 rounded-xl text-white"
                />
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="text-xs text-gray-400 mb-2">معلومات التسجيل:</div>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between text-white">
                    <span>عدد الطلاب:</span>
                    <span className="font-bold text-amber-400">{selectedLateStudents.size}</span>
                  </div>
                  <div className="flex items-center justify-between text-white">
                    <span>وقت بداية الدوام:</span>
                    <span className="font-mono text-primary-300">{effectiveAssemblyTime}</span>
                  </div>
                  <div className="flex items-center justify-between text-white">
                    <span>التأخير:</span>
                    <span className="font-bold text-orange-400">
                      {(() => {
                        const [hours, minutes] = lateTimeInput.time.split(':').map(Number);
                        const [startHours, startMinutesPart] = effectiveAssemblyTime.split(':').map(Number);
                        const startMinutes = (startHours * 60) + startMinutesPart + effectiveGracePeriod;
                        const arrivalMinutes = hours * 60 + minutes;
                        const delay = Math.max(0, arrivalMinutes - startMinutes);
                        return delay > 0 ? `${delay} دقيقة` : 'بدون تأخير';
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleConfirmMarkLate}
                  disabled={lateRecordLoading}
                  className="flex-1 py-3 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl text-white font-bold hover:shadow-lg hover:shadow-amber-500/30 transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {lateRecordLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      جاري التسجيل...
                    </>
                  ) : (
                    <>
                      <Check className="w-5 h-5" />
                      تأكيد التسجيل
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowLateTimeModal(false)}
                  disabled={lateRecordLoading}
                  className="px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Attendance Modal */}
      {editAttendanceStudent && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setEditAttendanceStudent(null)}
        >
          <div
            className={`mx-4 w-full max-w-md rounded-[1.75rem] p-8 ${surfaceClass}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-secondary-500 to-primary-500 flex items-center justify-center">
                  <Edit3 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white">تعديل حالة الحضور</h3>
                  <p className="text-sm text-gray-400">{editAttendanceStudent.name}</p>
                </div>
              </div>
              <button
                onClick={() => setEditAttendanceStudent(null)}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-gray-400 hover:text-white" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-300 mb-2 block">حالة الحضور</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setEditAttendanceStatus('present')}
                    className={`py-3 rounded-xl font-bold transition-all ${editAttendanceStatus === 'present'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                  >
                    حاضر
                  </button>
                  <button
                    onClick={() => setEditAttendanceStatus('late')}
                    className={`py-3 rounded-xl font-bold transition-all ${editAttendanceStatus === 'late'
                      ? 'bg-amber-500 text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                  >
                    متأخر
                  </button>
                  <button
                    onClick={() => setEditAttendanceStatus('absent')}
                    className={`py-3 rounded-xl font-bold transition-all ${editAttendanceStatus === 'absent'
                      ? 'bg-red-500 text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                  >
                    غائب
                  </button>
                </div>
              </div>

              {editAttendanceStatus !== 'absent' && (
                <div>
                  <label className="text-sm text-gray-300 mb-2 block">وقت الوصول</label>
                  <input
                    type="time"
                    value={editAttendanceTime}
                    onChange={(e) => setEditAttendanceTime(e.target.value)}
                    className="w-full input-glass p-3 rounded-xl text-white"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSaveEditAttendance}
                  disabled={lateRecordLoading}
                  className="flex-1 py-3 bg-gradient-to-br from-secondary-500 to-primary-500 rounded-xl text-white font-bold hover:shadow-lg hover:shadow-secondary-500/30 transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {lateRecordLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      جاري الحفظ...
                    </>
                  ) : (
                    <>
                      <Check className="w-5 h-5" />
                      حفظ التعديلات
                    </>
                  )}
                </button>
                <button
                  onClick={() => setEditAttendanceStudent(null)}
                  disabled={lateRecordLoading}
                  className="px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Day Modal */}
      {showResetDayModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowResetDayModal(false)}
        >
          <div
            className={`mx-4 w-full max-w-md rounded-[1.75rem] p-8 ${surfaceClass}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white">إعادة تعيين اليوم</h3>
                  <p className="text-sm text-gray-400">مسح جميع التسجيلات</p>
                </div>
              </div>
              <button
                onClick={() => setShowResetDayModal(false)}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-gray-400 hover:text-white" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-300 mb-2 block">اختر التاريخ</label>
                <input
                  type="date"
                  value={resetDayDate}
                  onChange={(e) => setResetDayDate(e.target.value)}
                  className="w-full input-glass p-3 rounded-xl text-white"
                />
              </div>

              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-200">
                    <p className="font-bold mb-2">⚠️ تحذير هام:</p>
                    <ul className="space-y-1 text-xs">
                      <li>• سيتم حذف جميع تسجيلات الحضور لهذا اليوم</li>
                      <li>• هذا الإجراء لا يمكن التراجع عنه</li>
                      <li>• يجب إعادة تسجيل الحضور يدوياً بعد المسح</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleResetDay}
                  disabled={resetDayLoading}
                  className="flex-1 py-3 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl text-white font-bold hover:shadow-lg hover:shadow-red-500/30 transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {resetDayLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      جاري المسح...
                    </>
                  ) : (
                    <>
                      <RefreshCcw className="w-5 h-5" />
                      تأكيد المسح
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowResetDayModal(false)}
                  disabled={resetDayLoading}
                  className="px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white hover:bg-white/20 transition-all disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Local Toast */}
      {localToast.show && (
        <div className={`fixed bottom-6 left-6 z-50 animate-fade-in-up`}>
          <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md ${localToast.type === 'success'
            ? 'bg-emerald-500/90 text-white'
            : 'bg-red-500/90 text-white'
            }`}>
            {localToast.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
            {localToast.message}
          </div>
        </div>
      )}
      {/* Quick Send Modal (Smart Queue) */}
      <QuickSendModal
        isOpen={showQuickSendModal}
        onClose={() => setShowQuickSendModal(false)}
        student={selectedQuickSendStudent}
        defaultTemplateId={quickSendTemplateId}
        onQueued={({ student, kind }) => {
          recordCommunicationActivity({
            channel: 'whatsapp',
            status: 'queued',
            title: kind === 'badge' ? 'وسام واتساب' : 'رسالة واتساب',
            recipientLabel: student.name,
            recipientCount: 1
          });
        }}
        onFailed={({ student, kind, error }) => {
          recordCommunicationActivity({
            channel: 'whatsapp',
            status: 'failed',
            title: kind === 'badge' ? 'وسام واتساب' : 'رسالة واتساب',
            recipientLabel: student.name,
            recipientCount: 1,
            detail: error
          });
        }}
      />

      {/* Barcode Studio Modal */}
      {showBarcodeStudio && (
        <BarcodeStudio
          students={students}
          selectedIds={barcodeSelectedIds}
          onClose={() => setShowBarcodeStudio(false)}
        />
      )}
      <UniversalGuideModal 
        isOpen={showGuide} 
        onClose={() => setShowGuide(false)} 
        title="دليل المراقبة اليومية"
        steps={supervisionGuideSteps}
        heroImage="/images/supervision_guide_hero.webp"
      />
    </div>
  );
};

export default Supervision;
