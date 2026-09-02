import { describe, expect, it } from 'vitest';
import { createInMemoryIntegrationAuditPort } from '../modules/integrations';
import type { NoorBrowserPort } from '../modules/integrations/noorBrowserAdapter';
import { createNoorRosterIntegrationService } from '../modules/integrations/noorRosterService';
import { createInMemoryRosterPort, createRosterModule } from '../modules/roster';

describe('Noor roster integration service', () => {
  it('runs inspect, human review, and local roster import end to end', async () => {
    const roster = createRosterModule(createInMemoryRosterPort({
      students: [{ id: '1001', name: 'اسم قديم', class_name: 'الأول', section: 'أ' }]
    }));
    const browser: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          capturedAt: new Date().toISOString(),
          html: `
            <table>
              <thead><tr><th>رقم الطالب</th><th>اسم الطالب</th><th>الصف</th><th>الفصل</th></tr></thead>
              <tbody>
                <tr><td>1001</td><td>أحمد محمد</td><td>الأول</td><td>أ</td></tr>
                <tr><td>1002</td><td>خالد علي</td><td>الثاني</td><td>ب</td></tr>
              </tbody>
            </table>`
        };
      }
    };
    const audit = createInMemoryIntegrationAuditPort();
    const service = createNoorRosterIntegrationService({
      browser,
      roster,
      audit,
      resolveApprover: () => ({
        id: 'admin-1',
        displayName: 'مدير المدرسة',
        canApproveIntegrations: true
      })
    });

    const review = await service.inspectRoster();
    expect(review.changes.map(change => [change.id, change.action])).toEqual([
      ['noor-student-1001', 'update'],
      ['noor-student-1002', 'create']
    ]);

    await service.commitRosterImport({
      reviewId: review.id,
      approvedChangeIds: review.changes.map(change => change.id),
      approval: {}
    });

    expect((await roster.load()).students).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1001', name: 'أحمد محمد' }),
      expect.objectContaining({ id: '1002', name: 'خالد علي' })
    ]));
    expect(audit.events().map(event => event.action)).toEqual([
      'inspected',
      'import-started',
      'import-succeeded'
    ]);
  });
});
