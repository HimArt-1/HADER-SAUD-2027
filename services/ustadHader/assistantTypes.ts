// =============================================================================
// نظام حاضر (Hader) - أنواع نتائج «أستاذ حاضر» المشتركة بين المحرك والواجهة
// =============================================================================

import type { ClassReference } from './arabicLexicon';

export type UstadResultType =
  | 'navigate'
  | 'stats_absence'
  | 'stats_attendance'
  | 'class_absence'
  | 'weekly_report'
  | 'alerts_preview'
  | 'student_card'
  | 'disambiguation'
  | 'confirmation'
  | 'theme_changed'
  | 'briefing'
  | 'suggestions'
  | 'help'
  | 'info'
  | 'success'
  | 'error'
  | 'silence';

export interface UstadStudentSummary {
  id: string;
  name: string;
  class_name: string;
  section: string;
  guardianPhone?: string;
}

// آخر ما دار في المحادثة، ليفهم المساعد «وفي رابع أ؟» و«سجله حاضر»
export interface UstadConversationContext {
  intentId: string;
  studentId?: string;
  classRef?: ClassReference | null;
  at: number;
}

export interface UstadSuggestion {
  intentId: string;
  command: string;
}

// ما يُنفَّذ بعد اختيار الطالب من قائمة الأسماء المتشابهة، حتى لا يضيع الطلب الأصلي
export type UstadStudentFollowUp =
  | { kind: 'lookup' }
  | { kind: 'mark_attendance'; newStatus: 'present' | 'absent' }
  | { kind: 'call_dismissal' };

// إجراء ينتظر تأكيد المستخدم الصريح؛ تُعاد فحوص الصلاحية والنطاق لحظة تنفيذه
export type UstadPendingAction = (
  | { type: 'mark_attendance'; studentId: string; newStatus: 'present' | 'absent' }
  | { type: 'call_dismissal'; studentId: string }
  | { type: 'send_absence_alerts'; studentIds: string[] }
) & {
  // الجملة التي طلبت الإجراء، تُحفظ في سجل الأنشطة
  utterance?: string;
};

export interface UstadActionPayload {
  type: UstadResultType;
  title: string;
  spokenText: string;
  data?: any;
  pendingAction?: UstadPendingAction;
  followUp?: UstadStudentFollowUp;
  context?: UstadConversationContext;
  actionButton?: {
    label: string;
    path?: string;
    onClickKey?: string;
  };
}
