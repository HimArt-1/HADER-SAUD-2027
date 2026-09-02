import { Role } from '../types';
import type {
  IntegrationApplyReceipt,
  IntegrationApplyRequest,
  IntegrationAuditEvent,
  IntegrationReview
} from '../modules/integrations';
import { createLocalIntegrationAuditPort } from '../modules/integrations/localAuditPort';
import type { NoorBrowserPort } from '../modules/integrations/noorBrowserAdapter';
import { createNoorRosterIntegrationService } from '../modules/integrations/noorRosterService';
import { auth } from './auth';
import { roster } from './roster';

export type IntegrationCenterController = Readonly<{
  isNoorDesktopAvailable(): boolean;
  openNoorSession(): Promise<{ opened: boolean }>;
  inspectNoorRoster(): Promise<IntegrationReview>;
  commitNoorRoster(request: IntegrationApplyRequest): Promise<IntegrationApplyReceipt>;
  auditEvents(): readonly IntegrationAuditEvent[];
}>;

const hasNoorDesktopBridge = (): boolean => (
  typeof window !== 'undefined'
  && typeof window.electronAPI?.openNoorSession === 'function'
  && typeof window.electronAPI?.captureNoorRosterPage === 'function'
);

export const createIntegrationCenterController = (): IntegrationCenterController => {
  const audit = createLocalIntegrationAuditPort();
  const browser: NoorBrowserPort = {
    async captureRosterPage(policy) {
      if (!hasNoorDesktopBridge()) {
        throw new Error('Noor desktop session is unavailable');
      }
      return window.electronAPI!.captureNoorRosterPage({
        allowedHosts: [...policy.allowedHosts],
        visibleBrowser: policy.visibleBrowser,
        credentialEntry: policy.credentialEntry,
        challengeHandling: policy.challengeHandling
      });
    }
  };
  const noor = createNoorRosterIntegrationService({
    browser,
    roster,
    audit,
    resolveApprover: () => {
      const user = auth.getSession();
      if (!user) return null;
      return {
        id: user.id,
        displayName: user.name,
        canApproveIntegrations: [Role.SITE_ADMIN, Role.SCHOOL_ADMIN].includes(user.role)
      };
    },
    environment: {
      onAuditError: error => console.error('[Integrations] Audit write failed', error)
    }
  });

  return Object.freeze({
    isNoorDesktopAvailable: hasNoorDesktopBridge,
    async openNoorSession() {
      if (!hasNoorDesktopBridge()) return { opened: false };
      return window.electronAPI!.openNoorSession();
    },
    inspectNoorRoster() {
      return noor.inspectRoster({ forceSync: true });
    },
    commitNoorRoster(request) {
      return noor.commitRosterImport(request);
    },
    auditEvents: audit.events
  });
};
