import { describe, expect, it } from 'vitest';
import { createInMemoryStaffOperationsPort, createStaffOperationsModule, type StaffTeacher } from '../modules/staffOperations';
import { createInMemoryIntegrationAuditPort } from '../modules/integrations';
import { createStaffReportService } from '../modules/integrations/staffReportService';
import { parseStaffReportRows } from '../modules/integrations/staffReportParser';

const teachers: StaffTeacher[] = [
  { id: '001', name: 'أحمد', specialty: 'علوم', isActive: true, maxWeeklyWaits: 4 },
  { id: '002', name: 'خالد', specialty: 'علوم', isActive: true, maxWeeklyWaits: 4 }
];
const attendance = (id = '001', status = 'غائب') => ({ 'معرف المعلم': id, 'التاريخ': '2026-09-06', 'حالة الحضور': status });
const preparation = { 'معرف المعلم': '001', 'التاريخ': '2026-09-06', 'الحصة': '١', 'المادة': 'علوم', 'الصف': 'الأول', 'الفصل': 'أ', 'حالة التحضير': 'غير محضر' };
function setup() {
  const port = createInMemoryStaffOperationsPort({ teachers, timetable: [{ id: 'lesson-1', teacherId: '001', day: 0, period: 1, subject: 'علوم', className: 'الأول', section: 'أ' }] });
  let actor = { id: 'admin', displayName: 'مدير', canApproveIntegrations: true };
  let time = new Date('2026-09-06T06:00:00Z');
  const audit = createInMemoryIntegrationAuditPort();
  const reports = createStaffReportService({ port, audit, resolveApprover: () => actor, environment: { now: () => time } });
  const staff = createStaffOperationsModule(port, { resolveOperator: () => ({ ...actor, canManageStaff: true }) });
  return { port, audit, reports, staff, setActor: (next: typeof actor) => { actor = next; }, expire: () => { time = new Date(time.getTime() + 16 * 60000); } };
}

describe('staff report validation', () => {
  it('normalizes Arabic digits and preserves leading zero identifiers', () => {
    expect(parseStaffReportRows('huduri', [{ ...attendance('٠٠١', 'متأخر'), 'دقائق التأخر': '١٢' }], teachers)[0]).toMatchObject({ teacherId: '001', status: 'late', minutesLate: 12 });
    expect(() => parseStaffReportRows('huduri', [attendance('1')], teachers)).toThrow('المعلم');
  });
  it.each([
    { ...attendance(), 'التاريخ': '2026-02-30' },
    { ...attendance(), 'التاريخ': '1448-03-01 هـ' },
    { ...attendance(), 'حالة الحضور': 'لا توجد بصمة' },
    { ...attendance(), 'حالة الحضور': 'حاضر', 'دقائق التأخر': '15' },
    { ...attendance(), 'حالة الحضور': 'متأخر', 'دقائق التأخر': '-1' },
    { ...attendance(), 'اسم المعلم': 'خالد' },
    { ...attendance(), 'teacher id': '002' }
  ])('rejects unsafe or ambiguous report row %j', row => {
    expect(() => parseStaffReportRows('huduri', [row], teachers)).toThrow();
  });
  it('rejects duplicates, empty reports, unknown and inactive teachers', () => {
    expect(() => parseStaffReportRows('huduri', [attendance(), attendance()], teachers)).toThrow('مكرر');
    expect(() => parseStaffReportRows('huduri', [], teachers)).toThrow();
    expect(() => parseStaffReportRows('huduri', [attendance('missing')], teachers)).toThrow();
    expect(() => parseStaffReportRows('huduri', [attendance()], [{ ...teachers[0], isActive: false }])).toThrow();
    expect(() => parseStaffReportRows('madrasati', [preparation, preparation], teachers)).toThrow('مكرر');
    expect(() => parseStaffReportRows('madrasati', [{ ...preparation, 'الحصة': 13 }], teachers)).toThrow('الحصة');
  });
});

