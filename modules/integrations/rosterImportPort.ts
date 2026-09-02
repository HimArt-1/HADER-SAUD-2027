import type { Student } from '../../types';
import { normalizeStudentId } from '../../services/dbHelpers';
import type { RosterModule } from '../roster';
import type {
  IntegrationChange,
  IntegrationImportExecutionRequest,
  IntegrationImportPort
} from './index';

type RosterImportEnvironment = Readonly<{
  now?: () => Date;
}>;

const readRequiredText = (value: unknown): string => (
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim()
    : ''
);

const toStudent = (
  change: IntegrationChange,
  existingById: ReadonlyMap<string, Student>
): Student => {
  if (change.entityType !== 'student' || !['create', 'update'].includes(change.action)) {
    throw new Error('Roster imports accept student create and update changes only');
  }

  const after = change.after;
  const id = readRequiredText(after?.external_id ?? after?.id);
  const name = readRequiredText(after?.name);
  const className = readRequiredText(after?.class_name);
  const section = readRequiredText(after?.section);
  if (!id || !name || !className || !section) {
    throw new Error(`Roster import change is not a valid student: ${change.id}`);
  }

  const normalizedId = normalizeStudentId(id);
  const existing = existingById.get(normalizedId);
  if (change.action === 'create' && existing) {
    throw new Error(`Roster student changed after review: ${change.id}`);
  }
  if (change.action === 'update') {
    const before = change.before;
    const beforeId = readRequiredText(before?.external_id ?? before?.id);
    const beforeName = readRequiredText(before?.name);
    const beforeClass = readRequiredText(before?.class_name);
    const beforeSection = readRequiredText(before?.section);
    const unchangedSinceReview = existing
      && normalizeStudentId(existing.id) === normalizeStudentId(beforeId)
      && existing.name.replace(/\s+/g, ' ').trim() === beforeName
      && existing.class_name.replace(/\s+/g, ' ').trim() === beforeClass
      && existing.section.replace(/\s+/g, ' ').trim() === beforeSection;
    if (!unchangedSinceReview) {
      throw new Error(`Roster student changed after review: ${change.id}`);
    }
  }
  return {
    ...existing,
    id: existing?.id ?? id,
    name,
    class_name: className,
    section,
    is_active: existing?.is_active ?? true
  };
};

/**
 * Applies an already-reviewed remote roster to Hader's local roster boundary.
 * This port never deletes students and never writes back to the external platform.
 */
export const createRosterIntegrationImportPort = (
  roster: RosterModule,
  environment: RosterImportEnvironment = {}
): IntegrationImportPort => {
  const now = environment.now ?? (() => new Date());

  return Object.freeze({
    async import(request: IntegrationImportExecutionRequest) {
      if (request.platform !== 'noor' || request.operation !== 'pull-roster') {
        throw new Error(`Unsupported roster import: ${request.platform}/${request.operation}`);
      }

      const snapshot = await roster.load();
      const existingById = new Map<string, Student>();
      snapshot.students.forEach(student => {
        const normalizedId = normalizeStudentId(student.id);
        if (!normalizedId || existingById.has(normalizedId)) {
          throw new Error('Hader roster contains duplicate normalized student identifiers');
        }
        existingById.set(normalizedId, student);
      });
      const students = request.approvedChanges.map(change => toStudent(change, existingById));
      const uniqueIds = new Set(students.map(student => normalizeStudentId(student.id)));
      if (uniqueIds.size !== students.length) {
        throw new Error('Roster import contains duplicate student identifiers');
      }

      await roster.execute({ type: 'save-students', students });
      return Object.freeze({
        reference: `hader://roster-import/${encodeURIComponent(request.idempotencyKey)}`,
        appliedChangeIds: Object.freeze(request.approvedChanges.map(change => change.id)),
        completedAt: now().toISOString()
      });
    }
  });
};
