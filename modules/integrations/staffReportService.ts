import type { StaffAttendanceRecord, StaffLessonPreparation, StaffOperationsPort } from '../staffOperations';
import { createIntegrationModule, type IntegrationAdapter, type IntegrationApprover, type IntegrationAuditPort, type IntegrationEnvironment, type IntegrationApplyRequest } from './index';
import { parseStaffReportRows, type StaffReportPlatform } from './staffReportParser';

export function createStaffReportService(dependencies: {
  port: StaffOperationsPort;
  audit: IntegrationAuditPort;
  resolveApprover: () => IntegrationApprover | null;
  environment?: Pick<IntegrationEnvironment, 'now' | 'createId' | 'reviewTtlMs'>;
}) {
  const now = dependencies.environment?.now ?? (() => new Date());
  const revisions = new Map<string, { version: number; actorId: string }>();
  const requireApprover = () => {
    const actor = dependencies.resolveApprover();
    if (!actor?.id.trim() || !actor.canApproveIntegrations) throw new Error('تتطلب المزامنة صلاحية مدير مسجل الدخول');
    return actor;
  };
  const adapter = (platform: StaffReportPlatform): IntegrationAdapter => ({
    platform,
    capabilities: [{ operation: 'pull-staff-report', effect: 'read' }],
    async inspect(request) {
      const actorId = requireApprover().id;
      const snapshot = await dependencies.port.load();
      const rows = request.input?.rows;
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('بيانات التقرير غير صالحة');
      const records = parseStaffReportRows(platform, rows, snapshot.teachers);
      const current: readonly (StaffAttendanceRecord | StaffLessonPreparation)[] = platform === 'huduri' ? snapshot.attendance : snapshot.preparations;
      const existing = new Map(current.map(record => [record.id, record] as const));
      const names = new Map(snapshot.teachers.map(teacher => [teacher.id, teacher.name]));
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(records)));
      if (requireApprover().id !== actorId) throw new Error('تغيرت جلسة المستخدم؛ أعد فحص التقرير');
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const remoteRevision = `${platform}:${hash}:${snapshot.version}:${encodeURIComponent(actorId)}`;
      revisions.set(remoteRevision, { version: snapshot.version, actorId });
      return {
        remoteRevision,
        warnings: ['المزامنة من التقرير إلى حاضر على هذا الجهاز. راجع المدرسة والفترة قبل الاعتماد.'],
        changes: records.map(record => {
          const before = existing.get(record.id);
          const fields = platform === 'huduri' ? ['status', 'minutesLate'] : ['status', 'subject', 'className', 'section'];
          const unchanged = before && fields.every(field => before[field] === record[field]);
          return {
            id: record.id,
            entityType: platform === 'huduri' ? 'staff-attendance' : 'lesson-preparation',
            entityLabel: names.get(record.teacherId) ?? record.teacherId,
            action: before ? (unchanged ? 'unchanged' as const : 'update' as const) : 'create' as const,
            before: before ? { ...before } : null,
            after: { ...record },
            warnings: before && !unchanged ? ['سيُستبدل السجل المحلي بالقيم المعروضة بعد اعتمادك.'] : []
          };
        })
      };
    },
    async apply() { throw new Error('الكتابة إلى المنصة الخارجية غير مفعلة'); }
  });
  const integration = createIntegrationModule([adapter('huduri'), adapter('madrasati')], dependencies.audit, {
    ...dependencies.environment,
    resolveApprover: dependencies.resolveApprover,
    importPort: {
      async import(request) {
        const actor = requireApprover();
        const revision = revisions.get(request.remoteRevision);
        if (!revision || revision.actorId !== actor.id || request.approvedBy !== actor.id) throw new Error('تغيرت جلسة المستخدم؛ أعد فحص التقرير');
        const recordedAt = now().toISOString();
        const records = request.approvedChanges.map(change => ({ ...change.after, recordedAt }));
        // The integration module owns immutable reviewed records; the port commits
        // all selected rows and their audit in the same version-checked transaction.
        await dependencies.port.importReport({
          attendance: request.platform === 'huduri' ? records as StaffAttendanceRecord[] : [],
          preparations: request.platform === 'madrasati' ? records as StaffLessonPreparation[] : []
        }, {
          id: request.idempotencyKey,
          action: 'report-imported',
          actorId: actor.id,
          occurredAt: recordedAt,
          details: { platform: request.platform, count: records.length }
        }, revision.version);
        return { reference: `staff-report:${request.idempotencyKey}`, appliedChangeIds: request.approvedChanges.map(change => change.id), completedAt: recordedAt };
      }
    }
  });
  return Object.freeze({
    async inspectRows(platform: StaffReportPlatform, rows: readonly Readonly<Record<string, unknown>>[]) {
      requireApprover();
      return integration.inspect({ platform, operation: 'pull-staff-report', input: { rows } });
    },
    commit(request: IntegrationApplyRequest) { return integration.commitImport(request); },
    async history() {
      requireApprover();
      const [snapshot, audit] = await Promise.all([dependencies.port.load(), dependencies.port.auditEvents()]);
      return { snapshot, imports: audit.filter(event => event.action === 'report-imported') };
    }
  });
}
