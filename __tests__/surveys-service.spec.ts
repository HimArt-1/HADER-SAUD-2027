import { describe, expect, it } from 'vitest';
import { createSurveyDraft } from '../modules/surveys';
import { createSurveyService } from '../services/surveys';

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
};

describe('survey service local adapter', () => {
  it('persists a published survey, public response, and aggregate bundle', async () => {
    const storage = createMemoryStorage();
    const service = createSurveyService({ storage, useCloud: false });
    const survey = createSurveyDraft({
      title: 'جودة التواصل',
      audience: 'guardians',
      createdBy: 'admin-1',
      questions: [{ id: 'q1', prompt: 'هل الرسائل واضحة؟', type: 'yes_no', required: true, options: [] }]
    });

    await service.saveDraft(survey);
    const published = await service.publish(survey.id, [{ id: 'g1', name: 'ولي أمر محمد', contact: '0500000000' }]);
    expect(published.invitations).toHaveLength(1);

    const publicSurvey = await service.getPublic(published.invitations[0].token);
    expect(publicSurvey.survey.title).toBe('جودة التواصل');
    const response = await service.submit(publicSurvey.invitation.token, [{ questionId: 'q1', value: true }]);
    expect(response.respondentName).toBe('ولي أمر محمد');

    const reloaded = createSurveyService({ storage, useCloud: false });
    const bundle = await reloaded.bundle(survey.id);
    expect(bundle.responses).toHaveLength(1);
    expect(bundle.invitations[0].respondedAt).toBeTruthy();
    await expect(reloaded.submit(publicSurvey.invitation.token, [{ questionId: 'q1', value: true }])).rejects.toThrow('مسبقاً');
  });

  it('removes a draft and all of its local records', async () => {
    const storage = createMemoryStorage();
    const service = createSurveyService({ storage, useCloud: false });
    const survey = createSurveyDraft({
      title: 'مسودة', audience: 'teachers', createdBy: 'admin-1',
      questions: [{ id: 'q1', prompt: 'ملاحظة', type: 'text', required: false, options: [] }]
    });
    await service.saveDraft(survey);
    expect(await service.list()).toHaveLength(1);
    await service.remove(survey.id);
    expect(await service.list()).toEqual([]);
  });
});
