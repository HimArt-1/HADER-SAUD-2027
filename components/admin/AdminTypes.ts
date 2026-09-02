// ═══════════════════════════════════════════════════════════════
// Admin Types - Shared types for Admin components
// ═══════════════════════════════════════════════════════════════

import { Student, DashboardStats, ReportFilter, SchoolClass, User, Role, KioskSettings, AttendanceRecord, ExitRecord, ViolationRecord, NotificationTemplates, NotificationTemplate, Notification, ClassStatsSummary, StudentIdSettings } from '../../types';

// Theme configuration type
export interface ThemeConfig {
  name: string;
  nameEn: string;
  emoji: string;
  gradient: string;
  colors: string[];
  primary_400: string;
  primary_500: string;
  primary_600: string;
  secondary_400: string;
  secondary_500: string;
  secondary_600: string;
}

// Toast state type
export interface ToastState {
  show: boolean;
  message: string;
  type: 'success' | 'error';
}

// Student profile data type
export interface StudentProfileData {
  attendance: AttendanceRecord[];
  exits: ExitRecord[];
  violations: ViolationRecord[];
}

// Delete confirmation type
export interface DeleteConfirmation {
  type: 'class' | 'user' | 'student';
  id: string;
  name: string;
}

// Rename confirmation type
export interface RenameConfirmation {
  student: Student;
  nextId: string;
}

// Manual attendance form type
export interface ManualAttendanceForm {
  student_id: string;
  date: string;
  time: string;
}

// Attendance settings type
export interface AttendanceSettings {
  mode: 'traditional' | 'hybrid';
  auto_mark_time?: string;
  unmarked_default?: 'present' | 'absent';
}

// New user form type
export interface NewUserForm {
  name: string;
  username: string;
  password: string;
  role: Role;
  assigned_classes: { class_name: string; sections: string[] }[];
  can_use_whatsapp?: boolean;
}

// Common props for all admin tabs
export interface AdminTabProps {
  loading: boolean;
  setLoading: (loading: boolean) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
}

// Dashboard tab props
export interface AdminDashboardProps extends AdminTabProps {
  stats: DashboardStats | null;
  detailedStats: any;
  weeklyStats: any[];
  classStats: ClassStatsSummary[];
  monthlyTrends: any[];
  violationsData: any[];
  exitsData: any[];
  setActiveTab: (tab: string) => void;
}

// Students tab props
export interface AdminStudentsProps extends AdminTabProps {
  students: Student[];
  setStudents: (students: Student[]) => void;
  classes: SchoolClass[];
  fetchStudents: () => Promise<void>;
  fetchDashboard: () => Promise<void>;
}

// Structure tab props
export interface AdminStructureProps extends AdminTabProps {
  classes: SchoolClass[];
  setClasses: (classes: SchoolClass[]) => void;
  students: Student[];
  fetchStructure: () => Promise<void>;
}

// Users tab props
export interface AdminUsersProps extends AdminTabProps {
  users: User[];
  setUsers: (users: User[]) => void;
  classes: SchoolClass[];
  fetchUsers: () => Promise<void>;
}

// Settings tab props
export interface AdminSettingsProps extends AdminTabProps {
  studentIdSettings: StudentIdSettings;
  setStudentIdSettings: (settings: StudentIdSettings) => void;
  students: Student[];
  fetchStudentIdSettings: () => Promise<void>;
}

// Kiosk tab props
export interface AdminKioskProps extends AdminTabProps {
  kioskSettings: KioskSettings;
  setKioskSettings: (settings: KioskSettings) => void;
  attendanceSettings: AttendanceSettings;
  setAttendanceSettings: (settings: AttendanceSettings) => void;
}

// Reports tab props
export interface AdminReportsProps extends AdminTabProps {
  students: Student[];
  classes: SchoolClass[];
  reportFilter: ReportFilter;
  setReportFilter: (filter: ReportFilter) => void;
}

// Notifications tab props
export interface AdminNotificationsProps extends AdminTabProps {
  templates: NotificationTemplates | null;
  setTemplates: (templates: NotificationTemplates | null) => void;
}

// Backup tab props
export interface AdminBackupProps extends AdminTabProps {
  refreshBackupSummary: () => Promise<void>;
}

// Follow-up tab props
export interface AdminFollowUpProps extends AdminTabProps {
  students: Student[];
  notifications: Notification[];
  fetchFollowUpNotifications: () => Promise<void>;
}

// Re-export types from main types file
export type { Student, DashboardStats, ReportFilter, SchoolClass, User, KioskSettings, AttendanceRecord, ExitRecord, ViolationRecord, NotificationTemplates, NotificationTemplate, Notification, ClassStatsSummary, StudentIdSettings };
export { Role } from '../../types';
