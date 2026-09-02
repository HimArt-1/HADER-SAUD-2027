import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  Eye,
  FilePlus2,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X
} from 'lucide-react';
import { auth } from '../services/auth';
import { db } from '../services/db';
import { createStaffOperationsController } from '../services/staffOperations';
import { surveyService, type SurveyBundle } from '../services/surveys';
import { whatsappGateway } from '../services/whatsappGateway';
import {
  buildSurveyRecipients,
  createSurveyDraft,
  summarizeSurvey,
  type Survey,
  type SurveyAudience,
  type SurveyInvitation,
  type SurveyQuestion,
  type SurveyQuestionType,
  type SurveyRecipient
} from '../modules/surveys';

const questionTypeLabels: Record<SurveyQuestionType, string> = {
  single_choice: 'اختيار واحد',
  multiple_choice: 'اختيارات متعددة',
  rating: 'تقييم من 1 إلى 5',
  yes_no: 'نعم أو لا',
  text: 'إجابة نصية'
};

const statusLabels = {
  draft: 'مسودة',
  published: 'منشور',
  closed: 'مغلق'
} as const;

const statusClasses = {
  draft: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
  published: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
  closed: 'border-amber-400/20 bg-amber-400/10 text-amber-200'
} as const;

const inputClass = 'input-glass mt-2 w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500';
const panelClass = 'glass-card rounded-[1.5rem] border border-white/10 bg-slate-950/60';

const newQuestion = (type: SurveyQuestionType = 'single_choice'): SurveyQuestion => ({
  id: crypto.randomUUID(),
  prompt: '',
  type,
  required: true,
  options: type === 'single_choice' || type === 'multiple_choice' ? ['الخيار الأول', 'الخيار الثاني'] : []
});

