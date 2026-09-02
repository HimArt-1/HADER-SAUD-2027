import { describe, expect, it } from 'vitest';
import {
  buildSurveyRecipients,
  createSurveyDraft,
  createSurveyResponse,
  publishSurvey,
  summarizeSurvey,
  type SurveyQuestion
} from '../modules/surveys';

const questions: readonly SurveyQuestion[] = [
  { id: 'q1', prompt: 'ما مستوى رضاك؟', type: 'rating', required: true, options: [] },
  { id: 'q2', prompt: 'القناة المفضلة', type: 'single_choice', required: true, options: ['واتساب', 'رسالة نصية'] },
  { id: 'q3', prompt: 'ملاحظاتك', type: 'text', required: false, options: [] }
];

const env = {
  now: () => new Date('2026-09-02T09:00:00.000Z'),
  createId: (() => { let id = 0; return () => `id-${++id}`; })(),
  createToken: (() => { let id = 0; return () => `token-${++id}`; })()
};

describe('surveys domain', () => {
  it('validates the draft before creating it', () => {
    expect(() => createSurveyDraft({ title: '', audience: 'guardians', questions, createdBy: 'admin' })).toThrow('عنوان');
    expect(() => createSurveyDraft({
      title: 'استبيان', audience: 'guardians', createdBy: 'admin',
      questions: [{ id: 'q', prompt: 'اختر', type: 'single_choice', required: true, options: ['واحد'] }]
    })).toThrow('خيارين');
  });

  it('publishes unique invitations and preserves recipients without phone numbers', () => {
    const survey = createSurveyDraft({ title: 'رضا المستفيدين', audience: 'teachers', questions, createdBy: 'admin' }, env);
    const published = publishSurvey(survey, [
      { id: 't1', name: 'أحمد', contact: '050 123 4567', detail: 'رياضيات' },
      { id: 't1', name: 'أحمد', contact: '0501234567', detail: 'رياضيات' },
      { id: 't2', name: 'سارة', contact: '', detail: 'علوم' }
    ], env);

    expect(published.survey.status).toBe('published');
    expect(published.invitations).toHaveLength(2);
    expect(published.invitations.map(invitation => invitation.token)).toEqual(['token-1', 'token-2']);
    expect(published.invitations[1].recipientContact).toBe('');
  });

  it('does not publish a survey whose closing time has passed', () => {
    const survey = createSurveyDraft({
      title: 'استبيان منتهي', audience: 'guardians', questions, createdBy: 'admin',
      closesAt: '2026-09-02T08:00:00.000Z'
    }, env);
    expect(() => publishSurvey(survey, [{ id: 'g1', name: 'ولي الأمر', contact: '' }], env)).toThrow('المستقبل');
  });

  it('rejects incomplete or duplicate answers and calculates results', () => {
    const draft = createSurveyDraft({ title: 'رضا المستفيدين', audience: 'guardians', questions, createdBy: 'admin' }, env);
    const { survey, invitations } = publishSurvey(draft, [{ id: 'g1', name: 'ولي الأمر', contact: '0500000000' }], env);

    expect(() => createSurveyResponse(survey, invitations[0], [], null, env)).toThrow('مطلوب');
    const submitted = createSurveyResponse(survey, invitations[0], [
      { questionId: 'q1', value: 4 },
      { questionId: 'q2', value: 'واتساب' },
      { questionId: 'q3', value: 'تجربة ممتازة' }
    ], null, env);
    expect(() => createSurveyResponse(survey, submitted.invitation, submitted.response.answers, submitted.response, env)).toThrow('مسبقاً');

    const summary = summarizeSurvey(survey, invitations, [submitted.response]);
    expect(summary.responseRate).toBe(100);
    expect(summary.questionResults[0].average).toBe(4);
    expect(summary.questionResults[1].values[0]).toMatchObject({ label: 'واتساب', count: 1, percentage: 100 });
    expect(summary.questionResults[2].textAnswers).toEqual(['تجربة ممتازة']);
  });

  it('deduplicates guardians by phone and includes active teachers', () => {
    const guardians = buildSurveyRecipients('guardians', [
      { id: 's1', name: 'محمد', class_name: 'الأول', section: 'أ', guardian_name: 'خالد', guardian_phone: '050 000 0000' },
      { id: 's2', name: 'نورة', class_name: 'الثالث', section: 'ب', guardian_name: 'خالد', guardian_phone: '0500000000' }
    ], []);
    expect(guardians).toHaveLength(1);
    expect(guardians[0].detail).toContain('محمد');
    expect(guardians[0].detail).toContain('نورة');

    const teachers = buildSurveyRecipients('teachers', [], [
      { id: 't1', name: 'أحمد', specialty: 'رياضيات', phone: '0550000000', maxWeeklyWaits: 2, isActive: true },
      { id: 't2', name: 'متوقف', specialty: 'علوم', maxWeeklyWaits: 2, isActive: false }
    ]);
    expect(teachers).toEqual([{ id: 't1', name: 'أحمد', contact: '0550000000', detail: 'رياضيات' }]);
  });
});
