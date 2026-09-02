const path = require('node:path');
const { fileURLToPath } = require('node:url');

/** Decide whether a main-window URL may access Hader's privileged Electron bridge. */
function isTrustedAppNavigation(rawUrl, options) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (options.isDevelopment) {
      return parsedUrl.origin === options.developmentOrigin;
    }
    if (parsedUrl.protocol === 'https:' && parsedUrl.origin === options.productionOrigin) {
      return true;
    }
    return parsedUrl.protocol === 'file:'
      && path.resolve(fileURLToPath(parsedUrl)) === path.resolve(options.localEntryFile);
  } catch {
    return false;
  }
}

module.exports = { isTrustedAppNavigation };
