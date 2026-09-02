export type BrowserAutomationPolicy = Readonly<{
  allowedHosts: readonly string[];
  visibleBrowser: true;
  credentialEntry: 'manual-only';
  challengeHandling: 'manual-only';
  writeMode: 'disabled' | 'supervised';
  requireReviewBeforeWrite: true;
  maxActionsPerMinute: number;
  navigationTimeoutMs: number;
}>;

export type BrowserAutomationPolicyInput = Readonly<{
  allowedHosts: readonly string[];
  writeMode?: BrowserAutomationPolicy['writeMode'];
  maxActionsPerMinute?: number;
  navigationTimeoutMs?: number;
  visibleBrowser?: boolean;
  credentialEntry?: string;
  challengeHandling?: string;
  requireReviewBeforeWrite?: boolean;
}>;

const normalizeHost = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes('/') || trimmed.includes(':')) {
    throw new Error(`Invalid automation host: ${value}`);
  }
  return trimmed;
};

/**
 * Creates the only browser policy accepted by government-platform adapters.
 * Automation is intentionally visible, credentials/challenges stay manual,
 * and write operations must remain supervised.
 */
export const createSafeBrowserAutomationPolicy = (
  input: BrowserAutomationPolicyInput
): BrowserAutomationPolicy => {
  if (input.visibleBrowser === false) {
    throw new Error('Government-platform automation must use a visible browser');
  }
  if (input.credentialEntry && input.credentialEntry !== 'manual-only') {
    throw new Error('Credential entry must remain manual');
  }
  if (input.challengeHandling && input.challengeHandling !== 'manual-only') {
    throw new Error('MFA and CAPTCHA challenges must remain manual');
  }
  if (input.requireReviewBeforeWrite === false) {
    throw new Error('Human review cannot be disabled');
  }

  const allowedHosts = [...new Set(input.allowedHosts.map(normalizeHost))];
  if (allowedHosts.length === 0) {
    throw new Error('At least one explicit host is required');
  }

  const maxActionsPerMinute = input.maxActionsPerMinute ?? 12;
  if (!Number.isInteger(maxActionsPerMinute) || maxActionsPerMinute < 1 || maxActionsPerMinute > 30) {
    throw new Error('Action rate must be an integer between 1 and 30 per minute');
  }

  const navigationTimeoutMs = input.navigationTimeoutMs ?? 30_000;
  if (!Number.isInteger(navigationTimeoutMs) || navigationTimeoutMs < 5_000 || navigationTimeoutMs > 120_000) {
    throw new Error('Navigation timeout must be between 5 and 120 seconds');
  }

  return Object.freeze({
    allowedHosts: Object.freeze(allowedHosts),
    visibleBrowser: true,
    credentialEntry: 'manual-only',
    challengeHandling: 'manual-only',
    writeMode: input.writeMode ?? 'disabled',
    requireReviewBeforeWrite: true,
    maxActionsPerMinute,
    navigationTimeoutMs
  });
};

export const isAllowedAutomationUrl = (
  policy: BrowserAutomationPolicy,
  value: string | URL
): boolean => {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return url.protocol === 'https:' && policy.allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};
