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
    // Verified live against chatgpt.com.
    sendButtonSelector: '#composer-submit-button, button[data-testid="send-button"]',
  },
  {
    name: 'claude',
    hostnames: ['claude.ai'],
    inputSelector: 'div[contenteditable="true"][enterkeyhint], div.ProseMirror[contenteditable="true"]',
    // Verified live against an existing claude.ai conversation (the old selector,
    // '[data-testid="user-message"] ~ div, .font-claude-message', matched zero elements -
    // assistant replies were never getting unmasked back to their real values).
    responseContainerSelector: '[data-testid="assistant-message"]',
    // Verified live against claude.ai: input selector matches exactly one element, and the
    // send button's disabled/ready check correctly flips once the composer has text.
    sendButtonSelector: 'button[aria-label="Send Message"], button[aria-label="Send message"]',
  },
  {
    name: 'gemini',
    hostnames: ['gemini.google.com'],
    // Gemini's composer is built on Quill, which keeps a second, off-screen
    // contenteditable (class "ql-clipboard") as an internal paste buffer - it matches this
    // selector too, so it's excluded explicitly rather than relying on DOM order or the
    // generic focused-element fallback in content-script.js's resolveComposer() to skip it.
    inputSelector: 'rich-textarea div[contenteditable="true"]:not(.ql-clipboard)',
    // Verified live against an existing gemini.google.com conversation - matches real
    // assistant-reply elements.
    responseContainerSelector: 'message-content',
    // Verified live against gemini.google.com: input, send button ("Send message", only
    // rendered once the composer has text), and this disabled/ready check all confirmed.
    sendButtonSelector: 'button[aria-label="Send message"]',
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