describe('reviewed report synchronization', () => {
  it('imports selected Huduri records atomically, deduplicates replay, and supplies coverage', async () => {
    const { port, reports, staff } = setup();
    const review = await reports.inspectRows('huduri', [attendance(), attendance('002', 'حاضر')]);
    expect((await port.load()).attendance).toHaveLength(0);
    const request = { reviewId: review.id, approvedChangeIds: review.changes.map(row => row.id), approval: {} };
    await reports.commit(request);
    expect((await port.load()).attendance).toHaveLength(2);
    expect((await port.auditEvents())[0]).toMatchObject({ action: 'report-imported', details: { platform: 'huduri', count: 2 } });
    expect((await staff.generateCoverage('2026-09-06')).assignments[0].substituteTeacherId).toBe('002');
    await expect(reports.commit(request)).rejects.toThrow('consumed');
    const replay = await reports.inspectRows('huduri', [attendance(), attendance('002', 'حاضر')]);
    expect(replay.changes.every(row => row.action === 'unchanged')).toBe(true);
  });
  it('stores Madrasati preparation without changing attendance or timetable', async () => {
    const { reports, port } = setup();
    const review = await reports.inspectRows('madrasati', [preparation]);
    await reports.commit({ reviewId: review.id, approvedChangeIds: [review.changes[0].id], approval: {} });
    const snapshot = await port.load();
    expect(snapshot.preparations[0]).toMatchObject({ status: 'not-prepared', period: 1, source: 'madrasati' });
    expect(snapshot.attendance).toHaveLength(0);
    expect(snapshot.timetable).toHaveLength(1);
    expect((await reports.history()).imports).toHaveLength(1);
  });
  it('never imports unselected rows or marks missing teachers absent', async () => {
    const { reports, port } = setup();
    const review = await reports.inspectRows('huduri', [attendance(), attendance('002')]);
    await reports.commit({ reviewId: review.id, approvedChangeIds: [review.changes[0].id], approval: {} });
    expect((await port.load()).attendance.map(row => row.teacherId)).toEqual(['001']);
  });
  it('invalidates a preview after a concurrent local edit, preserving all prior values', async () => {
    const { reports, staff, port } = setup();
    const review = await reports.inspectRows('huduri', [attendance(), attendance('002')]);
    await staff.recordAttendance({ teacherId: '001', date: '2026-09-06', status: 'present' });
    await expect(reports.commit({ reviewId: review.id, approvedChangeIds: review.changes.map(row => row.id), approval: {} })).rejects.toThrow('تغيرت البيانات');
    expect((await port.load()).attendance).toEqual([expect.objectContaining({ teacherId: '001', status: 'present' })]);
    expect((await port.auditEvents()).some(event => event.action === 'report-imported')).toBe(false);
  });
  it('rejects malformed reports without applying any earlier valid row', async () => {
    const { reports, port } = setup();
    await expect(reports.inspectRows('huduri', [attendance(), attendance('missing')])).rejects.toThrow();
    expect((await port.load()).attendance).toHaveLength(0);
  });
  it('requires authorization, rejects changed sessions and expires old reviews', async () => {
    const first = setup();
    const review = await first.reports.inspectRows('huduri', [attendance()]);
    first.setActor({ id: 'other', displayName: 'آخر', canApproveIntegrations: true });
    await expect(first.reports.commit({ reviewId: review.id, approvedChangeIds: [review.changes[0].id], approval: {} })).rejects.toThrow('جلسة');
    first.setActor({ id: 'other', displayName: 'آخر', canApproveIntegrations: false });
    await expect(first.reports.inspectRows('huduri', [attendance()])).rejects.toThrow('صلاحية');
    const second = setup();
    const expiring = await second.reports.inspectRows('huduri', [attendance()]);
    second.expire();
    await expect(second.reports.commit({ reviewId: expiring.id, approvedChangeIds: [expiring.changes[0].id], approval: {} })).rejects.toThrow('expired');
  });
  it('rejects forged selection and preserves a reviewed immutable payload', async () => {
    const { reports, port } = setup();
    const review = await reports.inspectRows('huduri', [attendance()]);
    expect(Object.isFrozen(review.changes[0].after)).toBe(true);
    await expect(reports.commit({ reviewId: review.id, approvedChangeIds: ['forged'], approval: {} })).rejects.toThrow('belong');
    expect((await port.load()).attendance).toHaveLength(0);
  });
});
