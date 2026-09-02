// =============================================================================
// نظام حاضر (Hader) - Type Definitions
// =============================================================================

// Enums
export enum Role {
  SITE_ADMIN = 'site_admin',
  SCHOOL_ADMIN = 'school_admin',
  SUPERVISOR_GLOBAL = 'supervisor_global',
  SUPERVISOR_CLASS = 'supervisor_class',
  WATCHER = 'watcher',
  KIOSK = 'kiosk',
  GUARDIAN = 'guardian',
  CALL_STATION = 'call_station'
}

// Storage Keys
export const STORAGE_KEYS = {
  STUDENTS: 'hader:students',
  ATTENDANCE: 'hader:attendance',
  EXITS: 'hader:exits',
  VIOLATIONS: 'hader:violations',
  NOTIFICATIONS: 'hader:notifications',
  SETTINGS: 'hader:settings',
  CLASSES: 'hader:classes',
  USERS: 'hader:users',
  SESSION: 'hader:session',
  DAILY_SHARE: 'hader:daily_share',
  SQL_QUEUE: 'hader:sql:queue',
  TELEMETRY_SESSION_KEY: 'hader:telemetry:session_key',
  TELEMETRY_AUTH_QUEUE: 'hader:telemetry:queue_auth',
  TELEMETRY_ERROR_QUEUE: 'hader:telemetry:queue_errors',
  TELEMETRY_SESSION_RESTORE: 'hader:telemetry:session_restore',
  ADMIN_THEME: 'hader:admin:theme',
  SUPPORT_THEME: 'hader:support:theme',
  KIOSK_THEME: 'hader:kiosk:theme',
  EMERGENCY_QUEUE: 'hader:emergency:queue',
  EMERGENCY_MODE: 'hader:emergency:mode',
  DISMISSALS: 'hader:dismissals',
  DISMISSAL_CALLS: 'hader:dismissal:calls',
  DISMISSAL_KIOSK_THEME: 'hader:dismissal:kiosk:theme',
  /** تفعيل/تعطيل نطق النداء في كشك الإنصراف (TTS) */
  DISMISSAL_KIOSK_SOUND: 'hader:dismissal:kiosk:sound',
  DISMISSAL_SCHEDULES: 'hader:dismissal:schedules',
  GUARDIAN_EXCUSES: 'hader:guardian_excuses',
  ACTIVITY_LOG: 'hader:activity:log'
};

// ═══════════════════════════════════════════════════════════════
// ⏰ Attendance Defaults — Single source of truth for timing
// ═══════════════════════════════════════════════════════════════
export const ATTENDANCE_DEFAULTS = {
  /** Default assembly time (HH:mm) — وقت الطابور */
  ASSEMBLY_TIME: '06:45',
  /** Default grace period in minutes — مهلة السماح */
  GRACE_PERIOD: 15,
  /** Default auto-absence time (HH:mm) — وقت احتساب الغياب */
  ABSENCE_TIME: '09:00',
  /** Default work days (0=Sun … 6=Sat) — أيام العمل */
  WORK_DAYS: [0, 1, 2, 3, 4] as readonly number[],
} as const;

// ═══════════════════════════════════════════════════════════════
// 🚨 Emergency Mode Types - وضع الطوارئ للكشك
// ═══════════════════════════════════════════════════════════════
export interface EmergencyEntry {
  id: string;                    // معرف فريد للسجل
  scanned_code: string;          // الباركود الذي تم مسحه
  scanned_at: string;            // وقت المسح (ISO string)
  resolved: boolean;             // هل تم حل/ربط هذا السجل؟
  resolved_at?: string;          // وقت الحل
  resolved_student_id?: string;  // معرف الطالب بعد الربط
  resolved_student_name?: string;// اسم الطالب بعد الربط
  notes?: string;                // ملاحظات إضافية
}

export type AuthAuditAction = 'LOGIN' | 'LOGOUT' | 'SESSION_RESTORE' | 'SESSION_EXPIRED';
export type ClientErrorSeverity = 'ERROR' | 'WARN';
export type ClientErrorSource = 'window.onerror' | 'unhandledrejection' | 'react-boundary' | 'console.error';

export interface AuthAuditLog {
  id: string;
  created_at: string;
  action: AuthAuditAction;
  actor_user_id?: string | null;
  actor_role?: Role | string | null;
  actor_label?: string | null;
  session_key: string;
  path: string;
  ip_hint?: string | null;
  user_agent: string;
  meta?: Record<string, any> | null;
}

