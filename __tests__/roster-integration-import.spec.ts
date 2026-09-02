import { describe, expect, it } from 'vitest';
import { createRosterModule, createInMemoryRosterPort } from '../modules/roster';
import type { IntegrationImportExecutionRequest } from '../modules/integrations';
import { createRosterIntegrationImportPort } from '../modules/integrations/rosterImportPort';

const createRequest = (
  changes: IntegrationImportExecutionRequest['approvedChanges']
): IntegrationImportExecutionRequest => ({
  platform: 'noor',
  operation: 'pull-roster',
  remoteRevision: 'noor-roster:fixture',
  approvedChanges: changes,
  approvedBy: 'مدير المدرسة',
  idempotencyKey: 'review-1'
});

describe('roster integration import port', () => {
  it('imports reviewed Noor students and preserves existing guardian data', async () => {
    const roster = createRosterModule(createInMemoryRosterPort({
      students: [{
        id: '1002',
        name: 'الاسم القديم',
        class_name: 'الأول',
        section: 'ب',
        guardian_phone: '0500000000',
        is_active: true
      }]
    }));
    const importer = createRosterIntegrationImportPort(roster, {
      now: () => new Date('2026-09-02T10:00:00.000Z')
    });

    const receipt = await importer.import(createRequest([
      {
        id: 'noor-student-1001',
        entityType: 'student',
        entityLabel: 'أحمد محمد',
        action: 'create',
        after: { external_id: '1001', name: 'أحمد محمد', class_name: 'الأول', section: 'أ' }
      },
      {
        id: 'noor-student-1002',
        entityType: 'student',
        entityLabel: 'خالد علي',
        action: 'update',
        before: {
          external_id: '1002',
          name: 'الاسم القديم',
          class_name: 'الأول',
          section: 'ب'
        },
        after: { external_id: '1002', name: 'خالد علي', class_name: 'الثاني', section: 'ب' }
      }
    ]));

    expect(receipt).toEqual({
      reference: 'hader://roster-import/review-1',
      appliedChangeIds: ['noor-student-1001', 'noor-student-1002'],
      completedAt: '2026-09-02T10:00:00.000Z'
    });
    const snapshot = await roster.load();
    expect(snapshot.students).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '1001',
        name: 'أحمد محمد',
        class_name: 'الأول',
        section: 'أ',
        is_active: true
      }),
      expect.objectContaining({
        id: '1002',
        name: 'خالد علي',
        class_name: 'الثاني',
        guardian_phone: '0500000000'
      })
    ]));
  });

  it('rejects deletion and malformed student data at the destination boundary', async () => {
    const importer = createRosterIntegrationImportPort(
      createRosterModule(createInMemoryRosterPort())
    );

    await expect(importer.import(createRequest([{
      id: 'delete-1001',
      entityType: 'student',
      entityLabel: 'أحمد محمد',
      action: 'delete',
      before: { external_id: '1001' },
      after: null
    }]))).rejects.toThrow('create and update');

    await expect(importer.import(createRequest([{
      id: 'create-invalid',
      entityType: 'student',
      entityLabel: 'سجل ناقص',
      action: 'create',
      after: { external_id: '1001', name: '' }
    }]))).rejects.toThrow('valid student');
  });

  it('rejects a stale review instead of overwriting a newer local roster edit', async () => {
    const roster = createRosterModule(createInMemoryRosterPort({
      students: [{ id: '1002', name: 'تعديل أحدث', class_name: 'الثالث', section: 'ج' }]
    }));
    const importer = createRosterIntegrationImportPort(roster);

    await expect(importer.import(createRequest([{
      id: 'noor-student-1002',
      entityType: 'student',
      entityLabel: 'خالد علي',
      action: 'update',
      before: {
        external_id: '1002',
        name: 'الاسم القديم',
        class_name: 'الأول',
        section: 'ب'
      },
      after: {
        external_id: '1002',
        name: 'خالد علي',
        class_name: 'الثاني',
        section: 'ب'
      }
    }]))).rejects.toThrow('changed after review');

    expect((await roster.load()).students[0]).toMatchObject({
      name: 'تعديل أحدث',
      class_name: 'الثالث'
    });
  });

  it('uses the shared student-id normalization without creating an equivalent duplicate', async () => {
    const roster = createRosterModule(createInMemoryRosterPort({
      students: [{ id: '١٠٠٢', name: 'الاسم القديم', class_name: 'الأول', section: 'ب' }]
    }));
    const importer = createRosterIntegrationImportPort(roster);

    await importer.import(createRequest([{
      id: 'noor-student-1002',
      entityType: 'student',
      entityLabel: 'خالد علي',
      action: 'update',
      before: {
        external_id: '1002', name: 'الاسم القديم', class_name: 'الأول', section: 'ب'
      },
      after: {
        external_id: '1002', name: 'خالد علي', class_name: 'الثاني', section: 'ب'
      }
    }]));

    const students = (await roster.load()).students;
    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({ id: '١٠٠٢', name: 'خالد علي' });
  });
});
