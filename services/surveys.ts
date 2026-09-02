import { supabase, supabaseStatus } from './supabase';
import { secureSessionStorage } from './secureStorage';
import {
  createSurveyResponse,
  publishSurvey as publishSurveyDomain,
  type Survey,
  type SurveyAnswer,
  type SurveyInvitation,
  type SurveyRecipient,
  type SurveyResponse
} from '../modules/surveys';

const STORAGE_KEY = 'hader:surveys:v1';
const DRAFT_TARGETS_KEY = 'hader:survey-draft-targets:v1';

type SurveyStore = Readonly<{
  surveys: readonly Survey[];
  invitations: readonly SurveyInvitation[];
  responses: readonly SurveyResponse[];
}>;

export type SurveyBundle = Readonly<{
  survey: Survey;
  invitations: readonly SurveyInvitation[];
  responses: readonly SurveyResponse[];
}>;

export type PublicSurvey = Readonly<{
  survey: Survey;
  invitation: SurveyInvitation;
  alreadyResponded: boolean;
}>;

export type SurveyService = Readonly<{
  storageMode: 'cloud' | 'local';
  list(): Promise<readonly Survey[]>;
  saveDraft(survey: Survey, recipients?: readonly SurveyRecipient[]): Promise<Survey>;
  draftRecipients(surveyId: string): readonly SurveyRecipient[] | null;
  publish(surveyId: string, recipients: readonly SurveyRecipient[]): Promise<SurveyBundle>;
  close(surveyId: string): Promise<Survey>;
  remove(surveyId: string): Promise<void>;
  bundle(surveyId: string): Promise<SurveyBundle>;
  getPublic(token: string): Promise<PublicSurvey>;
  submit(token: string, answers: readonly SurveyAnswer[]): Promise<SurveyResponse>;
}>;

const emptyStore = (): SurveyStore => ({ surveys: [], invitations: [], responses: [] });

const readStore = (storage: Pick<Storage, 'getItem'>): SurveyStore => {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null') as Partial<SurveyStore> | null;
    if (!parsed) return emptyStore();
    return {
      surveys: Array.isArray(parsed.surveys) ? parsed.surveys : [],
      invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [],
      responses: Array.isArray(parsed.responses) ? parsed.responses : []
    };
  } catch {
    return emptyStore();
  }
};

