import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  getStudents: vi.fn(),
  getAttendance: vi.fn(),
  getAttendanceRange: vi.fn(),
  getSettings: vi.fn(),
  addManualAttendance: vi.fn(),
  addManualAbsence: vi.fn(),
  logActivity: vi.fn()
}));
vi.mock('../services/db', () => ({ db, getLocalISODate: () => '2026-09-15' }));

const dismissals = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../services/dismissals', () => ({ dismissals }));

const whatsappGateway = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('../services/whatsappGateway', () => ({ whatsappGateway }));

const notificationCenter = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../services/notifications', () => ({ notificationCenter }));

const locks = vi.hoisted(() => {
  const held = new Set<string>();
  return {
    held,
    acquireDistributedLock: async (key: string) => {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    releaseDistributedLock: async (key: string) => {
      held.delete(key);
    }
  };
});
vi.mock('../services/distributedLock', () => ({
  acquireDistributedLock: locks.acquireDistributedLock,
  releaseDistributedLock: locks.releaseDistributedLock
}));

import {
  containsWakeWord,
  containsSilenceCommand
} from '../services/ustadHader/speechService';
import {
  parseGradeAndSection,
  extractStudentName,
  ustadIntentEngine
} from '../services/ustadHader/intentEngine';
import { Role, User } from '../types';

const TODAY = '2026-09-15'; // الثلاثاء

const students = [
  { id: 's1', name: 'محمد أحمد العتيبي', class_name: 'الثالث', section: 'ب', guardian_phone: '0551234567', is_active: true },
  { id: 's2', name: 'خالد سعد الشهري', class_name: 'الثالث', section: 'ب', guardian_phone: '0557654321', is_active: true },
  { id: 's3', name: 'فهد ناصر القحطاني', class_name: 'الرابع', section: 'أ', guardian_phone: '0559998888', is_active: true },
  { id: 's4', name: 'سلمان علي الدوسري', class_name: 'الرابع', section: 'أ', is_active: true }
];

const record = (studentId: string, status: 'present' | 'late' | 'absent', date = TODAY) => ({
  id: `${studentId}-${date}`,
  student_id: studentId,
  date,
  timestamp: `${date}T07:00:00`,
  status,
  minutes_late: status === 'late' ? 10 : 0
});

const settings = {
  assembly_time: '06:45',
  grace_period: 15,
  work_days: [0, 1, 2, 3, 4],
  attendance_settings: { academic_holidays: [] },
  whatsapp_templates: [{ id: 'tpl_absence', category: 'absence', content: 'غياب {StudentName} بتاريخ {Date}' }]
};

const siteAdmin: User = { id: 'u-admin', username: 'admin', name: 'مدير النظام', role: Role.SITE_ADMIN };
const schoolAdmin: User = { id: 'u-school', username: 'school', name: 'مدير المدرسة', role: Role.SCHOOL_ADMIN };
const watcher: User = { id: 'u-watcher', username: 'watcher', name: 'المراقب', role: Role.WATCHER };
const classSupervisor: User = {
  id: 'u-supervisor',
  username: 'supervisor',
  name: 'مشرف الرابع',
  role: Role.SUPERVISOR_CLASS,
  assigned_classes: [{ class_name: 'الرابع', sections: ['أ'] }]
};

const navigate = vi.fn();
const sendAlerts = (studentIds: string[], user: User = siteAdmin) =>
  ustadIntentEngine.executeConfirmedAction({ type: 'send_absence_alerts', studentIds }, user);

beforeEach(() => {
  vi.clearAllMocks();
  locks.held.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  db.getStudents.mockResolvedValue(students.map(student => ({ ...student })));
  db.getAttendance.mockResolvedValue([record('s1', 'present'), record('s3', 'late')]);
  db.getAttendanceRange.mockResolvedValue([]);
  db.getSettings.mockResolvedValue(settings);
  db.logActivity.mockResolvedValue(undefined);
  whatsappGateway.enqueue.mockResolvedValue(undefined);
  notificationCenter.execute.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('أستاذ حاضر (Ustadh Hader) - Speech and NLU Engine', () => {
  describe('Wake Word & Silence detection', () => {
    it('detects wake word in various Arabic forms', () => {
      expect(containsWakeWord('يا أستاذ حاضر')).toBe(true);
      expect(containsWakeWord('يا استاذ حاضر')).toBe(true);
      expect(containsWakeWord('استاذ حاضر')).toBe(true);
      expect(containsWakeWord('يااستاذ حاضر كم الغياب؟')).toBe(true);
      expect(containsWakeWord('صباح الخير يا طلاب')).toBe(false);
    });

    it('detects silence command «اسكت» accurately', () => {
      expect(containsSilenceCommand('اسكت')).toBe(true);
      expect(containsSilenceCommand('توقف')).toBe(true);
      expect(containsSilenceCommand('اصمت')).toBe(true);
      expect(containsSilenceCommand('بس')).toBe(true);
      expect(containsSilenceCommand('شكراً جزيلاً')).toBe(false);
    });
  });

  describe('Entity & Parameter Extraction', () => {
    it('extracts grade and section from natural speech', () => {
      const res1 = parseGradeAndSection('اعرض غياب ثالث باء');
      expect(res1).not.toBeNull();
      expect(res1?.grade).toBe('ثالث');
      expect(res1?.section).toBe('ب');

      const res2 = parseGradeAndSection('كشف غياب الصف الثاني أ');
      expect(res2?.grade).toBe('ثاني');
      expect(res2?.section).toBe('أ');

      const res3 = parseGradeAndSection('غياب خامس جيم');
      expect(res3?.grade).toBe('خامس');
      expect(res3?.section).toBe('ج');
    });

    it('extracts student name from conversational requests', () => {
      expect(extractStudentName('سجل حضور الطالب محمد أحمد اليوم')).toBe('محمد احمد');
      expect(extractStudentName('ابحث عن خالد الشهري')).toBe('خالد الشهري');
      expect(extractStudentName('نداء خروج للطالب فهد')).toBe('فهد');
      expect(extractStudentName('هل الطالب عبد الله حاضر؟')).toBe('عبد الله');
    });
  });

  describe('Intent Engine Execution', () => {
    const schoolAdminWithWhatsApp: User = { ...schoolAdmin, can_use_whatsapp: true };

    it('executes navigation command «افتح مركز التكاملات»', async () => {
      const result = await ustadIntentEngine.executeCommand('افتح مركز التكاملات', schoolAdminWithWhatsApp, navigate);
      expect(result.type).toBe('navigate');
      expect(result.title).toBe('مركز التكاملات');
      expect(navigate).toHaveBeenCalledWith('/admin?tab=integrations');
    });

    it('executes absence query «كم طالب غائب اليوم؟»', async () => {
      const result = await ustadIntentEngine.executeCommand('كم طالب غائب اليوم؟', schoolAdminWithWhatsApp, navigate);
      expect(result.type).toBe('stats_absence');
      expect(result.spokenText).toContain('عدد الطلاب الغائبين');
      expect(result.data).toMatchObject({ absent: 2, present: 1, late: 1, total: 4, rate: 50 });
    });

    it('executes silence command «اسكت»', async () => {
      const result = await ustadIntentEngine.executeCommand('اسكت', schoolAdminWithWhatsApp, navigate);
      expect(result.type).toBe('silence');
      expect(result.spokenText).toBe('');
    });

    it('executes theme toggle «الوضع الداكن»', async () => {
      const result = await ustadIntentEngine.executeCommand('الوضع الداكن', schoolAdminWithWhatsApp, navigate);
      expect(result.type).toBe('theme_changed');
    });

    it('enforces permissions for parent absence alerts', async () => {
      const guardian: User = { id: 'guardian-1', username: 'guardian', name: 'ولي أمر', role: Role.GUARDIAN, can_use_whatsapp: false };
      const result = await ustadIntentEngine.executeCommand('أرسل تنبيه لأولياء أمور الغائبين', guardian, navigate);
      expect(result.type).toBe('error');
      expect(result.title).toContain('صلاحيات');
    });

    it('closes the card on «أغلق» and answers a thank-you before closing', async () => {
      expect(await ustadIntentEngine.executeCommand('أغلق', siteAdmin, navigate)).toMatchObject({ type: 'dismiss', spokenText: '' });
      const thanks = await ustadIntentEngine.executeCommand('شكراً', siteAdmin, navigate);
      expect(thanks.type).toBe('dismiss');
      expect(thanks.spokenText).toContain('العفو');
    });

    it('treats the wake word inside a typed command as a greeting, not as the command', async () => {
      const withCommand = await ustadIntentEngine.executeCommand('يا أستاذ حاضر كم طالب غائب اليوم', siteAdmin, navigate);
      expect(withCommand.type).toBe('stats_absence');

      const wakeOnly = await ustadIntentEngine.executeCommand('يا أستاذ حاضر', siteAdmin, navigate);
      expect(wakeOnly.type).toBe('info');
      expect(wakeOnly.spokenText).not.toContain('لم أفهم');
    });
  });

  describe('Data scope and guardian privacy', () => {
    it('limits today statistics to a class supervisor\'s assigned classes', async () => {
      const result = await ustadIntentEngine.executeCommand('كم طالب غائب اليوم؟', classSupervisor, navigate);
      expect(result.data).toMatchObject({ total: 2, late: 1, absent: 1, rate: 50 });
    });

    it('reports the attendance rate alongside late statistics', async () => {
      const result = await ustadIntentEngine.executeCommand('كم المتأخرين اليوم', siteAdmin, navigate);
      expect(result.data).toMatchObject({ late: 1, rate: 50 });
    });

    it('does not reveal students outside a class supervisor\'s scope', async () => {
      const hidden = await ustadIntentEngine.executeCommand('ابحث عن محمد أحمد', classSupervisor, navigate);
      expect(hidden.type).toBe('error');
      expect(JSON.stringify(hidden)).not.toContain('0551234567');

      const visible = await ustadIntentEngine.executeCommand('ابحث عن فهد', classSupervisor, navigate);
      expect(visible.type).toBe('student_card');
      expect(visible.data.student.guardianPhone).toBe('0559998888');
    });

    it('hides guardian phone numbers from watchers', async () => {
      const result = await ustadIntentEngine.executeCommand('ابحث عن فهد', watcher, navigate);
      expect(result.type).toBe('student_card');
      expect(result.data.student.guardianPhone).toBeUndefined();
    });
  });

  describe('Confirmed actions use the platform services', () => {
    it('records confirmed attendance through the attendance service', async () => {
      db.addManualAttendance.mockResolvedValue({ success: true, message: 'ok', status: 'late', minutes_late: 12 });

      const preview = await ustadIntentEngine.executeCommand('سجل حضور الطالب خالد', watcher, navigate);
      expect(preview.type).toBe('confirmation');
      expect(preview.pendingAction).toEqual({ type: 'mark_attendance', studentId: 's2', newStatus: 'present', utterance: 'سجل حضور الطالب خالد' });
      expect(db.addManualAttendance).not.toHaveBeenCalled();

      const result = await ustadIntentEngine.executeConfirmedAction(preview.pendingAction!, watcher);
      expect(db.addManualAttendance).toHaveBeenCalledWith({ student_id: 's2', date: TODAY, time: '10:00' });
      expect(result.type).toBe('success');
      expect(result.spokenText).toContain('متأخراً 12');
    });

    it('refuses to change attendance outside a supervisor\'s classes', async () => {
      const result = await ustadIntentEngine.executeConfirmedAction(
        { type: 'mark_attendance', studentId: 's2', newStatus: 'absent' },
        classSupervisor
      );
      expect(result.type).toBe('error');
      expect(db.addManualAbsence).not.toHaveBeenCalled();
    });

    it('sends a confirmed dismissal call to the call board', async () => {
      dismissals.execute.mockResolvedValue({ outcome: 'requested' });

      const preview = await ustadIntentEngine.executeCommand('نداء خروج للطالب فهد', siteAdmin, navigate);
      expect(preview.pendingAction).toEqual({ type: 'call_dismissal', studentId: 's3', utterance: 'نداء خروج للطالب فهد' });

      const result = await ustadIntentEngine.executeConfirmedAction(preview.pendingAction!, siteAdmin);
      expect(dismissals.execute).toHaveBeenCalledWith({
        type: 'request-call',
        student: { id: 's3', name: 'فهد ناصر القحطاني', class_name: 'الرابع', section: 'أ' },
        requester: { id: 'u-admin', name: 'مدير النظام' }
      });
      expect(result.type).toBe('success');
    });

    it('builds the weekly report from recorded attendance', async () => {
      db.getAttendanceRange.mockResolvedValue([
        record('s1', 'present', '2026-09-13'),
        record('s2', 'late', '2026-09-13'),
        record('s1', 'present', '2026-09-14'),
        record('s2', 'present', '2026-09-14'),
        record('s3', 'present', '2026-09-14')
      ]);

      const result = await ustadIntentEngine.executeCommand('جهّز تقرير الأسبوع', siteAdmin, navigate);
      expect(db.getAttendanceRange).toHaveBeenCalledWith('2026-09-13', '2026-09-17');
      expect(result.data.days.map((day: any) => [day.date, day.hasData, day.presence])).toEqual([
        ['2026-09-13', true, 50],
        ['2026-09-14', true, 75],
        ['2026-09-15', false, 0],
        ['2026-09-16', false, 0],
        ['2026-09-17', false, 0]
      ]);
      expect(result.data.avgPresence).toBe(63);
    });
  });

  describe('Absence alerts', () => {
    it('previews alerts even when the request mentions WhatsApp', async () => {
      const result = await ustadIntentEngine.executeCommand('أرسل تنبيه لأولياء أمور الغائبين عبر واتساب', siteAdmin, navigate);
      expect(navigate).not.toHaveBeenCalled();
      expect(result.type).toBe('alerts_preview');
      expect(result.data.recipients.map((recipient: any) => recipient.studentId)).toEqual(['s2']);
      expect(result.data.withoutPhone).toBe(1);
      expect(result.data.messagePreview).toBe(`غياب خالد سعد الشهري بتاريخ ${TODAY}`);
      expect(result.pendingAction).toEqual({
        type: 'send_absence_alerts',
        studentIds: ['s2'],
        utterance: 'أرسل تنبيه لأولياء أمور الغائبين عبر واتساب'
      });
      expect(whatsappGateway.enqueue).not.toHaveBeenCalled();
    });

    it('follows the WhatsApp route guard for sending permission', async () => {
      const result = await ustadIntentEngine.executeCommand('أرسل تنبيه لأولياء أمور الغائبين', schoolAdmin, navigate);
      expect(result.type).toBe('error');
    });

    it('waits for the morning grace period before alerting guardians', async () => {
      vi.setSystemTime(new Date(`${TODAY}T06:50:00`));
      const result = await sendAlerts(['s2']);
      expect(result.type).toBe('info');
      expect(whatsappGateway.enqueue).not.toHaveBeenCalled();
    });

    it('queues a confirmed alert once per guardian per day', async () => {
      const first = await sendAlerts(['s2']);
      expect(first.type).toBe('success');
      expect(whatsappGateway.enqueue).toHaveBeenCalledTimes(1);
      expect(whatsappGateway.enqueue.mock.calls[0][0]).toEqual([
        expect.objectContaining({ phone: '966557654321', message: `غياب خالد سعد الشهري بتاريخ ${TODAY}` })
      ]);
      expect(notificationCenter.execute).toHaveBeenCalledWith(expect.objectContaining({ type: 'send-many' }));

      const second = await sendAlerts(['s2']);
      expect(second.type).toBe('info');
      expect(whatsappGateway.enqueue).toHaveBeenCalledTimes(1);
    });

    it('skips a student who arrived after the preview', async () => {
      db.getAttendance.mockResolvedValue([record('s1', 'present'), record('s2', 'late'), record('s3', 'late')]);
      const result = await sendAlerts(['s2']);
      expect(result.type).toBe('info');
      expect(whatsappGateway.enqueue).not.toHaveBeenCalled();
    });

    it('reports a failed send honestly and allows a retry', async () => {
      whatsappGateway.enqueue.mockRejectedValueOnce(new Error('WhatsApp server offline'));

      const failed = await sendAlerts(['s2']);
      expect(failed.type).toBe('error');
      expect(notificationCenter.execute).not.toHaveBeenCalled();

      const retried = await sendAlerts(['s2']);
      expect(retried.type).toBe('success');
      expect(whatsappGateway.enqueue).toHaveBeenCalledTimes(2);
    });
  });

  describe('Understanding, disambiguation, and audit', () => {
    const khaledFahad = { id: 's5', name: 'خالد فهد الغامدي', class_name: 'الرابع', section: 'أ', is_active: true };

    it('keeps the original request when several students share a name', async () => {
      db.getStudents.mockResolvedValue([...students, khaledFahad]);

      const ambiguous = await ustadIntentEngine.executeCommand('سجل حضور خالد', watcher, navigate);
      expect(ambiguous.type).toBe('disambiguation');
      expect(ambiguous.data.students.map((student: any) => student.id).sort()).toEqual(['s2', 's5']);
      expect(ambiguous.followUp).toEqual({ kind: 'mark_attendance', newStatus: 'present' });
      expect(db.addManualAttendance).not.toHaveBeenCalled();

      const chosen = await ustadIntentEngine.executeStudentFollowUp(ambiguous.followUp!, 's5', watcher, ambiguous.data.utterance);
      expect(chosen.type).toBe('confirmation');
      expect(chosen.pendingAction).toEqual({ type: 'mark_attendance', studentId: 's5', newStatus: 'present', utterance: 'سجل حضور خالد' });
    });

    it('narrows a shared name by the class mentioned in the same sentence', async () => {
      db.getStudents.mockResolvedValue([...students, khaledFahad]);
      const result = await ustadIntentEngine.executeCommand('سجل حضور خالد رابع أ', watcher, navigate);
      expect(result.type).toBe('confirmation');
      expect(result.pendingAction).toMatchObject({ studentId: 's5' });
    });

    it('treats an unknown trailing word as noise when no student has that name', async () => {
      const result = await ustadIntentEngine.executeCommand('كم طالب غائب اليوم يا شيخ', siteAdmin, navigate);
      expect(result.type).toBe('stats_absence');
    });

    it('says a student has not arrived yet before the morning grace period ends', async () => {
      vi.setSystemTime(new Date(`${TODAY}T06:50:00`));
      const result = await ustadIntentEngine.executeCommand('ابحث عن خالد', siteAdmin, navigate);
      expect(result.data).toMatchObject({ status: 'pending', statusArabic: 'لم يُسجَّل وصوله بعد' });
    });

    it('leaves applying the theme to the interface', async () => {
      const result = await ustadIntentEngine.executeCommand('فعل الوضع الليلي', siteAdmin, navigate);
      expect(result).toMatchObject({ type: 'theme_changed', data: { mode: 'dark' } });
    });

    it('records confirmed actions in the activity log, including refusals', async () => {
      db.addManualAttendance.mockResolvedValue({ success: true, message: 'ok', status: 'present', minutes_late: 0 });
      await ustadIntentEngine.executeConfirmedAction(
        { type: 'mark_attendance', studentId: 's2', newStatus: 'present', utterance: 'سجل حضور خالد' },
        watcher
      );
      expect(db.logActivity).toHaveBeenCalledWith('assistant_action', 'أستاذ حاضر: تم تسجيل الحضور', expect.objectContaining({
        user_id: 'u-watcher',
        user_name: 'المراقب',
        target_id: 's2',
        target_name: 'خالد سعد الشهري',
        metadata: expect.objectContaining({ source: 'ustad-hader', action: 'mark_attendance', outcome: 'success', utterance: 'سجل حضور خالد' })
      }));

      await ustadIntentEngine.executeConfirmedAction({ type: 'mark_attendance', studentId: 's2', newStatus: 'absent' }, classSupervisor);
      expect(db.logActivity).toHaveBeenLastCalledWith('assistant_action', expect.any(String), expect.objectContaining({
        user_id: 'u-supervisor',
        metadata: expect.objectContaining({ outcome: 'error' })
      }));
    });

    it('still completes the action when the activity log cannot be written', async () => {
      db.logActivity.mockRejectedValue(new Error('storage full'));
      dismissals.execute.mockResolvedValue({ outcome: 'requested' });
      const result = await ustadIntentEngine.executeConfirmedAction({ type: 'call_dismissal', studentId: 's3' }, siteAdmin);
      expect(result.type).toBe('success');
    });
  });
});
