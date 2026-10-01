// Bidirectional, per-tab, in-memory token <-> real-value map.
// Mirrors into chrome.storage.session (when available) so the popup UI can display the
// live token map for transparency. The in-memory map is the source of truth for the
// synchronous masking path; chrome.storage.session is best-effort and never read back
// into the hot path, so a slow/failed storage write never blocks typing.

if (typeof window !== 'undefined' && window.InfraMaskTokenStore) {
  // already loaded in this page - skip re-declaring
} else {
(function () {
const TOKEN_LABELS = {
  private_key: 'PRIVATEKEY',
  jwt: 'JWT',
  conn_string: 'CONNSTR',
  bootstrap_servers: 'BOOTSTRAP',
  aws_access_key: 'APIKEY',
  api_key: 'APIKEY',
  bearer_token: 'TOKEN',
  credential_kv: 'CRED',
  host_port: 'HOST',
  url: 'URL',
  hostname: 'HOST',
  ipv6: 'IP',
  ipv4: 'IP',
};

function createTokenStore() {
  const valueToToken = new Map();
  const tokenToValue = new Map();
  const counters = {};

  function nextLabel(type) {
    const label = TOKEN_LABELS[type] || 'VAL';
    counters[label] = (counters[label] || 0) + 1;
    return `⟦${label}_${counters[label]}⟧`; // ⟦LABEL_n⟧
  }

  function tokenFor(type, value) {
    const existing = valueToToken.get(value);
    if (existing) return existing;

    const token = nextLabel(type);
    valueToToken.set(value, token);
    tokenToValue.set(token, value);
    persist();
    return token;
  }

  function realValueFor(token) {
    return tokenToValue.get(token);
  }

  function entries() {
    return Array.from(tokenToValue.entries()).map(([token, value]) => ({ token, value }));
  }

  function clear() {
    valueToToken.clear();
    tokenToValue.clear();
    Object.keys(counters).forEach((k) => delete counters[k]);
    persist();
  }

  function persist() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.session) return;
    try {
      chrome.storage.session.set({ [sessionStorageKey()]: entries() }).catch(() => {});
    } catch (_err) {
      // storage unavailable (e.g. running under a unit test) — in-memory map still works
    }
  }

  // sessionStorage is natively per-tab, so it's reused here only to mint a stable id for
  // this tab, letting the popup read back just this tab's token map from
  // chrome.storage.session (which is extension-wide, not tab-scoped, on its own).
  function sessionStorageKey() {
    try {
      let id = window.sessionStorage.getItem('inframaskTabId');
      if (!id) {
        id = Math.random().toString(36).slice(2);
        window.sessionStorage.setItem('inframaskTabId', id);
      }
      return `inframaskTokens_${id}`;
    } catch (_err) {
      return 'inframaskTokens_default';
    }
  }

  return { tokenFor, realValueFor, entries, clear };
}

const api = { createTokenStore, TOKEN_LABELS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.InfraMaskTokenStore = api;
}
})();
}
