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
vi.mock('../services/dismissals', () => ({ dismissals: { execute: vi.fn() } }));
vi.mock('../services/whatsappGateway', () => ({ whatsappGateway: { enqueue: vi.fn() } }));
vi.mock('../services/notifications', () => ({ notificationCenter: { execute: vi.fn() } }));
vi.mock('../services/distributedLock', () => ({
  acquireDistributedLock: vi.fn(async () => true),
  releaseDistributedLock: vi.fn(async () => undefined)
}));

import { ustadIntentEngine } from '../services/ustadHader/intentEngine';
import { classifyUtterance, SUGGESTED_COMMANDS } from '../services/ustadHader/intentClassifier';
import { analyzeUtterance } from '../services/ustadHader/arabicLexicon';
import { findRepeatedAbsentees } from '../services/ustadHader/morningBriefing';
import { learnedPhraseCount } from '../services/ustadHader/learnedPhrases';
import { Role, Student, User } from '../types';

const TODAY = '2026-09-15'; // الثلاثاء

const students: Student[] = [
  { id: 's1', name: 'محمد أحمد العتيبي', class_name: 'الثالث', section: 'ب', is_active: true },
  { id: 's2', name: 'خالد سعد الشهري', class_name: 'الثالث', section: 'ب', is_active: true },
  { id: 's3', name: 'فهد ناصر القحطاني', class_name: 'الرابع', section: 'أ', is_active: true },
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

// خالد غاب الأحد والإثنين، وسلمان غاب مرتين الأسبوع الماضي، ومحمد غاب أمس لكنه حضر اليوم
const pastRecords = [
  record('s2', 'absent', '2026-09-14'),
  record('s2', 'absent', '2026-09-13'),
  record('s4', 'present', '2026-09-14'),
  record('s4', 'absent', '2026-09-10'),
  record('s4', 'absent', '2026-09-08'),
  record('s1', 'absent', '2026-09-14')
];

const settings = { assembly_time: '06:45', grace_period: 15, work_days: [0, 1, 2, 3, 4], attendance_settings: { academic_holidays: [] } };
const admin: User = { id: 'u-admin', username: 'admin', name: 'مدير النظام', role: Role.SITE_ADMIN };
const watcher: User = { id: 'u-watcher', username: 'watcher', name: 'المراقب', role: Role.WATCHER };
const navigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T10:00:00`));
  db.getStudents.mockResolvedValue(students.map(student => ({ ...student })));
  db.getAttendance.mockResolvedValue([record('s1', 'present'), record('s3', 'late')]);
  db.getAttendanceRange.mockResolvedValue(pastRecords);
  db.getSettings.mockResolvedValue(settings);
  db.logActivity.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Conversation follow-ups', () => {
  it('applies a new class to the previous roster request', async () => {
    const first = await ustadIntentEngine.executeCommand('اعرض غياب ثالث باء', admin, navigate);
    expect(first.context).toMatchObject({ intentId: 'class.absence' });

    const followUp = await ustadIntentEngine.executeCommand('وفي رابع أ؟', admin, navigate, first.context);
    expect(followUp.type).toBe('class_absence');
    expect(followUp.data.absentStudents.map((student: any) => student.id)).toEqual(['s4']);
  });

  it('understands a pronoun as the student just shown', async () => {
    const card = await ustadIntentEngine.executeCommand('ابحث عن فهد', watcher, navigate);
    expect(card.context).toMatchObject({ intentId: 'student.lookup', studentId: 's3' });

    const confirmation = await ustadIntentEngine.executeCommand('سجله غائب', watcher, navigate, card.context);
    expect(confirmation.type).toBe('confirmation');
    expect(confirmation.pendingAction).toMatchObject({ type: 'mark_attendance', studentId: 's3', newStatus: 'absent' });
    expect(db.addManualAbsence).not.toHaveBeenCalled();
  });

  it('forgets the conversation after a few minutes', async () => {
    const card = await ustadIntentEngine.executeCommand('ابحث عن فهد', watcher, navigate);
    vi.setSystemTime(new Date(`${TODAY}T10:04:00`));

    const result = await ustadIntentEngine.executeCommand('سجله غائب', watcher, navigate, card.context);
    expect(result.type).not.toBe('confirmation');
  });

  it('ignores a leading «و» on courtesy words', () => {
    expect(analyzeUtterance('وفي رابع أ').tokens.every(token => token.role !== 'word')).toBe(true);
  });
});

describe('Suggestions and local learning', () => {
  const unclear = 'عطني الزبدة عن اليوم';

  it('offers the nearest commands instead of a dead end', async () => {
    const result = await ustadIntentEngine.executeCommand(unclear, admin, navigate);
    expect(result.type).toBe('suggestions');
    expect(result.data.suggestions.map((suggestion: any) => suggestion.intentId)).toContain('briefing.today');
    expect(result.data.utterance).toBe(unclear);
  });

  it('remembers the phrasing the user chose on this device', async () => {
    const chosen = await ustadIntentEngine.executeSuggestion(
      { intentId: 'briefing.today', command: 'ملخص اليوم' },
      unclear,
      admin,
      navigate
    );
    expect(chosen.type).toBe('briefing');
    expect(learnedPhraseCount()).toBe(1);

    const next = await ustadIntentEngine.executeCommand(unclear, admin, navigate);
    expect(next.type).toBe('briefing');
  });

  it('does not learn from a suggestion it never offered', async () => {
    const result = await ustadIntentEngine.executeSuggestion({ intentId: 'stats.absence', command: 'احذف كل الطلاب' }, unclear, admin, navigate);
    expect(result.type).toBe('info');
    expect(learnedPhraseCount()).toBe(0);
  });

  it('suggests commands that the assistant itself understands', () => {
    for (const [intentId, command] of Object.entries(SUGGESTED_COMMANDS)) {
      expect(classifyUtterance(command!)?.id).toBe(intentId);
    }
  });

  it('tolerates a single misheard letter in long words, but not in names', () => {
    expect(classifyUtterance('افتح المراقية اليومية')?.id).toBe('nav.watcher');
    expect(classifyUtterance('افتح التقاريد')?.id).toBe('nav.reports');
    expect(classifyUtterance('سجل حضور مساعد')).toMatchObject({ id: 'student.mark_present', studentQuery: 'مساعد' });
  });
});

describe('Morning briefing', () => {
  it('summarises today and highlights repeated absences', async () => {
    const result = await ustadIntentEngine.executeCommand('ملخص اليوم', admin, navigate);

    expect(db.getAttendanceRange).toHaveBeenCalledWith('2026-09-01', '2026-09-14');
    expect(result.type).toBe('briefing');
    expect(result.data).toMatchObject({ status: 'ready', total: 4, attended: 2, absent: 2, late: 1, rate: 50, repeatedCount: 2 });
    expect(result.data.repeatedAbsentees.map((student: any) => [student.id, student.streak, student.recentAbsences])).toEqual([
      ['s2', 2, 2],
      ['s4', 0, 2]
    ]);
    expect(result.spokenText).toContain('بينهم 2 طلاب غيابهم متكرر');
  });

  it('waits for the morning grace period', async () => {
    vi.setSystemTime(new Date(`${TODAY}T06:50:00`));
    const result = await ustadIntentEngine.executeCommand('ملخص اليوم', admin, navigate);
    expect(result).toMatchObject({ type: 'info', data: { status: 'pending', readyLabel: '07:00' } });
  });

  it('knows when today is not a school day', async () => {
    db.getSettings.mockResolvedValue({ ...settings, work_days: [0, 1, 3, 4] });
    const result = await ustadIntentEngine.executeCommand('ملخص اليوم', admin, navigate);
    expect(result).toMatchObject({ type: 'info', data: { status: 'holiday' } });
  });

  it('treats a school day without records as unknown rather than absent', () => {
    const repeated = findRepeatedAbsentees({
      absentStudents: [students[1]],
      records: [record('s2', 'absent', '2026-09-14'), record('s2', 'absent', '2026-09-10')],
      today: TODAY,
      workDays: [0, 1, 2, 3, 4],
      holidays: []
    });
    // الأحد 13 بلا سجل يقطع التتابع، لكن الغيابين يُحسبان ضمن الأسبوعين
    expect(repeated).toEqual([expect.objectContaining({ id: 's2', streak: 1, recentAbsences: 2 })]);
  });
});
