import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, DoorOpen, Loader2, Printer, RefreshCw, Save, Settings2 } from 'lucide-react';
import { db, getLocalISODate } from '../../services/db';
import { appSettings } from '../../services/settings';
import { studentAffairs } from '../../services/studentAffairs';
import {
  DocumentPrintTemplate,
  DocumentPrintTemplates,
  ExitRecord,
  Student,
  SystemSettings,
  User,
  ViolationRecord
} from '../../types';
import {
  getDocumentPrintTemplates,
  printExitCard,
  printViolationNotice
} from '../../services/documentPrintTemplates';
import { getExitRequesterRelationLabel } from '../../services/exitRequester';
import { logError } from '../../types/errors';

type Props = {
  showToast: (message: string, type: 'success' | 'error') => void;
};

const fieldClass = 'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-primary-300/50 focus:ring-4 focus:ring-primary-300/10';

const formatTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
};

const formatExitStatus = (status?: ExitRecord['status']) => {
  if (status === 'pending') return 'قيد المراجعة';
  if (status === 'rejected') return 'مرفوض';
  return 'معتمد';
};

const updateTemplateField = (
  templates: Required<DocumentPrintTemplates>,
  key: keyof Required<DocumentPrintTemplates>,
  field: keyof DocumentPrintTemplate,
  value: string
): Required<DocumentPrintTemplates> => ({
  ...templates,
  [key]: {
    ...templates[key],
    [field]: value
  }
});

