import React, { useEffect, useState } from 'react';
import { Check, CheckCircle2, ClipboardList, Loader2, LockKeyhole, Send, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { SurveyAnswerValue, SurveyQuestion } from '../modules/surveys';
import { surveyService, type PublicSurvey as PublicSurveyData } from '../services/surveys';

const PublicSurvey: React.FC = () => {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicSurveyData | null>(null);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const requestedToken = token;
    setData(null);
    setError('');
    setAnswers({});
    setSubmitted(false);
    setLoading(true);
    surveyService.getPublic(requestedToken)
      .then(result => { if (active && requestedToken === token) setData(result); })
      .catch(loadError => { if (active) setError(loadError instanceof Error ? loadError.message : 'تعذر فتح الاستبيان'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const setAnswer = (questionId: string, value: SurveyAnswerValue) => {
    setAnswers(current => ({ ...current, [questionId]: value }));
    setError('');
  };

  const toggleMultiple = (questionId: string, option: string) => {
    const current = Array.isArray(answers[questionId]) ? answers[questionId] as readonly string[] : [];
    setAnswer(questionId, current.includes(option) ? current.filter(value => value !== option) : [...current, option]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data) return;
    setSubmitting(true);
    setError('');
    try {
      const payload = data.survey.questions.flatMap(question => {
        const value = answers[question.id];
        if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return [];
        return [{ questionId: question.id, value }];
      });
      await surveyService.submit(token, payload);
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'تعذر إرسال الإجابة');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <main className="flex min-h-[100dvh] items-center justify-center bg-[#061d20] px-5 text-slate-200" dir="rtl"><Loader2 className="ml-3 h-6 w-6 animate-spin text-primary-300" />جاري فتح الاستبيان...</main>;
  }

  if (error && !data) {
    return <StateCard icon={LockKeyhole} title="تعذر فتح الاستبيان" description={error} />;
  }

  if (!data) return null;
  const expired = Boolean(data.survey.closesAt && Date.now() > new Date(data.survey.closesAt).getTime());
  if (submitted || data.alreadyResponded) {
    return <StateCard icon={CheckCircle2} title={submitted ? 'وصلت إجابتك بنجاح' : 'سبق إرسال إجابتك'} description={submitted ? 'شكراً لمشاركتك. تم حفظ الإجابة ويمكنك الآن إغلاق هذه الصفحة.' : 'يقبل رابط الدعوة إجابة واحدة فقط حفاظاً على دقة النتائج.'} success />;
  }
  if (data.survey.status !== 'published' || expired) {
    return <StateCard icon={ClipboardList} title="الاستبيان مغلق" description="توقف هذا الاستبيان عن استقبال إجابات جديدة. نشكرك على اهتمامك." />;
  }

  return (
    <main className="min-h-[100dvh] bg-[#061d20] px-4 py-8 text-slate-100 sm:px-6 sm:py-12" dir="rtl">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true"><div className="absolute -right-40 -top-40 h-96 w-96 rounded-full bg-primary-500/10 blur-3xl" /><div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-secondary-500/10 blur-3xl" /></div>
      <div className="relative mx-auto max-w-2xl">
        <header className="mb-6 text-center">
          <img src="/images/hader-logo.png" alt="حاضر" className="mx-auto h-20 w-auto object-contain" />
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary-300/15 bg-primary-300/[0.06] px-3 py-1.5 text-xs font-bold text-primary-100"><ShieldCheck className="h-4 w-4" />استبيان مدرسي موثوق</div>
        </header>

        <section className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="border-b border-white/10 px-5 py-7 sm:px-8 sm:py-9">
            {!data.survey.anonymous && <p className="mb-3 text-xs font-bold text-primary-200">مرحباً {data.invitation.recipientName}</p>}
            <h1 className="text-2xl font-black leading-tight text-white sm:text-3xl">{data.survey.title}</h1>
            {data.survey.description && <p className="mt-3 text-sm leading-7 text-slate-400">{data.survey.description}</p>}
            <div className="mt-5 flex flex-wrap gap-3 text-[11px] text-slate-500"><span>{data.survey.questions.length} أسئلة</span><span>·</span><span>إجابة واحدة لكل دعوة</span>{data.survey.closesAt && <><span>·</span><span>متاح حتى {new Date(data.survey.closesAt).toLocaleString('ar-SA')}</span></>}</div>
          </div>

          <form onSubmit={submit} className="space-y-5 p-5 sm:p-8">
            {data.survey.questions.map((question, index) => (
              <QuestionField key={question.id} question={question} index={index} value={answers[question.id]} onChange={value => setAnswer(question.id, value)} onToggle={option => toggleMultiple(question.id, option)} />
            ))}

            {error && <div role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/[0.07] p-4 text-sm leading-6 text-rose-100">{error}</div>}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 py-4 text-sm font-black text-slate-950 shadow-lg shadow-primary-950/20 transition hover:bg-primary-400 disabled:cursor-wait disabled:opacity-60">{submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}{submitting ? 'جاري إرسال الإجابة...' : 'إرسال الإجابة'}</button>
            <p className="flex items-center justify-center gap-2 text-center text-[10px] leading-5 text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />تُستخدم إجابتك لأغراض التحسين المدرسي فقط.</p>
          </form>
        </section>
      </div>
    </main>
  );
};

const QuestionField: React.FC<{
  question: SurveyQuestion;
  index: number;
  value: SurveyAnswerValue | undefined;
  onChange: (value: SurveyAnswerValue) => void;
  onToggle: (option: string) => void;
}> = ({ question, index, value, onChange, onToggle }) => (
  <fieldset className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
    <legend className="sr-only">{question.prompt}</legend>
    <div className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-400/10 text-xs font-black text-primary-200">{index + 1}</span><div><h2 className="text-sm font-black leading-6 text-white">{question.prompt}</h2>{question.required && <span className="mt-1 block text-[10px] font-bold text-primary-300">مطلوب</span>}</div></div>
    <div className="mt-4">
      {question.type === 'text' && <textarea required={question.required} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} rows={4} placeholder="اكتب إجابتك هنا" className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-primary-400/50 focus:ring-2 focus:ring-primary-400/10" />}
      {question.type === 'rating' && <div className="grid grid-cols-5 gap-2" dir="ltr">{[1, 2, 3, 4, 5].map(rating => <button type="button" key={rating} onClick={() => onChange(rating)} className={`rounded-xl border py-3 text-sm font-black transition ${value === rating ? 'border-primary-400 bg-primary-500 text-slate-950' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-primary-300/30'}`} aria-label={`تقييم ${rating} من 5`}>{rating}</button>)}</div>}
      {question.type === 'yes_no' && <div className="grid grid-cols-2 gap-3">{[{ label: 'نعم', answer: true }, { label: 'لا', answer: false }].map(option => <button type="button" key={option.label} onClick={() => onChange(option.answer)} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition ${value === option.answer ? 'border-primary-400 bg-primary-500 text-slate-950' : 'border-white/10 bg-white/[0.03] text-slate-300'}`}>{value === option.answer && <Check className="h-4 w-4" />}{option.label}</button>)}</div>}
      {question.type === 'single_choice' && <div className="space-y-2">{question.options.map(option => <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ${value === option ? 'border-primary-400/50 bg-primary-400/[0.09] text-white' : 'border-white/10 bg-white/[0.02] text-slate-300'}`}><input type="radio" name={question.id} value={option} checked={value === option} onChange={() => onChange(option)} required={question.required} className="h-4 w-4 accent-primary-500" />{option}</label>)}</div>}
      {question.type === 'multiple_choice' && <div className="space-y-2">{question.options.map(option => { const checked = Array.isArray(value) && value.includes(option); return <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ${checked ? 'border-primary-400/50 bg-primary-400/[0.09] text-white' : 'border-white/10 bg-white/[0.02] text-slate-300'}`}><input type="checkbox" checked={checked} onChange={() => onToggle(option)} className="h-4 w-4 accent-primary-500" />{option}</label>; })}</div>}
    </div>
  </fieldset>
);

const StateCard: React.FC<{
  icon: typeof CheckCircle2;
  title: string;
  description: string;
  success?: boolean;
}> = ({ icon: Icon, title, description, success = false }) => (
  <main className="flex min-h-[100dvh] items-center justify-center bg-[#061d20] px-5 py-10 text-center" dir="rtl">
    <section className="w-full max-w-md rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-8 shadow-2xl backdrop-blur-xl">
      <img src="/images/hader-logo.png" alt="حاضر" className="mx-auto h-20 w-auto" />
      <div className={`mx-auto mt-7 flex h-14 w-14 items-center justify-center rounded-2xl ${success ? 'bg-emerald-400/10 text-emerald-200' : 'bg-primary-400/10 text-primary-200'}`}><Icon className="h-7 w-7" /></div>
      <h1 className="mt-5 text-2xl font-black text-white">{title}</h1>
      <p className="mt-3 text-sm leading-7 text-slate-400">{description}</p>
    </section>
  </main>
);

export default PublicSurvey;
