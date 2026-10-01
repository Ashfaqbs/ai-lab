// Per-site DOM knowledge. Adding a new site is a data change here, not a logic change
// anywhere else. Selectors are best-effort and may need updating if a site's DOM changes
// (see README "Known limitations").

if (typeof window !== 'undefined' && window.InfraMaskSiteAdapters) {
  // already loaded in this page - skip re-declaring
} else {
(function () {
const SITE_ADAPTERS = [
  {
    name: 'chatgpt',
    hostnames: ['chatgpt.com', 'chat.openai.com'],
    inputSelector: '#prompt-textarea, form [contenteditable="true"]',
    responseContainerSelector: '[data-message-author-role="assistant"]',
  },
  {
    name: 'claude',
    hostnames: ['claude.ai'],
    inputSelector: 'div[contenteditable="true"][enterkeyhint], div.ProseMirror[contenteditable="true"]',
    responseContainerSelector: '[data-testid="user-message"] ~ div, .font-claude-message',
  },
  {
    name: 'gemini',
    hostnames: ['gemini.google.com'],
    inputSelector: 'rich-textarea div[contenteditable="true"]',
    responseContainerSelector: 'message-content',
  },
];

function findAdapterForHostname(hostname) {
  return SITE_ADAPTERS.find((a) => a.hostnames.some((h) => hostname === h || hostname.endsWith('.' + h)));
}

const api = { SITE_ADAPTERS, findAdapterForHostname };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.InfraMaskSiteAdapters = api;
}
})();
}
