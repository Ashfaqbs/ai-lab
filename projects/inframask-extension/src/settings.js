// Single source of truth for the extension's persisted settings: shape, defaults, and
// load/save helpers. Shared by background.js, content-script.js, popup.js, and options.js so
// the storage key and default values only live in one place.

// Used from both page-like contexts (content script, popup, options page - have `window`)
// and the background service worker (has `self`, not `window`), so resolve whichever one
// is actually the global object here rather than assuming `window`.
var __inframaskGlobal = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : undefined);

if (__inframaskGlobal && __inframaskGlobal.InfraMaskSettings) {
  // already loaded in this page - skip re-declaring
} else {
(function () {

const STORAGE_KEY = 'inframaskSettings';

const DEFAULT_SETTINGS = {
  enabled: true,
  categories: {
    credentials: true, // passwords, API keys, tokens, JWTs, connection strings
    infra: true, // IPs, hostnames, bootstrap servers, URLs
    pii: true, // emails, phone numbers, SSNs, credit card numbers
  },
};

// Merges whatever is in storage over the defaults, so a settings object saved before a new
// category existed still comes back with that category enabled, not undefined/falsy.
function normalize(settings) {
  const base = { ...DEFAULT_SETTINGS, categories: { ...DEFAULT_SETTINGS.categories } };
  if (!settings || typeof settings !== 'object') return base;
  return {
    enabled: typeof settings.enabled === 'boolean' ? settings.enabled : base.enabled,
    categories: { ...base.categories, ...(settings.categories || {}) },
  };
}

function loadSettings(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    callback(normalize(null));
    return;
  }
  chrome.storage.local.get([STORAGE_KEY], (res) => callback(normalize(res[STORAGE_KEY])));
}

function saveSettings(settings, callback) {
  const value = normalize(settings);
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    if (callback) callback(value);
    return;
  }
  chrome.storage.local.set({ [STORAGE_KEY]: value }, () => {
    if (callback) callback(value);
  });
}

const api = { STORAGE_KEY, DEFAULT_SETTINGS, normalize, loadSettings, saveSettings };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  __inframaskGlobal.InfraMaskSettings = api;
}
})();
}
