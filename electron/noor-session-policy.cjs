'use strict';

const NOOR_SESSION_HOSTS = Object.freeze([
  'noor.moe.gov.sa',
  'mip.moe.gov.sa',
]);

const NOOR_SESSION_HOST_SET = new Set(NOOR_SESSION_HOSTS);

function normalizeHost(host) {
  return typeof host === 'string' ? host.trim().toLowerCase() : '';
}

function isAllowedNoorSessionUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      NOOR_SESSION_HOST_SET.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isAllowedNoorResourceUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  if (rawUrl.startsWith('data:') || rawUrl === 'about:blank') return true;
  if (rawUrl.startsWith('blob:')) {
    return isAllowedNoorSessionUrl(rawUrl.slice('blob:'.length));
  }
  return isAllowedNoorSessionUrl(rawUrl);
}

function assertSafeCapturePolicy(policy) {
  if (
    !policy ||
    typeof policy !== 'object' ||
    policy.visibleBrowser !== true ||
    policy.credentialEntry !== 'manual-only' ||
    policy.challengeHandling !== 'manual-only'
  ) {
    throw new Error('visible and manual: يجب أن تبقى جلسة نور مرئية وأن يكون الدخول والتحقق يدويين.');
  }

  if (!Array.isArray(policy.allowedHosts) || policy.allowedHosts.length === 0) {
    throw new Error('لم تُحدد نطاقات نور المسموح بها.');
  }

  const normalizedHosts = policy.allowedHosts.map(normalizeHost);
  if (
    normalizedHosts.some(
      (host) => !host || !NOOR_SESSION_HOST_SET.has(host),
    )
  ) {
    throw new Error('unsupported host: تتضمن سياسة الالتقاط نطاقًا غير معتمد لنظام نور.');
  }

  return Object.freeze({
    visibleBrowser: true,
    credentialEntry: 'manual-only',
    challengeHandling: 'manual-only',
    allowedHosts: Object.freeze([...new Set(normalizedHosts)]),
  });
}

module.exports = {
  NOOR_SESSION_HOSTS,
  assertSafeCapturePolicy,
  isAllowedNoorResourceUrl,
  isAllowedNoorSessionUrl,
};
