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
  publish(surveyId: string, recipients: readonly SurveyRecipient[]): Promise<SurveyBundle>;
  markQueued(invitationIds: readonly string[]): Promise<void>;
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

const toSurvey = (row: any): Survey => Object.freeze({
  id: String(row.id),
  title: String(row.title ?? ''),
  description: String(row.description ?? ''),
  audience: row.audience === 'teachers' ? 'teachers' : 'guardians',
  status: row.status === 'published' || row.status === 'closed' ? row.status : 'draft',
  anonymous: row.anonymous === true,
  closesAt: row.closes_at ?? row.closesAt ?? null,
  questions: Object.freeze(Array.isArray(row.questions) ? row.questions : []),
  draftRecipients: Object.freeze(Array.isArray(row.draft_recipients ?? row.draftRecipients) ? (row.draft_recipients ?? row.draftRecipients) : []),
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
  queuedAt: row.queued_at ?? row.queuedAt ?? null,
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
  draft_recipients: survey.draftRecipients,
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
  queued_at: invitation.queuedAt,
  responded_at: invitation.respondedAt,
  created_at: invitation.createdAt
});

const protectAnonymousBundle = (value: SurveyBundle): SurveyBundle => {
  if (!value.survey.anonymous) return value;
  return Object.freeze({
    survey: value.survey,
    invitations: Object.freeze(value.invitations.map(invitation => Object.freeze({
      ...invitation,
      respondedAt: null
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
  const session = secureSessionStorage.get();
  const token = session?.surveyAdminToken;
  if (session?.surveyAdminExpiresAt && session.surveyAdminExpiresAt <= Date.now()) {
    throw new Error('انتهت جلسة إدارة الاستبيانات. سجّل الخروج ثم ادخل مجدداً.');
  }
  if (!token) {
    throw new Error('جلسة إدارة الاستبيانات غير متاحة. بعد تطبيق ترحيل Supabase، سجّل الخروج ثم ادخل مجدداً.');
  }
  return token;
};

export const hasSurveyAdminAccess = (): boolean => {
  if (!supabaseStatus.isConfigured) return true;
  const session = secureSessionStorage.get();
  return Boolean(session?.surveyAdminToken && (!session.surveyAdminExpiresAt || session.surveyAdminExpiresAt > Date.now()));
};

export const saveManagedCloudUser = async (user: Readonly<Record<string, unknown>>): Promise<Record<string, any>> => {
  if (!supabaseStatus.isConfigured) throw new Error('الاتصال السحابي غير مهيأ');
  const { data, error } = await supabase.rpc('save_hader_user', {
    p_session_token: getSurveyAdminToken(),
    p_user: user
  });
  if (error || !data) throwDataError(error, 'حفظ المستخدم');
  return data as Record<string, any>;
};

export const deleteManagedCloudUser = async (userId: string): Promise<void> => {
  if (!supabaseStatus.isConfigured) throw new Error('الاتصال السحابي غير مهيأ');
  const { error } = await supabase.rpc('delete_hader_user', {
    p_session_token: getSurveyAdminToken(),
    p_user_id: userId
  });
  if (error) throwDataError(error, 'حذف المستخدم');
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
      return readStore(storage).surveys.map(toSurvey).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const { data, error } = await supabase.rpc('list_hader_surveys', { p_session_token: getSurveyAdminToken() });
    if (error) throwDataError(error, 'تحميل الاستبيانات');
    return Object.freeze((data ?? []).map(toSurvey));
  };

  const bundle = async (surveyId: string): Promise<SurveyBundle> => {
    if (!useCloud) {
      const store = readStore(storage);
      const rawSurvey = store.surveys.find(candidate => candidate.id === surveyId);
      const survey = rawSurvey ? toSurvey(rawSurvey) : undefined;
      if (!survey) throw new Error('الاستبيان غير موجود');
      return protectAnonymousBundle(Object.freeze({
        survey,
        invitations: Object.freeze(store.invitations.filter(item => item.surveyId === surveyId).map(toInvitation)),
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
      const savedDraft = Object.freeze({ ...survey, draftRecipients: Object.freeze([...(recipients ?? survey.draftRecipients ?? [])]) });
      if (!useCloud) {
        const store = readStore(storage);
        const surveys = [...store.surveys.filter(candidate => candidate.id !== survey.id), savedDraft];
        writeStore(storage, { ...store, surveys });
        return savedDraft;
      }
      const { data, error } = await supabase.rpc('save_hader_survey_draft', {
        p_session_token: getSurveyAdminToken(),
        p_survey: surveyRow(savedDraft)
      });
      if (error) throwDataError(error, 'حفظ المسودة');
      return toSurvey(data);
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
        return Object.freeze({ ...published, responses: [] });
      }
      const { error } = await supabase.rpc('publish_hader_survey', {
        p_session_token: getSurveyAdminToken(),
        p_survey_id: surveyId,
        p_invitations: published.invitations.map(invitationRow),
        p_published_at: published.survey.publishedAt
      });
      if (error) throwDataError(error, 'نشر الاستبيان');
      return bundle(surveyId);
    },
    async markQueued(invitationIds) {
      const uniqueIds = [...new Set(invitationIds.filter(Boolean))];
      if (uniqueIds.length === 0) return;
      const queuedAt = new Date().toISOString();
      if (!useCloud) {
        const store = readStore(storage);
        const ids = new Set(uniqueIds);
        const surveyById = new Map(store.surveys.map(survey => [survey.id, toSurvey(survey)]));
        writeStore(storage, {
          ...store,
          invitations: store.invitations.map(item => {
            if (!ids.has(item.id)) return item;
            const anonymous = surveyById.get(item.surveyId)?.anonymous === true;
            return {
              ...item,
              queuedAt,
              ...(anonymous ? {
                recipientId: `anonymous:${item.id}`,
                recipientName: 'مستلم مجهول',
                recipientContact: '',
                recipientDetail: ''
              } : {})
            };
          })
        });
        return;
      }
      const { error } = await supabase.rpc('mark_hader_survey_invitations_queued', {
        p_session_token: getSurveyAdminToken(),
        p_invitation_ids: uniqueIds,
        p_queued_at: queuedAt
      });
      if (error) throwDataError(error, 'تسجيل حالة إرسال الدعوات');
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
        return;
      }
      const { error } = await supabase.rpc('delete_hader_survey_draft', {
        p_session_token: getSurveyAdminToken(),
        p_survey_id: surveyId
      });
      if (error) throwDataError(error, 'حذف الاستبيان');
    },
    bundle,
    async getPublic(token) {
      if (!useCloud) {
        const store = readStore(storage);
        const invitation = store.invitations.find(candidate => candidate.token === token);
        if (!invitation) throw new Error('رابط الاستبيان غير صالح أو منتهي');
        const survey = store.surveys.find(candidate => candidate.id === invitation.surveyId);
        if (!survey) throw new Error('الاستبيان غير موجود');
        return Object.freeze({ survey, invitation, alreadyResponded: survey.anonymous ? false : Boolean(invitation.respondedAt) });
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
        if (existing && survey.anonymous) {
          return Object.freeze({ ...existing, invitationId: '', respondentName: null, answers: Object.freeze([]) });
        }
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
