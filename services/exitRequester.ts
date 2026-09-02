import { ExitRecord, ExitRequesterRelation } from '../types';

export const EXIT_REQUESTER_RELATIONS: Array<{ value: ExitRequesterRelation; label: string }> = [
  { value: 'father', label: 'أب' },
  { value: 'mother', label: 'أم' },
  { value: 'brother', label: 'أخ' },
  { value: 'sister', label: 'أخت' },
  { value: 'driver', label: 'سائق' },
  { value: 'other', label: 'أخرى' }
];

const RELATION_LABELS = new Map(EXIT_REQUESTER_RELATIONS.map(item => [item.value, item.label]));

export const getExitRequesterRelationLabel = (exit?: Pick<ExitRecord, 'requester_relation' | 'requester_relation_other'> | null) => {
  if (!exit?.requester_relation) return '-';

  const customRelation = (exit.requester_relation_other || '').trim();
  if (exit.requester_relation === 'other') return customRelation || 'أخرى';

  return RELATION_LABELS.get(exit.requester_relation) || '-';
};