const writeStore = (storage: Pick<Storage, 'setItem'>, store: SurveyStore): void => {
  storage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const readDraftTargets = (storage: Pick<Storage, 'getItem'>): Record<string, readonly SurveyRecipient[]> => {
  try {
    const parsed = JSON.parse(storage.getItem(DRAFT_TARGETS_KEY) || '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([surveyId, value]) => [surveyId, Array.isArray(value) ? value : []]));
  } catch {
    return {};
  }
};

const writeDraftTargets = (storage: Pick<Storage, 'setItem'>, targets: Record<string, readonly SurveyRecipient[]>): void => {
  storage.setItem(DRAFT_TARGETS_KEY, JSON.stringify(targets));
};

const toSurvey = (row: any): Survey => Object.freeze({
  id: String(row.id),
  title: String(row.title ?? ''),
  description: String(row.description ?? ''),
  audience: row.audience === 'teachers' ? 'teachers' : 'guardians',
  status: row.status === 'published' || row.status === 'closed' ? row.status : 'draft',
  anonymous: row.anonymous === true,
  closesAt: row.closes_at ?? row.closesAt ?? null,
  questions: Object.freeze(Array.isArray(row.questions) ? row.questions : []),
  createdBy: String(row.created_by ?? row.createdBy ?? ''),
  createdAt: String(row.created_at ?? row.createdAt ?? ''),
  updatedAt: String(row.updated_at ?? row.updatedAt ?? ''),
  publishedAt: row.published_at ?? row.publishedAt ?? null
});

const toInvitation = (row: any): SurveyInvitation => Object.freeze({
  id: String(row.id),
  surveyId: String(row.survey_id ?? row.surveyId),
  token: String(row.token),
  recipientId: String(row.recipient_id ?? row.recipientId),
  recipientName: String(row.recipient_name ?? row.recipientName ?? 'مستلم'),
  recipientContact: String(row.recipient_contact ?? row.recipientContact ?? ''),
  recipientDetail: String(row.recipient_detail ?? row.recipientDetail ?? ''),
  respondedAt: row.responded_at ?? row.respondedAt ?? null,
  createdAt: String(row.created_at ?? row.createdAt ?? '')
});

const toResponse = (row: any): SurveyResponse => Object.freeze({
  id: String(row.id),
  surveyId: String(row.survey_id ?? row.surveyId),
  invitationId: String(row.invitation_id ?? row.invitationId),
  respondentName: row.respondent_name ?? row.respondentName ?? null,
  answers: Object.freeze(Array.isArray(row.answers) ? row.answers : []),
  submittedAt: String(row.submitted_at ?? row.submittedAt ?? '')
});

const surveyRow = (survey: Survey) => ({
  id: survey.id,
  title: survey.title,
  description: survey.description,
  audience: survey.audience,
  status: survey.status,
  anonymous: survey.anonymous,
  closes_at: survey.closesAt,
  questions: survey.questions,
  created_by: survey.createdBy,
  created_at: survey.createdAt,
  updated_at: survey.updatedAt,
  published_at: survey.publishedAt
});

const invitationRow = (invitation: SurveyInvitation) => ({
  id: invitation.id,
  survey_id: invitation.surveyId,
  token: invitation.token,
  recipient_id: invitation.recipientId,
  recipient_name: invitation.recipientName,
  recipient_contact: invitation.recipientContact,
  recipient_detail: invitation.recipientDetail,
  responded_at: invitation.respondedAt,
  created_at: invitation.createdAt
});

const protectAnonymousBundle = (value: SurveyBundle): SurveyBundle => {
  if (!value.survey.anonymous) return value;
  return Object.freeze({
    survey: value.survey,
    invitations: Object.freeze(value.invitations.map(invitation => Object.freeze({
      ...invitation,
      respondedAt: invitation.respondedAt ? '1970-01-01T00:00:00.000Z' : null
    }))),
    responses: Object.freeze(value.responses.map(response => Object.freeze({
      ...response,
      invitationId: '',
      respondentName: null,
      submittedAt: `${response.submittedAt.slice(0, 10)}T00:00:00.000Z`
    })))
  });
};

const throwDataError = (error: any, action: string): never => {
  const missingSchema = error?.code === '42P01' || /does not exist|schema cache/i.test(String(error?.message));
  throw new Error(missingSchema
    ? 'قاعدة البيانات غير مهيأة للاستبيانات. طبّق ترحيل Supabase الجديد ثم أعد المحاولة.'
    : `تعذر ${action}: ${String(error?.message || 'خطأ غير معروف')}`);
};

const getSurveyAdminToken = (): string => {
  const token = secureSessionStorage.get()?.surveyAdminToken;
  if (!token) {
    throw new Error('جلسة إدارة الاستبيانات غير متاحة. بعد تطبيق ترحيل Supabase، سجّل الخروج ثم ادخل مجدداً.');
  }
  return token;
};

export const createSurveyService = (options: Readonly<{
  storage?: Storage;
  useCloud?: boolean;
  allowLocalPublishing?: boolean;
}> = {}): SurveyService => {
  const storage = options.storage ?? globalThis.localStorage;
  const useCloud = options.useCloud ?? supabaseStatus.isConfigured;
  const allowLocalPublishing = options.allowLocalPublishing ?? false;

  const list = async (): Promise<readonly Survey[]> => {
    if (!useCloud) {
      return [...readStore(storage).surveys].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const { data, error } = await supabase.rpc('list_hader_surveys', { p_session_token: getSurveyAdminToken() });
    if (error) throwDataError(error, 'تحميل الاستبيانات');
    return Object.freeze((data ?? []).map(toSurvey));
  };

  const bundle = async (surveyId: string): Promise<SurveyBundle> => {
    if (!useCloud) {
      const store = readStore(storage);
      const survey = store.surveys.find(candidate => candidate.id === surveyId);
      if (!survey) throw new Error('الاستبيان غير موجود');
      return protectAnonymousBundle(Object.freeze({
        survey,
        invitations: Object.freeze(store.invitations.filter(item => item.surveyId === surveyId)),
        responses: Object.freeze(store.responses.filter(item => item.surveyId === surveyId))
      }));
    }
    const { data, error } = await supabase.rpc('get_hader_survey_bundle', {
      p_session_token: getSurveyAdminToken(),
      p_survey_id: surveyId
    });
    if (error) throwDataError(error, 'تحميل الاستبيان ونتائجه');
    if (!data?.survey) throw new Error('الاستبيان غير موجود');
    return protectAnonymousBundle(Object.freeze({
      survey: toSurvey(data.survey),
      invitations: Object.freeze((data.invitations ?? []).map(toInvitation)),
      responses: Object.freeze((data.responses ?? []).map(toResponse))
    }));
  };

  return Object.freeze({
    storageMode: useCloud ? 'cloud' : 'local',
    list,
    async saveDraft(survey, recipients) {
      if (survey.status !== 'draft') throw new Error('لا يمكن تعديل استبيان منشور');
      if (recipients) {
        writeDraftTargets(storage, { ...readDraftTargets(storage), [survey.id]: recipients });
      }
      if (!useCloud) {
        const store = readStore(storage);
        const surveys = [...store.surveys.filter(candidate => candidate.id !== survey.id), survey];
        writeStore(storage, { ...store, surveys });
        return survey;
      }
      const { data, error } = await supabase.rpc('save_hader_survey_draft', {
        p_session_token: getSurveyAdminToken(),
        p_survey: surveyRow(survey)
      });
      if (error) throwDataError(error, 'حفظ المسودة');
      return toSurvey(data);
    },
    draftRecipients(surveyId) {
      const targets = readDraftTargets(storage);
      return Object.prototype.hasOwnProperty.call(targets, surveyId)
        ? Object.freeze([...(targets[surveyId] ?? [])])
        : null;
    },
    async publish(surveyId, recipients) {
      if (!useCloud && !allowLocalPublishing) {
        throw new Error('يتطلب نشر الاستبيان تخزين Supabase مشتركاً حتى تعمل الروابط على أجهزة المستلمين');
      }
      const current = await bundle(surveyId);
      const published = publishSurveyDomain(current.survey, recipients);
      if (!useCloud) {
        const store = readStore(storage);
        writeStore(storage, {
          surveys: [...store.surveys.filter(candidate => candidate.id !== surveyId), published.survey],
          invitations: [...store.invitations.filter(item => item.surveyId !== surveyId), ...published.invitations],
          responses: store.responses
        });
        const draftTargets = readDraftTargets(storage);
        delete draftTargets[surveyId];
        writeDraftTargets(storage, draftTargets);
        return Object.freeze({ ...published, responses: [] });
      }
      const { error } = await supabase.rpc('publish_hader_survey', {
        p_session_token: getSurveyAdminToken(),
        p_survey_id: surveyId,
        p_invitations: published.invitations.map(invitationRow),
        p_published_at: published.survey.publishedAt
      });
      if (error) throwDataError(error, 'نشر الاستبيان');
      const draftTargets = readDraftTargets(storage);
      delete draftTargets[surveyId];
      writeDraftTargets(storage, draftTargets);
      return bundle(surveyId);
    },
    async close(surveyId) {
      const updatedAt = new Date().toISOString();
      if (!useCloud) {
        const store = readStore(storage);
        const survey = store.surveys.find(candidate => candidate.id === surveyId);
        if (!survey) throw new Error('الاستبيان غير موجود');
        const closed = Object.freeze({ ...survey, status: 'closed' as const, updatedAt });
        writeStore(storage, { ...store, surveys: [...store.surveys.filter(candidate => candidate.id !== surveyId), closed] });
        return closed;
      }
      const { data, error } = await supabase.rpc('close_hader_survey', {
        p_session_token: getSurveyAdminToken(),
        p_survey_id: surveyId,
        p_updated_at: updatedAt
      });
      if (error) throwDataError(error, 'إغلاق الاستبيان');
      return toSurvey(data);
    },
    async remove(surveyId) {
      if (!useCloud) {
        const store = readStore(storage);
        writeStore(storage, {
          surveys: store.surveys.filter(candidate => candidate.id !== surveyId),
          invitations: store.invitations.filter(item => item.surveyId !== surveyId),
          responses: store.responses.filter(item => item.surveyId !== surveyId)
        });
        const draftTargets = readDraftTargets(storage);
        delete draftTargets[surveyId];
        writeDraftTargets(storage, draftTargets);
        return;
      }
      const { error } = await supabase.rpc('delete_hader_survey_draft', {
        p_session_token: getSurveyAdminToken(),
        p_survey_id: surveyId
      });
      if (error) throwDataError(error, 'حذف الاستبيان');
      const draftTargets = readDraftTargets(storage);
      delete draftTargets[surveyId];
      writeDraftTargets(storage, draftTargets);
    },
    bundle,
    async getPublic(token) {
      if (!useCloud) {
        const store = readStore(storage);
        const invitation = store.invitations.find(candidate => candidate.token === token);
        if (!invitation) throw new Error('رابط الاستبيان غير صالح أو منتهي');
        const survey = store.surveys.find(candidate => candidate.id === invitation.surveyId);
        if (!survey) throw new Error('الاستبيان غير موجود');
        return Object.freeze({ survey, invitation, alreadyResponded: Boolean(invitation.respondedAt) });
      }
      const { data, error } = await supabase.rpc('get_public_hader_survey', { p_token: token });
      if (error) throwDataError(error, 'فتح الاستبيان');
      if (!data?.survey || !data?.invitation) throw new Error('رابط الاستبيان غير صالح أو منتهي');
      const invitation = toInvitation(data.invitation);
      return Object.freeze({ survey: toSurvey(data.survey), invitation, alreadyResponded: Boolean(invitation.respondedAt) });
    },
    async submit(token, answers) {
      if (!useCloud) {
        const store = readStore(storage);
        const invitation = store.invitations.find(candidate => candidate.token === token);
        if (!invitation) throw new Error('رابط الاستبيان غير صالح أو منتهي');
        const survey = store.surveys.find(candidate => candidate.id === invitation.surveyId);
        if (!survey) throw new Error('الاستبيان غير موجود');
        const existing = store.responses.find(candidate => candidate.invitationId === invitation.id) ?? null;
        const submitted = createSurveyResponse(survey, invitation, answers, existing);
        writeStore(storage, {
          surveys: store.surveys,
          invitations: store.invitations.map(item => item.id === invitation.id ? submitted.invitation : item),
          responses: [...store.responses, submitted.response]
        });
        return submitted.response;
      }
      const { data, error } = await supabase.rpc('submit_hader_survey_response', {
        p_token: token,
        p_answers: answers
      });
      if (error) throwDataError(error, 'إرسال الإجابة');
      return toResponse(data);
    }
  });
};

export const surveyService = createSurveyService();
