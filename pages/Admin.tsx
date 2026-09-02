import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, getLocalISODate, getLocalDateStr } from '../services/db';
import { appSettings } from '../services/settings';
import { notificationCenter } from '../services/notifications';
import { studentAffairs } from '../services/studentAffairs';
import { getSyncedDate } from '../services/dbHelpers';
import { auth } from '../services/auth';
import { Student, DashboardStats, ReportFilter, SchoolClass, User, Role, KioskSettings, AttendanceRecord, ExitRecord, ViolationRecord, NotificationTemplates, NotificationTemplate, Notification, ClassStatsSummary, STORAGE_KEYS, SystemSettings, StudentIdSettings, ATTENDANCE_DEFAULTS, AcademicHoliday, GuardianExcuseRecord, GuardianExcuseStatus } from '../types';
import { FileService, ImportIdMode, ImportIdPattern, ImportField, ImportMapping } from '../services/fileService';
import { buildSchoolCatalog, getCatalogSections } from '../constants/schoolCatalog';
import { parseClassSections } from '../components/admin/classStructure';
import { validateUserAccountDraft } from '../components/admin/userAccountValidation';
import type { AdminAttendanceReportData } from '../components/admin/reportAnalytics';
import { deriveStudentIdPolicy, generateNextStudentId, isStudentIdDuplicate, validateStudentId } from '../services/studentIdPolicy';
import { getExitRequesterRelationLabel } from '../services/exitRequester';
import { FileSpreadsheet, Upload, UserPlus, Database, Loader2, LayoutDashboard, TrendingUp, AlertCircle, Clock, CheckCircle, FileText, Printer, FileCode, FileType, Plus, X, Search, Calendar, Trash2, Users, Trophy, ChevronDown, Target, Monitor, Image as ImageIcon, Settings as SettingsIcon, Activity, User as UserIcon, Eye, DoorOpen, AlertOctagon, Palette, Check, Type, Maximize2, Minimize2, Bell, MessageSquare, Save, Edit3, Download, Send, Megaphone, CheckSquare, Filter, SlidersHorizontal, MoveRight, Camera, Hash, CalendarDays, CalendarClock, PanelLeftClose, Pin, Menu, ChevronLeft, ChevronRight, Smartphone, Cable } from 'lucide-react';
import { getErrorMessage, logError } from '../types/errors';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { AdminDashboard, AdminReportsTab, AdminKioskTab, AdminStructureTab, AdminStudentsTab, AdminUsersTab, AdminSettingsTab, AdminFollowUpTab, AdminIncidentsTab, AdminExcusesTab, AdminBackupTab, AdminNotificationsTab, AdminCalendarTab, AdminActivityLogTab, AdminGuardianPhonesTab, AdminIntegrationsTab, AdminStaffOperationsTab, THEME_CONFIG, HIDDEN_ADMIN_USERNAMES, PRIVACY_ADD_KEY, PRIVACY_IMPORT_KEY } from '../components/admin';
import { cacheHolidays, getCachedHolidays, getHolidayInfo, isDateHoliday, normalizeAcademicHolidays } from '../services/academicCalendarService';
import { useToast } from '../components/Toast';
import { useSyncRefresh } from '../hooks/useSyncRefresh';
import { UniversalGuideModal, GuideStep } from '../components/common/UniversalGuideModal';
import { ShieldCheck, GraduationCap, Users as UsersIcon, HelpCircle } from 'lucide-react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { useAdminTheme } from '../hooks/useAdminTheme';
import {
  getAttendanceForDate,
  getAttendanceStatusCounts,
  uniqueAttendanceByStudentDate
} from '../modules/attendance';
import {
  AttendanceSettingsDraft,
  DEFAULT_ATTENDANCE_SETTINGS,
  normalizeAttendanceSettings
} from '../components/admin/attendanceSettingsRules';

const ImportWizard = lazyWithRetry(() =>
  import('../components/import/ImportWizard').then((module) => ({ default: module.ImportWizard }))
);
const BarcodeStudio = lazyWithRetry(() =>
  import('../components/BarcodeStudio').then((module) => ({ default: module.BarcodeStudio }))
);
const QuickSendModal = lazyWithRetry(() => import('../components/whatsapp/QuickSendModal'));
const BackupCenter = lazyWithRetry(() =>
  import('../components/BackupCenter').then((module) => ({ default: module.BackupCenter }))
);

const normalizeAdminIdentity = (value: unknown): string =>
  String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const mergeAdminUserRecords = (previous: User, next: User): User => ({
  ...previous,
  ...next,
  assigned_classes: next.assigned_classes?.length ? next.assigned_classes : previous.assigned_classes,
  assigned_sections: next.assigned_sections?.length ? next.assigned_sections : previous.assigned_sections,
  can_use_whatsapp: next.can_use_whatsapp ?? previous.can_use_whatsapp
});

