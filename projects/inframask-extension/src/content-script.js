// Wires the Masking Engine and Unmask Observer to the live page DOM.
// Runs as a content script, injected only on the hostnames listed in manifest.json.
(function () {
  const { findAdapterForHostname } = window.InfraMaskSiteAdapters;
  const { createTokenStore } = window.InfraMaskTokenStore;
  const { maskText, unmaskText, TOKEN_PATTERN } = window.InfraMaskEngine;

  const adapter = findAdapterForHostname(location.hostname);
  if (!adapter) return;

  const tokenStore = createTokenStore();
  let enabled = true;
  const DEBOUNCE_MS = 150;
  let debounceTimer = null;
  let inputEl = null;
  let responseContainer = null;

  loadConfig();
  attachWhenReady();
  listenForPopupRequests();

  function listenForPopupRequests() {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'inframask:getTokens') {
        sendResponse({ tokens: tokenStore.entries(), enabled, site: adapter.name });
      } else if (message?.type === 'inframask:clear') {
        tokenStore.clear();
        sendResponse({ ok: true });
      }
    });
  }

  function loadConfig() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(['inframaskEnabled'], (res) => {
      if (typeof res.inframaskEnabled === 'boolean') enabled = res.inframaskEnabled;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.inframaskEnabled) {
        enabled = changes.inframaskEnabled.newValue;
      }
    });
  }

  function attachWhenReady() {
    const observer = new MutationObserver(() => {
      tryAttachInput();
      tryAttachResponseObserver();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    tryAttachInput();
    tryAttachResponseObserver();
  }

  function tryAttachInput() {
    const el = document.querySelector(adapter.inputSelector);
    if (!el || el === inputEl) return;
    inputEl = el;
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('paste', () => setTimeout(() => onInput(), 0));
  }

  function tryAttachResponseObserver() {
    const el = document.querySelector(adapter.responseContainerSelector);
    if (!el || el === responseContainer) return;
    responseContainer = el.closest('main') || document.body;
    const respObserver = new MutationObserver((mutations) => {
      if (!enabled) return;
      mutations.forEach((m) => m.addedNodes.forEach((node) => unmaskNode(node)));
    });
    respObserver.observe(responseContainer, { childList: true, subtree: true, characterData: true });
  }

  function onInput() {
    if (!enabled || !inputEl) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runMask, DEBOUNCE_MS);
  }

  function runMask() {
    const original = inputEl.textContent;
    const { text, changed, maskedCount } = maskText(original, tokenStore);
    if (!changed) return;

    const caretOffset = getCaretCharOffset(inputEl);
    const delta = text.length - original.length;

    replaceEditableContent(inputEl, text);
    setCaretCharOffset(inputEl, Math.max(0, caretOffset + delta));

    updateBadge(maskedCount);
  }

  // Sites like ChatGPT and Claude render their input box as a ProseMirror/React-controlled
  // contentEditable: the framework owns an internal document model and the DOM is just its
  // output. Writing `el.textContent` directly changes what's displayed but never reaches that
  // internal model, so the ORIGINAL unmasked text is what actually gets submitted. Routing the
  // replacement through execCommand fires the native beforeinput/input events these editors
  // listen to, which updates their internal state to match what's now on screen.
  function replaceEditableContent(el, newText) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    const applied = document.execCommand('insertText', false, newText);
    if (!applied) {
      el.textContent = newText;
    }
  }

  function unmaskNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (TOKEN_PATTERN.test(node.textContent)) {
        node.textContent = unmaskText(node.textContent, tokenStore);
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        TOKEN_PATTERN.lastIndex = 0;
        if (TOKEN_PATTERN.test(n.textContent)) {
          n.textContent = unmaskText(n.textContent, tokenStore);
        }
      }
    }
  }

  function updateBadge(maskedCount) {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    try {
      chrome.runtime.sendMessage({ type: 'inframask:masked', count: tokenStore.entries().length, delta: maskedCount });
    } catch (_err) {
      // background worker may be asleep between events; non-critical
    }
  }

  // Caret offset helpers operate on plain-text contentEditable elements (no nested markup),
  // which matches how chat input boxes render while the user is actively typing.
  function getCaretCharOffset(el) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return el.textContent.length;
    const range = sel.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.endContainer, range.endOffset);
    return preRange.toString().length;
  }

  function setCaretCharOffset(el, offset) {
    const range = document.createRange();
    const sel = window.getSelection();
    let remaining = offset;
    let node = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while ((node = walker.nextNode())) {
      if (remaining <= node.textContent.length) break;
      remaining -= node.textContent.length;
    }
    if (!node) {
      range.selectNodeContents(el);
      range.collapse(false);
    } else {
      range.setStart(node, Math.min(remaining, node.textContent.length));
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }
})();
