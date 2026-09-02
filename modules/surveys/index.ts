import type { Student } from '../../types';
import type { StaffTeacher } from '../staffOperations';

export type SurveyAudience = 'guardians' | 'teachers';
export type SurveyStatus = 'draft' | 'published' | 'closed';
export type SurveyQuestionType = 'single_choice' | 'multiple_choice' | 'rating' | 'yes_no' | 'text';
export type SurveyAnswerValue = string | readonly string[] | number | boolean;

export type SurveyQuestion = Readonly<{
  id: string;
  prompt: string;
  type: SurveyQuestionType;
  required: boolean;
  options: readonly string[];
}>;

export type SurveyRecipient = Readonly<{
  id: string;
  name: string;
  contact: string;
  detail?: string;
}>;

export type Survey = Readonly<{
  id: string;
  title: string;
  description: string;
  audience: SurveyAudience;
  status: SurveyStatus;
  anonymous: boolean;
  closesAt: string | null;
  questions: readonly SurveyQuestion[];
  draftRecipients: readonly SurveyRecipient[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}>;

export type SurveyInvitation = Readonly<{
  id: string;
  surveyId: string;
  token: string;
  recipientId: string;
  recipientName: string;
  recipientContact: string;
  recipientDetail: string;
  queuedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
}>;

export type SurveyAnswer = Readonly<{
  questionId: string;
  value: SurveyAnswerValue;
}>;

export type SurveyResponse = Readonly<{
  id: string;
  surveyId: string;
  invitationId: string;
  respondentName: string | null;
  answers: readonly SurveyAnswer[];
  submittedAt: string;
}>;

export type SurveySummary = Readonly<{
  invited: number;
  responded: number;
  pending: number;
  responseRate: number;
  questionResults: readonly Readonly<{
    question: SurveyQuestion;
    answered: number;
    values: readonly Readonly<{ label: string; count: number; percentage: number }>[];
    textAnswers: readonly string[];
    average: number | null;
  }>[];
}>;

type DomainEnvironment = Readonly<{
  now?: () => Date;
  createId?: () => string;
  createToken?: () => string;
}>;

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();
const normalizeContact = (value: string): string => value.replace(/[^\d+]/g, '').trim();
const defaultId = (): string => crypto.randomUUID();

const assertSurveyQuestions = (questions: readonly SurveyQuestion[]): void => {
  if (questions.length === 0) throw new Error('أضف سؤالاً واحداً على الأقل');
  if (questions.length > 100) throw new Error('الحد الأقصى لأسئلة الاستبيان هو 100 سؤال');
  questions.forEach((question, index) => {
    const prompt = normalizeText(question.prompt);
    if (!prompt) throw new Error(`نص السؤال ${index + 1} مطلوب`);
    if (prompt.length > 500) throw new Error(`نص السؤال ${index + 1} يتجاوز الحد المسموح`);
    if (['single_choice', 'multiple_choice'].includes(question.type)) {
      const options = question.options.map(normalizeText).filter(Boolean);
      if (options.length < 2) throw new Error(`السؤال ${index + 1} يحتاج خيارين على الأقل`);
      if (options.length > 50 || options.some(option => option.length > 200)) throw new Error(`خيارات السؤال ${index + 1} تتجاوز الحد المسموح`);
      if (new Set(options.map(option => option.toLocaleLowerCase('ar'))).size !== options.length) {
        throw new Error(`خيارات السؤال ${index + 1} يجب ألا تتكرر`);
      }
    }
  });
};

export const createSurveyDraft = (
  input: Readonly<{
    id?: string;
    title: string;
    description?: string;
    audience: SurveyAudience;
    anonymous?: boolean;
    closesAt?: string | null;
    questions: readonly SurveyQuestion[];
    draftRecipients?: readonly SurveyRecipient[];
    createdBy: string;
  }>,
  environment: DomainEnvironment = {}
): Survey => {
  const title = normalizeText(input.title);
  if (!title) throw new Error('عنوان الاستبيان مطلوب');
  if (title.length > 200) throw new Error('عنوان الاستبيان يتجاوز الحد المسموح');
  if ((input.description ?? '').length > 4000) throw new Error('وصف الاستبيان يتجاوز الحد المسموح');
  if (!normalizeText(input.createdBy)) throw new Error('تعذر تحديد منشئ الاستبيان');
  assertSurveyQuestions(input.questions);
  const now = (environment.now ?? (() => new Date()))().toISOString();
  const createId = environment.createId ?? defaultId;
  const questions = input.questions.map(question => Object.freeze({
    ...question,
    id: question.id.trim() || createId(),
    prompt: normalizeText(question.prompt),
    options: Object.freeze(question.options.map(normalizeText).filter(Boolean))
  }));
  const closesAt = input.closesAt?.trim() || null;
  if (closesAt && Number.isNaN(new Date(closesAt).getTime())) throw new Error('موعد إغلاق الاستبيان غير صالح');

  return Object.freeze({
    id: input.id?.trim() || createId(),
    title,
    description: normalizeText(input.description ?? ''),
    audience: input.audience,
    status: 'draft',
    anonymous: input.anonymous ?? false,
    closesAt,
    questions: Object.freeze(questions),
    draftRecipients: Object.freeze([...(input.draftRecipients ?? [])]),
    createdBy: input.createdBy.trim(),
    createdAt: now,
    updatedAt: now,
    publishedAt: null
  });
};

export const publishSurvey = (
  survey: Survey,
  recipients: readonly SurveyRecipient[],
  environment: DomainEnvironment = {}
): Readonly<{ survey: Survey; invitations: readonly SurveyInvitation[] }> => {
  if (survey.status !== 'draft') throw new Error('يمكن نشر المسودات فقط');
  assertSurveyQuestions(survey.questions);
  if (recipients.length === 0) throw new Error('حدد مستلماً واحداً على الأقل');
  const now = (environment.now ?? (() => new Date()))().toISOString();
  const createId = environment.createId ?? defaultId;
  const createToken = environment.createToken ?? defaultId;
  const seen = new Set<string>();
  const uniqueRecipients = recipients.filter(recipient => {
    const key = `${recipient.id.trim()}|${normalizeContact(recipient.contact)}`;
    if (!recipient.id.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (uniqueRecipients.length === 0) throw new Error('بيانات المستلمين غير صالحة');
  if (survey.closesAt && new Date(survey.closesAt).getTime() <= new Date(now).getTime()) {
    throw new Error('موعد إغلاق الاستبيان يجب أن يكون في المستقبل');
  }

  return Object.freeze({
    survey: Object.freeze({ ...survey, status: 'published', draftRecipients: Object.freeze([]), publishedAt: now, updatedAt: now }),
    invitations: Object.freeze(uniqueRecipients.map(recipient => Object.freeze({
      id: createId(),
      surveyId: survey.id,
      token: createToken(),
      recipientId: recipient.id.trim(),
      recipientName: normalizeText(recipient.name) || 'مستلم',
      recipientContact: normalizeContact(recipient.contact),
      recipientDetail: normalizeText(recipient.detail ?? ''),
      queuedAt: null,
      respondedAt: null,
      createdAt: now
    })))
  });
};

export const isSurveyOpen = (survey: Survey, now: Date = new Date()): boolean => (
  survey.status === 'published'
  && (!survey.closesAt || new Date(survey.closesAt).getTime() > now.getTime())
);

const hasAnswer = (answer: SurveyAnswer | undefined): boolean => {
  if (!answer) return false;
  if (Array.isArray(answer.value)) return answer.value.length > 0;
  return typeof answer.value === 'string' ? Boolean(answer.value.trim()) : answer.value !== null && answer.value !== undefined;
};

export const createSurveyResponse = (
  survey: Survey,
  invitation: SurveyInvitation,
  answers: readonly SurveyAnswer[],
  existingResponse: SurveyResponse | null,
  environment: DomainEnvironment = {}
): Readonly<{ response: SurveyResponse; invitation: SurveyInvitation }> => {
  const nowDate = (environment.now ?? (() => new Date()))();
  if (survey.status !== 'published') throw new Error('هذا الاستبيان غير متاح لاستقبال الإجابات');
  if (survey.closesAt && nowDate.getTime() >= new Date(survey.closesAt).getTime()) throw new Error('انتهت مدة الاستبيان');
  if (invitation.surveyId !== survey.id) throw new Error('رابط الاستبيان غير صالح');
  if (invitation.respondedAt || existingResponse) throw new Error('تم إرسال الإجابة مسبقاً');
  const questionIds = new Set(survey.questions.map(question => question.id));
  if (answers.some(answer => !questionIds.has(answer.questionId))) throw new Error('تحتوي الإجابة سؤالاً غير صالح');
  if (answers.length > survey.questions.length) throw new Error('عدد الإجابات يتجاوز عدد الأسئلة');
  const duplicateIds = answers.map(answer => answer.questionId);
  if (new Set(duplicateIds).size !== duplicateIds.length) throw new Error('توجد إجابة مكررة للسؤال نفسه');
  for (const question of survey.questions) {
    const answer = answers.find(candidate => candidate.questionId === question.id);
    if (question.required && !hasAnswer(answer)) throw new Error(`السؤال «${question.prompt}» مطلوب`);
    if (!answer) continue;
    if (question.type === 'rating' && (typeof answer.value !== 'number' || !Number.isInteger(answer.value) || answer.value < 1 || answer.value > 5)) {
      throw new Error(`تقييم السؤال «${question.prompt}» يجب أن يكون بين 1 و5`);
    }
    if (question.type === 'single_choice' && (typeof answer.value !== 'string' || !question.options.includes(answer.value))) {
      throw new Error(`إجابة السؤال «${question.prompt}» غير صالحة`);
    }
    if (question.type === 'multiple_choice' && (!Array.isArray(answer.value) || answer.value.some(value => !question.options.includes(value)))) {
      throw new Error(`إجابة السؤال «${question.prompt}» غير صالحة`);
    }
    if (question.type === 'multiple_choice' && Array.isArray(answer.value) && (
      answer.value.length > question.options.length || new Set(answer.value).size !== answer.value.length
    )) {
      throw new Error(`إجابة السؤال «${question.prompt}» تحتوي اختيارات مكررة`);
    }
    if (question.type === 'yes_no' && typeof answer.value !== 'boolean') {
      throw new Error(`إجابة السؤال «${question.prompt}» غير صالحة`);
    }
    if (question.type === 'text' && (typeof answer.value !== 'string' || answer.value.length > 4000)) {
      throw new Error(`إجابة السؤال «${question.prompt}» طويلة أو غير صالحة`);
    }
  }
  const submittedAt = nowDate.toISOString();
  const createId = environment.createId ?? defaultId;
  return Object.freeze({
    response: Object.freeze({
      id: createId(),
      surveyId: survey.id,
      invitationId: invitation.id,
      respondentName: survey.anonymous ? null : invitation.recipientName,
      answers: Object.freeze(answers.map(answer => Object.freeze({ ...answer }))),
      submittedAt
    }),
    invitation: Object.freeze({ ...invitation, respondedAt: submittedAt })
  });
};

export const summarizeSurvey = (
  survey: Survey,
  invitations: readonly SurveyInvitation[],
  responses: readonly SurveyResponse[]
): SurveySummary => {
  const surveyInvitations = invitations.filter(invitation => invitation.surveyId === survey.id);
  const surveyResponses = responses.filter(response => response.surveyId === survey.id);
  const invited = surveyInvitations.length;
  const responded = surveyResponses.length;
  return Object.freeze({
    invited,
    responded,
    pending: Math.max(0, invited - responded),
    responseRate: invited === 0 ? 0 : Math.round((responded / invited) * 100),
    questionResults: Object.freeze(survey.questions.map(question => {
      const rawValues = surveyResponses
        .map(response => response.answers.find(answer => answer.questionId === question.id)?.value)
        .filter((value): value is SurveyAnswerValue => value !== undefined);
      const flatValues = rawValues.flatMap(value => Array.isArray(value) ? [...value] : [value]);
      const labels = question.type === 'rating'
        ? ['1', '2', '3', '4', '5']
        : question.type === 'yes_no'
          ? ['نعم', 'لا']
          : [...question.options];
      const normalizedValues = flatValues.map(value => typeof value === 'boolean' ? (value ? 'نعم' : 'لا') : String(value));
      const percentageBase = question.type === 'multiple_choice' ? rawValues.length : flatValues.length;
      const values = labels.map(label => {
        const count = normalizedValues.filter(value => value === label).length;
        return Object.freeze({ label, count, percentage: percentageBase === 0 ? 0 : Math.round((count / percentageBase) * 100) });
      });
      const numeric = rawValues.filter((value): value is number => typeof value === 'number');
      return Object.freeze({
        question,
        answered: rawValues.length,
        values: Object.freeze(values),
        textAnswers: Object.freeze(question.type === 'text' ? rawValues.map(String).filter(Boolean) : []),
        average: numeric.length === 0 ? null : Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(1))
      });
    }))
  });
};

export const buildSurveyRecipients = (
  audience: SurveyAudience,
  students: readonly Student[],
  teachers: readonly StaffTeacher[]
): readonly SurveyRecipient[] => {
  if (audience === 'teachers') {
    return Object.freeze(teachers
      .filter(teacher => teacher.isActive)
      .map(teacher => Object.freeze({
        id: teacher.id,
        name: teacher.name,
        contact: teacher.phone ?? '',
        detail: teacher.specialty
      })));
  }
  const guardians = new Map<string, SurveyRecipient>();
  students.filter(student => student.is_active !== false).forEach(student => {
    const contact = normalizeContact(student.guardian_phone || student.parent_phone || student.whatsapp_phone || '');
    const key = contact || `student:${student.id}`;
    const existing = guardians.get(key);
    const studentDetail = `${student.name} — ${student.class_name}/${student.section}`;
    guardians.set(key, Object.freeze({
      id: existing?.id ?? key,
      name: existing?.name ?? (normalizeText(student.guardian_name || '') || `ولي أمر ${student.name}`),
      contact,
      detail: existing?.detail ? `${existing.detail}، ${studentDetail}` : studentDetail
    }));
  });
  return Object.freeze([...guardians.values()]);
};
