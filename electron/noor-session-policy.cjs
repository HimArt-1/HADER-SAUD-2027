'use strict';

const NOOR_SESSION_HOSTS = Object.freeze([
  'noor.moe.gov.sa',
  'mip.moe.gov.sa',
]);

const NOOR_SESSION_HOST_SET = new Set(NOOR_SESSION_HOSTS);
// Authentication can leave Noor, but these hosts are never capture targets.
const NOOR_AUTH_HOSTS = new Set(['iam.moe.gov.sa', 'www.iam.gov.sa']);
const NOOR_QUEUE_HOST = 'moe.queue-it.net';
// Dependencies observed on Noor's public landing and sign-in pages. Keep CDN
// paths scoped, and do not allow them as top-level navigation destinations.
const NOOR_RESOURCE_PATHS = new Map([
  ['cdnjs.cloudflare.com', ['/ajax/libs/font-awesome/']],
  ['ajax.cloudflare.com', ['/cdn-cgi/scripts/']],
  ['object.moe.gov.sa', ['/noor/']],
  ['static.queue-it.net', ['/script/']],
  ['assets.queue-it.net', ['/moe/']],
  ['seal.digicert.com', ['/seals/']],
  ['fonts.googleapis.com', ['/css2']],
  ['fonts.gstatic.com', ['/s/']],
  ['dga.gov.sa', ['/themes/custom/dga/Images/NDS/']],
  ['imagedelivery.net', ['/KWAEkiRrki3UKDjjaDt6mA/']],
]);

function normalizeHost(host) {
  return typeof host === 'string' ? host.trim().toLowerCase() : '';
}

function isAllowedNoorSessionUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      !url.username && !url.password && !url.port &&
      (NOOR_SESSION_HOST_SET.has(url.hostname.toLowerCase()) ||
        NOOR_AUTH_HOSTS.has(url.hostname.toLowerCase()) || url.hostname === NOOR_QUEUE_HOST)
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
  if (isAllowedNoorSessionUrl(rawUrl)) return true;
  try {
    const url = new URL(rawUrl);
    const allowedPath = NOOR_RESOURCE_PATHS.get(url.hostname)?.some(prefix => url.pathname.startsWith(prefix));
    // The Nafath sign-in document loads its versioned application bundle here.
    const nafathBundle = url.hostname === 'iamall.pages.dev' && /^\/index-[\w-]+\.(?:js|css)$/.test(url.pathname);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      Boolean(allowedPath || nafathBundle);
  } catch {
    return false;
  }
}

function isAllowedNoorRequest({ url, resourceType }) {
  // A CDN may supply scripts or icons; it must not become a browsing destination.
  return resourceType === 'mainFrame'
    ? isAllowedNoorSessionUrl(url)
    : isAllowedNoorResourceUrl(url);
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
  isAllowedNoorRequest,
  isAllowedNoorSessionUrl,
};
