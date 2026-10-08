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
  credit_card: 'CARD',
  ssn: 'SSN',
  email: 'EMAIL',
  phone: 'PHONE',
};

// A tab's content script (and its TokenStore) stays alive across an SPA's client-side
// navigations - switching conversations never reloads the page, so nothing ever clears
// the map on its own. Over a long-running tab that masks many distinct secrets across many
// conversations, this would otherwise grow without bound. Capping it and dropping the
// oldest entries first keeps memory flat; losing the ability to unmask a very old, no-longer
// -visible token is an acceptable trade-off for not leaking memory for the life of the tab.
const MAX_TOKENS = 2000;

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

    if (valueToToken.size >= MAX_TOKENS) {
      // Map iteration order is insertion order, so the first key is the oldest entry.
      const oldestValue = valueToToken.keys().next().value;
      const oldestToken = valueToToken.get(oldestValue);
      valueToToken.delete(oldestValue);
      tokenToValue.delete(oldestToken);
    }

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