export interface ClientErrorLog {
  id: string;
  created_at: string;
  severity: ClientErrorSeverity;
  source: ClientErrorSource;
  message: string;
  stack?: string | null;
  path: string;
  actor_user_id?: string | null;
  actor_role?: Role | string | null;
  session_key: string;
  user_agent: string;
  meta?: Record<string, any> | null;
}

// User Interface
export interface User {
  id: string;
  username: string;
  password?: string;
  name: string;
  role: Role;
  assigned_classes?: { class_name: string; sections: string[] }[];
  assigned_sections?: string[];
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
  last_login?: string | null;
  login_attempts?: number;
  locked_until?: string | null;
  can_use_whatsapp?: boolean;
  created_at?: string;
  updated_at?: string;
}

// Student Interface
export type Student = {
  id: string;
  name: string;
  class_name: string;
  section: string;
  whatsapp_phone?: string;
  parent_phone?: string;
  guardian_phone?: string;
  guardian_name?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

// School Class Interface
export interface SchoolClass {
  id: string;
  name: string;
  sections: string[];
  grade_level?: number;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

// Class Statistics Snapshot
export interface ClassStatsSummary {
  name?: string;
  total?: number;
  rate?: number;
  present: number;
  late: number;
  absent: number;
  exits: number;
  violations: number;
  totalStudents: number;
  days: number;
}

// Attendance Record
export interface AttendanceRecord {
  id: string;
  student_id: string;
  date: string;
  timestamp: string;
  status: 'present' | 'late' | 'absent';
  minutes_late: number;
  recorded_by?: string | null;        // UUID of authenticated user (if available)
  recorded_by_label?: string | null;  // Fallback label when no auth user (e.g., "kiosk", "system")
  device_id?: string | null;
  created_at?: string;
  updated_at?: string;
  _updated_at?: string;
}

// Recorder Info - returned by resolveRecorder helper
export type RecorderInfo = {
  recorded_by: string | null;
  recorded_by_label: string | null;
};

// Exit Record
export type ExitRequesterRelation = 'father' | 'mother' | 'brother' | 'sister' | 'driver' | 'other';

export interface ExitRecord {
  id: string;
  student_id: string;
  reason: string;
  exit_time: string;
  requester_relation?: ExitRequesterRelation | null;
  requester_relation_other?: string | null;
  supervisor_name?: string;
  notes?: string;
  status?: 'pending' | 'approved' | 'rejected';
  created_by?: string | null;
  created_at?: string;
  date?: string; // Date portion for unique constraints (YYYY-MM-DD)
}

export interface DocumentPrintTemplate {
  title: string;
  subtitle?: string;
  body: string;
  footer?: string;
  signature_label?: string;
}

export interface DocumentPrintTemplates {
  exit_card?: DocumentPrintTemplate;
  violation_notice?: DocumentPrintTemplate;
}

// Violation Record
export interface ViolationRecord {
  id: string;
  student_id: string;
  type: string;
  level: number;
  description?: string;
  action_taken?: string;
  summon_guardian?: boolean;
  guardian_notified?: boolean;
  created_by?: string | null;
  created_by_label?: string | null;
  created_at: string;
  date?: string; // Date portion for unique constraints (YYYY-MM-DD)
}

export type GuardianExcuseStatus = 'pending' | 'approved' | 'rejected';

export interface GuardianExcuseRecord {
  id: string;
  student_id: string;
  student_name?: string | null;
  class_name?: string | null;
  section?: string | null;
  guardian_id?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  absence_date: string; // YYYY-MM-DD
  reason: string;
  attachment_url: string;
  attachment_path: string;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
  status: GuardianExcuseStatus;
  admin_notes?: string | null;
  reviewed_by?: string | null;
  reviewed_by_label?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// Notification Interface
export interface Notification {
  id: string;
  title?: string;
  message: string;
  type: 'announcement' | 'behavior' | 'general' | 'command' | 'alert' | 'attendance' | 'dismissal_call';
  target_audience: 'all' | 'admin' | 'supervisor' | 'guardian' | 'kiosk' | 'class' | 'student' | 'user';
  target_id?: string | null;
  is_popup?: boolean;
  is_read?: boolean;
  priority?: number;
  expires_at?: string | null;
  created_by?: string | null;
  created_at: string;
}

// Dashboard Statistics
export interface DashboardStats {
  total_students: number;
  present_count: number;
  late_count: number;
  absent_count: number;
  attendance_rate: number;
}

// Report Filter
export interface ReportFilter {
  date_from: string;
  date_to: string;
  class_name?: string;
  section?: string;
  status?: 'all' | 'present' | 'late' | 'absent';
  search_query?: string;
}

// Daily Summary
export interface DailySummary {
  id?: string;
  date: string;
  total_students?: number;
  present_count?: number;
  late_count?: number;
  absent_count?: number;
  attendance_rate?: number;
  summary_data?: any;
  created_at?: string;
  updated_at?: string;
}

// Social Links
export interface SocialLinks {
  support_url?: string;
  whatsapp?: string;
  instagram?: string;
}

// App Theme
export interface AppTheme {
  primary_400?: string;
  primary_500?: string;
  primary_600?: string;
  secondary_400?: string;
  secondary_500?: string;
  secondary_600?: string;
}

// Notification Template
export interface NotificationTemplate {
  title: string;
  message: string;
}

// Notification Templates
export interface NotificationTemplates {
  present?: NotificationTemplate;
  late: NotificationTemplate;
  absent: NotificationTemplate;
  behavior: NotificationTemplate;
  summon: NotificationTemplate;
}

export interface StudentIdSettings {
  allow_edit?: boolean;
  charset?: 'numeric' | 'alphanumeric';
  length?: number;
  prefix?: string;
}

// Academic Holiday Types
export type AcademicHolidayType = 'midterm' | 'extended' | 'national' | 'exceptional';

export interface AcademicHoliday {
  date: string;           // YYYY-MM-DD
  label: string;          // e.g. "إجازة نصف العام"
  type: AcademicHolidayType;
}

export interface AttendanceSettings {
  mode?: 'traditional' | 'hybrid';
  auto_mark_time?: string;
  unmarked_default?: 'present' | 'absent';
  enable_supervisor_quick_attendance?: boolean;
  work_days?: number[];
  academic_holidays?: AcademicHoliday[];
}

export interface SecuritySettings {
  maxLoginAttempts?: number;
  lockoutDurationMinutes?: number;
  sessionTimeoutMinutes?: number;
  requireStrongPassword?: boolean;
  student_id_settings?: StudentIdSettings;
}

// System Settings
export interface SystemSettings {
  id?: string; // Standardized to UUID
  system_ready?: boolean;
  school_active?: boolean;
  logo_url?: string;
  dark_mode?: boolean;
  admin_theme?: AdminTheme | string;
  theme?: AppTheme;
  assembly_time?: string;
  grace_period?: number;
  absence_time?: string;
  telemetry_retention_days?: number;
  notification_templates?: NotificationTemplates;
  social_links?: SocialLinks;
  kiosk_settings?: KioskSettings;
  security_settings?: SecuritySettings;
  attendance_settings?: AttendanceSettings;
  school_name?: string;
  principal_name?: string;
  whatsapp_templates?: WhatsAppTemplate[];
  whatsapp_triggers?: WhatsAppTriggers;
  whatsapp_autopilot?: boolean;
  whatsapp_autopilot_time?: string;
  work_days?: number[]; // Array of active days (0=Sunday, 1=Monday... 6=Saturday)
  late_message?: string;  // Custom kiosk message for late arrivals
  early_message?: string; // Custom kiosk message for on-time arrivals
  late_messages?: string[]; // Bank of late messages
  early_messages?: string[]; // Bank of early messages
  updated_at?: string;
}

// WhatsApp Triggers Configuration
export interface WhatsAppTriggers {
  on_present?: boolean;
  on_late?: boolean;
  on_absent?: boolean;
  on_exit?: boolean;
}

// Kiosk Display Size
export type KioskDisplaySize = 'sm' | 'md' | 'lg';

// Kiosk Theme - All implemented themes in Kiosk.tsx
export type KioskTheme =
  | 'dark-neon' | 'dark-gradient'
  | 'ocean-blue' | 'sunset-warm' | 'forest-green' | 'royal-purple'
  | 'light-clean' | 'light-soft'
  | 'light' | 'classic'
  | 'cherry-blossom' | 'fire-ember' | 'electric-storm' | 'deep-ocean'
  | 'mint-fresh' | 'galaxy-purple' | 'desert-sand'
  | string;

// Admin Theme - All themes available in Admin.tsx and Support.tsx
export type AdminTheme =
  | 'default' | 'ocean' | 'nature' | 'sunset' | 'violet'
  | 'midnight' | 'aurora' | 'ruby' | 'olive' | 'lavender'
  | 'chocolate' | 'darkchoco' | 'terracotta'
  | 'cherry' | 'fire' | 'electric' | 'deepocean'
  | 'mint' | 'galaxy' | 'desert';

// Screensaver Custom Text Settings
export interface ScreensaverCustomText {
  enabled?: boolean;
  text?: string;
  position?: 'top' | 'center' | 'bottom';
  size?: KioskDisplaySize;
}

// Kiosk Settings
export interface KioskSettings {
  main_title?: string;
  sub_title?: string;
  early_message?: string;
  late_message?: string;
  early_messages?: string[];
  late_messages?: string[];
  show_stats?: boolean;
  school_name?: string;
  principal_name?: string;
  show_school_name?: boolean;
  show_principal_name?: boolean;
  screensaver_enabled?: boolean;
  screensaver_timeout?: number;
  screensaver_images?: string[];
  screensaver_phrases?: string[];
  screensaver_custom_text?: ScreensaverCustomText;
  header_image?: string;
  // Announcement Carousel Settings
  announcements_enabled?: boolean;
  announcements_autoplay?: boolean;
  announcements_interval?: number; // in seconds
  announcements_transition?: 'slide' | 'fade' | 'zoom';
  announcements_position?: 'top' | 'bottom' | 'center';
  announcements_images?: string[];
  announcements_titles?: string[];
  announcements_descriptions?: string[];
  assembly_time?: string;
  grace_period?: number;
  absence_time?: string;
  theme?: KioskTheme;
  camera_scan_enabled?: boolean;
  camera_scan_auto_open?: boolean;
  display_settings?: {
    clock_size?: KioskDisplaySize;
    title_size?: KioskDisplaySize;
    card_size?: KioskDisplaySize;
    input_size?: KioskDisplaySize;
  };
  document_templates?: DocumentPrintTemplates;
}

// Rate Limits
export interface RateLimit {
  id: string;
  identifier: string;
  action_type: string;
  attempts: number;
  first_attempt: string;
  last_attempt: string;
  blocked_until?: string | null;
  created_at: string;
}

// Audit Log
export interface AuditLog {
  id: string;
  user_id?: string | null;
  action: string;
  table_name?: string;
  record_id?: string;
  old_data?: any;
  new_data?: any;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

// Diagnostic Result
export interface DiagnosticResult {
  key: string;
  title: string;
  message: string;
  status: 'ok' | 'warning' | 'error';
  count?: number;
  hint?: string;
}

// WhatsApp Message Template
export interface WhatsAppTemplate {
  id: string;
  name: string;
  content: string;
  category: 'general' | 'absence' | 'late' | 'behavior' | 'dismissal' | 'present';
  is_default?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 🚪 Dismissal System Types — نظام الانصراف
// ═══════════════════════════════════════════════════════════════

/** سجل الانصراف */
export interface DismissalRecord {
  id: string;
  student_id: string;
  date: string;                    // YYYY-MM-DD
  exit_time: string;               // ISO timestamp
  method: 'kiosk' | 'watcher' | 'scanner';
  picked_up_by?: string;           // اسم المستلم
  recorded_by?: string | null;
  recorded_by_label?: string | null;
  notes?: string;
  created_at?: string;
}

/** طلب نداء انصراف */
export interface DismissalCallRequest {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  section: string;
  requested_by: string;            // 'guardian' | supervisor userId
  requested_by_name?: string;
  status: 'pending' | 'called' | 'dismissed' | 'cancelled';
  request_time: string;
  called_at?: string;
  dismissed_at?: string;
}

/** إعدادات كشك الانصراف */
export interface DismissalKioskSettings {
  dismissal_start_time?: string;
  auto_close_time?: string;
  theme?: KioskTheme;
  require_guardian_name?: boolean;
  enable_call_board?: boolean;
}

/** جدول انصراف الفصول */
export interface DismissalSchedule {
  id: string;
  class_name: string;
  dismissal_time: string;  // HH:mm
  days: number[];          // 0=Sun..6=Sat
  label?: string;
}

/** سجل الأنشطة */
export type ActivityAction =
  | 'login' | 'logout'
  | 'student_add' | 'student_edit' | 'student_delete' | 'student_import'
  | 'attendance_record' | 'attendance_manual'
  | 'exit_record' | 'violation_record'
  | 'dismissal_record'
  | 'notification_send' | 'notification_broadcast'
  | 'backup_create' | 'backup_restore'
  | 'settings_update' | 'kiosk_settings_update'
  | 'user_add' | 'user_edit' | 'user_delete'
  | 'class_add' | 'class_edit' | 'class_delete'
  | 'whatsapp_send' | 'telegram_send'
  | 'other';

export interface ActivityLogEntry {
  id: string;
  action: ActivityAction;
  description: string;
  user_id?: string;
  user_name?: string;
  target_id?: string;
  target_name?: string;
  metadata?: Record<string, any>;
  created_at: string;
}
