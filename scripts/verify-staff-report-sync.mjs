// Run with: node scripts/verify-staff-report-sync.mjs
// Uses an isolated Chromium context and a disposable IndexedDB database.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 5189, strictPort: false, hmr: false },
  plugins: [{
    name: 'staff-report-test-page',
    configureServer(vite) {
      vite.middlewares.use('/__staff-report-check', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><title>Staff report verification</title></head><body></body></html>');
      });
    }
  }]
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${origin}/__staff-report-check`);
  const result = await page.evaluate(async () => {
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs');
    const { HaderStaffOperationsDB, createIndexedDbStaffOperationsPort } = await import('/services/staffOperations.ts');
    const { createStaffReportService } = await import('/modules/integrations/staffReportService.ts');
    const { createInMemoryIntegrationAuditPort } = await import('/modules/integrations/index.ts');
    const databaseName = 'staff-report-browser-verification';
    await Dexie.delete(databaseName);
    const legacy = new Dexie(databaseName);
    legacy.version(2).stores({
      teachers: '&id, name, specialty', timetable: '&id, teacherId, day, period, [day+period], [teacherId+day+period]',
      attendance: '&id, teacherId, date, status, [date+teacherId]', coveragePlans: '&id, date, approvedAt',
      audit: '&id, action, occurredAt, actorId', metadata: '&key'
    });
    await legacy.table('teachers').put({ id: '001', name: 'معلم تجريبي', specialty: 'علوم', maxWeeklyWaits: 4, isActive: true });
    legacy.close();
    let database = new HaderStaffOperationsDB(databaseName);
    let port = createIndexedDbStaffOperationsPort(database);
    const migrated = await port.load();
    const reports = createStaffReportService({ port, audit: createInMemoryIntegrationAuditPort(), resolveApprover: () => ({ id: 'test-admin', displayName: 'اختبار', canApproveIntegrations: true }) });
    const rows = [{ 'معرف المعلم': '001', 'التاريخ': '2026-09-06', 'حالة الحضور': 'حاضر' }];
    const review = await reports.inspectRows('huduri', rows);
    const rejectAudit = () => { throw new Error('Injected audit write failure'); };
    database.audit.hook('creating', rejectAudit);
    let rejected = false;
    try { await reports.commit({ reviewId: review.id, approvedChangeIds: [review.changes[0].id], approval: {} }); } catch { rejected = true; }
    database.audit.hook('creating').unsubscribe(rejectAudit);
    const afterFailure = await port.load();
    const nextReview = await reports.inspectRows('huduri', rows);
    await reports.commit({ reviewId: nextReview.id, approvedChangeIds: [nextReview.changes[0].id], approval: {} });
    database.close();
    database = new HaderStaffOperationsDB(databaseName);
    port = createIndexedDbStaffOperationsPort(database);
    const reopened = await port.load();
    const event = { id: 'concurrent', action: 'report-imported', actorId: 'test', occurredAt: new Date().toISOString(), details: {} };
    const concurrent = await Promise.allSettled([
      port.importReport({ attendance: [{ ...reopened.attendance[0], status: 'late', minutesLate: 5 }], preparations: [] }, { ...event, id: 'a' }, reopened.version),
      port.importReport({ attendance: [{ ...reopened.attendance[0], status: 'absent' }], preparations: [] }, { ...event, id: 'b' }, reopened.version)
    ]);
    const final = await port.load();
    const audit = await port.auditEvents();
    const output = {
      migratedTeacherCount: migrated.teachers.length, migratedPreparationCount: migrated.preparations.length,
      rejected, rollbackAttendanceCount: afterFailure.attendance.length, rollbackVersion: afterFailure.version,
      persistedAttendanceCount: reopened.attendance.length, persistedSource: reopened.attendance[0]?.source,
      concurrentSuccesses: concurrent.filter(value => value.status === 'fulfilled').length,
      finalVersion: final.version, auditCount: audit.length
    };
    database.close();
    await Dexie.delete(databaseName);
    return output;
  });
  assert.deepEqual(result, {
    migratedTeacherCount: 1, migratedPreparationCount: 0, rejected: true,
    rollbackAttendanceCount: 0, rollbackVersion: 0,
    persistedAttendanceCount: 1, persistedSource: 'huduri', concurrentSuccesses: 1,
    finalVersion: 2, auditCount: 2
  });
  console.log('Passed: v2 migration, atomic audit rollback, persisted import, concurrent version checks.');
} finally {
  await browser?.close();
  await server.close();
}
