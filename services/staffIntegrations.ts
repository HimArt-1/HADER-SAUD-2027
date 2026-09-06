import Papa from 'papaparse';
import { Role } from '../types';
import { auth } from './auth';
import { parseXlsxFile } from './import/parsers/xlsx';
import { createIndexedDbStaffOperationsPort } from './staffOperations';
import { createLocalIntegrationAuditPort } from '../modules/integrations/localAuditPort';
import { createStaffReportService } from '../modules/integrations/staffReportService';
import type { StaffReportPlatform } from '../modules/integrations/staffReportParser';

export function createStaffIntegrationsController() {
  const reports = createStaffReportService({
    port: createIndexedDbStaffOperationsPort(),
    audit: createLocalIntegrationAuditPort(),
    resolveApprover: () => {
      const user = auth.getSession();
      return user ? { id: user.id, displayName: user.name, canApproveIntegrations: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN].includes(user.role) } : null;
    }
  });
  return Object.freeze({
    ...reports,
    async inspectFile(platform: StaffReportPlatform, file: File) {
      if (file.size > 5 * 1024 * 1024) throw new Error('الحد الأقصى لحجم التقرير 5MB');
      if (/\.csv$/i.test(file.name)) {
        const parsed = Papa.parse<Record<string, unknown>>(await file.text(), { header: true, skipEmptyLines: 'greedy' });
        if (parsed.errors.length || Object.keys(parsed.meta.renamedHeaders ?? {}).length) throw new Error('ملف CSV غير صالح أو يحتوي أعمدة متكررة');
        return reports.inspectRows(platform, parsed.data);
      }
      if (!/\.xlsx?$/i.test(file.name)) throw new Error('اختر تقرير Excel أو CSV');
      const parsed = await parseXlsxFile(file);
      // SheetJS renames duplicate headers with a suffix. Reject those rather than
      // silently choosing one of two conflicting columns.
      if (parsed.columns.some(column => /_\d+$/.test(column))) throw new Error('التقرير يحتوي عناوين أعمدة ملتبسة؛ استخدم القالب');
      return reports.inspectRows(platform, parsed.rows);
    }
  });
}
export type StaffIntegrationsController = ReturnType<typeof createStaffIntegrationsController>;
