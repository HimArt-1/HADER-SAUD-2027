import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users
} from 'lucide-react';
import type {
  CoveragePlan,
  StaffAttendanceStatus,
  StaffOperationsAuditEvent,
  StaffOperationsDashboard,
  StaffTeachingSlotInput
} from '../../modules/staffOperations';
import {
  createStaffOperationsController,
  type StaffOperationsController
} from '../../services/staffOperations';

type Props = Readonly<{
  controller?: StaffOperationsController;
  initialDate?: string;
  showToast: (message: string, type: 'success' | 'error') => void;
}>;

const today = (): string => new Date().toLocaleDateString('en-CA');

const statusLabels: Record<StaffAttendanceStatus, string> = {
  present: 'حاضر',
  late: 'متأخر',
  absent: 'غائب'
};

const statusClasses: Record<StaffAttendanceStatus, string> = {
  present: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  late: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  absent: 'border-rose-400/30 bg-rose-400/10 text-rose-100'
};

const dayLabels = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'] as const;

const readableError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (message && message.length <= 180) return message;
  return 'تعذر إكمال العملية. لم تُحفظ تغييرات جزئية.';
};

const AdminStaffOperationsTab: React.FC<Props> = ({
  controller,
  initialDate,
  showToast
}) => {
  const operations = useMemo(
    () => controller ?? createStaffOperationsController(),
    [controller]
  );
  const [date, setDate] = useState(initialDate ?? today());
  const [dashboard, setDashboard] = useState<StaffOperationsDashboard | null>(null);
  const [coveragePlan, setCoveragePlan] = useState<CoveragePlan | null>(null);
  const [auditEvents, setAuditEvents] = useState<readonly StaffOperationsAuditEvent[]>([]);
  const [importPreview, setImportPreview] = useState<Readonly<{
    fileName: string;
    slots: readonly StaffTeachingSlotInput[];
    errors: readonly string[];
  }> | null>(null);
  const [teacherForm, setTeacherForm] = useState({
    name: '',
    specialty: '',
    maxWeeklyWaits: '3'
  });
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>('load');

  const loadDashboard = useCallback(async () => {
    setBusy('load');
    try {
      const [nextDashboard, nextAudit] = await Promise.all([
        operations.dashboard(date),
        operations.auditEvents()
      ]);
      setDashboard(nextDashboard);
      setAuditEvents(nextAudit.slice(0, 8));
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  }, [date, operations, showToast]);

  useEffect(() => {
    setCoveragePlan(null);
    void loadDashboard();
  }, [loadDashboard]);

  const handleSaveTeacher = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('teacher');
    setCoveragePlan(null);
    try {
      await operations.saveTeacher({
        ...(editingTeacherId ? { id: editingTeacherId } : {}),
        name: teacherForm.name,
        specialty: teacherForm.specialty,
        maxWeeklyWaits: Number(teacherForm.maxWeeklyWaits),
        ...(editingTeacherId ? {
          isActive: dashboard?.teachers.find(teacher => teacher.id === editingTeacherId)?.isActive ?? true
        } : {})
      });
      setTeacherForm({ name: '', specialty: '', maxWeeklyWaits: '3' });
      setEditingTeacherId(null);
      showToast(editingTeacherId ? 'تم تحديث بيانات المعلم' : 'تم حفظ المعلم مع حدث تدقيق', 'success');
      await loadDashboard();
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleAttendance = async (teacherId: string, status: StaffAttendanceStatus) => {
    setBusy(`attendance:${teacherId}`);
    setCoveragePlan(null);
    try {
      await operations.recordAttendance({ teacherId, date, status });
      showToast('تم تحديث حالة المعلم', 'success');
      await loadDashboard();
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleTeacherStatus = async (teacherId: string) => {
    const teacher = dashboard?.teachers.find(candidate => candidate.id === teacherId);
    if (!teacher) return;
    setBusy(`teacher-status:${teacherId}`);
    setCoveragePlan(null);
    try {
      await operations.saveTeacher({ ...teacher, isActive: !teacher.isActive });
      showToast(teacher.isActive ? 'تم تعطيل المعلم دون حذف سجله' : 'تم تفعيل المعلم', 'success');
      await loadDashboard();
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('file');
    setImportPreview(null);
    try {
      const preview = await operations.previewTimetableFile(file);
      setImportPreview({ fileName: file.name, ...preview });
      if (preview.errors.length > 0) {
        showToast('يحتوي الملف أخطاء؛ لم يتم حفظ أي صف', 'error');
      }
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleApplyTimetable = async () => {
    if (!importPreview || importPreview.errors.length > 0) return;
    setBusy('timetable');
    setCoveragePlan(null);
    try {
      await operations.replaceTimetable({ slots: importPreview.slots });
      setImportPreview(null);
      showToast('تم اعتماد الجدول الأسبوعي دون تعارضات', 'success');
      await loadDashboard();
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateCoverage = async () => {
    setBusy('generate');
    setCoveragePlan(null);
    try {
      const plan = await operations.generateCoverage(date);
      setCoveragePlan(plan);
      showToast('تم توليد مقترح الانتظار؛ راجعه قبل الاعتماد', 'success');
    } catch (error) {
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleApproveCoverage = async () => {
    if (!coveragePlan) return;
    setBusy('approve');
    try {
      const approved = await operations.approveCoverage(coveragePlan);
      setCoveragePlan(approved);
      showToast('تم اعتماد جدول الانتظار وتسجيله', 'success');
      await loadDashboard();
    } catch (error) {
      setCoveragePlan(null);
      showToast(readableError(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const attendanceByTeacher = new Map(
    (dashboard?.attendance ?? [])
      .filter(record => record.date === date)
      .map(record => [record.teacherId, record] as const)
  );
  const teacherById = new Map(
    (dashboard?.teachers ?? []).map(teacher => [teacher.id, teacher] as const)
  );
  const activeTeachers = dashboard?.teachers.filter(teacher => teacher.isActive) ?? [];
  const absentCount = dashboard?.absentTeacherIds.length ?? 0;
  const displayedPlan = coveragePlan?.approvedAt
    ? (dashboard?.approvedPlan?.id === coveragePlan.id ? dashboard.approvedPlan : null)
    : coveragePlan ?? dashboard?.approvedPlan ?? null;
  const timetableCountByTeacher = new Map<string, number>();
  (dashboard?.timetable ?? []).forEach(slot => {
    timetableCountByTeacher.set(slot.teacherId, (timetableCountByTeacher.get(slot.teacherId) ?? 0) + 1);
  });

  return (
    <section className="space-y-6" dir="rtl">
      <div className="overflow-hidden rounded-[1.75rem] border border-primary-400/20 bg-slate-950/70 shadow-[0_28px_90px_-60px_rgba(34,211,238,0.6)]">
        <div className="border-b border-white/10 bg-gradient-to-l from-primary-500/15 via-slate-950/50 to-amber-500/10 p-6 md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
                <ShieldCheck className="h-4 w-4" /> اعتماد بشري وتدقيق ذري
              </div>
              <h2 className="text-2xl font-black text-white md:text-3xl">المعلمين والانتظار</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                سجل المعلمين، راقب الحالة اليومية، واستخرج تغطية متوازنة للحصص دون تعارض أو تجاوز للحد الأسبوعي.
              </p>
            </div>
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-200">
              <CalendarClock className="h-5 w-5 text-primary-200" />
              <span className="font-bold">يوم التشغيل</span>
              <input
                type="date"
                value={date}
                onChange={event => setDate(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-white"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 md:p-7">
          {[
            { label: 'المعلمون النشطون', value: activeTeachers.length, icon: Users, color: 'text-primary-200' },
            { label: 'الغائبون اليوم', value: absentCount, icon: AlertTriangle, color: 'text-rose-200' },
            { label: 'حصص الجدول', value: dashboard?.timetable.length ?? 0, icon: CalendarClock, color: 'text-secondary-200' },
            { label: 'تغطيات معتمدة', value: dashboard?.approvedPlan?.assignments.length ?? 0, icon: UserCheck, color: 'text-emerald-200' }
          ].map(stat => (
            <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
              <div className="mt-3 text-2xl font-black text-white">{stat.value}</div>
              <div className="text-xs text-slate-400">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-2">
          <form onSubmit={handleSaveTeacher} className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center gap-2 text-white"><UserPlus className="h-5 w-5 text-primary-200" /><h3 className="font-black">{editingTeacherId ? 'تعديل بيانات المعلم' : 'إضافة معلم'}</h3></div>
            <div className="mt-4 space-y-3">
              <input required value={teacherForm.name} onChange={event => setTeacherForm(previous => ({ ...previous, name: event.target.value }))} placeholder="اسم المعلم" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white" />
              <input required value={teacherForm.specialty} onChange={event => setTeacherForm(previous => ({ ...previous, specialty: event.target.value }))} placeholder="التخصص" className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white" />
              <label className="block text-xs text-slate-400">الحد الأسبوعي للانتظار
                <input type="number" min="0" max="20" value={teacherForm.maxWeeklyWaits} onChange={event => setTeacherForm(previous => ({ ...previous, maxWeeklyWaits: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white" />
              </label>
              <div className="flex gap-2">
                <button disabled={busy !== null} className="flex-1 rounded-xl bg-primary-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-40">{editingTeacherId ? 'حفظ التعديلات' : 'حفظ المعلم'}</button>
                {editingTeacherId && <button type="button" onClick={() => { setEditingTeacherId(null); setTeacherForm({ name: '', specialty: '', maxWeeklyWaits: '3' }); }} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-slate-300">إلغاء</button>}
              </div>
            </div>
          </form>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center gap-2 text-white"><FileSpreadsheet className="h-5 w-5 text-emerald-200" /><h3 className="font-black">استيراد الجدول الأسبوعي</h3></div>
            <p className="mt-2 text-xs leading-6 text-slate-400">الأعمدة: اسم/معرف المعلم، اليوم، الحصة، المادة، الصف، الفصل.</p>
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary-400/30 bg-primary-400/[0.06] px-4 py-4 text-sm font-bold text-primary-100">
              <FileSpreadsheet className="h-4 w-4" /> اختيار ملف Excel
              <input aria-label="رفع ملف جدول المعلمين" type="file" accept=".xlsx,.xls" className="hidden" onChange={event => void handleFile(event.target.files?.[0])} />
            </label>
            {busy === 'file' && <p className="mt-3 text-xs text-slate-400">جاري فحص الملف...</p>}
            {importPreview && (
              <div className={`mt-4 rounded-xl border p-3 text-xs ${importPreview.errors.length ? 'border-rose-400/20 bg-rose-400/[0.07] text-rose-100' : 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-100'}`}>
                <p className="font-bold">{importPreview.fileName}</p>
                {importPreview.errors.length === 0 ? (
                  <>
                    <p className="mt-1">جاهز للمراجعة: {importPreview.slots.length} حصة</p>
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto text-right">
                      {importPreview.slots.map((slot, index) => (
                        <div key={`${slot.teacherId}-${slot.day}-${slot.period}-${index}`} className="rounded-lg border border-emerald-300/10 bg-slate-950/35 p-2">
                          <strong>{teacherById.get(slot.teacherId)?.name ?? slot.teacherId}</strong>
                          <span className="mx-1 text-emerald-200/70">·</span>
                          {dayLabels[slot.day]}، الحصة {slot.period}، {slot.subject}، {slot.className}/{slot.section}
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={handleApplyTimetable} disabled={busy !== null} className="mt-3 w-full rounded-lg bg-emerald-500 px-3 py-2 font-black text-slate-950 disabled:opacity-40">اعتماد الجدول الأسبوعي</button>
                  </>
                ) : importPreview.errors.slice(0, 8).map(error => <p key={error} className="mt-1">{error}</p>)}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 xl:col-span-3">
          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h3 className="font-black text-white">حالة المعلمين اليوم</h3><p className="mt-1 text-xs text-slate-400">أي تغيير يلغي المقترح غير المعتمد تلقائيًا.</p></div>
              {busy === 'load' && <RefreshCw className="h-4 w-4 animate-spin text-primary-200" />}
            </div>
            <div className="mt-4 space-y-3">
              {(dashboard?.teachers.length ?? 0) === 0 ? <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">أضف المعلمين أولًا.</p> : dashboard?.teachers.map(teacher => {
                const currentStatus = attendanceByTeacher.get(teacher.id)?.status;
                return (
                  <div key={teacher.id} className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${teacher.isActive ? 'border-white/10 bg-white/[0.035]' : 'border-white/5 bg-white/[0.015] opacity-65'}`}>
                    <div><div className="flex items-center gap-2"><strong className="text-white">{teacher.name}</strong>{!teacher.isActive && <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-300">غير نشط</span>}{teacher.isActive && !currentStatus && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">الحضور غير مسجل</span>}</div><p className="text-xs text-slate-400">{teacher.specialty} · نصاب {timetableCountByTeacher.get(teacher.id) ?? 0} حصة · حد الانتظار {teacher.maxWeeklyWaits}</p></div>
                    <div className="flex flex-wrap gap-2">
                      {(['present', 'late', 'absent'] as const).map(status => (
                        <button
                          key={status}
                          type="button"
                          aria-label={`تسجيل ${teacher.name} ${statusLabels[status]}`}
                          onClick={() => void handleAttendance(teacher.id, status)}
                          disabled={busy !== null || !teacher.isActive}
                          className={`rounded-lg border px-3 py-2 text-xs font-bold transition disabled:opacity-40 ${currentStatus === status ? statusClasses[status] : 'border-white/10 bg-white/[0.03] text-slate-400'}`}
                        >{statusLabels[status]}</button>
                      ))}
                      <button type="button" aria-label={`تعديل ${teacher.name}`} onClick={() => { setEditingTeacherId(teacher.id); setTeacherForm({ name: teacher.name, specialty: teacher.specialty, maxWeeklyWaits: String(teacher.maxWeeklyWaits) }); }} disabled={busy !== null} className="rounded-lg border border-primary-300/20 px-3 py-2 text-xs font-bold text-primary-100 disabled:opacity-40">تعديل</button>
                      <button type="button" aria-label={`${teacher.isActive ? 'تعطيل' : 'تفعيل'} ${teacher.name}`} onClick={() => void handleTeacherStatus(teacher.id)} disabled={busy !== null} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-slate-400 disabled:opacity-40">{teacher.isActive ? 'تعطيل' : 'تفعيل'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-amber-200" /><h3 className="font-black text-white">جدول الانتظار</h3></div><p className="mt-1 text-xs text-slate-400">المقترح لا يُحفظ قبل اعتماد المدير.</p></div>
              <button type="button" onClick={handleGenerateCoverage} disabled={busy !== null || absentCount === 0} className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-40">توليد جدول الانتظار</button>
            </div>

            {displayedPlan?.approvedAt && (
              <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] p-3 text-sm text-emerald-100">جدول الانتظار معتمد لهذا اليوم ({displayedPlan.assignments.length} تغطية).</div>
            )}
            {displayedPlan && (
              <div className="mt-5 space-y-3">
                {displayedPlan.assignments.length === 0 && <p className="text-sm text-slate-400">لا توجد حصص تحتاج إلى تغطية.</p>}
                {displayedPlan.assignments.map(assignment => {
                  const substitute = assignment.substituteTeacherId ? teacherById.get(assignment.substituteTeacherId) : null;
                  const absent = teacherById.get(assignment.absentTeacherId);
                  return (
                    <div key={assignment.id} className={`rounded-2xl border p-4 ${assignment.status === 'unfilled' ? 'border-rose-400/25 bg-rose-400/[0.07]' : 'border-white/10 bg-white/[0.035]'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-white">الحصة {assignment.period} · {assignment.className}/{assignment.section}</strong><span className="text-xs text-slate-400">{assignment.subject}</span></div>
                      <p className="mt-2 text-sm text-slate-300">الغائب: {absent?.name ?? assignment.absentTeacherId}</p>
                      <p className={`mt-1 text-sm font-bold ${substitute ? 'text-emerald-200' : 'text-rose-200'}`}>{substitute?.name ?? 'لا يوجد بديل متاح'}</p>
                      <p className="mt-1 text-xs text-slate-500">{assignment.reasons.join(' · ')}</p>
                    </div>
                  );
                })}
                {!displayedPlan.approvedAt && (
                  <button type="button" onClick={handleApproveCoverage} disabled={busy !== null || displayedPlan.unfilledCount > 0 || displayedPlan.assignments.length === 0} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" /> اعتماد جدول الانتظار</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
        <h3 className="font-black text-white">سجل التدقيق الأخير</h3>
        {auditEvents.length === 0 ? <p className="mt-3 text-sm text-slate-500">لا توجد عمليات مسجلة بعد.</p> : (
          <div className="mt-3 divide-y divide-white/5">
            {auditEvents.map(event => (
              <div key={event.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="text-slate-300">{{
                  'teacher-saved': 'حفظ بيانات معلم',
                  'timetable-replaced': 'اعتماد الجدول الأسبوعي',
                  'attendance-recorded': 'تحديث حضور معلم',
                  'coverage-approved': 'اعتماد جدول الانتظار'
                }[event.action]}</span>
                <time className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString('ar-SA')}</time>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default AdminStaffOperationsTab;
