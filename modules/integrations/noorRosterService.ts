import type { RosterModule } from '../roster';
import { createSafeBrowserAutomationPolicy } from './browserPolicy';
import {
  createIntegrationModule,
  type IntegrationApplyReceipt,
  type IntegrationApplyRequest,
  type IntegrationAuditPort,
  type IntegrationEnvironment,
  type IntegrationReview
} from './index';
import {
  createNoorBrowserAdapter,
  type NoorBrowserPort
} from './noorBrowserAdapter';
import { createRosterIntegrationImportPort } from './rosterImportPort';

export type NoorRosterIntegrationService = Readonly<{
  inspectRoster(options?: Readonly<{ forceSync?: boolean }>): Promise<IntegrationReview>;
  commitRosterImport(request: IntegrationApplyRequest): Promise<IntegrationApplyReceipt>;
}>;

type NoorRosterServiceDependencies = Readonly<{
  browser: NoorBrowserPort;
  roster: RosterModule;
  audit: IntegrationAuditPort;
  resolveApprover: NonNullable<IntegrationEnvironment['resolveApprover']>;
  allowedHosts?: readonly string[];
  environment?: Omit<IntegrationEnvironment, 'importPort'>;
}>;

/**
 * Public Noor roster workflow. The UI receives a review, never raw page HTML.
 */
export const createNoorRosterIntegrationService = (
  dependencies: NoorRosterServiceDependencies
): NoorRosterIntegrationService => {
  const policy = createSafeBrowserAutomationPolicy({
    allowedHosts: dependencies.allowedHosts ?? ['noor.moe.gov.sa'],
    writeMode: 'disabled'
  });
  const integration = createIntegrationModule(
    [createNoorBrowserAdapter(dependencies.browser, policy)],
    dependencies.audit,
    {
      ...dependencies.environment,
      resolveApprover: dependencies.resolveApprover,
      importPort: createRosterIntegrationImportPort(dependencies.roster)
    }
  );

  return Object.freeze({
    async inspectRoster(options = {}) {
      const snapshot = await dependencies.roster.load(options);
      return integration.inspect({
        platform: 'noor',
        operation: 'pull-roster',
        input: {
          localStudents: snapshot.students.map(student => ({
            id: student.id,
            name: student.name,
            class_name: student.class_name,
            section: student.section
          }))
        }
      });
    },
    commitRosterImport(request) {
      return integration.commitImport(request);
    }
  });
};