const dedupeAdminUsers = (input: User[]): User[] => {
  const byKey = new Map<string, User>();
  const output: User[] = [];

  input.forEach((user, index) => {
    const key = user.id
      ? `id:${user.id}`
      : user.username
        ? `username:${normalizeAdminIdentity(user.username)}`
        : `index:${index}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, mergeAdminUserRecords(existing, user));
      return;
    }
    byKey.set(key, user);
    output.push(user);
  });

  return output.map(user => {
    const key = user.id
      ? `id:${user.id}`
      : user.username
        ? `username:${normalizeAdminIdentity(user.username)}`
        : '';
    return key && byKey.has(key) ? byKey.get(key)! : user;
  });
};

const dedupeAdminClasses = (input: SchoolClass[]): SchoolClass[] => {
  const byClass = new Map<string, SchoolClass>();

  input.forEach((cls, index) => {
    const className = String(cls.name || '').trim();
    const key = className ? normalizeAdminIdentity(className) : `id:${cls.id || index}`;
    const existing = byClass.get(key);
    const sections = Array.from(new Set((cls.sections || []).map(sec => String(sec).trim()).filter(Boolean)));

    if (existing) {
      byClass.set(key, {
        ...existing,
        ...cls,
        id: existing.id || cls.id,
        name: existing.name || cls.name,
        sections: Array.from(new Set([...(existing.sections || []), ...sections]))
      });
      return;
    }

    byClass.set(key, { ...cls, sections });
  });

  return Array.from(byClass.values());
};

const buildAdminClassGroups = (classes: SchoolClass[]): Record<string, SchoolClass[]> =>
  classes.reduce<Record<string, SchoolClass[]>>((acc, cls) => {
    const key = (cls.name || 'غير محدد').trim();
    if (!acc[key]) acc[key] = [];
    acc[key].push(cls);
    return acc;
  }, {});

const Admin: React.FC = () => {
  const toast = useToast();
  const showToast = toast.showToast;
  const [activeTab, setActiveTab] = useState('dashboard');
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [adminSearchOpen, setAdminSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const currentUser = auth.getSession();
  const storageMode = db.getMode();

  // Theme State
  const { selectedTheme, setTheme: setAdminTheme } = useAdminTheme();
  const [showThemeSelector, setShowThemeSelector] = useState(false);

  const persistAdminTheme = async (themeKey: string) => {
    const theme = THEME_CONFIG[themeKey];
    if (!theme) return;

    try {
      await appSettings.execute({
        type: 'patch',
        changes: {
          admin_theme: themeKey,
          theme: {
            primary_400: theme.primary_400,
            primary_500: theme.primary_500,
            primary_600: theme.primary_600,
            secondary_400: theme.secondary_400,
            secondary_500: theme.secondary_500,
            secondary_600: theme.secondary_600
          }
        }
      });
      showToast('تم حفظ الثيم وتطبيقه على الأجهزة', 'success');
    } catch (error) {
      logError(error, 'Admin - Save Admin Theme');
      showToast('تم تطبيق الثيم محلياً، وتعذر حفظه للمزامنة', 'error');
    }
  };

  // Dashboard State
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<any[]>([]);
  const [classStats, setClassStats] = useState<ClassStatsSummary[]>([]);
  const [detailedStats, setDetailedStats] = useState<any>(null);
  const [monthlyTrends, setMonthlyTrends] = useState<any[]>([]);
  const [attendanceByClass, setAttendanceByClass] = useState<any[]>([]);
  const [violationsData, setViolationsData] = useState<any[]>([]);
  const [exitsData, setExitsData] = useState<any[]>([]);

  // Students State
  const [students, setStudents] = useState<Student[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [studentSortBy, setStudentSortBy] = useState<'name' | 'id' | 'class' | 'section'>('name');
  const [studentSortDir, setStudentSortDir] = useState<'asc' | 'desc'>('asc');
  const [studentFilterGrade, setStudentFilterGrade] = useState<string>('all');
  const [studentFilterSection, setStudentFilterSection] = useState<string>('all');
  const [studentFilterStatus, setStudentFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [studentFilterActivity, setStudentFilterActivity] = useState<'all' | 'today' | 'week' | 'month' | 'older' | 'unknown'>('all');
  const [studentFiltersCollapsed, setStudentFiltersCollapsed] = useState(false);

  // Structure State
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [newClass, setNewClass] = useState({ name: '', sections: '' });
  const [classGroups, setClassGroups] = useState<Record<string, SchoolClass[]>>({});
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [classStudents, setClassStudents] = useState<Student[]>([]);
  const [selectedClassStats, setSelectedClassStats] = useState<ClassStatsSummary | null>(null);

  // Edit Sections Modal State
  const [editingClass, setEditingClass] = useState<SchoolClass | null>(null);
  const [editingSections, setEditingSections] = useState<string[]>([]);
  const [newSectionInput, setNewSectionInput] = useState('');
  const [classRange, setClassRange] = useState<'today' | 'week' | 'month'>('today');
  const [classLoading, setClassLoading] = useState(false);
  const [classStudentSearch, setClassStudentSearch] = useState('');
  const [classStudentSortBy, setClassStudentSortBy] = useState<'name' | 'id'>('name');
  const [classStudentSortDir, setClassStudentSortDir] = useState<'asc' | 'desc'>('asc');

  // Users State
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState<{ name: string, username: string, password: string, role: Role, assigned_classes: { class_name: string, sections: string[] }[], can_use_whatsapp?: boolean }>({
    name: '',
    username: '',
    password: '',
    role: Role.SCHOOL_ADMIN,
    assigned_classes: [],
    can_use_whatsapp: false
  });
  const [editingUser, setEditingUser] = useState<(User & { password?: string }) | null>(null);
  const [showEditUserModal, setShowEditUserModal] = useState(false);

  // Modals State
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStudentProfile, setSelectedStudentProfile] = useState<Student | null>(null);
  const [studentProfileData, setStudentProfileData] = useState<{ attendance: AttendanceRecord[], exits: ExitRecord[], violations: ViolationRecord[] } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBarcodeStudio, setShowBarcodeStudio] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ type: 'class' | 'user' | 'student', id: string, name: string } | null>(null);
  const [showManualAttendanceModal, setShowManualAttendanceModal] = useState(false);
  const [manualAttendanceForm, setManualAttendanceForm] = useState({ student_id: '', date: getLocalISODate(), time: '07:00' });
  const [manualAttendanceSearch, setManualAttendanceSearch] = useState('');
  const [manualAttendanceSaving, setManualAttendanceSaving] = useState(false);
  const [manualAttendanceType, setManualAttendanceType] = useState<'attendance' | 'absence'>('attendance');

  // Edit Student State
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [showEditStudentModal, setShowEditStudentModal] = useState(false);

  // New Student Form State
  const [newStudent, setNewStudent] = useState<Partial<Student>>({ id: '', name: '', class_name: '', section: '', guardian_phone: '', guardian_name: '', is_active: true });

  // Student ID Settings
  const [studentIdSettings, setStudentIdSettings] = useState<StudentIdSettings>({
    allow_edit: true
  });
  const [studentIdSettingsSaving, setStudentIdSettingsSaving] = useState(false);

  // Student ID Edit Modal
  const [idEditTarget, setIdEditTarget] = useState<Student | null>(null);
  const [idEditValue, setIdEditValue] = useState('');
  const [idEditError, setIdEditError] = useState<string | null>(null);
  const [renameConfirm, setRenameConfirm] = useState<{ student: Student; nextId: string } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);

  const [settingsRenameQuery, setSettingsRenameQuery] = useState('');
  const [settingsRenameTargetId, setSettingsRenameTargetId] = useState('');
  const [settingsRenameNewId, setSettingsRenameNewId] = useState('');
  const [settingsRenameError, setSettingsRenameError] = useState<string | null>(null);

  const [privacyPrompt, setPrivacyPrompt] = useState<'add' | 'import' | null>(null);
  const [privacyRemember, setPrivacyRemember] = useState(false);

  // Quick Send State
  const [showQuickSend, setShowQuickSend] = useState(false);
  const [quickSendStudent, setQuickSendStudent] = useState<Student | null>(null);

  // Local Toast (for quick feedback)
  const [localToast, setLocalToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({ show: false, message: '', type: 'success' });

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importIdMode, setImportIdMode] = useState<ImportIdMode>('keep');
  const [importIdPattern, setImportIdPattern] = useState<ImportIdPattern>({ prefix: '', length: 6, charset: 'numeric', start: 1 });
  const [importIdColumn, setImportIdColumn] = useState('');
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [columnSelections, setColumnSelections] = useState<Record<string, string>>({});
  const [columnMapping, setColumnMapping] = useState<ImportMapping>({});
  const [importPreviewRows, setImportPreviewRows] = useState<any[]>([]);

  // Student Selection State
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [bulkSelectGrade, setBulkSelectGrade] = useState('');
  const [bulkSelectSection, setBulkSelectSection] = useState('');


  // [REMOVED] Hybrid Mode Attendance State - Quick Attendance Actions removed per user request

  const isHiddenAdminUser = (user: User) => {
    const username = (user.username || '').toLowerCase();
    return user.role === Role.SITE_ADMIN || HIDDEN_ADMIN_USERNAMES.has(username);
  };
  const [bulkMoveClass, setBulkMoveClass] = useState('');
  const [bulkMoveSection, setBulkMoveSection] = useState('');

  // Reports State
  // Use local date for defaults to avoid timezone confusion
  const defaultReportDate = React.useMemo(() => getLocalISODate(), []);
  const [reportFiltersCollapsed, setReportFiltersCollapsed] = useState(false);
  const [reportFilter, setReportFilter] = useState<ReportFilter>({
    date_from: defaultReportDate,
    date_to: defaultReportDate,
    class_name: '',
    section: '',
    status: 'all',
    search_query: ''
  });
  const [reportData, setReportData] = useState<AdminAttendanceReportData | null>(null);

  // Kiosk Settings State
  // Attendance Settings (Hybrid Mode)
  const [attendanceSettings, setAttendanceSettings] = useState<AttendanceSettingsDraft>(DEFAULT_ATTENDANCE_SETTINGS);
  const [attendanceSettingsSaving, setAttendanceSettingsSaving] = useState(false);

  // Academic Calendar State
  const [academicHolidays, setAcademicHolidays] = useState<AcademicHoliday[]>([]);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const dashboardFetchSeqRef = useRef(0);
  const mobileTabRailRef = useRef<HTMLDivElement | null>(null);
  const adminSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const focusAdminSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        adminSearchInputRef.current?.focus();
        setAdminSearchOpen(true);
      }
    };

    window.addEventListener('keydown', focusAdminSearch);
    return () => window.removeEventListener('keydown', focusAdminSearch);
  }, []);
  const [showGuide, setShowGuide] = useState(false);

  const adminGuideSteps: GuideStep[] = [
    {
      title: "مرحباً في مركز الإدارة",
      description: "هنا يتم التحكم في كافة مفاصل النظام الأساسية لضمان سير العمل المدرسي.",
      icon: ShieldCheck,
      color: "amber",
      details: [
        "إدارة بيانات الطلاب والمستخدمين.",
        "تهيئة الفصول الدراسية والشعب.",
        "تأمين البيانات عبر النسخ الاحتياطي."
      ]
    },
    {
      title: "إدارة الطلاب والاستيراد",
      description: "يمكنك إضافة الطلاب يدوياً أو استيرادهم من ملف Excel/CSV بسهولة.",
      icon: UserPlus,
      color: "blue",
      details: [
        "استخدم 'معالج الاستيراد' لنقل آلاف الطلاب في دقائق.",
        "توليد أرقام أكاديمية ذكية تلقائياً.",
        "تحديث بيانات الطلاب وحالاتهم بضغطة زر."
      ]
    },
    {
      title: "هيكل المدرسة والشعب",
      description: "تخصيص الصفوف الدراسية بما يتناسب مع نظام مدرستك.",
      icon: GraduationCap,
      color: "purple",
      details: [
        "إضافة صفوف دراسية جديدة وتوزيع الشعب.",
        "تعديل مسميات الفصول في أي وقت.",
        "مراقبة إحصائيات الحضور والغياب لكل صف على حدة."
      ]
    },
    {
      title: "صلاحيات المستخدمين",
      description: "توزيع الأدوار والمسؤوليات على فريق العمل.",
      icon: UsersIcon,
      color: "emerald",
      details: [
        "إنشاء حسابات للمعلمين، المشرفين، ومدراء النظام.",
        "تحديد صلاحيات دقيقة لكل مستخدم (مثل صلاحية الواتساب).",
        "متابعة سجل الأنشطة والعمليات التي تمت في النظام."
      ]
    },
    {
      title: "الإعدادات والنسخ الاحتياطي",
      description: "حماية بياناتك هي أولويتنا القصوى.",
      icon: SettingsIcon,
      color: "rose",
      details: [
        "تخصيص رسائل التنبيه الآلية (واتساب/تليجرام).",
        "ضبط أوقات الدوام الرسمي والعطلات الدراسية.",
        "إنشاء نسخ احتياطية دورية واستعادتها عند الحاجة."
      ]
    }
  ];

  const [kiosk_settings, setKioskSettings] = useState<KioskSettings>({
    main_title: 'مرحباً في نظام الحضور الذكي',
    sub_title: 'لطفاً انتظر التعليمات أو مرر البطاقة',
    early_message: 'أهلًا بك! وصلت في الوقت المناسب',
    late_message: 'لقد تأخرت عن التجمع، راجع الإدارة',
    show_stats: true,
    school_name: '',
    principal_name: '',
    show_school_name: true,
    show_principal_name: true,
    screensaver_enabled: false,
    screensaver_timeout: 300000, // 5 minutes default
    screensaver_images: [],
    header_image: undefined,
    announcements_enabled: false,
    announcements_autoplay: true,
    announcements_interval: 5,
    announcements_transition: 'slide',
    announcements_position: 'bottom',
    announcements_images: [],
    announcements_titles: [],
    announcements_descriptions: [],
    assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
    grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD,
    theme: 'dark-neon',
    camera_scan_enabled: false,
    camera_scan_auto_open: false,
    display_settings: {
      clock_size: 'lg',
      title_size: 'lg',
      card_size: 'md',
      input_size: 'lg'
    }
  });

  // Notification Templates State
  const [notification_templates, setNotificationTemplates] = useState<NotificationTemplates>({
    late: { title: 'تنبيه تأخر', message: 'نود إعلامكم بتأخر ابنكم/ابنتكم عن الحضور للمدرسة اليوم. نأمل الحرص على الالتزام بالمواعيد.' },
    absent: { title: 'تنبيه غياب', message: 'نود إعلامكم بتغيب ابنكم/ابنتكم عن المدرسة اليوم. يرجى تبرير الغياب في أقرب وقت.' },
    behavior: { title: 'ملاحظة سلوكية', message: 'نود إعلامكم بتسجيل ملاحظة سلوكية على ابنكم/ابنتكم. يرجى مراجعة الإدارة للمتابعة.' },
    summon: { title: 'استدعاء ولي أمر', message: 'نرجو التكرم بمراجعة إدارة المدرسة لمناقشة موضوع يخص ابنكم/ابنتكم.' }
  });
  const [editingTemplate, setEditingTemplate] = useState<'late' | 'absent' | 'behavior' | 'summon' | null>(null);

  // Broadcast State for sending notifications
  const [broadcast, setBroadcast] = useState({
    title: '',
    message: '',
    target: 'all' as 'all' | 'supervisor' | 'guardian',
    type: 'announcement' as 'announcement' | 'general' | 'command',
    is_popup: false
  });
  const [sendingNotification, setSendingNotification] = useState(false);
  const [followUpNotifications, setFollowUpNotifications] = useState<Notification[]>([]);
  type StatusFilter = 'all' | 'notified' | 'pending';
  type DirectionFilter = 'all' | 'incoming' | 'outgoing';
  const [followUpFilter, setFollowUpFilter] = useState<StatusFilter>('all');
  const [followUpDirection] = useState<DirectionFilter>('all');
  const [followUpAttendance, setFollowUpAttendance] = useState<AttendanceRecord[]>([]);
  const [guardianExcuses, setGuardianExcuses] = useState<GuardianExcuseRecord[]>([]);
  const [backupSummary, setBackupSummary] = useState<{
    students: number;
    attendance: number;
    exits: number;
    violations: number;
    notifications: number;
    classes: number;
    users: number;
    dailySummaries: number;
    hasSettings: boolean;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<{
    meta: { app: string; created_at: string; mode?: string; version?: string };
    summary: {
      students: number;
      attendance: number;
      exits: number;
      violations: number;
      notifications: number;
      classes: number;
      users: number;
      dailySummaries: number;
      hasSettings: boolean;
    };
  } | null>(null);
  const [restoreIdMode, setRestoreIdMode] = useState<ImportIdMode>('keep');
  const [restoreIdPattern, setRestoreIdPattern] = useState<ImportIdPattern>({ prefix: '', length: 6, charset: 'numeric', start: 1 });
  const [restoreColumns, setRestoreColumns] = useState<string[]>([]);
  const [restoreMapping, setRestoreMapping] = useState<ImportMapping>({});
  const [restorePreviewRows, setRestorePreviewRows] = useState<any[]>([]);

  // Send Notification Handler
  const handleSendNotification = async () => {
    if (!broadcast.title || !broadcast.message) {
      toast.warning('يرجى إدخال العنوان والرسالة');
      return;
    }
    setSendingNotification(true);
    try {
      await notificationCenter.execute({
        type: 'broadcast',
        title: broadcast.title,
        message: broadcast.message,
        notificationType: broadcast.type,
        targetAudience: broadcast.target,
        isPopup: broadcast.is_popup,
        createdBy: currentUser?.id
      });

      toast.success('تم جدولة الإشعار للإرسال ✓');
      db.logActivity('notification_broadcast', `إرسال إشعار: ${broadcast.title}`, { user_id: currentUser?.id, user_name: currentUser?.name });
      setBroadcast({ title: '', message: '', target: 'all', type: 'announcement', is_popup: false });
    } catch (e) {
      logError(e, 'Admin - Send Broadcast');
      toast.error('حدث خطأ أثناء إرسال الإشعار');
    } finally {
      setSendingNotification(false);
    }
  };

  const saveAttendanceSettingsToCloud = async (newSettings: AttendanceSettingsDraft): Promise<boolean> => {
    setAttendanceSettingsSaving(true);
    try {
      await appSettings.execute({
        type: 'patch',
        changes: {
          attendance_settings: {
            ...newSettings,
            work_days: newSettings.work_days
          },
          // Keep the root value for backward compatibility.
          work_days: newSettings.work_days
        }
      });
      // Update local storage
      localStorage.setItem('hader:attendance:settings', JSON.stringify(newSettings));
      setAttendanceSettings(newSettings);
      showToast('تم حفظ إعدادات الدوام 💾', 'success');
      return true;
    } catch (e) {
      logError(e, 'Admin - Save Attendance Settings');
      showToast('فشل حفظ الإعدادات', 'error');
      return false;
    } finally {
      setAttendanceSettingsSaving(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // 📅 Save Academic Holidays
  // ═══════════════════════════════════════════════════════════════
  const saveAcademicHolidays = async (holidays: AcademicHoliday[]): Promise<boolean> => {
    setCalendarSaving(true);
    try {
      const normalizedHolidays = normalizeAcademicHolidays(holidays);
      await appSettings.execute({
        type: 'patch',
        changes: {
          attendance_settings: { academic_holidays: normalizedHolidays }
        }
      });
      setAcademicHolidays(normalizedHolidays);
      cacheHolidays(normalizedHolidays);
      return true;
    } catch (e) {
      logError(e, 'Admin - Save Academic Holidays');
      showToast('فشل حفظ التقويم الدراسي', 'error');
      return false;
    } finally {
      setCalendarSaving(false);
    }
  };

  const safeParseJSON = <T,>(value: string | null, fallback: T): T => {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logError(error, 'Admin - Parse JSON');
      return fallback;
    }
  };

  const getDailySummaryKeys = () => {
    if (typeof localStorage === 'undefined') return [];
    return Object.keys(localStorage).filter(key => key.startsWith(`${STORAGE_KEYS.DAILY_SHARE}:`));
  };

  const normalizeCollection = <T,>(value: any): T[] => {
    if (Array.isArray(value)) return value as T[];
    if (value && typeof value === 'object') {
      return Object.values(value) as T[];
    }
    if (typeof value === 'string') {
      const parsed = safeParseJSON<any>(value, []);
      return normalizeCollection<T>(parsed);
    }
    return [];
  };

  const normalizeText = (value: any) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };

  const buildGeneratedId = (index: number, pattern?: ImportIdPattern) => {
    const length = pattern?.length && pattern.length > 0 ? pattern.length : 6;
    const start = typeof pattern?.start === 'number' && pattern.start > 0 ? pattern.start : 1;
    const charset = pattern?.charset === 'alphanumeric' ? 'alphanumeric' : 'numeric';
    const prefix = pattern?.prefix || '';
    const sequence = start + index;
    const body = charset === 'numeric'
      ? sequence.toString().padStart(length, '0')
      : sequence.toString(36).padStart(length, '0');
    return `${prefix}${body}`;
  };

  const pickFirstValue = (record: any, keys: string[]) => {
    if (!record || typeof record !== 'object') return '';
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) {
        const text = normalizeText(record[key]);
        if (text) return text;
      }
    }
    return '';
  };

  const normalizeStudentsFromBackup = (rawStudents: any[], mapping?: ImportMapping, idMode?: ImportIdMode, idPattern?: ImportIdPattern) => {
    return rawStudents.map((raw, index) => {
      const name = pickFirstValue(raw, ['name', 'student_name', 'full_name', 'الاسم', 'اسم', 'الطالب']);
      const className = pickFirstValue(raw, ['class_name', 'class', 'grade', 'صف', 'الصف', 'المرحلة', 'السنة']);
      const section = pickFirstValue(raw, ['section', 'class_section', 'الشعبة', 'شعبة', 'الفصل', 'قسم']);
      const mappedId = mapping?.id ? normalizeText(raw[mapping.id]) : '';
      const mappedName = mapping?.name ? normalizeText(raw[mapping.name]) : '';
      const mappedClass = mapping?.grade ? normalizeText(raw[mapping.grade]) : '';
      const mappedSection = mapping?.section ? normalizeText(raw[mapping.section]) : '';
      const mappedGuardianPhone = mapping?.guardian_phone ? normalizeText(raw[mapping.guardian_phone]) : '';
      const mappedGuardianName = mapping?.guardian_name ? normalizeText(raw[mapping.guardian_name]) : '';
      const fallbackId = pickFirstValue(raw, ['id', 'student_id', 'studentId', 'معرف', 'المعرف', 'رقم', 'رقم الطالب']);
      const id = idMode === 'generate' || idMode === 'replace'
        ? buildGeneratedId(index, idPattern)
        : (mappedId || fallbackId);
      return {
        id,
        name: mappedName || name,
        class_name: mappedClass || className,
        section: mappedSection || section,
        guardian_phone: mappedGuardianPhone || pickFirstValue(raw, ['guardian_phone', 'parent_phone', 'رقم_ولي_الأمر', 'ولي_الأمر']),
        guardian_name: mappedGuardianName || pickFirstValue(raw, ['guardian_name', 'parent_name', 'ولي_الأمر_اسم', 'اسم_ولي_الأمر']),
        is_active: raw?.is_active ?? true
      } as Student;
    });
  };

  const ensureStudentIds = (students: Student[]) => {
    const used = new Set<string>();
    const idMap = new Map<string, string>();
    const normalized = students.map((student) => {
      const originalId = normalizeText(student.id);
      let id = originalId;
      if (!id || used.has(id)) {
        id = `stu-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      }
      used.add(id);
      if (originalId && id !== originalId && !idMap.has(originalId)) {
        idMap.set(originalId, id);
      }
      return { ...student, id };
    });
    return { normalized, idMap };
  };

  const buildClassesFromStudents = (students: Student[]) => {
    const byClass = new Map<string, Set<string>>();
    students.forEach((student) => {
      const className = normalizeText(student.class_name);
      if (!className) return;
      const section = normalizeText(student.section);
      if (!byClass.has(className)) {
        byClass.set(className, new Set());
      }
      if (section) {
        byClass.get(className)?.add(section);
      }
    });
    return Array.from(byClass.entries()).map(([name, sections], idx) => ({
      id: `class-${idx + 1}-${name}`,
      name,
      sections: Array.from(sections)
    })) as SchoolClass[];
  };

  const normalizeBackupPayload = (parsed: any, options?: { mapping?: ImportMapping; idMode?: ImportIdMode; idPattern?: ImportIdPattern }) => {
    const dataSource = parsed?.data ?? parsed?.payload ?? parsed?.backup ?? parsed;
    const readValue = (field: string, storageKey: string, fallback: any) => {
      const raw = dataSource?.[field] ?? dataSource?.[storageKey] ?? parsed?.[field] ?? parsed?.[storageKey];
      if (typeof raw === 'string') {
        return safeParseJSON(raw, fallback);
      }
      return raw ?? fallback;
    };

    const rawStudents = normalizeCollection<any>(readValue('students', STORAGE_KEYS.STUDENTS, []));
    const mapping = options?.mapping;
    const idMode = options?.idMode;
    const idPattern = options?.idPattern;
    const { normalized: students, idMap } = ensureStudentIds(
      normalizeStudentsFromBackup(rawStudents, mapping, idMode, idPattern)
    );
    const mapStudentId = (record: any) => {
      if (!record || typeof record !== 'object') return record;
      const rawId = normalizeText(record.student_id ?? record.studentId ?? record.studentID ?? record.student);
      if (!rawId) return record;
      const mapped = idMap.get(rawId) || rawId;
      return { ...record, student_id: mapped };
    };
    const attendance = normalizeCollection<AttendanceRecord>(readValue('attendance', STORAGE_KEYS.ATTENDANCE, []))
      .map(mapStudentId);
    const exits = normalizeCollection<ExitRecord>(readValue('exits', STORAGE_KEYS.EXITS, []))
      .map(mapStudentId);
    const violations = normalizeCollection<ViolationRecord>(readValue('violations', STORAGE_KEYS.VIOLATIONS, []))
      .map(mapStudentId);
    const notifications = normalizeCollection<Notification>(readValue('notifications', STORAGE_KEYS.NOTIFICATIONS, []));
    const rawClasses = normalizeCollection<SchoolClass>(readValue('classes', STORAGE_KEYS.CLASSES, []));
    const classes = rawClasses.length ? rawClasses : buildClassesFromStudents(students);
    const users = normalizeCollection<User>(readValue('users', STORAGE_KEYS.USERS, []));
    const settings = readValue('settings', STORAGE_KEYS.SETTINGS, null) as SystemSettings | null;

    const dailyRaw = readValue('daily_summaries', '', null) ?? readValue('dailySummaries', '', null);
    let dailySummaries: { key: string; value: any }[] = [];
    if (Array.isArray(dailyRaw)) {
      dailySummaries = dailyRaw.map((entry: any) => ({
        key: entry?.key,
        value: entry?.value
      })).filter((entry: any) => entry.key);
    } else if (dailyRaw && typeof dailyRaw === 'object') {
      dailySummaries = Object.entries(dailyRaw).map(([key, value]) => ({ key, value }));
    } else {
      const dailyKeys = Object.keys(dataSource || {}).filter(key => key.startsWith(`${STORAGE_KEYS.DAILY_SHARE}:`));
      dailySummaries = dailyKeys.map(key => ({
        key,
        value: safeParseJSON<any>(dataSource[key], null)
      }));
    }

    const summary = {
      students: students.length,
      attendance: attendance.length,
      exits: exits.length,
      violations: violations.length,
      notifications: notifications.length,
      classes: classes.length,
      users: users.length,
      dailySummaries: dailySummaries.length,
      hasSettings: Boolean(settings)
    };

    const meta = parsed?.meta ?? parsed?.metadata ?? {
      app: 'Hader',
      created_at: parsed?.created_at ?? new Date().toISOString(),
      version: parsed?.version
    };

    return {
      meta,
      summary,
      data: {
        students,
        attendance,
        exits,
        violations,
        notifications,
        classes,
        users,
        settings,
        daily_summaries: dailySummaries
      },
      rawStudents
    };
  };

  const getRawStudentsFromBackup = (parsed: any) => {
    const dataSource = parsed?.data ?? parsed?.payload ?? parsed?.backup ?? parsed;
    const raw = dataSource?.students ?? dataSource?.[STORAGE_KEYS.STUDENTS] ?? parsed?.students ?? parsed?.[STORAGE_KEYS.STUDENTS] ?? [];
    return normalizeCollection<any>(raw);
  };

  const getColumnsFromRows = (rows: any[]) => {
    if (!rows.length) return [];
    const keys = new Set<string>();
    rows.forEach((row) => {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach((key) => keys.add(key));
      }
    });
    return Array.from(keys);
  };

  const buildRestoreStudentsFromMapping = (rawStudents: any[], mapping: ImportMapping, idMode: ImportIdMode, idPattern: ImportIdPattern) => {
    const mapped = normalizeStudentsFromBackup(rawStudents, mapping, idMode, idPattern);
    const requiredMissing = mapped.find(student => !student.name || !student.class_name || !student.section);
    if (requiredMissing) {
      throw new Error('تأكد من تعيين الأعمدة المطلوبة: الاسم، الصف، الفصل.');
    }
    return mapped;
  };

  const refreshRestoreMapping = (columns: string[]) => {
    if (!columns.length) {
      setRestoreMapping({});
      return;
    }
    const detected = FileService.detectColumnMapping(columns);
    setRestoreMapping(detected);
  };

  const handleRestoreMappingChange = (field: ImportField, column: string) => {
    setRestoreMapping((prev) => ({
      ...prev,
      [field]: column
    }));
  };

  const buildLocalBackupPayload = () => {
    const students = safeParseJSON<Student[]>(localStorage.getItem(STORAGE_KEYS.STUDENTS), []);
    const attendance = safeParseJSON<AttendanceRecord[]>(localStorage.getItem(STORAGE_KEYS.ATTENDANCE), []);
    const exits = safeParseJSON<ExitRecord[]>(localStorage.getItem(STORAGE_KEYS.EXITS), []);
    const violations = safeParseJSON<ViolationRecord[]>(localStorage.getItem(STORAGE_KEYS.VIOLATIONS), []);
    const notifications = safeParseJSON<Notification[]>(localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS), []);
    const classes = safeParseJSON<SchoolClass[]>(localStorage.getItem(STORAGE_KEYS.CLASSES), []);
    const users = safeParseJSON<User[]>(localStorage.getItem(STORAGE_KEYS.USERS), []);
    const settings = safeParseJSON<SystemSettings | null>(localStorage.getItem(STORAGE_KEYS.SETTINGS), null);
    const dailyKeys = getDailySummaryKeys();
    const dailySummaries = dailyKeys.map(key => ({
      key,
      value: safeParseJSON<any>(localStorage.getItem(key), null)
    }));
    const summary = {
      students: students.length,
      attendance: attendance.length,
      exits: exits.length,
      violations: violations.length,
      notifications: notifications.length,
      classes: classes.length,
      users: users.length,
      dailySummaries: dailySummaries.length,
      hasSettings: Boolean(settings)
    };

    return {
      meta: {
        app: 'Hader',
        version: '1',
        created_at: new Date().toISOString(),
        mode: storageMode
      },
      summary,
      data: {
        students,
        attendance,
        exits,
        violations,
        notifications,
        classes,
        users,
        settings,
        daily_summaries: dailySummaries
      }
    };
  };

  const refreshBackupSummary = () => {
    if (storageMode !== 'local') {
      setBackupSummary(null);
      return;
    }
    const payload = buildLocalBackupPayload();
    setBackupSummary(payload.summary);
  };

  const handleDownloadBackup = async () => {
    if (storageMode !== 'local') {
      toast.warning('النسخ الاحتياطي متاح فقط في الوضع المحلي حالياً.');
      return;
    }
    setBackupBusy(true);
    setBackupError(null);
    try {
      const payload = buildLocalBackupPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hader-backup-${getLocalISODate()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupSummary(payload.summary);
      db.logActivity('backup_create', 'تم إنشاء نسخة احتياطية', { user_id: currentUser?.id, user_name: currentUser?.name, metadata: payload.summary });
    } catch (error) {
      logError(error, 'Admin - Generate Backup');
      setBackupError('تعذر إنشاء النسخة الاحتياطية. حاول مرة أخرى.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreFile = async (file: File | null) => {
    setRestoreFile(file);
    setRestorePreview(null);
    setBackupError(null);
    setRestoreColumns([]);
    setRestorePreviewRows([]);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      setRestoreFile(null);
      setBackupError('يجب اختيار ملف JSON صالح للنسخ الاحتياطي.');
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawStudents = getRawStudentsFromBackup(parsed);
      const columns = getColumnsFromRows(rawStudents);
      setRestoreColumns(columns);
      setRestorePreviewRows(rawStudents.slice(0, 5));
      refreshRestoreMapping(columns);
      const normalized = normalizeBackupPayload(parsed, { mapping: FileService.detectColumnMapping(columns), idMode: restoreIdMode, idPattern: restoreIdPattern });
      if (!normalized?.data) throw new Error('invalid format');
      setRestorePreview({
        meta: normalized.meta,
        summary: normalized.summary
      });
    } catch (error) {
      logError(error, 'Admin - File Operation');
      setBackupError('ملف النسخة الاحتياطية غير صالح أو تالف.');
    }
  };

  const restoreLocalStorageSnapshot = (snapshot: Array<{ key: string; value: string | null }>) => {
    snapshot.forEach(({ key, value }) => {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    });
  };

  const applyLocalRestoreAtomically = (data: ReturnType<typeof normalizeBackupPayload>['data']) => {
    const coreEntries: Array<[string, string]> = [
      [STORAGE_KEYS.STUDENTS, JSON.stringify(data.students)],
      [STORAGE_KEYS.ATTENDANCE, JSON.stringify(data.attendance)],
      [STORAGE_KEYS.EXITS, JSON.stringify(data.exits)],
      [STORAGE_KEYS.VIOLATIONS, JSON.stringify(data.violations)],
      [STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(data.notifications)],
      [STORAGE_KEYS.CLASSES, JSON.stringify(data.classes)],
      [STORAGE_KEYS.USERS, JSON.stringify(data.users)]
    ];

    if (data.settings) {
      coreEntries.push([STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings)]);
    }

    const existingDailyKeys = getDailySummaryKeys();
    const nextDailyEntries = Array.isArray(data.daily_summaries)
      ? data.daily_summaries
        .filter((entry: { key?: string }) => entry?.key?.startsWith(`${STORAGE_KEYS.DAILY_SHARE}:`))
        .map((entry: { key: string; value: any }) => [entry.key, JSON.stringify(entry.value)] as [string, string])
      : [];

    const touchedKeys = new Set<string>([
      ...coreEntries.map(([key]) => key),
      ...existingDailyKeys,
      ...nextDailyEntries.map(([key]) => key)
    ]);
    const snapshot = Array.from(touchedKeys).map((key) => ({
      key,
      value: localStorage.getItem(key)
    }));

    try {
      coreEntries.forEach(([key, value]) => localStorage.setItem(key, value));
      existingDailyKeys.forEach(key => localStorage.removeItem(key));
      nextDailyEntries.forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (error) {
      try {
        restoreLocalStorageSnapshot(snapshot);
      } catch (rollbackError) {
        logError(rollbackError, 'Admin - Restore Rollback');
      }
      throw error;
    }
  };

  const handleApplyRestore = async () => {
    if (storageMode !== 'local') {
      toast.warning('استعادة النسخة الاحتياطية متاحة فقط في الوضع المحلي حالياً.');
      return;
    }
    if (!restoreFile) {
      toast.warning('يرجى اختيار ملف النسخة الاحتياطية أولاً.');
      return;
    }
    setBackupBusy(true);
    setBackupError(null);
    try {
      const text = await restoreFile.text();
      const parsed = JSON.parse(text);
      const rawStudents = getRawStudentsFromBackup(parsed);
      if (rawStudents.length) {
        buildRestoreStudentsFromMapping(rawStudents, restoreMapping, restoreIdMode, restoreIdPattern);
      }
      const normalized = normalizeBackupPayload(parsed, {
        mapping: restoreMapping,
        idMode: restoreIdMode,
        idPattern: restoreIdPattern
      });
      const resolvedStudents = normalized.data.students;
      const resolvedClasses = normalized.data.classes.length
        ? normalized.data.classes
        : buildClassesFromStudents(resolvedStudents);
      const data = {
        ...normalized.data,
        students: resolvedStudents,
        classes: resolvedClasses
      };

      applyLocalRestoreAtomically(data);

      refreshBackupSummary();
      toast.success('تمت استعادة النسخة الاحتياطية بنجاح. سيتم إعادة تحميل الصفحة.');
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      logError(error, 'Admin - File Operation');
      setBackupError('تعذر استعادة النسخة الاحتياطية. تحقق من الملف وحاول مرة أخرى.');
    } finally {
      setBackupBusy(false);
    }
  };

  // --- Fetchers ---
  const fetchDashboard = async () => {
    const seq = ++dashboardFetchSeqRef.current;
    setLoading(true);
    try {
      const today = getLocalISODate();
      const anchor = getSyncedDate();
      const thirtyDaysAgo = new Date(anchor);
      thirtyDaysAgo.setDate(anchor.getDate() - 30);
      const startDate = getLocalDateStr(thirtyDaysAgo);

      const [allStudents, allAttendance, allClasses, allUsers, violationSnapshot, exitSnapshot, settings] = await Promise.all([
        db.getStudents(),
        db.getAttendanceRange(startDate, today), // Fix: Fetch only last 30 days to avoid 1000-row limit
        db.getClasses(),
        db.getUsers(),
        studentAffairs.load({ type: 'violations' }),
        studentAffairs.load({ type: 'exits', date: today }),
        appSettings.load()
      ]);
      const allViolations = violationSnapshot.violations;
      const allExits = exitSnapshot.exits;

      // Ignore stale responses when a newer dashboard fetch already started.
      if (seq !== dashboardFetchSeqRef.current) return;

      const workDays = (settings?.attendance_settings as any)?.work_days ?? settings?.work_days ?? [0, 1, 2, 3, 4];
      const configuredHolidays = (settings?.attendance_settings as any)?.academic_holidays ?? [];

      setStudents(allStudents);
      setClasses(dedupeAdminClasses(allClasses));
      setUsers(dedupeAdminUsers(allUsers.filter(user => !isHiddenAdminUser(user))));

      // Calculate real weekly stats (last 7 days)
      const weekDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const weeklyData: any[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = getLocalDateStr(date);
        const dayIndex = date.getDay();
        const isHoliday = isDateHoliday(dateStr, workDays, configuredHolidays);
        const holidayInfo = getHolidayInfo(dateStr, configuredHolidays);
        const dayAttendance = getAttendanceForDate(allAttendance, dateStr);
        const dayStudents = allStudents.length;
        const counts = getAttendanceStatusCounts(dayAttendance, dayStudents, { isHoliday });
        const present = counts.present;
        const late = counts.late;

        const rate = (dayStudents > 0 && !isHoliday) ? Math.round(((present + late) / dayStudents) * 100) : null;

        weeklyData.push({
          day: weekDays[dayIndex],
          presence: rate,
          present,
          late,
          absent: counts.absent,
          total: dayStudents,
          isHoliday,
          holidayName: holidayInfo?.label
        });
      }
      setWeeklyStats(weeklyData);

      // Build O(1) lookup maps
      const studentById = new Map(allStudents.map(s => [s.id, s]));
      const studentsByClass = new Map<string, Student[]>();
      for (const s of allStudents) {
        const list = studentsByClass.get(s.class_name) || [];
        list.push(s);
        studentsByClass.set(s.class_name, list);
      }

      // Calculate real class stats
      const classData: any[] = [];
      const isTodayHoliday = isDateHoliday(today, workDays, configuredHolidays);
      const todayHolidayInfo = getHolidayInfo(today, configuredHolidays);
      const todayAttendanceAll = getAttendanceForDate(allAttendance, today);

      // Group today's attendance by class using the map
      const todayAttByClass = new Map<string, AttendanceRecord[]>();
      for (const a of todayAttendanceAll) {
        const student = studentById.get(a.student_id);
        if (student) {
          const list = todayAttByClass.get(student.class_name) || [];
          list.push(a);
          todayAttByClass.set(student.class_name, list);
        }
      }

      for (const cls of allClasses) {
        const classStudents = studentsByClass.get(cls.name) || [];
        const todayAtt = todayAttByClass.get(cls.name) || [];
        const counts = getAttendanceStatusCounts(todayAtt, classStudents.length, { isHoliday: isTodayHoliday });
        classData.push({
          name: cls.name,
          total: classStudents.length,
          present: counts.present,
          late: counts.late,
          absent: counts.absent,
          rate: (classStudents.length > 0 && !isTodayHoliday) ? Math.round((counts.attended / classStudents.length) * 100) : 0
        });
      }
      setClassStats(classData);

      // Calculate detailed stats
      const todayAttendance = getAttendanceForDate(allAttendance, today);
      const todayCounts = getAttendanceStatusCounts(todayAttendance, allStudents.length, { isHoliday: isTodayHoliday });
      const present_count = todayCounts.present;
      const late_count = todayCounts.late;
      const absent_count = todayCounts.absent;
      const attendance_rate = (allStudents.length > 0 && !isTodayHoliday) ? Math.round((todayCounts.attended / allStudents.length) * 100) : 0;

      // Compare with the latest actual school day instead of a weekend or holiday.
      let comparisonDate = new Date(`${today}T12:00:00`);
      let comparisonDateStr = today;
      for (let offset = 1; offset <= 30; offset += 1) {
        const candidate = new Date(`${today}T12:00:00`);
        candidate.setDate(candidate.getDate() - offset);
        const candidateStr = getLocalDateStr(candidate);
        if (!isDateHoliday(candidateStr, workDays, configuredHolidays)) {
          comparisonDate = candidate;
          comparisonDateStr = candidateStr;
          break;
        }
      }

      const comparisonAttendance = getAttendanceForDate(allAttendance, comparisonDateStr);
      const comparisonCounts = getAttendanceStatusCounts(comparisonAttendance, allStudents.length);
      const comparisonRate = allStudents.length > 0
        ? Math.round((comparisonCounts.attended / allStudents.length) * 100)
        : 0;
      const rateChange = isTodayHoliday ? 0 : attendance_rate - comparisonRate;
      const comparisonLabel = comparisonDate.toLocaleDateString('ar-SA', {
        weekday: 'long',
        day: 'numeric',
        month: 'short'
      });

      setStats({
        total_students: allStudents.length,
        present_count,
        late_count,
        absent_count,
        attendance_rate
      });

      // Attendance by class for detailed view
      const attendanceByClassData = classData.map(c => ({
        name: c.name,
        present: c.present,
        late: c.late,
        absent: c.absent,
        total: c.total,
        rate: c.rate
      }));
      setAttendanceByClass(attendanceByClassData);

      // Violations data
      const violationsByLevel = [
        { name: 'منخفض', value: allViolations.filter(v => v.level === 1).length, color: '#10b981' },
        { name: 'متوسط', value: allViolations.filter(v => v.level === 2).length, color: '#f59e0b' },
        { name: 'عالي', value: allViolations.filter(v => v.level === 3).length, color: '#ef4444' }
      ];
      setViolationsData(violationsByLevel);

      // Exits data
      setExitsData(allExits);

      // Monthly trends (last 30 days)
      const monthlyData: any[] = [];
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = getLocalDateStr(date);
        const dayAtt = getAttendanceForDate(allAttendance, dateStr);
        const isHoliday = isDateHoliday(dateStr, workDays, configuredHolidays);
        const dayCounts = getAttendanceStatusCounts(dayAtt, allStudents.length, { isHoliday });
        const dayRate = allStudents.length > 0 && !isHoliday
          ? Math.round((dayCounts.attended / allStudents.length) * 100)
          : null;
        monthlyData.push({
          date: dateStr,
          day: date.getDate(),
          rate: dayRate,
          present: dayCounts.present,
          late: dayCounts.late,
          isHoliday
        });
      }
      setMonthlyTrends(monthlyData);

      // Detailed stats object
      const workingWeek = weeklyData.filter(day => !day.isHoliday && day.presence != null);
      setDetailedStats({
        total_students: allStudents.length,
        todayRate: attendance_rate,
        comparisonRate,
        comparisonLabel,
        rateChange,
        totalViolations: allViolations.length,
        totalExits: allExits.length,
        averageWeeklyRate: workingWeek.length > 0
          ? Math.round(workingWeek.reduce((sum, day) => sum + Number(day.presence), 0) / workingWeek.length)
          : 0,
        isTodayHoliday,
        holidayName: todayHolidayInfo?.label
      });

    } catch (e) {
      logError(e, 'Admin - Operation');
    } finally {
      setLoading(false);
    }
  };

  const fetchStudents = async (options?: { forceSync?: boolean }) => {
    setLoading(true);
    try {
      const data = await db.getStudents(options);
      setStudents(data);
    } catch (e) { logError(e, 'Admin - Operation'); } finally { setLoading(false); }
  };

  // Initial force sync on mount to ensure fresh data
  useEffect(() => {
    fetchStudents({ forceSync: true });
  }, []);

  useEffect(() => {
    const handleSchemaWarning = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string; column?: string; message?: string }>).detail;
      const target = detail?.table && detail?.column ? `${detail.table}.${detail.column}` : 'Supabase';
      toast.warning(`قاعدة البيانات تحتاج تحديثاً: ${target}`, 8000);
    };

    window.addEventListener('hader:schema-warning', handleSchemaWarning);
    return () => window.removeEventListener('hader:schema-warning', handleSchemaWarning);
  }, [toast]);

  const getRangeDates = (range: 'today' | 'week' | 'month') => {
    const today = getLocalISODate();
    const date = new Date(today);
    if (range === 'week') date.setDate(date.getDate() - 6);
    if (range === 'month') date.setDate(date.getDate() - 29);
    const from = getLocalDateStr(date);
    return { from, to: today };
  };

  const loadClassProfile = async (grade: string, section: string, range: 'today' | 'week' | 'month' = classRange) => {
    if (!grade || !section) return;
    setClassLoading(true);
    try {
      const { from, to } = getRangeDates(range);
      const [studentsByClass, stats] = await Promise.all([
        db.getStudentsByClass(grade, section),
        db.getClassProfileStats(grade, section, from, to)
      ]);
      setSelectedGrade(grade);
      setSelectedSection(section);
      setClassStudents(studentsByClass);
      setSelectedClassStats(stats);
      setClassRange(range);
    } catch (error) {
      logError(error, 'Admin - Load Class Profile');
    } finally {
      setClassLoading(false);
    }
  };

  const fetchStructure = async (options?: { preserveSelection?: boolean }) => {
    setLoading(true);
    try {
      const [data, grouped] = await Promise.all([db.getClasses(), db.getClassesGroupedByGrade()]);
      const uniqueClasses = dedupeAdminClasses(data);
      const uniqueGrouped = Object.keys(grouped || {}).length > 0
        ? Object.fromEntries(
          Object.entries(grouped).map(([grade, rows]) => [grade, dedupeAdminClasses(rows || [])])
        )
        : buildAdminClassGroups(uniqueClasses);
      setClasses(uniqueClasses);
      setClassGroups(uniqueGrouped);

      const grades = Object.keys(uniqueGrouped);
      if (grades.length === 0) {
        setSelectedGrade('');
        setSelectedSection('');
        setClassStudents([]);
        setSelectedClassStats(null);
        return;
      }

      const selectedGradeCandidate = options?.preserveSelection && uniqueGrouped[selectedGrade]
        ? selectedGrade
        : grades[0];

      const sections = (uniqueGrouped[selectedGradeCandidate] || []).flatMap(cls =>
        (cls.sections || []).map(sec => sec.trim()).filter(Boolean)
      );

      const selectedSectionCandidate = options?.preserveSelection && sections.includes(selectedSection)
        ? selectedSection
        : (sections[0] || '');

      setSelectedGrade(selectedGradeCandidate);
      setSelectedSection(selectedSectionCandidate);

      if (selectedGradeCandidate && selectedSectionCandidate) {
        await loadClassProfile(selectedGradeCandidate, selectedSectionCandidate, classRange);
      }
    } catch (e) { logError(e, 'Admin - Operation'); } finally { setLoading(false); }
  };

  const handleRebuildStructure = async () => {
    setClassLoading(true);
    try {
      await db.syncClassesFromStudents();
      await fetchStructure({ preserveSelection: true });
      toast.success('تم بناء الهيكل بنجاح');
    } catch (error) {
      logError(error, 'Admin - Sync Structure');
      toast.error('تعذر بناء الهيكل تلقائيًا. حاول مرة أخرى.');
    } finally {
      setClassLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await db.getUsers();
      const filtered = data.filter((u) => !isHiddenAdminUser(u));
      setUsers(dedupeAdminUsers(filtered));
    } catch (e) { logError(e, 'Admin - Operation'); } finally { setLoading(false); }
  };

  const fetchKioskSettings = async () => {
    setLoading(true);
    try {
      const settings = await appSettings.load();
      if (settings) {
        const defaults: KioskSettings = {
          main_title: 'مرحباً في نظام الحضور الذكي',
          sub_title: 'لطفاً انتظر التعليمات أو مرر البطاقة',
          early_message: 'أهلًا بك! وصلت في الوقت المناسب',
          late_message: 'لقد تأخرت عن التجمع، راجع الإدارة',
          show_stats: true,
          school_name: settings.school_name || '',
          principal_name: settings.principal_name || '',
          show_school_name: true,
          show_principal_name: true,
          screensaver_enabled: false,
          screensaver_timeout: 300000,
          screensaver_images: [],
          header_image: undefined,
          announcements_enabled: false,
          announcements_autoplay: true,
          announcements_interval: 5,
          announcements_transition: 'slide',
          announcements_position: 'bottom',
          announcements_images: [],
          announcements_titles: [],
          announcements_descriptions: [],
          assembly_time: ATTENDANCE_DEFAULTS.ASSEMBLY_TIME,
          grace_period: ATTENDANCE_DEFAULTS.GRACE_PERIOD,
          theme: 'dark-neon'
        };
        // 🔥 SOURCE OF TRUTH: Favor top-level settings columns
        const incoming = (settings.kiosk_settings as Partial<KioskSettings>) || {};
        const merged = {
          ...defaults,
          ...incoming,
          // System-level settings overwrite kiosk-specific defaults/blobs
          school_name: settings.school_name || incoming.school_name || defaults.school_name,
          principal_name: settings.principal_name || incoming.principal_name || defaults.principal_name,
          assembly_time: settings.assembly_time || incoming.assembly_time || defaults.assembly_time,
          grace_period: settings.grace_period ?? incoming.grace_period ?? defaults.grace_period,
          show_school_name: incoming.show_school_name ?? defaults.show_school_name,
          show_principal_name: incoming.show_principal_name ?? defaults.show_principal_name
        };

        setKioskSettings(merged);
      }
    } catch (e) {
      logError(e, 'Admin - fetchKioskSettings');
    } finally {
      setLoading(false);
    }
  };

  const fetchNotificationTemplates = async () => {
    setLoading(true);
    try {
      const settings = await appSettings.load();
      if (settings?.notification_templates) {
        setNotificationTemplates({
          late: settings.notification_templates.late || notification_templates.late,
          absent: settings.notification_templates.absent || notification_templates.absent,
          behavior: settings.notification_templates.behavior || notification_templates.behavior,
          summon: settings.notification_templates.summon || notification_templates.summon
        });
      }
    } catch (e) { logError(e, 'Admin - Operation'); } finally { setLoading(false); }
  };

  const saveNotificationTemplates = async () => {
    setLoading(true);
    try {
      await appSettings.execute({
        type: 'patch',
        changes: { notification_templates }
      });
      toast.success('تم حفظ قوالب الإشعارات بنجاح ✓');
      setEditingTemplate(null);
    } catch (e) {
      logError(e, 'Admin - Operation');
      toast.error('حدث خطأ أثناء الحفظ');
    } finally { setLoading(false); }
  };

  const fetchFollowUpNotifications = async () => {
    setLoading(true);
    try {
      const today = getLocalISODate();
      const [data, attendance] = await Promise.all([
        notificationCenter.load({ type: 'all', limit: 300 }),
        db.getAttendance(today)
      ]);
      setFollowUpNotifications(data);
      setFollowUpAttendance(attendance);
    } catch (e) {
      logError(e, 'Admin - Operation');
    } finally {
      setLoading(false);
    }
  };

  const fetchGuardianExcuses = async () => {
    setLoading(true);
    try {
      const [excuseRows] = await Promise.all([
        studentAffairs.load({ type: 'excuses', filters: { limit: 300 } }).then(result => result.excuses),
        students.length ? Promise.resolve(students) : fetchStudents()
      ]);
      setGuardianExcuses(excuseRows);
    } catch (e) {
      logError(e, 'Admin - Fetch Guardian Excuses');
      toast.error('تعذر تحميل أعذار أولياء الأمور');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewGuardianExcuse = async (
    excuse: GuardianExcuseRecord,
    status: Exclude<GuardianExcuseStatus, 'pending'>,
    notes: string
  ) => {
    const result = await studentAffairs.execute({
      type: 'review-excuse',
      excuse,
      status,
      notes,
      reviewer: {
        id: currentUser?.id,
        label: currentUser?.name || currentUser?.username || 'الإدارة'
      }
    });
    if (!result.excuse) throw new Error('Reviewed excuse was not returned');
    setGuardianExcuses(prev => prev.map(row => row.id === result.excuse!.id ? result.excuse! : row));

    toast.success(status === 'approved' ? 'تم اعتماد العذر' : 'تم رفض العذر');
  };

  // [REMOVED] Hybrid Mode Attendance Functions removed per user request

  // Load attendance settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      let resolvedAttendanceSettings = DEFAULT_ATTENDANCE_SETTINGS;
      try {
        // 1. Try LocalStorage first (Fastest)
        const savedSettings = localStorage.getItem('hader:attendance:settings');
        if (savedSettings) {
          const parsed = safeParseJSON<Record<string, unknown>>(savedSettings, {});
          resolvedAttendanceSettings = normalizeAttendanceSettings(parsed);
          setAttendanceSettings(resolvedAttendanceSettings);
        }
        setAcademicHolidays(normalizeAcademicHolidays(getCachedHolidays()));

        // 2. Fetch from Cloud (Authoritative)
        const cloudSettings = await appSettings.load({ refresh: true });
        if (cloudSettings) {
          const remoteAttendance = cloudSettings.attendance_settings && typeof cloudSettings.attendance_settings === 'object'
            ? cloudSettings.attendance_settings
            : {};
          const normalizedRemote = normalizeAttendanceSettings({
            ...remoteAttendance,
            work_days: remoteAttendance.work_days ?? cloudSettings.work_days
          }, resolvedAttendanceSettings);
          setAttendanceSettings(normalizedRemote);
          localStorage.setItem('hader:attendance:settings', JSON.stringify(normalizedRemote));

          // Load academic holidays
          const remoteHolidays = remoteAttendance.academic_holidays;
          if (Array.isArray(remoteHolidays)) {
            const normalizedHolidays = normalizeAcademicHolidays(remoteHolidays);
            setAcademicHolidays(normalizedHolidays);
            cacheHolidays(normalizedHolidays);
          }
        }
      } catch (error) {
        logError(error, 'Admin - Load Attendance Settings');
      }
    };
    loadSettings();
  }, []);

  const refreshActiveTabData = () => {
    if (activeTab === 'dashboard') fetchDashboard();
    if (activeTab === 'students') { fetchStudents(); fetchStructure(); fetchStudentIdSettings(); }
    if (activeTab === 'structure') fetchStructure();
    if (activeTab === 'users') { fetchUsers(); fetchStructure(); }
    if (activeTab === 'kiosk') fetchKioskSettings();
    if (activeTab === 'reports') { fetchStructure(); fetchStudents(); }
    if (activeTab === 'notifications') fetchNotificationTemplates();
    if (activeTab === 'backup') refreshBackupSummary();
    if (activeTab === 'follow-up') { fetchStudents(); fetchFollowUpNotifications(); }
    if (activeTab === 'excuses') fetchGuardianExcuses();
    if (activeTab === 'settings') fetchStudentIdSettings();
  };

  useEffect(() => {
    refreshActiveTabData();
  }, [activeTab]);

  useLiveUpdates(() => {
    if (import.meta.env.DEV) {
      console.debug('[Admin] Real-time update detected');
    }
    refreshActiveTabData();
  });

  useSyncRefresh(() => {
    if (import.meta.env.DEV) {
      console.debug('[Admin] Background sync completed');
    }
    refreshActiveTabData();
  });

  useEffect(() => {
    if (showManualAttendanceModal) {
      setManualAttendanceForm(prev => ({
        student_id: prev.student_id,
        date: getLocalISODate(),
        time: kiosk_settings.assembly_time || prev.time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME
      }));
    }
  }, [showManualAttendanceModal, kiosk_settings.assembly_time]);

  // Real-time Attendance Subscription
  useEffect(() => {
    const sub = db.subscribeToAttendance((newRecord) => {
      // Refresh authoritative data to avoid optimistic drift across devices.
      if (activeTab === 'dashboard') fetchDashboard();
      if (activeTab === 'students') fetchStudents();
      if (activeTab === 'structure') fetchStructure();
    });

    return () => {
      sub.unsubscribe();
    };
  }, [activeTab]);

  // Load student profile data when a student is selected
  useEffect(() => {
    if (selectedStudentProfile) {
      const loadProfileData = async () => {
        setLoading(true);
        try {
          const [attendance, affairs] = await Promise.all([
            db.getStudentAttendance(selectedStudentProfile.id),
            studentAffairs.load({ type: 'student', studentId: selectedStudentProfile.id })
          ]);
          setStudentProfileData({
            attendance,
            exits: affairs.exits,
            violations: affairs.violations
          });
        } catch (e) {
          logError(e, 'Admin - Operation');
        } finally {
          setLoading(false);
        }
      };
      loadProfileData();
    } else {
      setStudentProfileData(null);
    }
  }, [selectedStudentProfile]);

  const showLocalToast = (message: string, type: 'success' | 'error' = 'success') => {
    setLocalToast({ show: true, message, type });
    setTimeout(() => setLocalToast({ show: false, message: '', type: 'success' }), 3000);
  };

  const getPrivacyKey = (mode: 'add' | 'import') =>
    mode === 'add' ? PRIVACY_ADD_KEY : PRIVACY_IMPORT_KEY;

  const openPrivacyGate = (mode: 'add' | 'import') => {
    const skip = localStorage.getItem(getPrivacyKey(mode)) === '1';
    if (skip) {
      if (mode === 'add') {
        const generatedId = generateNextStudentId(students, studentIdPolicy);
        setNewStudent({ id: generatedId, name: '', class_name: '', section: '', guardian_phone: '', guardian_name: '', is_active: true });
        setShowAddModal(true);
      } else {
        setShowImportModal(true);
      }
      return;
    }
    setPrivacyRemember(false);
    setPrivacyPrompt(mode);
  };

  const handlePrivacyContinue = () => {
    if (!privacyPrompt) return;
    if (privacyRemember) {
      localStorage.setItem(getPrivacyKey(privacyPrompt), '1');
    }
    if (privacyPrompt === 'add') {
      const generatedId = generateNextStudentId(students, studentIdPolicy);
      setNewStudent({ id: generatedId, name: '', class_name: '', section: '', guardian_phone: '', guardian_name: '', is_active: true });
      setShowAddModal(true);
    } else {
      setShowImportModal(true);
    }
    setPrivacyPrompt(null);
    showToast('تم تأكيد سياسة الخصوصية', 'success');
  };

  const handlePrivacyCancel = () => {
    setPrivacyPrompt(null);
    showToast('تم إلغاء العملية حفاظًا على الخصوصية', 'error');
  };

  const fetchStudentIdSettings = async () => {
    setLoading(true);
    try {
      const settings = await appSettings.load();
      const incoming = settings?.security_settings?.student_id_settings || {};
      setStudentIdSettings({
        allow_edit: incoming.allow_edit ?? true,
        charset: incoming.charset,
        length: incoming.length,
        prefix: incoming.prefix
      });
    } catch (error) {
      logError(error, 'Admin - Load Student ID Settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStudentIdSettings = async () => {
    setStudentIdSettingsSaving(true);
    try {
      await appSettings.execute({
        type: 'patch',
        changes: {
          security_settings: { student_id_settings: studentIdSettings }
        }
      });
      showToast('تم حفظ إعدادات المعرّف بنجاح', 'success');
    } catch (error) {
      logError(error, 'Admin - Save Student ID Settings');
      showToast('حدث خطأ أثناء حفظ إعدادات المعرّف', 'error');
    } finally {
      setStudentIdSettingsSaving(false);
    }
  };

  // --- Handlers ---

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const classSections = getCatalogSections(schoolCatalog, newStudent.class_name || '');
      const rawSection = newStudent.section || '';
      const normalizedSection = classSections.length > 0
        ? classSections.find(sec => normalizeLabel(sec) === normalizeLabel(rawSection)) || ''
        : normalizeSectionInput(rawSection);

      if (classSections.length > 0 && !normalizedSection) {
        showToast('يرجى اختيار فصل صحيح من القائمة المعتمدة.', 'error');
        setLoading(false);
        return;
      }
      const candidateId = (newStudent.id || '').trim();
      const validation = validateStudentId(candidateId, studentIdPolicy);
      if (!validation.valid) {
        showToast(validation.message, 'error');
        setLoading(false);
        return;
      }
      if (isStudentIdDuplicate(candidateId, students)) {
        showToast('المعرّف مستخدم بالفعل لطالب آخر.', 'error');
        setLoading(false);
        return;
      }
      const existing = await db.getStudentById(candidateId);
      if (existing) {
        showToast('المعرّف مستخدم بالفعل لطالب آخر.', 'error');
        setLoading(false);
        return;
      }
      const studentToAdd: Student = {
        id: candidateId,
        name: newStudent.name || '',
        class_name: newStudent.class_name || '',
        section: normalizedSection,
        guardian_phone: newStudent.guardian_phone,
        guardian_name: newStudent.guardian_name,
        is_active: newStudent.is_active ?? true,
      };

      // 🌐 CLOUD MODE: saveStudents returns Student[] from Supabase
      const createdStudents = await db.saveStudents([studentToAdd]);

      if (createdStudents && createdStudents.length > 0) {
        // ✅ Add returned students directly to state
        setStudents(prev => [...prev, ...createdStudents]);
        setShowAddModal(false);
        setNewStudent({ id: '', name: '', class_name: '', section: '', guardian_phone: '', guardian_name: '', is_active: true });
        showToast('تم إضافة الطالب بنجاح', 'success');
        db.logActivity('student_add', `إضافة طالب: ${studentToAdd.name}`, { user_id: currentUser?.id, user_name: currentUser?.name, target_id: studentToAdd.id, target_name: studentToAdd.name });
      }
    } catch (e) {
      logError(e, 'Admin - Add Student');
      showToast('حدث خطأ أثناء الإضافة', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEditStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setLoading(true);
    try {
      const classSections = getCatalogSections(schoolCatalog, editingStudent.class_name || '');
      const rawSection = editingStudent.section || '';
      const normalizedSection = classSections.length > 0
        ? classSections.find(sec => normalizeLabel(sec) === normalizeLabel(rawSection)) || ''
        : normalizeSectionInput(rawSection);
      if (classSections.length > 0 && !normalizedSection) {
        showToast('يرجى اختيار فصل صحيح من القائمة المعتمدة.', 'error');
        setLoading(false);
        return;
      }
      // 🌐 CLOUD MODE: updateStudent returns updated Student from Supabase
      const updatedStudent = await db.updateStudent({ ...editingStudent, section: normalizedSection });

      // ✅ Update state directly with returned student instead of refetching
      setStudents(prev => prev.map(s => s.id === updatedStudent.id ? updatedStudent : s));
      setShowEditStudentModal(false);
      setEditingStudent(null);
      showToast('تم تحديث بيانات الطالب بنجاح', 'success');
    } catch (e) {
      logError(e, 'Admin - Update Student');
      showToast('حدث خطأ أثناء التحديث', 'error');
    } finally {
      setLoading(false);
    }
  };

  const requestStudentIdRename = async (
    student: Student,
    candidateId: string,
    setError: (message: string | null) => void
  ) => {
    try {
      const nextId = candidateId.trim();
      if (!nextId) {
        setError('المعرّف مطلوب.');
        return;
      }
      if (nextId === student.id) {
        setError('المعرّف الجديد مطابق للمعرّف الحالي.');
        return;
      }
      const validation = validateStudentId(nextId, studentIdPolicy);
      if (!validation.valid) {
        setError(validation.message);
        return;
      }
      if (isStudentIdDuplicate(nextId, students, student.id)) {
        setError('المعرّف مستخدم بالفعل لطالب آخر.');
        return;
      }
      const existing = await db.getStudentById(nextId);
      if (existing && existing.id !== student.id) {
        setError('المعرّف مستخدم بالفعل لطالب آخر.');
        return;
      }
      setError(null);
      setRenameConfirm({ student, nextId });
    } catch (error) {
      logError(error, 'Admin - Validate Student ID Rename');
      setError('تعذر التحقق من المعرّف حالياً. حاول مرة أخرى.');
    }
  };

  const executeStudentIdRename = async () => {
    if (!renameConfirm) return;
    const { student, nextId } = renameConfirm;
    setRenameSaving(true);
    try {
      const updated = await db.renameStudentId(student.id, nextId);
      setStudents(prev => prev.map(s => s.id === student.id ? { ...s, id: updated.id } : s));
      setSelectedStudentIds(prev => {
        if (!prev.has(student.id)) return prev;
        const next = new Set(prev);
        next.delete(student.id);
        next.add(updated.id);
        return next;
      });
      setEditingStudent(prev => prev && prev.id === student.id ? { ...prev, id: updated.id } : prev);
      setSelectedStudentProfile(prev => prev && prev.id === student.id ? { ...prev, id: updated.id } : prev);
      setIdEditTarget(null);
      setIdEditValue('');
      setIdEditError(null);
      setSettingsRenameTargetId('');
      setSettingsRenameNewId('');
      setSettingsRenameError(null);
      setRenameConfirm(null);
      showToast('تم تحديث معرّف الطالب بنجاح', 'success');
    } catch (error) {
      logError(error, 'Admin - Update Student ID');
      showToast('حدث خطأ أثناء تحديث المعرّف', 'error');
    } finally {
      setRenameSaving(false);
    }
  };

  const handleManualAttendanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAttendanceForm.student_id) {
      toast.warning('يرجى اختيار الطالب أولاً');
      return;
    }
    if (!manualAttendanceForm.date) {
      toast.warning('يرجى تحديد اليوم');
      return;
    }
    if (manualAttendanceType === 'attendance' && !manualAttendanceForm.time) {
      toast.warning('يرجى تحديد وقت الحضور');
      return;
    }
    setManualAttendanceSaving(true);
    try {
      let result;
      if (manualAttendanceType === 'absence') {
        result = await db.addManualAbsence({
          student_id: manualAttendanceForm.student_id,
          date: manualAttendanceForm.date
        });
      } else {
        result = await db.addManualAttendance({
          student_id: manualAttendanceForm.student_id,
          date: manualAttendanceForm.date,
          time: manualAttendanceForm.time
        });
      }
      if (!result.success) {
        toast.error(result.message || 'فشل في التسجيل');
        return;
      }
      const actionText = manualAttendanceType === 'absence' ? 'غياب' : 'حضور';
      toast.success(`تم تسجيل ${actionText} ${result.student?.name || 'الطالب'} بنجاح`);
      setShowManualAttendanceModal(false);
      setManualAttendanceSearch('');
      setManualAttendanceForm({
        student_id: '',
        date: getLocalISODate(),
        time: kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME
      });
      setManualAttendanceType('attendance');
      fetchDashboard();
      if (selectedStudentProfile?.id === manualAttendanceForm.student_id) {
        setSelectedStudentProfile(prev => (prev ? { ...prev } : prev));
      }
    } catch (error) {
      logError(error, 'Admin - Manual Attendance/Absence');
      toast.error('حدث خطأ أثناء التسجيل');
    } finally {
      setManualAttendanceSaving(false);
    }
  };

  const handleDeleteStudent = async (student_id: string, studentName: string) => {
    setDeleteConfirmation({ type: 'student', id: student_id, name: studentName });
  };

  const confirmDeleteStudent = async () => {
    if (!deleteConfirmation || deleteConfirmation.type !== 'student') return;
    setLoading(true);
    try {
      await db.deleteStudent(deleteConfirmation.id);
      await fetchStudents();
      setDeleteConfirmation(null);
      toast.success('تم حذف الطالب بنجاح');
    } catch (e) {
      toast.error('حدث خطأ أثناء الحذف');
    } finally {
      setLoading(false);
    }
  };

  const resetImportPreview = () => {
    setImportColumns([]);
    setColumnSelections({});
    setColumnMapping({});
    setImportPreviewRows([]);
  };

  const handleImportFileChange = async (file: File | null) => {
    setImportFile(file);
    if (!file) {
      resetImportPreview();
      return;
    }

    setLoading(true);
    try {
      const preview = await FileService.previewColumns(file);
      setImportColumns(preview.columns);
      setImportPreviewRows(preview.sample);

      const suggested = FileService.detectColumnMapping(preview.columns);
      const selections: Record<string, string> = {};
      Object.entries(suggested).forEach(([field, col]) => {
        if (col) selections[col] = field;
      });
      setColumnSelections(selections);
      setColumnMapping(suggested);
    } catch (error) {
      logError(error, 'Admin - Read File Columns');
      toast.error('تعذر قراءة الأعمدة من الملف. تأكد من أن الملف يحتوي على صفوف وبيانات صحيحة.');
      resetImportPreview();
    } finally {
      setLoading(false);
    }
  };

  const handleColumnSelection = (column: string, field: string) => {
    setColumnSelections(prev => {
      const next = { ...prev };

      // Ensure a field is mapped to one column only
      Object.keys(next).forEach(col => {
        if (col !== column && next[col] === field) delete next[col];
      });

      if (field === 'ignore') {
        delete next[column];
      } else {
        next[column] = field;
      }

      const mapping: ImportMapping = {};
      Object.entries(next).forEach(([col, mappedField]) => {
        if (mappedField && mappedField !== 'ignore') {
          mapping[mappedField as ImportField] = col;
        }
      });
      setColumnMapping(mapping);

      return next;
    });
  };

  const ensureMapping = (): ImportMapping => {
    if (importColumns.length === 0) return columnMapping;

    const finalMapping: ImportMapping = { ...columnMapping };
    if (!finalMapping.grade || !finalMapping.section) {
      const suggested = FileService.detectColumnMapping(importColumns);
      finalMapping.grade = finalMapping.grade || suggested.grade;
      finalMapping.section = finalMapping.section || suggested.section;
    }
    return finalMapping;
  };

  const handleImport = async () => {
    if (!importFile) return;
    setLoading(true);
    try {
      const rawData = await FileService.parseImportFile(importFile);

      const manualMapping = ensureMapping();
      if (!manualMapping.grade || !manualMapping.section) {
        toast.warning('يرجى تحديد أعمدة الصف والفصل من لوحة المطابقة قبل الاستيراد.');
        return;
      }

      const { students: mappedStudents } = FileService.mapRowsToStudents(rawData, {
        mode: importIdMode,
        idColumn: importIdColumn,
        idPattern: importIdPattern,
        preventDuplicates: true,
        manualMapping,
      });

      // Remove duplicates against existing state
      const existingIds = new Set(students.map(s => s.id));
      const existingNames = new Set(students.map(s => `${s.name}-${s.class_name}-${s.section}`.toLowerCase()));
      const uniqueStudents = mappedStudents.filter(s => {
        const nameKey = `${s.name}-${s.class_name}-${s.section}`.toLowerCase();
        return !existingIds.has(s.id) && !existingNames.has(nameKey);
      });

      if (uniqueStudents.length === 0) {
        toast.warning('لا توجد بيانات جديدة للاستيراد بعد إزالة التكرارات.');
        return;
      }

      // 🌐 CLOUD MODE: saveStudents returns Student[] from Supabase
      const savedStudents = await db.saveStudents(uniqueStudents);

      // ✅ Add imported students directly to state instead of refetching
      setStudents(prev => [...prev, ...savedStudents]);

      const summary = await db.syncClassesFromStudents();

      await fetchStructure({ preserveSelection: true });
      toast.success(`تم استيراد ${savedStudents.length} طالب بنجاح، وتم تحديث ${summary.sections} فصول ضمن ${summary.classes} صفوف`);
      setImportFile(null);
      setShowImportModal(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'حدث خطأ أثناء قراءة الملف. تأكد من الصيغة.';
      toast.error(message);
      logError(e, 'Admin - Operation');
    } finally {
      setLoading(false);
    }
  };

  // Export Student Template for bulk import
  const handleExportTemplate = () => {
    // Template with headers and example rows
    const templateData = [
      {
        'المعرف': '',
        'الاسم': '',
        'الصف': '',
        'الفصل': '',
        'الجوال': ''
      }
    ];

    FileService.exportToCSV(templateData, 'نموذج_قائمة_الطلاب');
  };

  const handleAddClass = async () => {
    const className = newClass.name.trim();
    const sections = parseClassSections(newClass.sections);

    if (!className || sections.length === 0) {
      showToast('أدخل اسم الصف وشعبة واحدة على الأقل.', 'error');
      return;
    }

    if (classes.some(cls => normalizeLabel(cls.name) === normalizeLabel(className))) {
      showToast('هذا الصف موجود بالفعل. يمكنك تعديل شُعبه من الهيكل الحالي.', 'error');
      return;
    }

    setClassLoading(true);
    try {
      await db.saveClass({
        id: Math.random().toString(36).slice(2, 11),
        name: className,
        sections
      });
      setNewClass({ name: '', sections: '' });
      await fetchStructure({ preserveSelection: true });
      showToast(`تمت إضافة ${className} مع ${sections.length} شُعب.`, 'success');
    } catch (error) {
      logError(error, 'Admin - Add Class');
      showToast('تعذر إضافة الصف. حاول مرة أخرى.', 'error');
    } finally {
      setClassLoading(false);
    }
  };

  // Edit Sections Functions
  const handleEditSections = (cls: SchoolClass) => {
    setEditingClass(cls);
    setEditingSections([...cls.sections]);
    setNewSectionInput('');
  };

  const handleAddSectionToEdit = () => {
    const trimmed = newSectionInput.trim().toUpperCase();
    if (!trimmed) return;

    if (editingSections.includes(trimmed)) {
      showToast('هذا الفصل موجود بالفعل', 'error');
      return;
    }

    setEditingSections(prev => [...prev, trimmed].sort((a, b) => a.localeCompare(b)));
    setNewSectionInput('');
  };

  const handleRemoveSectionFromEdit = (section: string) => {
    setEditingSections(prev => prev.filter(s => s !== section));
  };

  const handleSaveEditedSections = async () => {
    if (!editingClass) return;

    if (editingSections.length === 0) {
      showToast('يجب أن يحتوي الصف على فصل واحد على الأقل', 'error');
      return;
    }

    try {
      setLoading(true);
      await db.saveClass({
        ...editingClass,
        sections: editingSections
      });

      showToast('تم تحديث الفصول بنجاح', 'success');
      setEditingClass(null);
      setEditingSections([]);
      setNewSectionInput('');
      await fetchStructure({ preserveSelection: true });
    } catch (error) {
      logError(error, 'Admin - Save Edited Sections');
      showToast('فشل تحديث الفصول', 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleStudentSelection = (id: string) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      const allIds = sortedStudents.map(s => s.id);
      const allSelected = allIds.every(id => next.has(id));
      if (allSelected) {
        allIds.forEach(id => next.delete(id));
      } else {
        allIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleSelectByClassSection = () => {
    if (!bulkSelectGrade) {
      toast.warning('يرجى اختيار الصف أولاً.');
      return;
    }
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      const filtered = students.filter(s => {
        if (s.class_name !== bulkSelectGrade) return false;
        if (bulkSelectSection && s.section !== bulkSelectSection) return false;
        return true;
      });
      filtered.forEach(s => next.add(s.id));
      return next;
    });
  };

  const handleBulkStatusUpdate = async (isActive: boolean) => {
    if (selectedStudentIds.size === 0) return;
    const confirmed = window.confirm(isActive ? 'تفعيل الطلاب المحددين؟' : 'تعطيل الطلاب المحددين؟');
    if (!confirmed) return;
    setLoading(true);
    try {
      const idsToUpdate = Array.from(selectedStudentIds);
      const updates = students.filter(s => idsToUpdate.includes(s.id)).map(s => ({ ...s, is_active: isActive }));
      await Promise.all(updates.map(s => db.updateStudent(s)));
      setStudents(prev => prev.map(s => idsToUpdate.includes(s.id) ? { ...s, is_active: isActive } : s));
      toast.success(isActive ? 'تم تفعيل الطلاب المحددين' : 'تم تعطيل الطلاب المحددين');
    } catch (e) {
      logError(e, 'Admin - Operation');
      toast.error('حدث خطأ أثناء تحديث حالة الطلاب');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkDeleteStudents = async () => {
    if (selectedStudentIds.size === 0) return;
    const confirmed = window.confirm('سيتم حذف جميع الطلاب المحددين. هل أنت متأكد؟');
    if (!confirmed) return;
    setLoading(true);
    try {
      const idsToDelete = Array.from(selectedStudentIds);
      await Promise.all(idsToDelete.map(id => db.deleteStudent(id)));
      setStudents(prev => prev.filter(s => !selectedStudentIds.has(s.id)));
      setSelectedStudentIds(new Set());
      toast.success('تم حذف الطلاب المحددين بنجاح');
    } catch (e) {
      logError(e, 'Admin - Operation');
      toast.error('حدث خطأ أثناء حذف الطلاب المحددين');
    } finally {
      setLoading(false);
    }
  };

  const handleExportSelectedStudents = async () => {
    if (selectedStudentIds.size === 0) {
      toast.warning('يرجى تحديد طلاب للتصدير');
      return;
    }
    const selected = students.filter(s => selectedStudentIds.has(s.id));
    const exportData = selected.map(s => ({
      'المعرف': s.id,
      'الاسم': s.name,
      'الصف': s.class_name,
      'الفصل': s.section,
      'الحالة': s.is_active === false ? 'غير نشط' : 'نشط',
      'آخر تحديث': s.updated_at || s.created_at || ''
    }));
    await FileService.exportToCSV(exportData, 'الطلاب_المحددون');
  };

  const handleBulkMoveStudents = async () => {
    if (selectedStudentIds.size === 0) {
      toast.warning('يرجى تحديد طلاب للنقل');
      return;
    }
    if (!bulkMoveClass || !bulkMoveSection) {
      toast.warning('يرجى اختيار الصف والفصل المستهدفين');
      return;
    }

    setLoading(true);
    try {
      const idsToMove = Array.from(selectedStudentIds);
      const targetClass = classes.find(c => c.name === bulkMoveClass);

      if (!targetClass) {
        await db.saveClass({ id: '', name: bulkMoveClass, sections: [bulkMoveSection], is_active: true } as SchoolClass);
      } else if (!(targetClass.sections || []).includes(bulkMoveSection)) {
        await db.saveClass({ ...targetClass, sections: [...(targetClass.sections || []), bulkMoveSection] });
      }

      await Promise.all(idsToMove.map(async (id) => {
        const current = students.find(s => s.id === id);
        if (!current) return;
        await db.updateStudent({ ...current, class_name: bulkMoveClass, section: bulkMoveSection });
      }));

      setStudents(prev => prev.map(s => selectedStudentIds.has(s.id) ? { ...s, class_name: bulkMoveClass, section: bulkMoveSection } : s));
      await fetchStructure({ preserveSelection: true });
      toast.success('تم نقل الطلاب المحددين بنجاح');
    } catch (e) {
      logError(e, 'Admin - Operation');
      toast.error('حدث خطأ أثناء نقل الطلاب');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGrade = (grade: string) => {
    const sections = getCatalogSections(schoolCatalog, grade);
    const targetSection = sections[0] || '';
    loadClassProfile(grade, targetSection || selectedSection, classRange);
  };

  const handleSelectSection = (section: string) => {
    if (!selectedGrade || !section) return;
    loadClassProfile(selectedGrade, section, classRange);
  };

  const handleClassRangeChange = (range: 'today' | 'week' | 'month') => {
    if (!selectedGrade || !selectedSection) {
      setClassRange(range);
      return;
    }
    loadClassProfile(selectedGrade, selectedSection, range);
  };

  const handleDeleteClass = (id: string, name: string) => {
    setDeleteConfirmation({ type: 'class', id, name });
  };

  const handleAddUser = async () => {
    const validationIssues = validateUserAccountDraft(
      newUser,
      currentUser ? [...users, currentUser] : users
    );
    if (validationIssues.length > 0) {
      toast.warning(validationIssues[0].message);
      return;
    }
    try {
      const payload: any = {
        username: newUser.username.trim(),
        password: newUser.password.trim(),
        name: newUser.name.trim(),
        role: newUser.role,
        is_active: true,
        can_use_whatsapp: !!newUser.can_use_whatsapp,
      };
      // Only set assigned_classes for supervisor roles
      if (newUser.role === Role.SUPERVISOR_CLASS) {
        payload.assigned_classes = Array.isArray(newUser.assigned_classes) ? newUser.assigned_classes : [];
        // If you wish to support assigned_sections, add to state and form, for now set as null:
        payload.assigned_sections = null;
      } else {
        payload.assigned_classes = null;
        payload.assigned_sections = null;
      }

      // 🌐 CLOUD MODE: saveUser now returns the created User object from Supabase
      const createdUser = await db.saveUser(payload);

      // ✅ Add returned user directly to state instead of refetching all users
      setUsers(prev => dedupeAdminUsers([...prev, createdUser]));

      setNewUser({ name: '', username: '', password: '', role: Role.SCHOOL_ADMIN, assigned_classes: [], can_use_whatsapp: false });
      toast.success('تم إنشاء الحساب بنجاح');

    } catch (error) {
      logError(error, 'Admin - Create User');
      toast.error(`فشل إنشاء المستخدم: ${getErrorMessage(error)}`, 8000);
    }
  };

  const handleDeleteUser = (id: string, name: string) => {
    if (currentUser?.id === id) {
      toast.warning('لا يمكن حذف الحساب المستخدم حاليًا.');
      return;
    }
    setDeleteConfirmation({ type: 'user', id, name });
  };

  const handleStartEditUser = (user: User) => {
    setEditingUser({
      ...user,
      password: ''
    });
    setShowEditUserModal(true);
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    if (editingUser.id === currentUser?.id && editingUser.role !== currentUser.role) {
      toast.warning('لا يمكنك تغيير صلاحية الحساب المستخدم حاليًا.');
      return;
    }
    const validationIssues = validateUserAccountDraft(
      editingUser,
      currentUser ? [...users, currentUser] : users,
      { passwordRequired: false, excludeUserId: editingUser.id }
    );
    if (validationIssues.length > 0) {
      toast.warning(validationIssues[0].message);
      return;
    }

    setLoading(true);
    try {
      const existingUser = users.find(u => u.id === editingUser.id);
      const payload: any = {
        id: editingUser.id,
        username: editingUser.username.trim(),
        name: editingUser.name.trim(),
        role: editingUser.role,
        is_active: editingUser.is_active ?? true,
        can_use_whatsapp: !!editingUser.can_use_whatsapp,
        assigned_classes: editingUser.role === Role.SUPERVISOR_CLASS ? editingUser.assigned_classes : null,
        assigned_sections: null,
      };

      if (editingUser.password && editingUser.password.trim()) {
        payload.password = editingUser.password.trim();
      } else if (existingUser?.password) {
        payload.password = existingUser.password;
      }

      const updatedUser = await db.saveUser(payload);
      setUsers(prev => dedupeAdminUsers(prev.map(u => u.id === updatedUser.id ? updatedUser : u)));
      setShowEditUserModal(false);
      setEditingUser(null);
      toast.success('تم تحديث المستخدم بنجاح');
    } catch (error) {
      logError(error, 'Admin - Update User');
      toast.error('فشل تحديث المستخدم. تحقق من البيانات وحاول مجددًا');
    } finally {
      setLoading(false);
    }
  };

  const confirmDeleteAction = async () => {
    if (!deleteConfirmation) return;

    setLoading(true);
    try {
      if (deleteConfirmation.type === 'class') {
        await db.deleteClass(deleteConfirmation.id);
        await fetchStructure();
      } else if (deleteConfirmation.type === 'user') {
        await db.deleteUser(deleteConfirmation.id);
        await fetchUsers();
      } else if (deleteConfirmation.type === 'student') {
        await db.deleteStudent(deleteConfirmation.id);
        await fetchStudents();
      }
      db.logActivity(
        deleteConfirmation.type === 'class' ? 'class_delete' : deleteConfirmation.type === 'user' ? 'user_delete' : 'student_delete',
        `حذف ${deleteConfirmation.type === 'class' ? 'فصل' : deleteConfirmation.type === 'user' ? 'مستخدم' : 'طالب'}: ${deleteConfirmation.name}`,
        { user_id: currentUser?.id, user_name: currentUser?.name, target_id: deleteConfirmation.id, target_name: deleteConfirmation.name }
      );
      setDeleteConfirmation(null);
    } catch (e) {
      logError(e, 'Admin - Operation');
    } finally {
      setLoading(false);
    }
  };


  const manualAttendanceCandidates = React.useMemo(() => {
    const query = manualAttendanceSearch.trim().toLowerCase();
    if (!query) return students;
    return students.filter(s => (
      s.name?.toLowerCase().includes(query) ||
      s.id?.toLowerCase().includes(query) ||
      s.class_name?.toLowerCase().includes(query) ||
      s.section?.toLowerCase().includes(query)
    ));
  }, [students, manualAttendanceSearch]);
  const manualAttendanceStudent = React.useMemo(
    () => students.find(s => s.id === manualAttendanceForm.student_id),
    [students, manualAttendanceForm.student_id]
  );
  const manualAttendancePreview = React.useMemo(() => {
    if (!manualAttendanceForm.date || !manualAttendanceForm.time) return null;
    const timestamp = new Date(`${manualAttendanceForm.date}T${manualAttendanceForm.time}`);
    if (Number.isNaN(timestamp.getTime())) return null;
    const [h, m] = (kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME).split(':').map(Number);
    const cutoff = new Date(timestamp);
    cutoff.setHours(h, (m || 0) + (kiosk_settings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD), 0, 0);
    const isLate = timestamp.getTime() > cutoff.getTime();
    const minutesLate = isLate ? Math.floor((timestamp.getTime() - cutoff.getTime()) / 60000) : 0;
    return { timestamp, cutoff, isLate, minutesLate };
  }, [manualAttendanceForm.date, manualAttendanceForm.time, kiosk_settings.assembly_time, kiosk_settings.grace_period]);


  const normalizedSearch = searchTerm.trim().toLowerCase();
  const removeDiacritics = (value: string) => value.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  const normalizeArabic = (value: string) =>
    removeDiacritics(value)
      .replace(/[إأآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه');
  const normalizeLabel = (value?: string | null) =>
    normalizeArabic((value || '').toString().trim().replace(/\s+/g, ' ')).toLowerCase();
  const normalizeSectionInput = (value: string) =>
    normalizeArabic(value)
      .replace(/[^\w\u0600-\u06FF]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();
  const schoolCatalog = useMemo(() => buildSchoolCatalog(classes), [classes]);
  const studentIdPolicy = useMemo(() => deriveStudentIdPolicy(students, studentIdSettings), [students, studentIdSettings]);
  const allowStudentIdEdit = studentIdPolicy.allow_edit !== false;
  const studentIdPolicyHint = useMemo(() => {
    const parts: string[] = [];
    if (studentIdPolicy.prefix) parts.push(`بادئة: ${studentIdPolicy.prefix}`);
    if (studentIdPolicy.length) parts.push(`طول ثابت: ${studentIdPolicy.length}`);
    parts.push(studentIdPolicy.charset === 'numeric' ? 'أرقام فقط' : 'حروف وأرقام');
    return parts.join(' • ');
  }, [studentIdPolicy]);
  const settingsRenameCandidates = useMemo(() => {
    const query = normalizeLabel(settingsRenameQuery);
    if (!query) return students.slice(0, 20);
    return students.filter((student) =>
      normalizeLabel(student.name).includes(query) ||
      normalizeLabel(student.id).includes(query) ||
      normalizeLabel(student.class_name).includes(query) ||
      normalizeLabel(student.section || '').includes(query)
    ).slice(0, 20);
  }, [settingsRenameQuery, students]);
  const settingsRenameTarget = useMemo(
    () => students.find(student => student.id === settingsRenameTargetId) || null,
    [settingsRenameTargetId, students]
  );

  const getActivityBucket = (student: Student): 'today' | 'week' | 'month' | 'older' | 'unknown' => {
    const dateStr = student.updated_at || student.created_at;
    if (!dateStr) return 'unknown';
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return 'unknown';
    const now = new Date();
    const diffMs = now.getTime() - target.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 1) return 'today';
    if (diffDays < 7) return 'week';
    if (diffDays < 30) return 'month';
    return 'older';
  };

  const normalizedSearchValue = normalizeLabel(normalizedSearch);
  const filteredStudents = students.filter(s => {
    const matchesSearch = !normalizedSearchValue || (
      normalizeLabel(s.name).includes(normalizedSearchValue) ||
      normalizeLabel(s.id).includes(normalizedSearchValue) ||
      normalizeLabel(s.class_name).includes(normalizedSearchValue) ||
      normalizeLabel(s.section || '').includes(normalizedSearchValue)
    );
    const matchesGrade = studentFilterGrade === 'all' || normalizeLabel(s.class_name) === normalizeLabel(studentFilterGrade);
    const matchesSection = studentFilterSection === 'all' || normalizeLabel(s.section) === normalizeLabel(studentFilterSection);
    const matchesStatus = studentFilterStatus === 'all' || (studentFilterStatus === 'active' ? s.is_active !== false : s.is_active === false);
    const bucket = getActivityBucket(s);
    const matchesActivity = studentFilterActivity === 'all' || bucket === studentFilterActivity;
    return matchesSearch && matchesGrade && matchesSection && matchesStatus && matchesActivity;
  });

  const gradeFilters = schoolCatalog.grades;
  const sectionFilters = schoolCatalog.sections;
  const countStudentsByGrade = (grade: string) =>
    students.filter(s => normalizeLabel(s.class_name) === normalizeLabel(grade)).length;
  const countStudentsBySection = (section: string, grade?: string) =>
    students.filter(s => (
      normalizeLabel(s.section) === normalizeLabel(section)
      && (!grade || normalizeLabel(s.class_name) === normalizeLabel(grade))
    )).length;
  const activityCounts = students.reduce<Record<string, number>>((acc, s) => {
    const bucket = getActivityBucket(s);
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  const statusCounts = {
    active: students.filter(s => s.is_active !== false).length,
    inactive: students.filter(s => s.is_active === false).length,
  };
  const bulkMoveSections = bulkMoveClass
    ? getCatalogSections(schoolCatalog, bulkMoveClass)
    : sectionFilters;
  const visibleSections = studentFilterGrade === 'all'
    ? sectionFilters
    : getCatalogSections(schoolCatalog, studentFilterGrade);
  const activeStudentFilters = [
    studentFilterGrade !== 'all',
    studentFilterSection !== 'all',
    studentFilterStatus !== 'all',
    studentFilterActivity !== 'all'
  ].filter(Boolean).length;

  const resetStudentFilters = () => {
    setStudentFilterGrade('all');
    setStudentFilterSection('all');
    setStudentFilterStatus('all');
    setStudentFilterActivity('all');
  };


  const sortedStudents = [...filteredStudents].sort((a, b) => {
    const dir = studentSortDir === 'asc' ? 1 : -1;
    const getValue = (student: Student) => {
      switch (studentSortBy) {
        case 'id':
          return student.id || '';
        case 'class':
          return student.class_name || '';
        case 'section':
          return student.section || '';
        case 'name':
        default:
          return student.name || '';
      }
    };
    const valA = getValue(a).toString().toLowerCase();
    const valB = getValue(b).toString().toLowerCase();
    return valA.localeCompare(valB, 'ar', { sensitivity: 'base' }) * dir;
  });

  const selectedInView = sortedStudents.filter(s => selectedStudentIds.has(s.id)).length;
  const allStudentsSelected = sortedStudents.length > 0 && sortedStudents.every(s => selectedStudentIds.has(s.id));

  const newStudentSections = newStudent.class_name
    ? getCatalogSections(schoolCatalog, newStudent.class_name)
    : [];
  const editingStudentSections = editingStudent
    ? getCatalogSections(schoolCatalog, editingStudent.class_name)
    : [];

  const gradeKeys = schoolCatalog.grades;
  const sectionsForSelectedGrade = selectedGrade
    ? getCatalogSections(schoolCatalog, selectedGrade)
    : [];
  const classAttendanceRate = selectedClassStats && selectedClassStats.totalStudents > 0
    ? Math.max(0, Math.round(((selectedClassStats.present + selectedClassStats.late) / (selectedClassStats.totalStudents * selectedClassStats.days)) * 100))
    : 0;
  const totalSections = classes.reduce((sum, cls) => sum + (cls.sections?.length || 0), 0);
  const filteredClassStudents = React.useMemo(() => {
    const query = classStudentSearch.trim().toLowerCase();
    const baseList = query
      ? classStudents.filter(student =>
        student.name.toLowerCase().includes(query) ||
        student.id.toLowerCase().includes(query)
      )
      : classStudents;
    const dir = classStudentSortDir === 'asc' ? 1 : -1;
    return [...baseList].sort((a, b) => {
      const valA = (classStudentSortBy === 'id' ? a.id : a.name).toLowerCase();
      const valB = (classStudentSortBy === 'id' ? b.id : b.name).toLowerCase();
      return valA.localeCompare(valB, 'ar', { sensitivity: 'base' }) * dir;
    });
  }, [classStudents, classStudentSearch, classStudentSortBy, classStudentSortDir]);
  const restoreFieldOptions: { field: ImportField; label: string; required?: boolean }[] = [
    { field: 'id', label: 'المعرف' },
    { field: 'name', label: 'اسم الطالب', required: true },
    { field: 'grade', label: 'الصف', required: true },
    { field: 'section', label: 'الفصل', required: true },
    { field: 'guardian_phone', label: 'رقم ولي الأمر' },
    { field: 'guardian_name', label: 'اسم ولي الأمر' }
  ];
  const guardianIncomingNotifications = React.useMemo(
    () => followUpNotifications.filter(n => (n.created_by || '').startsWith('guardian_')),
    [followUpNotifications]
  );
  const guardianOutgoingNotifications = React.useMemo(
    () => followUpNotifications.filter(n => n.target_audience === 'guardian'),
    [followUpNotifications]
  );
  const todaysGuardianOutgoing = React.useMemo(() => {
    const today = getLocalISODate();
    return guardianOutgoingNotifications.filter(n => (n.created_at || '').startsWith(today));
  }, [guardianOutgoingNotifications]);
  const attendanceByStudentId = React.useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    uniqueAttendanceByStudentDate(followUpAttendance, getLocalISODate()).forEach(record => {
      map.set(String(record.student_id), record);
    });
    return map;
  }, [followUpAttendance]);
  const lateStudents = React.useMemo(() => {
    return students.filter(student => {
      const record = attendanceByStudentId.get(student.id);
      return record?.status === 'late';
    });
  }, [students, attendanceByStudentId]);
  const absentStudents = React.useMemo(() => {
    return students.filter(student => !attendanceByStudentId.has(student.id));
  }, [students, attendanceByStudentId]);
  const followUpRows = React.useMemo(() => {
    const baseRows = [
      ...lateStudents.map(student => ({ student, status: 'late' as const })),
      ...absentStudents.map(student => ({ student, status: 'absent' as const }))
    ];
    const mapped = baseRows.map(row => {
      const latestGuardianNotification = todaysGuardianOutgoing.find(n => n.target_id === row.student.id);
      const notified = Boolean(latestGuardianNotification);
      const whatsappNotified = Boolean(
        latestGuardianNotification && /واتساب|whatsapp/i.test(`${latestGuardianNotification.title || ''} ${latestGuardianNotification.message || ''}`)
      );
      return {
        ...row,
        notified,
        whatsappNotified,
        lastNotifiedAt: latestGuardianNotification?.created_at || null
      };
    });
    if (followUpFilter === 'notified') {
      return mapped.filter(row => row.notified);
    }
    if (followUpFilter === 'pending') {
      return mapped.filter(row => !row.notified);
    }
    return mapped;
  }, [lateStudents, absentStudents, todaysGuardianOutgoing, followUpFilter]);
  const followUpVisibleNotifications = React.useMemo(() => {
    if (followUpDirection === 'incoming') return guardianIncomingNotifications;
    if (followUpDirection === 'outgoing') return guardianOutgoingNotifications;
    return followUpNotifications;
  }, [followUpDirection, guardianIncomingNotifications, guardianOutgoingNotifications, followUpNotifications]);
  const lateNotifiedCount = React.useMemo(() => {
    const ids = new Set(
      guardianOutgoingNotifications
        .filter(n => (n.title || '').includes('تأخر'))
        .map(n => n.target_id || '')
        .filter(Boolean)
    );
    return ids.size;
  }, [guardianOutgoingNotifications]);
  const absentNotifiedCount = React.useMemo(() => {
    const ids = new Set(
      guardianOutgoingNotifications
        .filter(n => (n.title || '').includes('غياب'))
        .map(n => n.target_id || '')
        .filter(Boolean)
    );
    return ids.size;
  }, [guardianOutgoingNotifications]);
  const statColorMap: Record<string, string> = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
    amber: 'border-amber-500/20 bg-amber-500/5',
    red: 'border-red-500/20 bg-red-500/5',
    cyan: 'border-primary-500/20 bg-primary-500/5',
    purple: 'border-secondary-500/20 bg-secondary-500/5',
    blue: 'border-secondary-500/20 bg-secondary-500/5'
  };

  const adminTabs = [
    { id: 'dashboard', label: 'لوحة القيادة', icon: LayoutDashboard },
    { id: 'students', label: 'الطلاب', icon: UserPlus },
    { id: 'structure', label: 'الهيكل المدرسي', icon: Database },
    { id: 'reports', label: 'التقارير', icon: FileText },
    { id: 'integrations', label: 'مركز التكاملات', icon: Cable },
    { id: 'staff-operations', label: 'المعلمين والانتظار', icon: CalendarClock },
    { id: 'users', label: 'المستخدمين', icon: Users },
    { id: 'settings', label: 'الإعدادات', icon: SettingsIcon },
    { id: 'kiosk', label: 'إعدادات الكشك', icon: Monitor },
    { id: 'notifications', label: 'الإشعارات', icon: Bell },
    { id: 'follow-up', label: 'المتابعة', icon: Activity },
    { id: 'excuses', label: 'الأعذار', icon: FileText },
    { id: 'incidents', label: 'التصاريح والسلوك', icon: DoorOpen },
    { id: 'backup', label: 'النسخ الاحتياطي', icon: Download },
    { id: 'calendar', label: 'التقويم الدراسي', icon: CalendarDays },
    { id: 'activity-log', label: 'سجل الأنشطة', icon: Activity },
    { id: 'guardian-phones', label: 'أرقام أولياء الأمور', icon: Smartphone },
  ];
  const activeAdminTab = adminTabs.find(tab => tab.id === activeTab) ?? adminTabs[0];
  const normalizedAdminSearchQuery = adminSearchQuery.trim().toLocaleLowerCase('ar');
  const matchingAdminTabs = normalizedAdminSearchQuery
    ? adminTabs.filter(tab => tab.label.toLocaleLowerCase('ar').includes(normalizedAdminSearchQuery))
    : adminTabs;
  const activeAdminTabIndex = Math.max(0, adminTabs.findIndex(tab => tab.id === activeTab));
  const canMoveToPreviousAdminTab = activeAdminTabIndex > 0;
  const canMoveToNextAdminTab = activeAdminTabIndex < adminTabs.length - 1;

  useEffect(() => {
    const rail = mobileTabRailRef.current;
    if (!rail) return;
    const activeButton = rail.querySelector<HTMLButtonElement>(`[data-admin-tab="${activeTab}"]`);
    activeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeTab]);

  const moveMobileAdminTab = (offset: -1 | 1) => {
    const nextIndex = Math.min(adminTabs.length - 1, Math.max(0, activeAdminTabIndex + offset));
    const nextTab = adminTabs[nextIndex];
    if (nextTab) setActiveTab(nextTab.id);
  };

  const navigateToAdminTab = (tabId: string) => {
    setActiveTab(tabId);
    setAdminSearchQuery('');
    setAdminSearchOpen(false);
  };

  const schoolPerformance = detailedStats?.isTodayHoliday
    ? { label: detailedStats.holidayName || 'عطلة مدرسية', className: 'text-sky-200 bg-sky-500/10 border-sky-500/25' }
    : stats
    ? stats.attendance_rate >= 90
      ? { label: 'ممتاز', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' }
      : stats.attendance_rate >= 75
        ? { label: 'جيد', className: 'text-primary-200 bg-primary-500/10 border-primary-500/25' }
        : { label: 'يتطلب متابعة', className: 'text-amber-200 bg-amber-500/10 border-amber-500/25' }
    : { label: 'قيد التحميل', className: 'text-slate-300 bg-white/5 border-white/10' };
  const visibleUsers = useMemo(
    () => dedupeAdminUsers(users.filter(u => !isHiddenAdminUser(u))),
    [users]
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] min-w-0 space-y-6 overflow-x-hidden pb-24 lg:pb-12">
      <header className="no-print relative max-w-full overflow-visible rounded-[1.5rem] border border-primary-500/15 bg-slate-950/70 p-4 shadow-[0_24px_80px_-45px_rgb(var(--color-primary-500)_/_0.55)] backdrop-blur-2xl sm:p-5 md:rounded-[2rem] md:p-6">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-l from-transparent via-primary-300/40 to-transparent" />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-xl border border-primary-500/20 bg-primary-500/10 px-3 py-1.5 text-xs font-semibold text-primary-100">
                <activeAdminTab.icon className="h-4 w-4" />
                {activeAdminTab.label}
              </span>
              <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold ${schoolPerformance.className}`}>
                <Trophy className="h-4 w-4" />
                أداء المدرسة: {schoolPerformance.label}
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300">
                <Database className="h-4 w-4 text-slate-400" />
                {storageMode === 'local' ? 'محلي' : 'مزامن'}
              </span>
            </div>
            <h1 className="text-3xl font-black leading-tight text-slate-50 md:text-4xl">
              مركز إدارة حاضر
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
              تحكم بالطلاب، المستخدمين، التقويم، الإشعارات، والتقارير من مساحة واحدة.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <div className="relative min-w-0 sm:w-80">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary-300/70" />
              <input
                ref={adminSearchInputRef}
                type="text"
                value={adminSearchQuery}
                onChange={event => {
                  setAdminSearchQuery(event.target.value);
                  setAdminSearchOpen(true);
                }}
                onFocus={() => setAdminSearchOpen(true)}
                onBlur={() => setAdminSearchOpen(false)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setAdminSearchOpen(false);
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Enter' && matchingAdminTabs[0]) {
                    navigateToAdminTab(matchingAdminTabs[0].id);
                  }
                }}
                placeholder="انتقل إلى قسم..."
                aria-label="البحث في أقسام الإدارة"
                aria-expanded={adminSearchOpen}
                aria-controls="admin-section-search-results"
                className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/55 pr-11 pl-14 text-sm text-white outline-none transition duration-200 placeholder:text-slate-500 focus:border-primary-300/55 focus:bg-slate-950/80 focus:ring-2 focus:ring-primary-400/15"
              />
              <kbd className="pointer-events-none absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline-flex">
                ⌘K
              </kbd>
              {adminSearchOpen && adminSearchQuery.trim() && (
                <div
                  id="admin-section-search-results"
                  className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
                >
                  {matchingAdminTabs.length > 0 ? matchingAdminTabs.slice(0, 6).map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => navigateToAdminTab(tab.id)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm font-semibold text-slate-300 outline-none transition hover:bg-primary-400/10 hover:text-white focus-visible:ring-2 focus-visible:ring-primary-300/45"
                    >
                      <tab.icon className="h-4 w-4 text-primary-200" />
                      <span>{tab.label}</span>
                    </button>
                  )) : (
                    <div className="px-3 py-4 text-center text-sm text-slate-500">
                      لا يوجد قسم مطابق
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowThemeSelector(true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-sm font-bold text-white transition duration-200 hover:border-primary-300/35 hover:bg-primary-400/10 active:scale-[0.98]"
              title="تغيير الثيم"
            >
              <Palette className="h-5 w-5 text-primary-200" />
              <span>الثيم</span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 min-[380px]:grid-cols-2 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs text-slate-500">المستخدم الحالي</div>
            <div className="mt-1 truncate text-sm font-bold text-slate-100">{currentUser?.name || 'مدير النظام'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs text-slate-500">الطلاب</div>
            <div className="mt-1 font-mono text-2xl font-black text-slate-50">{stats?.total_students ?? students.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs text-slate-500">المستخدمون</div>
            <div className="mt-1 font-mono text-2xl font-black text-slate-50">{visibleUsers.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-xs text-slate-500">التبويب النشط</div>
            <div className="mt-1 truncate text-sm font-bold text-primary-100">{activeAdminTab.label}</div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex min-w-0 max-w-full flex-col gap-6 overflow-x-hidden pb-10 lg:flex-row lg:pb-0">

        {/* ═══════════════════════════════════════════════════════════════
            🎯 Desktop Sidebar — Collapsible
            ═══════════════════════════════════════════════════════════════ */}
        {(() => {
          const isExpanded = !sidebarCollapsed || sidebarPinned || sidebarHovered;
          return (
            <>
              {/* ── Desktop Sidebar ── */}
              <div
                className="hidden lg:block flex-shrink-0 transition-all duration-300 ease-in-out"
                style={{ width: isExpanded ? 256 : 72 }}
                onMouseEnter={() => { if (sidebarCollapsed && !sidebarPinned) setSidebarHovered(true); }}
                onMouseLeave={() => setSidebarHovered(false)}
              >
                <div className={`sticky top-6 flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/70 shadow-[0_24px_80px_-50px_rgb(var(--color-primary-500)_/_0.6)] backdrop-blur-2xl transition-all duration-300 ${isExpanded ? 'p-4' : 'items-center p-2'
                  }`}>
                  {/* Collapse / Pin Toggle */}
                  <div className={`flex items-center mb-2 ${isExpanded ? 'justify-between px-2' : 'justify-center'}`}>
                    {isExpanded && (
                      <span className="text-xs font-semibold text-slate-500">أقسام الإدارة</span>
                    )}
                    <div className="flex gap-1">
                      {isExpanded && sidebarCollapsed && (
                        <button
                          onClick={() => { setSidebarPinned(!sidebarPinned); setSidebarHovered(false); }}
                          className={`p-1.5 rounded-lg transition-all duration-200 ${sidebarPinned ? 'text-primary-400 bg-primary-500/20' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                          title={sidebarPinned ? 'إلغاء التثبيت' : 'تثبيت الشريط'}
                        >
                          <Pin className={`w-3.5 h-3.5 transition-transform ${sidebarPinned ? 'rotate-0' : 'rotate-45'}`} />
                        </button>
                      )}
                      <button
                        onClick={() => { setSidebarCollapsed(!sidebarCollapsed); setSidebarPinned(false); setSidebarHovered(false); }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all duration-200"
                        title={sidebarCollapsed ? 'توسيع' : 'تصغير'}
                      >
                        {sidebarCollapsed ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Nav Items */}
                  <div className="flex flex-col gap-1.5">
                    {adminTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          if (!sidebarPinned) setSidebarCollapsed(true);
                        }}
                        className={`group flex items-center rounded-2xl font-semibold outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary-300/45 ${isExpanded ? 'gap-3 px-4 py-3' : 'justify-center px-0 py-3'
                          } ${activeTab === tab.id
                            ? 'border border-primary-300/30 bg-primary-400/15 text-white shadow-[0_16px_40px_-26px_rgb(var(--color-primary-400)_/_0.9)]'
                            : 'border border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white'
                          }`}
                        title={!isExpanded ? tab.label : undefined}
                      >
                        <tab.icon className={`h-5 w-5 flex-shrink-0 transition duration-200 ${activeTab === tab.id ? 'text-primary-100' : 'text-primary-300/70 group-hover:text-primary-200'}`} />
                        {isExpanded && (
                          <span className="overflow-hidden whitespace-nowrap text-sm">{tab.label}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1 px-3 py-4">
                    <button
                      onClick={() => setShowGuide(true)}
                      className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all duration-300 ${
                        showGuide ? 'bg-amber-500/10 text-amber-300' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <HelpCircle className="h-5 w-5" />
                      <span className={`whitespace-nowrap transition-all duration-300 ${sidebarCollapsed && !sidebarHovered ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                        دليل الإدارة
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Mobile Admin Tabs ── */}
              <div className="sticky top-[76px] z-40 w-full max-w-[100vw] px-1 lg:hidden">
                <div className="relative overflow-hidden rounded-2xl border border-primary-500/20 bg-slate-950/95 px-10 py-1.5 shadow-[0_18px_60px_-38px_rgb(var(--color-primary-500)_/_0.75)] backdrop-blur-2xl">
                  <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-slate-950 via-slate-950/85 to-transparent" />
                  <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-slate-950 via-slate-950/85 to-transparent" />

                  <button
                    type="button"
                    onClick={() => moveMobileAdminTab(-1)}
                    disabled={!canMoveToPreviousAdminTab}
                    className="absolute right-1 top-1/2 z-10 inline-flex h-10 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-primary-100 transition duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="التبويب السابق"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>

                  <div
                    ref={mobileTabRailRef}
                    dir="rtl"
                    className="flex min-w-0 touch-pan-x snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-smooth py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {adminTabs.map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        data-admin-tab={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex h-12 shrink-0 snap-center items-center gap-2 rounded-xl border px-3 text-xs font-bold leading-tight outline-none transition duration-200 active:scale-[0.98] ${activeTab === tab.id
                          ? 'border-primary-300/30 bg-primary-400/15 text-primary-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                          : 'border-white/5 bg-white/[0.035] text-slate-400 hover:border-white/10 hover:text-slate-200'
                          }`}
                      >
                        <tab.icon className={`h-5 w-5 flex-shrink-0 ${activeTab === tab.id ? 'text-primary-100' : 'text-primary-300/70'}`} />
                        <span className="max-w-[8.5rem] truncate whitespace-nowrap">{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => moveMobileAdminTab(1)}
                    disabled={!canMoveToNextAdminTab}
                    className="absolute left-1 top-1/2 z-10 inline-flex h-10 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-primary-100 transition duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                    aria-label="التبويب التالي"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </>
          );
        })()}

        {/* Content Area */}
        <div className="flex-1 min-w-0 w-full max-w-full">

          {loading && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary-400" />
            </div>
          )}

          {/* --- DASHBOARD TAB --- */}
          {activeTab === 'dashboard' && stats && detailedStats && (
            <AdminDashboard
              stats={stats}
              detailedStats={detailedStats}
              weeklyStats={weeklyStats}
              classStats={classStats}
              monthlyTrends={monthlyTrends}
              violationsData={violationsData}
              exitsData={exitsData}
              setActiveTab={setActiveTab}
            />
          )}

          {/* --- OTHER TABS (Students, Structure, Users, Reports) - Kept Clean --- */}
          {activeTab === 'students' && (
            <AdminStudentsTab
              students={students}
              sortedStudents={sortedStudents}
              filteredStudents={filteredStudents}
              selectedStudentIds={selectedStudentIds}
              setSelectedStudentIds={setSelectedStudentIds}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              studentSortBy={studentSortBy}
              setStudentSortBy={setStudentSortBy}
              studentSortDir={studentSortDir}
              setStudentSortDir={setStudentSortDir}
              studentFilterGrade={studentFilterGrade}
              setStudentFilterGrade={setStudentFilterGrade}
              studentFilterSection={studentFilterSection}
              setStudentFilterSection={setStudentFilterSection}
              studentFilterStatus={studentFilterStatus}
              setStudentFilterStatus={setStudentFilterStatus}
              studentFilterActivity={studentFilterActivity}
              setStudentFilterActivity={setStudentFilterActivity}
              studentFiltersCollapsed={studentFiltersCollapsed}
              setStudentFiltersCollapsed={setStudentFiltersCollapsed}
              activeStudentFilters={activeStudentFilters}
              resetStudentFilters={resetStudentFilters}
              gradeFilters={gradeFilters}
              visibleSections={visibleSections}
              countStudentsByGrade={countStudentsByGrade}
              countStudentsBySection={countStudentsBySection}
              statusCounts={statusCounts}
              activityCounts={activityCounts}
              selectedInView={selectedInView}
              allStudentsSelected={allStudentsSelected}
              toggleSelectAllFiltered={toggleSelectAllFiltered}
              toggleStudentSelection={toggleStudentSelection}
              bulkSelectGrade={bulkSelectGrade}
              setBulkSelectGrade={setBulkSelectGrade}
              bulkSelectSection={bulkSelectSection}
              setBulkSelectSection={setBulkSelectSection}
              schoolCatalog={schoolCatalog}
              handleSelectByClassSection={handleSelectByClassSection}
              handleBulkDeleteStudents={handleBulkDeleteStudents}
              handleBulkStatusUpdate={handleBulkStatusUpdate}
              handleBulkMoveStudents={handleBulkMoveStudents}
              handleExportSelectedStudents={handleExportSelectedStudents}
              bulkMoveClass={bulkMoveClass}
              setBulkMoveClass={setBulkMoveClass}
              bulkMoveSection={bulkMoveSection}
              setBulkMoveSection={setBulkMoveSection}
              bulkMoveSections={bulkMoveSections}
              handleExportTemplate={handleExportTemplate}
              openPrivacyGate={openPrivacyGate}
              setShowManualAttendanceModal={setShowManualAttendanceModal}
              setShowBarcodeStudio={setShowBarcodeStudio}
              handleDeleteStudent={handleDeleteStudent}
              hasSchoolStructure={classes.length > 0 && totalSections > 0}
              onGoToStructure={() => setActiveTab('structure')}
              allowStudentIdEdit={studentIdSettings.allow_edit ?? true}
              setSelectedStudentProfile={setSelectedStudentProfile}
              setIdEditTarget={setIdEditTarget}
              setIdEditValue={setIdEditValue}
              setIdEditError={setIdEditError}
              setEditingStudent={setEditingStudent}
              setShowEditStudentModal={setShowEditStudentModal}
            />
          )}


          {activeTab === 'structure' && (
            <AdminStructureTab
              students={students}
              classes={classes}
              classStudents={classStudents}
              selectedClassStats={selectedClassStats}
              classAttendanceRate={classAttendanceRate}
              totalSections={totalSections}
              gradeKeys={gradeKeys}
              sectionsForSelectedGrade={sectionsForSelectedGrade}
              filteredClassStudents={filteredClassStudents}
              classLoading={classLoading}
              selectedGrade={selectedGrade}
              selectedSection={selectedSection}
              classRange={classRange}
              newClass={newClass}
              classStudentSearch={classStudentSearch}
              classStudentSortBy={classStudentSortBy}
              classStudentSortDir={classStudentSortDir}
              setNewClass={setNewClass}
              setClassStudentSearch={setClassStudentSearch}
              setClassStudentSortBy={setClassStudentSortBy}
              setClassStudentSortDir={setClassStudentSortDir}
              handleSelectGrade={handleSelectGrade}
              handleSelectSection={handleSelectSection}
              handleClassRangeChange={handleClassRangeChange}
              handleAddClass={handleAddClass}
              handleEditSections={handleEditSections}
              handleDeleteClass={handleDeleteClass}
              handleRebuildStructure={handleRebuildStructure}
              onGoToStudents={() => setActiveTab('students')}
            />
          )}


          {activeTab === 'users' && (
            <AdminUsersTab
              classes={classes}
              visibleUsers={visibleUsers}
              newUser={newUser}
              setNewUser={setNewUser}
              handleAddUser={handleAddUser}
              handleDeleteUser={handleDeleteUser}
              handleStartEditUser={handleStartEditUser}
              onGoToStructure={() => setActiveTab('structure')}
              currentUserId={currentUser?.id}
            />
          )}

          {activeTab === 'integrations' && (
            <AdminIntegrationsTab showToast={showToast} />
          )}

          {activeTab === 'staff-operations' && (
            <AdminStaffOperationsTab showToast={showToast} />
          )}

          {activeTab === 'settings' && (
            <AdminSettingsTab
              attendanceSettings={attendanceSettings}
              setAttendanceSettings={setAttendanceSettings}
              attendanceSettingsSaving={attendanceSettingsSaving}
              saveAttendanceSettingsToCloud={saveAttendanceSettingsToCloud}
              academicHolidays={academicHolidays}
              showToast={showToast}
              studentIdSettings={studentIdSettings}
              setStudentIdSettings={setStudentIdSettings}
              studentIdSettingsSaving={studentIdSettingsSaving}
              studentIdPolicy={studentIdPolicy}
              studentIdPolicyHint={studentIdPolicyHint}
              handleSaveStudentIdSettings={handleSaveStudentIdSettings}
              allowStudentIdEdit={studentIdSettings.allow_edit ?? true}
              settingsRenameQuery={settingsRenameQuery}
              setSettingsRenameQuery={setSettingsRenameQuery}
              settingsRenameTargetId={settingsRenameTargetId}
              setSettingsRenameTargetId={setSettingsRenameTargetId}
              settingsRenameNewId={settingsRenameNewId}
              setSettingsRenameNewId={setSettingsRenameNewId}
              settingsRenameError={settingsRenameError}
              setSettingsRenameError={setSettingsRenameError}
              settingsRenameCandidates={settingsRenameCandidates}
              settingsRenameTarget={settingsRenameTarget}
              requestStudentIdRename={requestStudentIdRename}
              kiosk_settings={kiosk_settings}
              setKioskSettings={setKioskSettings}
              fetchKioskSettings={fetchKioskSettings}
            />
          )}

          {/* --- CALENDAR TAB --- */}
          {activeTab === 'calendar' && (
            <AdminCalendarTab
              holidays={academicHolidays}
              workDays={attendanceSettings.work_days ?? [0, 1, 2, 3, 4]}
              saving={calendarSaving}
              onSaveHolidays={saveAcademicHolidays}
              showToast={showToast}
            />
          )}

          {/* --- ACTIVITY LOG TAB --- */}
          {activeTab === 'activity-log' && (
            <AdminActivityLogTab
              showToast={showToast}
            />
          )}

          {activeTab === 'guardian-phones' && (
            <AdminGuardianPhonesTab
              students={students}
              setStudents={setStudents}
              fetchStudents={fetchStudents}
              showToast={showToast}
            />
          )}

          {activeTab === 'kiosk' && (
            <AdminKioskTab
              kiosk_settings={kiosk_settings}
              setKioskSettings={setKioskSettings}
              loading={loading}
              setLoading={setLoading}
              fetchKioskSettings={fetchKioskSettings}
            />
          )}

          {/* ===================== TAB: FOLLOW-UP ===================== */}
          {activeTab === 'follow-up' && (
            <AdminFollowUpTab
              followUpFilter={followUpFilter}
              setFollowUpFilter={setFollowUpFilter}
              guardianIncomingNotifications={guardianIncomingNotifications}
              guardianOutgoingNotifications={guardianOutgoingNotifications}
              lateStudents={lateStudents}
              absentStudents={absentStudents}
              followUpRows={followUpRows}
            />
          )}

          {activeTab === 'incidents' && (
            <AdminIncidentsTab showToast={showToast} />
          )}

          {activeTab === 'excuses' && (
            <AdminExcusesTab
              excuses={guardianExcuses}
              students={students}
              loading={loading}
              onRefresh={fetchGuardianExcuses}
              onReview={handleReviewGuardianExcuse}
            />
          )}

          {/* ===================== TAB: BACKUP ===================== */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              <AdminBackupTab
                storageMode={storageMode}
                backupError={backupError}
                backupBusy={backupBusy}
                backupSummary={backupSummary}
                restoreFile={restoreFile}
                restorePreview={restorePreview}
                restoreColumns={restoreColumns}
                restoreFieldOptions={restoreFieldOptions}
                restoreMapping={restoreMapping}
                restoreIdMode={restoreIdMode}
                restoreIdPattern={restoreIdPattern}
                restorePreviewRows={restorePreviewRows}
                handleDownloadBackup={handleDownloadBackup}
                handleRestoreFile={handleRestoreFile}
                handleApplyRestore={handleApplyRestore}
                handleRestoreMappingChange={handleRestoreMappingChange}
                setRestoreIdMode={setRestoreIdMode}
                setRestoreIdPattern={setRestoreIdPattern}
              />
              <React.Suspense fallback={<div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-gray-300">جاري تحميل مركز النسخ الاحتياطي...</div>}>
                <BackupCenter />
              </React.Suspense>
            </div>
          )}

          {/* ===================== TAB: NOTIFICATION TEMPLATES ===================== */}
          {activeTab === 'notifications' && (
            <AdminNotificationsTab
              notification_templates={notification_templates}
              setNotificationTemplates={setNotificationTemplates}
              editingTemplate={editingTemplate}
              setEditingTemplate={setEditingTemplate}
              saveNotificationTemplates={saveNotificationTemplates}
              broadcast={broadcast}
              setBroadcast={setBroadcast}
              sendingNotification={sendingNotification}
              handleSendNotification={handleSendNotification}
            />
          )}

          {activeTab === 'reports' && (
            <AdminReportsTab
              reportFilter={reportFilter}
              setReportFilter={setReportFilter}
              reportFiltersCollapsed={reportFiltersCollapsed}
              setReportFiltersCollapsed={setReportFiltersCollapsed}
              reportData={reportData}
              setReportData={setReportData}
              classes={classes}
              students={students}
              kiosk_settings={kiosk_settings}
              loading={loading}
              setLoading={setLoading}
              defaultReportDate={defaultReportDate}
              workDays={attendanceSettings.work_days ?? [0, 1, 2, 3, 4]}
              holidays={academicHolidays}
              onGoToStudents={() => setActiveTab('students')}
            />
          )}

        </div>
      </div>

      {/* --- MODALS (Shared) --- */}

      {/* Student Profile Modal */}
      {selectedStudentProfile && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 overflow-y-auto">
          <div className="glass-card w-full max-w-4xl rounded-3xl p-6 relative animate-fade-in-up border border-white/20 my-8">
            <button onClick={() => setSelectedStudentProfile(null)} className="absolute left-6 top-6 text-gray-400 hover:text-white z-10"><X className="w-6 h-6" /></button>

            {/* Header */}
            <div className="flex items-center gap-6 mb-8 pb-6 border-b border-white/10">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center text-white text-3xl font-bold shadow-lg">
                {(selectedStudentProfile.name || selectedStudentProfile.id || '؟').charAt(0)}
              </div>
              <div className="flex-1">
                <h2 className="text-3xl font-bold font-serif text-white mb-2">{selectedStudentProfile.name}</h2>
                <div className="flex items-center gap-4 text-gray-400 text-sm">
                  <span className="font-mono bg-white/5 px-3 py-1 rounded-lg">#{selectedStudentProfile.id}</span>
                  <span className="bg-primary-500/20 text-primary-400 px-3 py-1 rounded-lg">{selectedStudentProfile.class_name} - {selectedStudentProfile.section}</span>
                </div>
              </div>
            </div>

            {/* Guardian Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <div className="text-xs text-gray-400 mb-1">معرف الطالب</div>
                <div className="text-white font-mono text-lg">{selectedStudentProfile.id}</div>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <div className="text-xs text-gray-400 mb-1">رقم ولي الأمر</div>
                <div className="text-white font-mono text-lg">{selectedStudentProfile.guardian_phone}</div>
              </div>
            </div>

            {/* WhatsApp Quick Action */}
            <div className="mb-8">
              <button
                onClick={() => {
                  setQuickSendStudent(selectedStudentProfile);
                  setShowQuickSend(true);
                }}
                className="w-full bg-green-600/20 hover:bg-green-600/30 border border-green-600/30 text-green-400 p-4 rounded-xl flex items-center justify-between group transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg mb-1">واتساب سريع</div>
                    <div className="text-sm text-green-400/70">إرسال رسالة مباشرة لولي الأمر</div>
                  </div>
                </div>
                <MoveRight className="w-6 h-6 transform rotate-180 group-hover:-translate-x-2 transition-transform" />
              </button>
            </div>



            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-10 h-10 animate-spin text-primary-400 mx-auto mb-4" />
                <p className="text-gray-400">جاري تحميل البيانات...</p>
              </div>
            ) : studentProfileData && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Attendance Summary */}
                <div className="glass-card p-4 rounded-2xl border border-white/10">
                  <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-emerald-400" /> سجل الحضور
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                    {studentProfileData.attendance.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">لا يوجد سجلات حضور</p>
                    ) : (
                      studentProfileData.attendance.slice(0, 10).map((a, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-white/5 rounded-lg text-sm">
                          <span className="text-gray-400 font-mono">{a.date}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${a.status === 'present' ? 'bg-emerald-500/20 text-emerald-400' :
                            a.status === 'late' ? 'bg-amber-500/20 text-amber-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>
                            {a.status === 'present' ? 'حاضر' : a.status === 'late' ? `متأخر ${a.minutes_late || 0} د` : 'غائب'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/10 text-center">
                    <span className="text-xs text-gray-400">الإجمالي: </span>
                    <span className="text-white font-bold">{studentProfileData.attendance.length}</span>
                    <span className="text-xs text-gray-400 mr-2"> سجل</span>
                  </div>
                </div>

                {/* Exits (Permissions) */}
                <div className="glass-card p-4 rounded-2xl border border-white/10">
                  <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                    <DoorOpen className="w-5 h-5 text-amber-400" /> سجل الاستئذان
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                    {studentProfileData.exits.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">لا يوجد سجلات استئذان</p>
                    ) : (
                      studentProfileData.exits.slice(0, 10).map((e, i) => (
                        <div key={i} className="p-2 bg-white/5 rounded-lg text-sm">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-gray-400 font-mono text-xs">{e.exit_time.split('T')[0]}</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${e.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
                              }`}>
                              {e.status === 'approved' ? 'معتمد' : 'معلق'}
                            </span>
                          </div>
                          <p className="text-gray-300 text-xs">{e.reason}</p>
                          <p className="mt-1 text-[11px] text-amber-200/80">المستأذن: {getExitRequesterRelationLabel(e)}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/10 text-center">
                    <span className="text-xs text-gray-400">الإجمالي: </span>
                    <span className="text-white font-bold">{studentProfileData.exits.length}</span>
                    <span className="text-xs text-gray-400 mr-2"> استئذان</span>
                  </div>
                </div>

                {/* Violations */}
                <div className="glass-card p-4 rounded-2xl border border-white/10">
                  <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                    <AlertOctagon className="w-5 h-5 text-red-400" /> المخالفات
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                    {studentProfileData.violations.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">لا يوجد مخالفات - ممتاز! 🌟</p>
                    ) : (
                      studentProfileData.violations.slice(0, 10).map((v, i) => (
                        <div key={i} className="p-2 bg-white/5 rounded-lg text-sm">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-gray-400 font-mono text-xs">{v.created_at.split('T')[0]}</span>
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${v.level === 3 ? 'bg-red-500/20 text-red-400' :
                              v.level === 2 ? 'bg-amber-500/20 text-amber-400' :
                                'bg-emerald-500/20 text-emerald-400'
                              }`}>
                              {v.level === 3 ? 'عالي' : v.level === 2 ? 'متوسط' : 'منخفض'}
                            </span>
                          </div>
                          <p className="text-gray-300 text-xs">{v.description}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/10 text-center">
                    <span className="text-xs text-gray-400">الإجمالي: </span>
                    <span className={`font-bold ${studentProfileData.violations.length === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {studentProfileData.violations.length}
                    </span>
                    <span className="text-xs text-gray-400 mr-2"> مخالفة</span>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Stats */}
            {studentProfileData && (
              <div className="mt-6 pt-6 border-t border-white/10">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <div className="text-2xl font-bold text-emerald-400 font-mono">
                      {uniqueAttendanceByStudentDate(studentProfileData.attendance).filter(a => a.status === 'present').length}
                    </div>
                    <div className="text-xs text-gray-400">أيام حضور</div>
                  </div>
                  <div className="text-center p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <div className="text-2xl font-bold text-amber-400 font-mono">
                      {uniqueAttendanceByStudentDate(studentProfileData.attendance).filter(a => a.status === 'late').length}
                    </div>
                    <div className="text-xs text-gray-400">أيام تأخير</div>
                  </div>
                  <div className="text-center p-3 bg-secondary-500/10 rounded-xl border border-secondary-500/20">
                    <div className="text-2xl font-bold text-secondary-400 font-mono">
                      {studentProfileData.exits.length}
                    </div>
                    <div className="text-xs text-gray-400">استئذان</div>
                  </div>
                  <div className="text-center p-3 bg-red-500/10 rounded-xl border border-red-500/20">
                    <div className="text-2xl font-bold text-red-400 font-mono">
                      {studentProfileData.violations.length}
                    </div>
                    <div className="text-xs text-gray-400">مخالفات</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )
      }

      {
        showManualAttendanceModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 overflow-y-auto">
            <div className="glass-card w-full max-w-3xl rounded-3xl p-6 relative animate-fade-in-up border border-white/20 text-right">
              <button onClick={() => { setShowManualAttendanceModal(false); setManualAttendanceType('attendance'); }} className="absolute left-6 top-6 text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
              <div className="flex items-center gap-3 mb-6">
                <div className={`p-3 rounded-2xl border ${manualAttendanceType === 'absence' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold font-serif text-white">
                    {manualAttendanceType === 'absence' ? 'تسجيل غياب يدوي' : 'تسجيل حضور يدوي'}
                  </h3>
                  <p className="text-sm text-gray-400">
                    {manualAttendanceType === 'absence' ? 'حدد الطالب واليوم لتسجيل الغياب.' : 'حدد الطالب واليوم ووقت الحضور ليتم احتساب الحالة تلقائياً.'}
                  </p>
                </div>
              </div>

              <form onSubmit={handleManualAttendanceSubmit} className="space-y-5">
                <div className="flex gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setManualAttendanceType('attendance')}
                    className={`flex-1 px-4 py-2 rounded-xl font-bold transition-all ${manualAttendanceType === 'attendance'
                      ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/30'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                  >
                    تسجيل حضور
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualAttendanceType('absence')}
                    className={`flex-1 px-4 py-2 rounded-xl font-bold transition-all ${manualAttendanceType === 'absence'
                      ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10'
                      }`}
                  >
                    تسجيل غياب
                  </button>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">بحث سريع</label>
                    <input
                      type="text"
                      value={manualAttendanceSearch}
                      onChange={e => setManualAttendanceSearch(e.target.value)}
                      placeholder="ابحث بالاسم أو المعرف أو الصف"
                      className="w-full input-glass p-3 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">اختر الطالب</label>
                    <select
                      value={manualAttendanceForm.student_id}
                      onChange={e => setManualAttendanceForm({ ...manualAttendanceForm, student_id: e.target.value })}
                      className="w-full input-glass p-3 rounded-xl"
                      required
                    >
                      <option value="">اختر الطالب...</option>
                      {manualAttendanceCandidates.map(student => (
                        <option key={student.id} value={student.id}>
                          {student.name} • {student.id} • {student.class_name} - {student.section}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={`grid gap-4 ${manualAttendanceType === 'absence' ? 'md:grid-cols-1' : 'md:grid-cols-3'}`}>
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">اليوم</label>
                    <input
                      type="date"
                      value={manualAttendanceForm.date}
                      onChange={e => setManualAttendanceForm({ ...manualAttendanceForm, date: e.target.value })}
                      className="w-full input-glass p-3 rounded-xl"
                      required
                    />
                  </div>
                  {manualAttendanceType === 'attendance' && (
                    <>
                      <div>
                        <label className="block text-xs text-gray-400 mb-2">وقت الحضور</label>
                        <input
                          type="time"
                          value={manualAttendanceForm.time}
                          onChange={e => setManualAttendanceForm({ ...manualAttendanceForm, time: e.target.value })}
                          className="w-full input-glass p-3 rounded-xl"
                          required
                        />
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 flex flex-col justify-center">
                        <div className="text-xs text-gray-400">الحالة المتوقعة</div>
                        <div className="mt-1">
                          {manualAttendancePreview ? (
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${manualAttendancePreview.isLate ? 'bg-amber-500/20 text-amber-200' : 'bg-emerald-500/20 text-emerald-200'}`}>
                              {manualAttendancePreview.isLate ? `متأخر +${manualAttendancePreview.minutesLate} د` : 'حاضر'}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">أدخل وقتاً صالحاً</span>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  {manualAttendanceType === 'absence' && (
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-300 flex-shrink-0" />
                      <p className="text-sm text-red-200">سيتم تسجيل غياب الطالب لهذا اليوم</p>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">الطالب: {manualAttendanceStudent?.name || 'غير محدد'}</span>
                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">الصف: {manualAttendanceStudent?.class_name || '—'}</span>
                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">الفصل: {manualAttendanceStudent?.section || '—'}</span>
                  </div>
                  {manualAttendanceType === 'attendance' && (
                    <div className="mt-3 grid md:grid-cols-3 gap-3 text-xs text-gray-400">
                      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                        <div className="mb-1">وقت الاصطفاف</div>
                        <div className="text-white font-mono">{kiosk_settings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME}</div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                        <div className="mb-1">سماحية التأخير</div>
                        <div className="text-white font-mono">{kiosk_settings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD} دقيقة</div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                        <div className="mb-1">وقت التسجيل</div>
                        <div className="text-white font-mono">
                          {manualAttendancePreview ? manualAttendancePreview.timestamp.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <p className="text-xs text-gray-400">
                    {manualAttendanceType === 'absence'
                      ? 'سيتم تسجيل الطالب غائباً لهذا اليوم بشكل رسمي.'
                      : 'يتم احتساب التأخير تلقائياً حسب إعدادات كشك الحضور.'
                    }
                  </p>
                  <button
                    type="submit"
                    disabled={manualAttendanceSaving}
                    className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${manualAttendanceSaving
                      ? (manualAttendanceType === 'absence' ? 'bg-red-500/20 text-red-200/60 cursor-not-allowed' : 'bg-amber-500/20 text-amber-200/60 cursor-not-allowed')
                      : (manualAttendanceType === 'absence' ? 'bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/30' : 'bg-amber-600 text-white hover:bg-amber-500 shadow-lg shadow-amber-900/30')
                      }`}
                  >
                    {manualAttendanceSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    {manualAttendanceType === 'absence' ? 'تأكيد تسجيل الغياب' : 'تأكيد التسجيل'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }

      {
        privacyPrompt && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md rounded-3xl p-6 animate-fade-in-up border border-white/20 text-right">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-amber-300" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white font-serif">تنبيه الخصوصية</h3>
                    <p className="text-xs text-gray-400">يرجى التأكد قبل المتابعة</p>
                  </div>
                </div>
                <button onClick={handlePrivacyCancel} className="text-gray-400 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed mb-4">
                يمنع رفع أي بيانات حساسة مثل: صورة بطاقة الهوية، رقم الجواز، صور شخصية، أو مستندات رسمية.
                <br />
                البيانات المطلوبة فقط: الاسم، المعرّف، الصف، الفصل، وجوال ولي الأمر.
              </p>
              <label className="flex items-center gap-2 text-xs text-gray-400 mb-5">
                <input
                  type="checkbox"
                  checked={privacyRemember}
                  onChange={(e) => setPrivacyRemember(e.target.checked)}
                  className="accent-gray-500 w-4 h-4"
                />
                عدم إظهار مرة أخرى
              </label>
              <div className="flex gap-3">
                <button
                  onClick={handlePrivacyCancel}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-gray-300 hover:border-white/30"
                >
                  إلغاء
                </button>
                <button
                  onClick={handlePrivacyContinue}
                  className="flex-1 py-3 rounded-xl font-bold transition-all bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                >
                  فهمت
                </button>
              </div>
            </div>
          </div>
        )
      }

      {
        showAddModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg rounded-3xl p-6 relative animate-fade-in-up border border-white/20">
              <button onClick={() => setShowAddModal(false)} className="absolute left-6 top-6 text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
              <h3 className="text-2xl font-bold font-serif text-white mb-6 flex items-center gap-2"><UserPlus className="w-6 h-6 text-primary-400" /> إضافة طالب جديد</h3>
              <form onSubmit={handleAddStudent} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs text-gray-400 mb-1">معرّف الطالب</label>
                  <input
                    type="text"
                    required
                    className="w-full input-glass p-3 rounded-xl font-mono"
                    placeholder="مثال: 000123"
                    value={newStudent.id || ''}
                    onChange={e => setNewStudent({ ...newStudent, id: e.target.value })}
                  />
                  <p className="text-[11px] text-gray-500">يجب أن يكون فريدًا ولا يتكرر لطالب آخر. {studentIdPolicyHint}</p>
                </div>
                <input type="text" required className="w-full input-glass p-3 rounded-xl" placeholder="الاسم" value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} />
                <input type="text" required className="w-full input-glass p-3 rounded-xl font-mono" placeholder="جوال ولي الأمر" value={newStudent.guardian_phone} onChange={e => setNewStudent({ ...newStudent, guardian_phone: e.target.value })} />
                <div className="grid grid-cols-2 gap-4"><select className="w-full input-glass p-3 rounded-xl" value={newStudent.class_name} onChange={e => setNewStudent({ ...newStudent, class_name: e.target.value, section: '' })} required><option value="">اختر الصف...</option>{gradeFilters.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select>{newStudentSections.length > 0 ? (<select className="w-full input-glass p-3 rounded-xl" value={newStudent.section} onChange={e => setNewStudent({ ...newStudent, section: e.target.value })} required><option value="">اختر الفصل...</option>{newStudentSections.map(sec => (<option key={sec} value={sec}>{sec}</option>))}</select>) : (<input type="text" required className="w-full input-glass p-3 rounded-xl" placeholder="أ، ب، ج..." value={newStudent.section} onChange={e => setNewStudent({ ...newStudent, section: e.target.value })} />)}</div>
                <button type="submit" className="w-full py-4 mt-4 bg-primary-600 rounded-xl text-white font-bold hover:bg-primary-500 shadow-lg">حفظ وإضافة</button>
              </form>
            </div>
          </div>
        )
      }

      {
        idEditTarget && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md rounded-3xl p-6 animate-fade-in-up border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-primary-500/20 border border-primary-500/40 flex items-center justify-center">
                    <Hash className="w-5 h-5 text-primary-300" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white font-serif">تعديل معرّف الطالب</h3>
                    <p className="text-xs text-gray-400">{idEditTarget.name}</p>
                  </div>
                </div>
                <button onClick={() => setIdEditTarget(null)} className="text-gray-400 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">المعرّف الحالي</label>
                  <input
                    type="text"
                    readOnly
                    className="w-full input-glass p-3 rounded-xl bg-white/5 text-gray-400 font-mono"
                    value={idEditTarget.id}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">المعرّف الجديد</label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl font-mono"
                    placeholder="اكتب المعرّف الجديد..."
                    value={idEditValue}
                    onChange={(e) => {
                      setIdEditValue(e.target.value);
                      setIdEditError(null);
                    }}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">يجب أن يكون فريدًا ولا يكرر طالبًا آخر. {studentIdPolicyHint}</p>
                </div>
                {idEditError && (
                  <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                    {idEditError}
                  </div>
                )}
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setIdEditTarget(null)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-gray-300 hover:border-white/30"
                >
                  إلغاء
                </button>
                <button
                  onClick={() => idEditTarget && requestStudentIdRename(idEditTarget, idEditValue, setIdEditError)}
                  className="flex-1 py-3 rounded-xl font-bold transition-all bg-gradient-to-r from-primary-600 to-secondary-600 text-white"
                >
                  حفظ التعديل
                </button>
              </div>
            </div>
          </div>
        )
      }

      {
        renameConfirm && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[75] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md rounded-3xl p-6 animate-fade-in-up border border-white/20 text-right">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-amber-300" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white font-serif">تأكيد تغيير المعرّف</h3>
                    <p className="text-xs text-gray-400">سيتم تحديث سجلات الحضور والتقارير.</p>
                  </div>
                </div>
                <button onClick={() => setRenameConfirm(null)} className="text-gray-400 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">المعرّف الحالي</span>
                  <span className="font-mono text-white">{renameConfirm.student.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">المعرّف الجديد</span>
                  <span className="font-mono text-emerald-300">{renameConfirm.nextId}</span>
                </div>
              </div>
              <p className="text-xs text-amber-200 mt-4">
                هذا التغيير سيؤثر على سجلات الحضور، الاستئذان، المخالفات والتنبيهات المرتبطة بالطالب.
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setRenameConfirm(null)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-gray-300 hover:border-white/30"
                >
                  إلغاء
                </button>
                <button
                  onClick={executeStudentIdRename}
                  disabled={renameSaving}
                  className={`flex-1 py-3 rounded-xl font-bold transition-all ${renameSaving ? 'bg-amber-500/20 text-amber-200/60 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                    }`}
                >
                  {renameSaving ? <Loader2 className="w-4 h-4 animate-spin inline ml-2" /> : null}
                  تأكيد
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Edit Student Modal */}
      {
        showEditStudentModal && editingStudent && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg rounded-3xl p-6 relative animate-fade-in-up border border-white/20">
              <button onClick={() => { setShowEditStudentModal(false); setEditingStudent(null); }} className="absolute left-6 top-6 text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
              <h3 className="text-2xl font-bold font-serif text-white mb-6 flex items-center gap-2">
                <SettingsIcon className="w-6 h-6 text-amber-400" /> تعديل بيانات الطالب
              </h3>
              <form onSubmit={handleEditStudent} className="space-y-4">
                {/* Student ID - Read Only */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs text-gray-400">المعرف</label>
                    {allowStudentIdEdit && (
                      <button
                        type="button"
                        onClick={() => { setIdEditTarget(editingStudent); setIdEditValue(''); setIdEditError(null); }}
                        className="text-[11px] text-primary-300 hover:text-primary-200 flex items-center gap-1"
                      >
                        <Hash className="w-3 h-3" />
                        تعديل المعرّف
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    readOnly
                    className="w-full input-glass p-3 rounded-xl bg-white/5 text-gray-400 cursor-not-allowed font-mono"
                    value={editingStudent.id}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">تغيير المعرّف سيحدّث كل السجلات المرتبطة. {studentIdPolicyHint}</p>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">الاسم</label>
                  <input
                    type="text"
                    required
                    className="w-full input-glass p-3 rounded-xl"
                    placeholder="الاسم"
                    value={editingStudent.name}
                    onChange={e => setEditingStudent({ ...editingStudent, name: e.target.value })}
                  />
                </div>

                {/* Guardian Phone */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">جوال ولي الأمر</label>
                  <input
                    type="text"
                    required
                    className="w-full input-glass p-3 rounded-xl font-mono"
                    placeholder="جوال ولي الأمر"
                    value={editingStudent.guardian_phone}
                    onChange={e => setEditingStudent({ ...editingStudent, guardian_phone: e.target.value })}
                  />
                </div>

                {/* Class and Section */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">الصف</label>
                    <select
                      className="w-full input-glass p-3 rounded-xl"
                      value={editingStudent.class_name}
                      onChange={e => setEditingStudent({ ...editingStudent, class_name: e.target.value, section: '' })}
                      required
                    >
                      <option value="">اختر الصف...</option>
                      {gradeFilters.map(grade => <option key={grade} value={grade}>{grade}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">الفصل</label>
                    {editingStudentSections.length > 0 ? (
                      <select
                        className="w-full input-glass p-3 rounded-xl"
                        value={editingStudent.section}
                        onChange={e => setEditingStudent({ ...editingStudent, section: e.target.value })}
                        required
                      >
                        <option value="">اختر الفصل...</option>
                        {editingStudentSections.map(sec => (
                          <option key={sec} value={sec}>{sec}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        required
                        className="w-full input-glass p-3 rounded-xl"
                        placeholder="أ، ب، ج..."
                        value={editingStudent.section}
                        onChange={e => setEditingStudent({ ...editingStudent, section: e.target.value })}
                      />
                    )}
                  </div>
                </div>

                <button type="submit" className="w-full py-4 mt-4 bg-amber-600 rounded-xl text-white font-bold hover:bg-amber-500 shadow-lg shadow-amber-900/20 transition-all">
                  حفظ التغييرات
                </button>
              </form>
            </div>
          </div>
        )
      }

      {/* Edit User Modal */}
      {
        showEditUserModal && editingUser && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-xl rounded-3xl p-6 relative animate-fade-in-up border border-white/20">
              <button onClick={() => { setShowEditUserModal(false); setEditingUser(null); }} className="absolute left-6 top-6 text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
              <h3 className="text-2xl font-bold font-serif text-white mb-6 flex items-center gap-2">
                <Edit3 className="w-6 h-6 text-primary-400" /> تعديل بيانات المستخدم
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">الاسم الكامل</label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl"
                    value={editingUser.name}
                    onChange={e => setEditingUser({ ...editingUser, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">اسم المستخدم</label>
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl"
                    value={editingUser.username}
                    onChange={e => setEditingUser({ ...editingUser, username: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">كلمة المرور (اتركها فارغة للإبقاء عليها)</label>
                  <input
                    type="password"
                    className="w-full input-glass p-3 rounded-xl"
                    placeholder="كلمة مرور جديدة"
                    value={editingUser.password ?? ''}
                    onChange={e => setEditingUser({ ...editingUser, password: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">الصلاحية</label>
                  <select
                    className="w-full input-glass p-3 rounded-xl"
                    value={editingUser.role}
                    onChange={e => setEditingUser({ ...editingUser, role: e.target.value as Role, assigned_classes: [] })}
                  >
                    <option value={Role.SCHOOL_ADMIN}>مدير مدرسة - صلاحيات كاملة</option>
                    <option value={Role.SUPERVISOR_GLOBAL}>مشرف عام - إشراف على جميع الصفوف</option>
                    <option value={Role.SUPERVISOR_CLASS}>مشرف صف - إشراف على صفوف محددة</option>
                    <option value={Role.WATCHER}>مراقب - مراقبة الحضور فقط</option>
                    <option value={Role.KIOSK}>كشك - واجهة الكشك فقط</option>
                    <option value={Role.CALL_STATION}>محطة النداء - واجهة نداء الطلاب الانصراف فقط</option>
                  </select>
                </div>

                <button
                  type="button"
                  aria-pressed={Boolean(editingUser.can_use_whatsapp)}
                  className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-right transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary-300/40"
                  onClick={() => setEditingUser({ ...editingUser, can_use_whatsapp: !editingUser.can_use_whatsapp })}
                >
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${editingUser.can_use_whatsapp ? 'bg-green-500 border-green-500' : 'border-white/30'}`}>
                    {editingUser.can_use_whatsapp && <Check className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <span className="text-sm text-gray-300 font-medium select-none">منح صلاحية استخدام أداة واتساب</span>
                </button>

                {editingUser.role === Role.SUPERVISOR_CLASS && (
                  <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                    <label className="text-sm text-gray-300 font-medium block mb-3">تحديد الصفوف والفصول المسؤول عنها:</label>
                    <div className="space-y-3 max-h-48 overflow-y-auto custom-scrollbar">
                      {classes.map((cls, classIndex) => (
                        <div key={`${cls.id || 'class'}-${cls.name || 'unnamed'}-${classIndex}`} className="p-3 bg-black/20 rounded-lg border border-white/5">
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              id={`edit-class-${cls.id}`}
                              checked={editingUser.assigned_classes?.some(ac => ac.class_name === cls.name) ?? false}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditingUser({
                                    ...editingUser,
                                    assigned_classes: [...(editingUser.assigned_classes ?? []), { class_name: cls.name, sections: [] }]
                                  });
                                } else {
                                  setEditingUser({
                                    ...editingUser,
                                    assigned_classes: (editingUser.assigned_classes ?? []).filter(ac => ac.class_name !== cls.name)
                                  });
                                }
                              }}
                              className="w-4 h-4 rounded"
                            />
                            <label htmlFor={`edit-class-${cls.id}`} className="text-white font-medium">{cls.name}</label>
                          </div>
                          {editingUser.assigned_classes?.some(ac => ac.class_name === cls.name) && cls.sections.length > 0 && (
                            <div className="mr-6 flex flex-wrap gap-2">
                              {cls.sections.map(sec => {
                                const assignedClass = editingUser.assigned_classes?.find(ac => ac.class_name === cls.name);
                                const isSelected = assignedClass?.sections?.includes(sec) ?? false;
                                return (
                                  <label key={sec} className={`flex items-center gap-1 px-3 py-1 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' : 'bg-white/5 text-gray-400 border border-white/10'
                                    }`}>
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        const updatedClasses = (editingUser.assigned_classes ?? []).map(ac => {
                                          if (ac && ac.class_name === cls.name) {
                                            return {
                                              ...ac,
                                              sections: e.target.checked
                                                ? [...(ac.sections || []), sec]
                                                : (ac.sections || []).filter(s => s !== sec)
                                            };
                                          }
                                          return ac;
                                        });
                                        setEditingUser({ ...editingUser, assigned_classes: updatedClasses });
                                      }}
                                      className="hidden"
                                    />
                                    <span className="text-sm">فصل {sec}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {(editingUser.assigned_classes ?? []).length === 0 && (
                      <p className="text-xs text-amber-400 mt-2">⚠️ يرجى تحديد صف واحد على الأقل</p>
                    )}
                  </div>
                )}

                <button
                  onClick={handleUpdateUser}
                  disabled={loading}
                  className={`w-full py-3 rounded-xl text-white font-bold transition-all ${loading ? 'bg-primary-500/30 cursor-not-allowed' : 'bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-500 hover:to-secondary-500'
                    }`}
                >
                  حفظ التغييرات
                </button>
              </div>
            </div>
          </div>
        )
      }

      {
        showImportModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-4xl rounded-3xl p-8 relative animate-fade-in-up border border-white/20 text-right">
              <React.Suspense fallback={<div className="p-8 text-center text-white">جاري تحميل أداة الاستيراد...</div>}>
                <ImportWizard
                  onClose={() => setShowImportModal(false)}
                  onImported={async () => {
                    const [allStudents, allClasses] = await Promise.all([db.getStudents(), db.getClasses()]);
                    setStudents(allStudents);
                    setClasses(dedupeAdminClasses(allClasses));
                    fetchDashboard();
                    fetchStructure({ preserveSelection: true });
                  }}
                />
              </React.Suspense>
            </div>
          </div>
        )
      }

      {
        showBarcodeStudio && (
          <React.Suspense fallback={<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 text-white">جاري تحميل استوديو الباركود...</div>}>
            <BarcodeStudio
              students={students}
              selectedIds={selectedStudentIds}
              onClose={() => setShowBarcodeStudio(false)}
            />
          </React.Suspense>
        )
      }

      {
        deleteConfirmation && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
            <div className="glass-card w-full max-w-sm rounded-3xl p-6 border border-white/20 text-center relative">
              <Trash2 className="w-8 h-8 text-red-500 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">تأكيد الحذف</h3>
              <p className="text-gray-400 mb-6">هل أنت متأكد من حذف <span className="text-white font-bold mx-1">{deleteConfirmation.name}</span>؟</p>
              <div className="flex gap-3"><button onClick={() => setDeleteConfirmation(null)} className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-gray-300 font-bold transition-colors">إلغاء</button><button onClick={confirmDeleteAction} className="flex-1 py-3 bg-red-600 hover:bg-red-500 rounded-xl text-white font-bold shadow-lg shadow-red-900/20 transition-colors">حذف</button></div>
            </div>
          </div>
        )
      }

      {/* Theme Selector Modal */}
      {
        showThemeSelector && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setShowThemeSelector(false)}
          >
            <div
              className="glass-card p-8 rounded-3xl border border-white/20 max-w-5xl w-full mx-4 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[rgb(var(--color-primary-400))] via-[rgb(var(--color-secondary-400))] to-[rgb(var(--color-primary-500))]">
                  اختر الثيم 🎨
                </h3>
                <button
                  onClick={() => setShowThemeSelector(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X className="w-6 h-6 text-gray-400 hover:text-white" />
                </button>
              </div>

              {/* Themes Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Object.entries(THEME_CONFIG).map(([key, theme]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setAdminTheme(key);
                      void persistAdminTheme(key);
                      setTimeout(() => setShowThemeSelector(false), 400);
                    }}
                    className={`group relative p-6 rounded-2xl transition-all duration-300 hover:scale-105 hover:shadow-2xl ${selectedTheme === key
                      ? 'border-2 border-white shadow-xl shadow-white/20'
                      : 'border border-white/20 hover:border-white/40'
                      } bg-gradient-to-br ${theme.gradient} overflow-hidden`}
                  >
                    {/* Theme Preview Content */}
                    <div className="relative z-10">
                      <div className="text-5xl mb-3 drop-shadow-lg">{theme.emoji}</div>
                      <div className="text-sm font-bold text-white mb-1 drop-shadow-md">
                        {theme.name}
                      </div>
                      <div className="text-xs text-white/80 drop-shadow-sm">
                        {theme.nameEn}
                      </div>
                    </div>

                    {/* Selected Badge */}
                    {selectedTheme === key && (
                      <div className="absolute top-3 right-3 bg-white rounded-full p-1.5 shadow-lg">
                        <Check className="w-4 h-4 text-black" />
                      </div>
                    )}

                    {/* Hover Glow Effect */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  </button>
                ))}
              </div>

              <div className="mt-6 p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="text-sm text-gray-300 text-center">
                  ✨ سيتم حفظ الثيم المختار تلقائياً وتطبيقه على جميع الصفحات
                </p>
              </div>
            </div>
          </div>
        )
      }

      {/* [REMOVED] Bulk Attendance Modal - Hybrid Mode removed per user request */}

      {/* Edit Sections Modal */}
      {
        editingClass && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => {
              setEditingClass(null);
              setEditingSections([]);
              setNewSectionInput('');
            }}
          >
            <div
              className="glass-card p-8 rounded-3xl border-2 border-white/20 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500">
                    <Database className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-white">تعديل الفصول</h3>
                    <p className="text-sm text-gray-400">{editingClass.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditingClass(null);
                    setEditingSections([]);
                    setNewSectionInput('');
                  }}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X className="w-6 h-6 text-gray-400 hover:text-white" />
                </button>
              </div>

              {/* Add Section Input */}
              <div className="mb-6">
                <label className="text-sm font-bold text-white mb-3 block">إضافة فصل جديد:</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={newSectionInput}
                    onChange={(e) => setNewSectionInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddSectionToEdit()}
                    placeholder="مثال: أ أو B أو 1"
                    className="flex-1 input-glass p-3 rounded-xl text-white placeholder-gray-500"
                  />
                  <button
                    onClick={handleAddSectionToEdit}
                    disabled={!newSectionInput.trim()}
                    className="px-6 py-3 rounded-xl bg-gradient-to-br from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-bold shadow-lg hover:shadow-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    إضافة
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  💡 سيتم تحويل اسم الفصل تلقائياً إلى أحرف كبيرة
                </p>
              </div>

              {/* Current Sections */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-bold text-white">الفصول الحالية ({editingSections.length}):</label>
                  {editingSections.length === 0 && (
                    <span className="text-xs text-red-400">يجب إضافة فصل واحد على الأقل</span>
                  )}
                </div>

                {editingSections.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {editingSections.map((section) => (
                      <div
                        key={section}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
                      >
                        <span className="text-white font-bold">فصل {section}</span>
                        <button
                          onClick={() => handleRemoveSectionFromEdit(section)}
                          className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          title="حذف الفصل"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-gray-400 bg-white/5 rounded-xl border border-dashed border-white/10">
                    لا توجد فصول. أضف فصلاً واحداً على الأقل.
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div className="p-4 rounded-xl bg-secondary-500/10 border border-secondary-400/30 mb-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-secondary-400 mt-0.5" />
                  <div className="text-sm text-secondary-200">
                    <p className="font-bold mb-2">ملاحظات:</p>
                    <ul className="space-y-1 text-xs">
                      <li>• يمكنك إضافة فصول جديدة أو حذف فصول موجودة</li>
                      <li>• الفصول تُرتب تلقائياً أبجدياً</li>
                      <li>• لا يمكن حذف جميع الفصول - يجب بقاء فصل واحد على الأقل</li>
                      <li>• تحديث الفصول لن يؤثر على الطلاب المسجلين</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveEditedSections}
                  disabled={loading || editingSections.length === 0}
                  className="flex-1 py-4 rounded-xl bg-gradient-to-br from-primary-600 to-secondary-600 hover:from-primary-500 hover:to-secondary-500 text-white font-bold shadow-lg hover:shadow-primary-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
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
                  onClick={() => {
                    setEditingClass(null);
                    setEditingSections([]);
                    setNewSectionInput('');
                  }}
                  disabled={loading}
                  className="px-6 py-4 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold border border-white/20 transition-all disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )
      }

      {
        localToast.show && (
          <div className="fixed bottom-6 left-6 z-[90] animate-fade-in-up">
            <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl backdrop-blur-md ${localToast.type === 'success' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
              }`}>
              {localToast.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
              {localToast.message}
            </div>
          </div>
        )
      }

      {/* Quick Send Modal */}
      {showQuickSend && (
        <React.Suspense fallback={null}>
          <QuickSendModal
            isOpen={showQuickSend}
            onClose={() => setShowQuickSend(false)}
            student={quickSendStudent}
          />
        </React.Suspense>
      )}
      <UniversalGuideModal 
        isOpen={showGuide} 
        onClose={() => setShowGuide(false)} 
        title="دليل مركز الإدارة"
        steps={adminGuideSteps}
        heroImage="/images/admin_guide_hero.webp"
      />
    </div >
  );
};

export default Admin;
