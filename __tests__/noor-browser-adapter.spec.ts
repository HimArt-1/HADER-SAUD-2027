import { describe, expect, it } from 'vitest';
import {
  createInMemoryIntegrationAuditPort,
  createIntegrationModule
} from '../modules/integrations';
import { createSafeBrowserAutomationPolicy } from '../modules/integrations/browserPolicy';
import {
  createNoorBrowserAdapter,
  type NoorBrowserPort
} from '../modules/integrations/noorBrowserAdapter';

const rosterHtml = `
<!doctype html>
<html lang="ar" dir="rtl">
  <head><title>قائمة الطلاب - نظام نور</title></head>
  <body>
    <main>
      <h1>كشف الطلاب</h1>
      <table>
        <thead>
          <tr>
            <th>رقم الطالب</th>
            <th>اسم الطالب</th>
            <th>الصف</th>
            <th>الفصل</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>١٠٠١</td><td>أحمد محمد</td><td>الأول</td><td>أ</td></tr>
          <tr><td>1002</td><td> خالد   علي </td><td>الثاني</td><td>ب</td></tr>
        </tbody>
      </table>
    </main>
  </body>
</html>`;

describe('Noor browser adapter', () => {
  it('returns a normalized roster review through the integration interface', async () => {
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html: rosterHtml,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const adapter = createNoorBrowserAdapter(
      port,
      createSafeBrowserAutomationPolicy({
        allowedHosts: ['noor.moe.gov.sa'],
        writeMode: 'disabled'
      })
    );
    const integrations = createIntegrationModule(
      [adapter],
      createInMemoryIntegrationAuditPort(),
      {
        now: () => new Date('2026-09-02T06:01:00.000Z'),
        createId: (() => {
          let sequence = 0;
          return () => `review-${++sequence}`;
        })()
      }
    );

    const review = await integrations.inspect({
      platform: 'noor',
      operation: 'pull-roster',
      input: { localStudents: [] }
    });

    expect(review).toMatchObject({
      platform: 'noor',
      operation: 'pull-roster',
      effect: 'read'
    });
    expect(review.remoteRevision).toMatch(/^noor-roster:[a-f0-9]{64}$/);
    expect(review.changes).toEqual([
      expect.objectContaining({
        id: 'noor-student-1001',
        entityType: 'student',
        entityLabel: 'أحمد محمد',
        action: 'create',
        after: {
          external_id: '1001',
          name: 'أحمد محمد',
          class_name: 'الأول',
          section: 'أ'
        }
      }),
      expect.objectContaining({
        id: 'noor-student-1002',
        entityLabel: 'خالد علي',
        action: 'create'
      })
    ]);
    expect(JSON.stringify(review)).not.toContain('<table>');
    expect(JSON.stringify(review)).not.toContain('StudentList.aspx');
  });

  it('reconciles existing students and blocks automatic removal of missing rows', async () => {
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html: rosterHtml,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const adapter = createNoorBrowserAdapter(
      port,
      createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
    );
    const integrations = createIntegrationModule(
      [adapter],
      createInMemoryIntegrationAuditPort()
    );

    const review = await integrations.inspect({
      platform: 'noor',
      operation: 'pull-roster',
      input: {
        localStudents: [
          { id: '1001', name: 'أحمد محمد', class_name: 'الأول', section: 'أ' },
          { id: '1002', name: 'خالد علي القديم', class_name: 'الأول', section: 'ب' },
          { id: '1003', name: 'طالب غير ظاهر', class_name: 'الثالث', section: 'ج' }
        ]
      }
    });

    expect(review.changes).toEqual([
      expect.objectContaining({ id: 'noor-student-1001', action: 'unchanged' }),
      expect.objectContaining({
        id: 'noor-student-1002',
        action: 'update',
        before: expect.objectContaining({ name: 'خالد علي القديم', class_name: 'الأول' }),
        after: expect.objectContaining({ name: 'خالد علي', class_name: 'الثاني' })
      }),
      expect.objectContaining({
        id: 'hader-student-1003',
        action: 'delete',
        blocked: true,
        warnings: expect.arrayContaining([expect.stringContaining('لا يُحذف تلقائياً')])
      })
    ]);
  });

  it('stops safely when Noor requires authentication', async () => {
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Login.aspx',
          title: 'تسجيل الدخول - نظام نور',
          html: '<form><input type="password" name="password"><button>تسجيل الدخول</button></form>',
          capturedAt: new Date().toISOString()
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    await expect(integrations.inspect({
      platform: 'noor',
      operation: 'pull-roster'
    })).rejects.toThrow('Noor authentication is required');
  });

  it('does not interpret an empty roster as removal of every local student', async () => {
    const emptyRosterHtml = rosterHtml.replace(
      /<tbody>[\s\S]*<\/tbody>/,
      '<tbody><tr><td colspan="4">لا توجد بيانات</td></tr></tbody>'
    );
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html: emptyRosterHtml,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    await expect(integrations.inspect({
      platform: 'noor',
      operation: 'pull-roster',
      input: { localStudents: [{ id: '1001', name: 'أحمد محمد' }] }
    })).rejects.toThrow('Noor roster is unexpectedly empty');
  });

  it('changes the remote revision when roster content changes at the same row count', async () => {
    let html = rosterHtml;
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    const first = await integrations.inspect({ platform: 'noor', operation: 'pull-roster' });
    html = rosterHtml.replace('خالد   علي', 'خالد صالح');
    const second = await integrations.inspect({ platform: 'noor', operation: 'pull-roster' });

    expect(second.remoteRevision).not.toBe(first.remoteRevision);
  });

  it('stops safely when Noor returns duplicate student identifiers', async () => {
    const duplicatedHtml = rosterHtml.replace('<td>1002</td>', '<td>١٠٠١</td>');
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html: duplicatedHtml,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    await expect(integrations.inspect({
      platform: 'noor',
      operation: 'pull-roster'
    })).rejects.toThrow('duplicate student identifier');
  });

  it('passes the enforced safe policy to the browser port before capture', async () => {
    let visibleBrowser: boolean | undefined;
    const port: NoorBrowserPort = {
      async captureRosterPage(policy) {
        visibleBrowser = policy.visibleBrowser;
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html: rosterHtml,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    await integrations.inspect({ platform: 'noor', operation: 'pull-roster' });
    expect(visibleBrowser).toBe(true);
  });

  it('rejects stale snapshots and incomplete roster columns', async () => {
    let html = rosterHtml;
    let capturedAt = '2020-01-01T00:00:00.000Z';
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html,
          capturedAt
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    await expect(integrations.inspect({
      platform: 'noor', operation: 'pull-roster'
    })).rejects.toThrow('snapshot is stale');

    capturedAt = new Date().toISOString();
    html = rosterHtml.replace('<th>الفصل</th>', '<th>ملاحظات</th>');
    await expect(integrations.inspect({
      platform: 'noor', operation: 'pull-roster'
    })).rejects.toThrow('layout is not recognized');
  });

  it('rejects a partially populated student row instead of producing a partial review', async () => {
    const incompleteRowHtml = rosterHtml.replace(
      '<tr><td>1002</td><td> خالد   علي </td><td>الثاني</td><td>ب</td></tr>',
      '<tr><td>1002</td><td>خالد علي</td><td></td><td>ب</td></tr>'
    );
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html: incompleteRowHtml,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    await expect(integrations.inspect({
      platform: 'noor', operation: 'pull-roster'
    })).rejects.toThrow('incomplete student row');
  });

  it('rejects malformed or duplicate local student identifiers before reconciliation', async () => {
    const port: NoorBrowserPort = {
      async captureRosterPage() {
        return {
          url: 'https://noor.moe.gov.sa/Noor/Student/StudentList.aspx',
          title: 'قائمة الطلاب - نظام نور',
          html: rosterHtml,
          capturedAt: new Date().toISOString()
        };
      }
    };
    const integrations = createIntegrationModule([
      createNoorBrowserAdapter(
        port,
        createSafeBrowserAutomationPolicy({ allowedHosts: ['noor.moe.gov.sa'] })
      )
    ], createInMemoryIntegrationAuditPort());

    await expect(integrations.inspect({
      platform: 'noor',
      operation: 'pull-roster',
      input: {
        localStudents: [
          { id: '1001', name: 'أحمد' },
          { id: '١٠٠١', name: 'أحمد مكرر', class_name: 'الأول', section: 'أ' }
        ]
      }
    })).rejects.toThrow('local roster is malformed or contains duplicate identifiers');
  });
});