const AdminIncidentsTab: React.FC<Props> = ({ showToast }) => {
  const [date, setDate] = useState(getLocalISODate());
  const [loading, setLoading] = useState(true);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [exits, setExits] = useState<ExitRecord[]>([]);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [templates, setTemplates] = useState<Required<DocumentPrintTemplates>>(getDocumentPrintTemplates());

  const userById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const studentById = useMemo(() => new Map(students.map(student => [student.id, student])), [students]);

  const resolveExitRecorder = useCallback((exit: ExitRecord) => {
    if (exit.supervisor_name) return exit.supervisor_name;
    if (exit.created_by && userById.has(exit.created_by)) return userById.get(exit.created_by)!.name;
    return '-';
  }, [userById]);

  const resolveViolationRecorder = useCallback((violation: ViolationRecord) => {
    if (violation.created_by_label) return violation.created_by_label;
    if (violation.created_by && userById.has(violation.created_by)) return userById.get(violation.created_by)!.name;
    return '-';
  }, [userById]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [studentRows, userRows, settingsRow, affairs] = await Promise.all([
        db.getStudents(),
        db.getUsers(),
        appSettings.load(),
        studentAffairs.load({ type: 'day', date })
      ]);
      setStudents(studentRows);
      setUsers(userRows);
      setSettings(settingsRow);
      setTemplates(getDocumentPrintTemplates(settingsRow));
      setExits(affairs.exits);
      setViolations(affairs.violations);
    } catch (error) {
      logError(error, 'AdminIncidentsTab - loadData');
      showToast('تعذر تحميل سجلات التصاريح والمخالفات', 'error');
    } finally {
      setLoading(false);
    }
  }, [date, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveTemplates = async () => {
    setSavingTemplates(true);
    try {
      const nextSettings = await appSettings.execute({
        type: 'patch',
        changes: {
          kiosk_settings: { document_templates: templates }
        }
      });
      setSettings(nextSettings);
      showToast('تم حفظ قوالب الطباعة', 'success');
    } catch (error) {
      logError(error, 'AdminIncidentsTab - saveTemplates');
      showToast('تعذر حفظ قوالب الطباعة', 'error');
    } finally {
      setSavingTemplates(false);
    }
  };

  const handlePrintExit = (exit: ExitRecord, student: Student | undefined, recorder: string) => {
    const ok = printExitCard(exit, student, settings, recorder);
    if (!ok) showToast('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح.', 'error');
  };

  const handlePrintViolation = (violation: ViolationRecord, student: Student | undefined, recorder: string) => {
    const ok = printViolationNotice(violation, student, settings, recorder);
    if (!ok) showToast('تعذر فتح نافذة الطباعة. تحقق من إعدادات المتصفح.', 'error');
  };

  const TemplateEditor = ({
    title,
    tone,
    templateKey
  }: {
    title: string;
    tone: 'sky' | 'rose';
    templateKey: keyof Required<DocumentPrintTemplates>;
  }) => {
    const template = templates[templateKey];
    const toneClass = tone === 'sky' ? 'border-sky-400/20 bg-sky-500/[0.06]' : 'border-rose-400/20 bg-rose-500/[0.06]';

    return (
      <section className={`rounded-2xl border p-4 ${toneClass}`}>
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-slate-300" />
          <h3 className="text-sm font-bold text-slate-100">{title}</h3>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-400">العنوان</span>
            <input
              value={template.title}
              onChange={(event) => setTemplates(prev => updateTemplateField(prev, templateKey, 'title', event.target.value))}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-400">الوصف المختصر</span>
            <input
              value={template.subtitle || ''}
              onChange={(event) => setTemplates(prev => updateTemplateField(prev, templateKey, 'subtitle', event.target.value))}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-400">المحتوى</span>
            <textarea
              value={template.body}
              onChange={(event) => setTemplates(prev => updateTemplateField(prev, templateKey, 'body', event.target.value))}
              className={`${fieldClass} min-h-[150px] resize-y font-mono text-xs leading-6`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-400">التذييل</span>
            <textarea
              value={template.footer || ''}
              onChange={(event) => setTemplates(prev => updateTemplateField(prev, templateKey, 'footer', event.target.value))}
              className={`${fieldClass} min-h-[76px] resize-y`}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-400">تسمية التوقيع</span>
            <input
              value={template.signature_label || ''}
              onChange={(event) => setTemplates(prev => updateTemplateField(prev, templateKey, 'signature_label', event.target.value))}
              className={fieldClass}
            />
          </label>
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-6">
      <header className="rounded-[1.75rem] border border-white/10 bg-slate-950/55 p-5 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.95)] backdrop-blur-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-300/70">التصاريح والسلوك</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">سجل الاستئذانات والمخالفات</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              مراجعة يومية للتصاريح والملاحظات مع اسم المستخدم المسجل وطباعة المستندات الرسمية.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
              <CalendarDays className="h-4 w-4 text-primary-300" />
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="bg-transparent text-slate-100 outline-none"
              />
            </label>
            <button
              onClick={() => void loadData()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-bold text-slate-100 transition hover:-translate-y-0.5 hover:bg-white/[0.08] active:translate-y-0"
            >
              <RefreshCw className="h-4 w-4" />
              تحديث
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-sky-100">استئذانات اليوم المحدد</span>
                <DoorOpen className="h-5 w-5 text-sky-300" />
              </div>
              <p className="mt-3 font-mono text-3xl font-semibold text-white tabular-nums">{exits.length}</p>
            </div>
            <div className="rounded-2xl border border-rose-400/15 bg-rose-500/[0.06] p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-rose-100">مخالفات اليوم المحدد</span>
                <AlertTriangle className="h-5 w-5 text-rose-300" />
              </div>
              <p className="mt-3 font-mono text-3xl font-semibold text-white tabular-nums">{violations.length}</p>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-4 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                <DoorOpen className="h-5 w-5 text-sky-300" />
                تفاصيل الاستئذان
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-right text-sm">
                <thead className="border-b border-white/10 text-xs text-slate-500">
                  <tr>
                    <th className="p-3">الطالب</th>
                    <th className="p-3">الوقت</th>
                    <th className="p-3">السبب</th>
                    <th className="p-3">المستأذن</th>
                    <th className="p-3">المسجل</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3">طباعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                  ) : exits.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-500">لا توجد استئذانات لهذا التاريخ</td></tr>
                  ) : exits.map(exit => {
                    const student = studentById.get(exit.student_id);
                    const recorder = resolveExitRecorder(exit);
                    return (
                      <tr key={exit.id} className="transition hover:bg-white/[0.03]">
                        <td className="p-3">
                          <p className="font-semibold text-slate-100">{student?.name || exit.student_id}</p>
                          <p className="mt-1 text-xs text-slate-500">{student?.class_name || '-'} - {student?.section || '-'}</p>
                        </td>
                        <td className="p-3 font-mono text-slate-400">{formatTime(exit.exit_time)}</td>
                        <td className="p-3 text-slate-300">{exit.reason}</td>
                        <td className="p-3 text-slate-300">{getExitRequesterRelationLabel(exit)}</td>
                        <td className="p-3 text-slate-400">{recorder}</td>
                        <td className="p-3">
                          <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2.5 py-1 text-xs font-bold text-sky-200">
                            {formatExitStatus(exit.status)}
                          </span>
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => handlePrintExit(exit, student, recorder)}
                            className="inline-flex items-center gap-2 rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-100 transition hover:bg-sky-500/15"
                          >
                            <Printer className="h-4 w-4" />
                            بطاقة
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/50 p-4 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                <AlertTriangle className="h-5 w-5 text-rose-300" />
                تفاصيل المخالفات
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-right text-sm">
                <thead className="border-b border-white/10 text-xs text-slate-500">
                  <tr>
                    <th className="p-3">الطالب</th>
                    <th className="p-3">النوع</th>
                    <th className="p-3">المستوى</th>
                    <th className="p-3">الإجراء</th>
                    <th className="p-3">المسجل</th>
                    <th className="p-3">طباعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                  ) : violations.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-500">لا توجد مخالفات لهذا التاريخ</td></tr>
                  ) : violations.map(violation => {
                    const student = studentById.get(violation.student_id);
                    const recorder = resolveViolationRecorder(violation);
                    return (
                      <tr key={violation.id} className="transition hover:bg-white/[0.03]">
                        <td className="p-3">
                          <p className="font-semibold text-slate-100">{student?.name || violation.student_id}</p>
                          <p className="mt-1 text-xs text-slate-500">{student?.class_name || '-'} - {student?.section || '-'}</p>
                        </td>
                        <td className="p-3 text-rose-200">{violation.type}</td>
                        <td className="p-3 font-mono text-slate-300">{violation.level}</td>
                        <td className="max-w-[220px] truncate p-3 text-slate-400">{violation.action_taken || '-'}</td>
                        <td className="p-3 text-slate-400">{recorder}</td>
                        <td className="p-3">
                          <button
                            onClick={() => handlePrintViolation(violation, student, recorder)}
                            className="inline-flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-500/15"
                          >
                            <Printer className="h-4 w-4" />
                            إشعار
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <TemplateEditor title="قالب بطاقة الاستئذان" tone="sky" templateKey="exit_card" />
          <TemplateEditor title="قالب إشعار المخالفة" tone="rose" templateKey="violation_notice" />
          <button
            onClick={saveTemplates}
            disabled={savingTemplates}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary-300/20 bg-primary-500/15 px-4 py-3 text-sm font-bold text-primary-50 transition hover:-translate-y-0.5 hover:bg-primary-500/20 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingTemplates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ قوالب الطباعة
          </button>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-xs leading-6 text-slate-400">
            المتغيرات المتاحة: {'{student_name}'}, {'{student_id}'}, {'{class_name}'}, {'{section}'}, {'{reason}'}, {'{requester_relation}'}, {'{exit_time}'}, {'{violation_type}'}, {'{level}'}, {'{description}'}, {'{action_taken}'}, {'{recorded_by}'}.
          </div>
        </aside>
      </div>
    </div>
  );
};

export default AdminIncidentsTab;