const surveyUrl = (token: string): string => {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/survey/${encodeURIComponent(token)}`;
};

const whatsappPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('966')) return digits;
  if (digits.startsWith('0')) return `966${digits.slice(1)}`;
  return digits;
};

const invitationMessage = (survey: Survey, invitation: SurveyInvitation): string =>
  `مرحباً ${invitation.recipientName}، ندعوك للمشاركة في استبيان «${survey.title}». رابط الإجابة: ${surveyUrl(invitation.token)}`;

const safeCsvCell = (value: unknown): string => {
  const text = String(value ?? '');
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
};

const downloadCsv = (name: string, rows: readonly (readonly unknown[])[]): void => {
  const csv = `\uFEFF${rows.map(row => row.map(safeCsvCell).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

type View = 'overview' | 'builder' | 'details';

const Surveys: React.FC = () => {
  const [view, setView] = useState<View>('overview');
  const [surveys, setSurveys] = useState<readonly Survey[]>([]);
  const [directory, setDirectory] = useState<Record<SurveyAudience, readonly SurveyRecipient[]>>({ guardians: [], teachers: [] });
  const [manualRecipients, setManualRecipients] = useState<readonly SurveyRecipient[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [recipientSearch, setRecipientSearch] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualContact, setManualContact] = useState('');
  const [bundle, setBundle] = useState<SurveyBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingSurvey, setEditingSurvey] = useState<Survey | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState<SurveyAudience>('guardians');
  const [anonymous, setAnonymous] = useState(false);
  const [closesAt, setClosesAt] = useState('');
  const [questions, setQuestions] = useState<readonly SurveyQuestion[]>([newQuestion()]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [surveyList, studentsResult, staffResult] = await Promise.all([
        surveyService.list(),
        db.getStudents(),
        createStaffOperationsController().dashboard(new Date().toLocaleDateString('en-CA')).catch(() => null)
      ]);
      setSurveys(surveyList);
      setDirectory({
        guardians: buildSurveyRecipients('guardians', studentsResult, []),
        teachers: buildSurveyRecipients('teachers', [], staffResult?.teachers ?? [])
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل مركز الاستبيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const surveyId = bundle?.survey.id;
    if (view !== 'details' || !surveyId) return;
    const timer = window.setInterval(() => {
      void surveyService.bundle(surveyId).then(setBundle).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [bundle?.survey.id, view]);

  const recipients = useMemo(() => [...directory[audience], ...manualRecipients], [audience, directory, manualRecipients]);
  const filteredRecipients = useMemo(() => {
    const query = recipientSearch.trim().toLocaleLowerCase('ar');
    if (!query) return recipients;
    return recipients.filter(recipient => `${recipient.name} ${recipient.contact} ${recipient.detail ?? ''}`.toLocaleLowerCase('ar').includes(query));
  }, [recipientSearch, recipients]);

  const resetBuilder = (survey?: Survey) => {
    setEditingSurvey(survey ?? null);
    setTitle(survey?.title ?? '');
    setDescription(survey?.description ?? '');
    setAudience(survey?.audience ?? 'guardians');
    setAnonymous(survey?.anonymous ?? false);
    setClosesAt(survey?.closesAt ? survey.closesAt.slice(0, 16) : '');
    setQuestions(survey?.questions ?? [newQuestion()]);
    setManualRecipients([]);
    const nextAudience = survey?.audience ?? 'guardians';
    setSelectedRecipients(new Set(directory[nextAudience].map(recipient => recipient.id)));
    setRecipientSearch('');
    setError('');
    setView('builder');
  };

  const selectAudience = (next: SurveyAudience) => {
    setAudience(next);
    setSelectedRecipients(new Set(directory[next].map(recipient => recipient.id)));
    setManualRecipients([]);
  };

  const updateQuestion = (id: string, patch: Partial<SurveyQuestion>) => {
    setQuestions(current => current.map(question => question.id === id ? { ...question, ...patch } : question));
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    setQuestions(next);
  };

  const addManualRecipient = () => {
    if (!manualName.trim()) {
      setError('اكتب اسم المستلم قبل إضافته');
      return;
    }
    const recipient: SurveyRecipient = {
      id: `manual:${crypto.randomUUID()}`,
      name: manualName.trim(),
      contact: manualContact.trim(),
      detail: 'مضاف يدوياً'
    };
    setManualRecipients(current => [...current, recipient]);
    setSelectedRecipients(current => new Set(current).add(recipient.id));
    setManualName('');
    setManualContact('');
    setError('');
  };

  const buildDraft = (): Survey => {
    const currentUser = auth.getSession();
    const next = createSurveyDraft({
      id: editingSurvey?.id,
      title,
      description,
      audience,
      anonymous,
      closesAt: closesAt || null,
      questions,
      createdBy: currentUser?.id ?? 'admin'
    });
    return editingSurvey ? Object.freeze({ ...next, createdAt: editingSurvey.createdAt }) : next;
  };

  const handleSave = async (publishNow: boolean) => {
    setBusy(publishNow ? 'publish' : 'save');
    setError('');
    try {
      const draft = await surveyService.saveDraft(buildDraft());
      if (!publishNow) {
        notify('حُفظت المسودة بنجاح');
        await load();
        setView('overview');
        return;
      }
      const targets = recipients.filter(recipient => selectedRecipients.has(recipient.id));
      const published = await surveyService.publish(draft.id, targets);
      notify(`نُشر الاستبيان وأُنشئت ${published.invitations.length} دعوة`);
      setBundle(published);
      await load();
      setView('details');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'تعذر حفظ الاستبيان');
    } finally {
      setBusy(null);
    }
  };

  const openDetails = async (surveyId: string) => {
    setBusy(`details:${surveyId}`);
    setError('');
    try {
      setBundle(await surveyService.bundle(surveyId));
      setView('details');
    } catch (detailsError) {
      setError(detailsError instanceof Error ? detailsError.message : 'تعذر تحميل النتائج');
    } finally {
      setBusy(null);
    }
  };

  const handleClose = async () => {
    if (!bundle) return;
    setBusy('close');
    try {
      await surveyService.close(bundle.survey.id);
      setBundle(await surveyService.bundle(bundle.survey.id));
      await load();
      notify('أُغلق الاستبيان وتوقف استقبال الإجابات');
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : 'تعذر إغلاق الاستبيان');
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (survey: Survey) => {
    if (survey.status !== 'draft' || !window.confirm(`حذف مسودة «${survey.title}»؟`)) return;
    setBusy(`remove:${survey.id}`);
    try {
      await surveyService.remove(survey.id);
      await load();
      notify('حُذفت المسودة');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'تعذر حذف المسودة');
    } finally {
      setBusy(null);
    }
  };

  const copyInvitation = async (invitation: SurveyInvitation) => {
    await navigator.clipboard.writeText(invitationMessage(bundle!.survey, invitation));
    notify('نُسخت رسالة الدعوة');
  };

  const queueWhatsApp = async () => {
    if (!bundle) return;
    const pending = bundle.invitations.filter(invitation => !invitation.respondedAt && invitation.recipientContact);
    if (pending.length === 0) {
      setError('لا توجد دعوات معلقة بأرقام جوال صالحة');
      return;
    }
    setBusy('whatsapp');
    setError('');
    try {
      await whatsappGateway.enqueue(pending.map(invitation => ({
        id: `survey-${invitation.id}`,
        phone: invitation.recipientContact,
        student_name: invitation.recipientName,
        message: invitationMessage(bundle.survey, invitation),
        status_label: 'دعوة استبيان'
      })));
      notify(`أضيفت ${pending.length} دعوة إلى طابور واتساب`);
    } catch (whatsappError) {
      setError(whatsappError instanceof Error ? `${whatsappError.message}. يمكنك نسخ الروابط أو تصديرها.` : 'تعذر الاتصال بخدمة واتساب');
    } finally {
      setBusy(null);
    }
  };

  const exportInvitations = () => {
    if (!bundle) return;
    downloadCsv(`survey-invitations-${bundle.survey.id}.csv`, [
      ['المستلم', 'الجوال', 'الحالة', 'الرابط'],
      ...bundle.invitations.map(invitation => [
        invitation.recipientName,
        invitation.recipientContact,
        invitation.respondedAt ? 'أجاب' : 'بانتظار الإجابة',
        surveyUrl(invitation.token)
      ])
    ]);
  };

  const exportResponses = () => {
    if (!bundle) return;
    const invitationById = new Map(bundle.invitations.map(invitation => [invitation.id, invitation]));
    downloadCsv(`survey-results-${bundle.survey.id}.csv`, [
      ['المستجيب', 'وقت الإرسال', ...bundle.survey.questions.map(question => question.prompt)],
      ...bundle.responses.map(response => {
        const invitation = invitationById.get(response.invitationId);
        return [
          response.respondentName ?? (bundle.survey.anonymous ? 'مجهول' : invitation?.recipientName ?? ''),
          response.submittedAt,
          ...bundle.survey.questions.map(question => {
            const value = response.answers.find(answer => answer.questionId === question.id)?.value;
            return Array.isArray(value) ? value.join(' | ') : value ?? '';
          })
        ];
      })
    ]);
  };

  if (loading) {
    return <div className="flex min-h-[60dvh] items-center justify-center text-slate-300"><Loader2 className="ml-3 h-6 w-6 animate-spin text-primary-300" />جاري تجهيز مركز الاستبيانات...</div>;
  }

  const summary = bundle ? summarizeSurvey(bundle.survey, bundle.invitations, bundle.responses) : null;
  const totalPublished = surveys.filter(survey => survey.status === 'published').length;
  const totalClosed = surveys.filter(survey => survey.status === 'closed').length;

  return (
    <div className="min-h-[100dvh] space-y-6 px-4 py-6 sm:px-6 lg:px-8" dir="rtl">
      {notice && <div role="status" className="fixed bottom-6 left-1/2 z-[150] -translate-x-1/2 rounded-xl border border-emerald-300/20 bg-slate-950/95 px-5 py-3 text-sm font-bold text-emerald-200 shadow-2xl">{notice}</div>}

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold text-primary-200"><ClipboardCheck className="h-4 w-4" />التواصل المؤسسي</div>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">مركز الاستبيانات</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">أنشئ استبياناً موجهاً، أرسله برابط خاص، وتابع نسبة المشاركة والنتائج من مكان واحد.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view !== 'overview' && <button type="button" onClick={() => { setView('overview'); setBundle(null); setError(''); }} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-200">العودة للقائمة</button>}
          <button type="button" onClick={() => resetBuilder()} className="flex items-center gap-2 rounded-xl bg-primary-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-primary-950/20"><Plus className="h-4 w-4" />استبيان جديد</button>
        </div>
      </header>

      {error && <div role="alert" className="flex items-start justify-between gap-4 rounded-2xl border border-rose-400/20 bg-rose-400/[0.07] p-4 text-sm text-rose-100"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="إغلاق التنبيه"><X className="h-4 w-4" /></button></div>}

      {view === 'overview' && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: 'إجمالي الاستبيانات', value: surveys.length, icon: ClipboardList },
              { label: 'تستقبل إجابات الآن', value: totalPublished, icon: Clock3 },
              { label: 'استبيانات مكتملة', value: totalClosed, icon: CheckCircle2 }
            ].map(item => <div key={item.label} className={`${panelClass} p-5`}><item.icon className="h-5 w-5 text-primary-300" /><div className="mt-5 text-3xl font-black text-white">{item.value}</div><p className="mt-1 text-xs text-slate-400">{item.label}</p></div>)}
          </section>

          <section className={`${panelClass} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6"><div><h2 className="font-black text-white">كل الاستبيانات</h2><p className="mt-1 text-xs text-slate-400">المسودات والاستبيانات النشطة والمغلقة</p></div><button type="button" onClick={() => void load()} aria-label="تحديث" className="rounded-xl border border-white/10 p-2.5 text-slate-300"><RefreshCw className="h-4 w-4" /></button></div>
            {surveys.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center"><div className="rounded-2xl bg-primary-400/10 p-4 text-primary-200"><FilePlus2 className="h-8 w-8" /></div><h3 className="mt-5 font-black text-white">ابدأ أول استبيان</h3><p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">اختر الجمهور، صمّم الأسئلة، ثم انشر روابط مخصصة يمكن متابعتها.</p><button type="button" onClick={() => resetBuilder()} className="mt-6 rounded-xl bg-primary-500 px-5 py-3 text-sm font-black text-slate-950">إنشاء استبيان</button></div>
            ) : (
              <div className="divide-y divide-white/10">
                {surveys.map(survey => (
                  <article key={survey.id} className="flex flex-col gap-4 px-5 py-5 transition hover:bg-white/[0.025] sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-black text-white">{survey.title}</h3><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClasses[survey.status]}`}>{statusLabels[survey.status]}</span></div><p className="mt-2 text-xs text-slate-400">{survey.audience === 'guardians' ? 'أولياء الأمور' : 'المعلمون'} · {survey.questions.length} أسئلة · {new Date(survey.createdAt).toLocaleDateString('ar-SA')}</p></div>
                    <div className="flex gap-2">
                      {survey.status === 'draft' ? <><button type="button" onClick={() => resetBuilder(survey)} className="rounded-xl border border-primary-300/20 bg-primary-300/[0.06] px-4 py-2.5 text-xs font-bold text-primary-100">متابعة التحرير</button><button type="button" onClick={() => void handleRemove(survey)} disabled={busy !== null} aria-label={`حذف ${survey.title}`} className="rounded-xl border border-rose-300/15 px-3 text-rose-200 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></> : <button type="button" onClick={() => void openDetails(survey.id)} disabled={busy !== null} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-slate-200 disabled:opacity-40">{busy === `details:${survey.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}النتائج والتوزيع</button>}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {view === 'builder' && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
          <main className="space-y-6">
            <section className={`${panelClass} p-5 sm:p-6`}>
              <div className="flex items-center gap-3"><div className="rounded-xl bg-primary-400/10 p-2.5 text-primary-200"><FilePlus2 className="h-5 w-5" /></div><div><h2 className="font-black text-white">بيانات الاستبيان</h2><p className="text-xs text-slate-400">اكتب عنواناً واضحاً وعرّف الهدف باختصار.</p></div></div>
              <div className="mt-6 grid gap-4">
                <label className="text-xs font-bold text-slate-300">عنوان الاستبيان<input value={title} onChange={event => setTitle(event.target.value)} placeholder="مثال: رضا أولياء الأمور عن التواصل المدرسي" className={inputClass} /></label>
                <label className="text-xs font-bold text-slate-300">وصف مختصر<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} placeholder="وضّح الغرض والوقت المتوقع للإجابة" className={inputClass} /></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-bold text-slate-300">الجمهور<select value={audience} onChange={event => selectAudience(event.target.value as SurveyAudience)} className={inputClass}><option value="guardians">أولياء الأمور</option><option value="teachers">المعلمون</option></select></label>
                  <label className="text-xs font-bold text-slate-300">موعد الإغلاق (اختياري)<input type="datetime-local" value={closesAt} onChange={event => setClosesAt(event.target.value)} className={inputClass} /></label>
                </div>
                <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm text-slate-300"><input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} className="mt-1 h-4 w-4 accent-primary-500" /><span><strong className="block text-white">إجابات مجهولة الهوية</strong><span className="mt-1 block text-xs leading-5 text-slate-400">ستظهر الإجابات دون اسم المستجيب، مع استمرار منع التكرار عبر رابط الدعوة.</span></span></label>
              </div>
            </section>

            <section className={`${panelClass} p-5 sm:p-6`}>
              <div className="flex items-center justify-between"><div><h2 className="font-black text-white">الأسئلة</h2><p className="mt-1 text-xs text-slate-400">رتّب الأسئلة واختر نوع الإجابة المناسب.</p></div><span className="rounded-full bg-primary-400/10 px-3 py-1 text-xs font-bold text-primary-200">{questions.length} سؤال</span></div>
              <div className="mt-5 space-y-4">
                {questions.map((question, index) => (
                  <article key={question.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3"><span className="text-xs font-black text-primary-200">السؤال {index + 1}</span><div className="flex gap-1"><button type="button" onClick={() => moveQuestion(index, -1)} disabled={index === 0} aria-label="تحريك السؤال للأعلى" className="rounded-lg p-2 text-slate-400 disabled:opacity-25"><ArrowUp className="h-4 w-4" /></button><button type="button" onClick={() => moveQuestion(index, 1)} disabled={index === questions.length - 1} aria-label="تحريك السؤال للأسفل" className="rounded-lg p-2 text-slate-400 disabled:opacity-25"><ArrowDown className="h-4 w-4" /></button><button type="button" onClick={() => setQuestions(current => current.filter(item => item.id !== question.id))} disabled={questions.length === 1} aria-label="حذف السؤال" className="rounded-lg p-2 text-rose-300 disabled:opacity-25"><Trash2 className="h-4 w-4" /></button></div></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
                      <label className="text-xs font-bold text-slate-300">نص السؤال<input value={question.prompt} onChange={event => updateQuestion(question.id, { prompt: event.target.value })} placeholder="اكتب السؤال هنا" className={inputClass} /></label>
                      <label className="text-xs font-bold text-slate-300">نوع الإجابة<select value={question.type} onChange={event => { const type = event.target.value as SurveyQuestionType; updateQuestion(question.id, { type, options: type === 'single_choice' || type === 'multiple_choice' ? (question.options.length >= 2 ? question.options : ['الخيار الأول', 'الخيار الثاني']) : [] }); }} className={inputClass}>{Object.entries(questionTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    </div>
                    {(question.type === 'single_choice' || question.type === 'multiple_choice') && <label className="mt-3 block text-xs font-bold text-slate-300">الخيارات — خيار في كل سطر<textarea value={question.options.join('\n')} onChange={event => updateQuestion(question.id, { options: event.target.value.split('\n') })} rows={3} className={inputClass} /></label>}
                    <label className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-300"><input type="checkbox" checked={question.required} onChange={event => updateQuestion(question.id, { required: event.target.checked })} className="h-4 w-4 accent-primary-500" />سؤال إلزامي</label>
                  </article>
                ))}
              </div>
              <button type="button" onClick={() => setQuestions(current => [...current, newQuestion('yes_no')])} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary-300/30 bg-primary-300/[0.04] px-4 py-3 text-sm font-bold text-primary-100"><Plus className="h-4 w-4" />إضافة سؤال</button>
            </section>
          </main>

          <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <section className={`${panelClass} p-5`}>
              <div className="flex items-center justify-between"><div><h2 className="font-black text-white">المستلمون</h2><p className="mt-1 text-xs text-slate-400">لكل مستلم رابط مستقل للإجابة.</p></div><span className="text-xl font-black text-primary-200">{selectedRecipients.size}</span></div>
              <div className="relative mt-4"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={recipientSearch} onChange={event => setRecipientSearch(event.target.value)} aria-label="البحث في المستلمين" placeholder="بحث بالاسم أو الجوال" className={`${inputClass} mt-0 pr-10`} /></div>
              <div className="mt-3 flex gap-2"><button type="button" onClick={() => setSelectedRecipients(new Set(recipients.map(recipient => recipient.id)))} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-slate-300">تحديد الكل</button><button type="button" onClick={() => setSelectedRecipients(new Set())} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-slate-400">إلغاء التحديد</button></div>
              <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pl-1">
                {filteredRecipients.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs leading-6 text-slate-500">لا توجد جهات مطابقة. أضف مستلماً يدوياً أو حدّث بيانات {audience === 'guardians' ? 'الطلاب' : 'المعلمين'}.</p> : filteredRecipients.map(recipient => {
                  const selected = selectedRecipients.has(recipient.id);
                  return <button type="button" key={recipient.id} onClick={() => setSelectedRecipients(current => { const next = new Set(current); if (selected) next.delete(recipient.id); else next.add(recipient.id); return next; })} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-right transition ${selected ? 'border-primary-300/30 bg-primary-300/[0.08]' : 'border-white/10 bg-white/[0.02]'}`}><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-primary-400 bg-primary-500 text-slate-950' : 'border-slate-600'}`}>{selected && <Check className="h-3.5 w-3.5" />}</span><span className="min-w-0"><strong className="block truncate text-xs text-white">{recipient.name}</strong><span className="mt-1 block truncate text-[10px] text-slate-400">{recipient.contact || 'لا يوجد جوال — الرابط قابل للنسخ'} · {recipient.detail}</span></span></button>;
                })}
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3"><p className="text-xs font-black text-white">إضافة مستلم يدوياً</p><label className="mt-3 block text-[10px] font-bold text-slate-400">الاسم<input value={manualName} onChange={event => setManualName(event.target.value)} className={`${inputClass} mt-1 py-2.5`} /></label><label className="mt-2 block text-[10px] font-bold text-slate-400">الجوال (اختياري)<input dir="ltr" inputMode="tel" value={manualContact} onChange={event => setManualContact(event.target.value)} className={`${inputClass} mt-1 py-2.5 text-right`} /></label><button type="button" onClick={addManualRecipient} className="mt-3 w-full rounded-lg border border-primary-300/20 px-3 py-2.5 text-xs font-bold text-primary-100">إضافة للقائمة</button></div>
            </section>
            <section className={`${panelClass} p-5`}><div className="flex items-start gap-3"><Eye className="mt-0.5 h-5 w-5 text-primary-200" /><div><h3 className="font-black text-white">قبل النشر</h3><p className="mt-1 text-xs leading-6 text-slate-400">يمكن تعديل المسودة فقط. بعد النشر تبقى الأسئلة ثابتة حفاظاً على اتساق النتائج.</p></div></div><div className="mt-5 grid gap-2"><button type="button" onClick={() => void handleSave(false)} disabled={busy !== null} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-200 disabled:opacity-40">{busy === 'save' ? 'جاري الحفظ...' : 'حفظ كمسودة'}</button><button type="button" onClick={() => void handleSave(true)} disabled={busy !== null} className="flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-40">{busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}نشر وإنشاء الروابط</button></div></section>
          </aside>
        </div>
      )}

      {view === 'details' && bundle && summary && (
        <div className="space-y-6">
          <section className={`${panelClass} overflow-hidden`}>
            <div className="border-b border-white/10 p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClasses[bundle.survey.status]}`}>{statusLabels[bundle.survey.status]}</span><span className="text-xs text-slate-500">{bundle.survey.audience === 'guardians' ? 'أولياء الأمور' : 'المعلمون'}</span></div><h2 className="mt-3 text-2xl font-black text-white">{bundle.survey.title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{bundle.survey.description || 'لا يوجد وصف لهذا الاستبيان.'}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void openDetails(bundle.survey.id)} disabled={busy !== null} aria-label="تحديث النتائج" className="rounded-xl border border-white/10 p-2.5 text-slate-300"><RefreshCw className={`h-4 w-4 ${busy?.startsWith('details:') ? 'animate-spin' : ''}`} /></button><button type="button" onClick={exportResponses} disabled={summary.responded === 0} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-slate-200 disabled:opacity-35"><Download className="h-4 w-4" />تصدير النتائج</button>{bundle.survey.status === 'published' && <button type="button" onClick={() => void handleClose()} disabled={busy !== null} className="flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-2.5 text-xs font-bold text-amber-100"><Archive className="h-4 w-4" />إغلاق الاستبيان</button>}</div></div></div>
            <div className="grid gap-px bg-white/10 sm:grid-cols-4">{[
              { label: 'الدعوات', value: summary.invited, icon: UsersRound },
              { label: 'الإجابات', value: summary.responded, icon: ClipboardCheck },
              { label: 'بانتظار الإجابة', value: summary.pending, icon: Clock3 },
              { label: 'نسبة المشاركة', value: `${summary.responseRate}%`, icon: BarChart3 }
            ].map(stat => <div key={stat.label} className="bg-slate-950/80 p-5"><stat.icon className="h-5 w-5 text-primary-300" /><div className="mt-4 text-2xl font-black text-white">{stat.value}</div><p className="mt-1 text-xs text-slate-400">{stat.label}</p></div>)}</div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <section className={`${panelClass} p-5 sm:p-6`}><div className="flex items-center justify-between"><div><h3 className="font-black text-white">تحليل الإجابات</h3><p className="mt-1 text-xs text-slate-400">تتحدث المؤشرات عند إعادة فتح هذا الاستبيان.</p></div><BarChart3 className="h-5 w-5 text-primary-200" /></div><div className="mt-6 space-y-5">{summary.questionResults.map((result, index) => <article key={result.question.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] font-bold text-primary-200">السؤال {index + 1}</span><h4 className="mt-1 text-sm font-black text-white">{result.question.prompt}</h4></div><span className="shrink-0 text-[10px] text-slate-500">{result.answered} إجابة</span></div>{result.question.type === 'text' ? <div className="mt-4 space-y-2">{result.textAnswers.length ? result.textAnswers.map((answer, answerIndex) => <p key={`${answer}-${answerIndex}`} className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-xs leading-6 text-slate-300">{answer}</p>) : <p className="py-4 text-center text-xs text-slate-500">لا توجد إجابات نصية بعد.</p>}</div> : <div className="mt-4 space-y-3">{result.average !== null && <div className="mb-4 flex items-center justify-between rounded-xl bg-primary-400/[0.07] p-3"><span className="text-xs text-primary-100">متوسط التقييم</span><strong className="text-xl text-white">{result.average}<span className="text-xs text-slate-400"> / 5</span></strong></div>}{result.values.map(value => <div key={value.label}><div className="mb-1.5 flex justify-between text-xs"><span className="text-slate-300">{value.label}</span><span className="text-slate-500">{value.count} · {value.percentage}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${value.percentage}%` }} /></div></div>)}</div>}</article>)}</div></section>

            <aside className={`${panelClass} self-start overflow-hidden xl:sticky xl:top-6`}><div className="border-b border-white/10 p-5"><div className="flex items-center justify-between"><div><h3 className="font-black text-white">التوزيع والمتابعة</h3><p className="mt-1 text-xs text-slate-400">إرسال الدعوات ومراجعة حالتها.</p></div><MessageCircle className="h-5 w-5 text-primary-200" /></div><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => void queueWhatsApp()} disabled={busy !== null || bundle.survey.status !== 'published'} className="flex items-center justify-center gap-2 rounded-xl bg-primary-500 px-3 py-3 text-xs font-black text-slate-950 disabled:opacity-35">{busy === 'whatsapp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}إرسال عبر واتساب</button><button type="button" onClick={exportInvitations} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-3 text-xs font-bold text-slate-200"><Download className="h-4 w-4" />تصدير الروابط</button></div></div><div className="max-h-[560px] divide-y divide-white/10 overflow-y-auto">{bundle.invitations.map(invitation => <div key={invitation.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><strong className="truncate text-xs text-white">{invitation.recipientName}</strong>{invitation.respondedAt ? <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold text-emerald-200">أجاب</span> : <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold text-amber-200">معلّق</span>}</div><p className="mt-1 truncate text-[10px] text-slate-500">{invitation.recipientContact || 'لا يوجد رقم جوال'} · {invitation.recipientDetail}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => void copyInvitation(invitation)} aria-label={`نسخ رابط ${invitation.recipientName}`} className="rounded-lg border border-white/10 p-2 text-slate-300"><Copy className="h-3.5 w-3.5" /></button>{invitation.recipientContact && <a href={`https://wa.me/${whatsappPhone(invitation.recipientContact)}?text=${encodeURIComponent(invitationMessage(bundle.survey, invitation))}`} target="_blank" rel="noreferrer" aria-label={`إرسال إلى ${invitation.recipientName}`} className="rounded-lg border border-primary-300/20 p-2 text-primary-200"><MessageCircle className="h-3.5 w-3.5" /></a>}</div></div></div>)}</div></aside>
          </div>

          {bundle.responses.length > 0 && <section className={`${panelClass} overflow-hidden`}><div className="border-b border-white/10 p-5"><h3 className="font-black text-white">سجل المشاركات</h3><p className="mt-1 text-xs text-slate-400">وقت الاستلام وهوية المستجيب حسب إعداد الخصوصية.</p></div><div className="overflow-x-auto"><table className="min-w-full text-right text-xs"><thead className="bg-white/[0.025] text-slate-400"><tr><th className="px-5 py-3 font-bold">المستجيب</th><th className="px-5 py-3 font-bold">وقت الإرسال</th><th className="px-5 py-3 font-bold">اكتمال الإجابة</th></tr></thead><tbody className="divide-y divide-white/10">{bundle.responses.map(response => <tr key={response.id}><td className="px-5 py-4 font-bold text-white">{response.respondentName ?? 'مجهول'}</td><td className="px-5 py-4 text-slate-400">{new Date(response.submittedAt).toLocaleString('ar-SA')}</td><td className="px-5 py-4 text-emerald-200">{response.answers.length} من {bundle.survey.questions.length}</td></tr>)}</tbody></table></div></section>}
        </div>
      )}
    </div>
  );
};

export default Surveys;
