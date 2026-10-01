// Wires the Masking Engine and Unmask Observer to the live page DOM.
// Runs as a content script, injected only on the hostnames listed in manifest.json.
if (window.__inframaskContentScriptLoaded) {
  // already running in this page (e.g. a stale re-injection after an extension reload) -
  // a second copy would double-attach listeners and duplicate every mask, so skip it.
} else {
window.__inframaskContentScriptLoaded = true;
(function () {
  const { findAdapterForHostname } = window.InfraMaskSiteAdapters;
  const { createTokenStore } = window.InfraMaskTokenStore;
  const { maskText, unmaskText, TOKEN_PATTERN } = window.InfraMaskEngine;
  const { STORAGE_KEY, DEFAULT_SETTINGS, normalize, loadSettings } = window.InfraMaskSettings;

  const adapter = findAdapterForHostname(location.hostname);
  if (!adapter) return;

  const tokenStore = createTokenStore();
  let settings = DEFAULT_SETTINGS;
  const DEBOUNCE_MS = 150;
  let debounceTimer = null;
  let inputEl = null;
  let responseContainer = null;
  let suppressNextEnter = false;
  let suppressNextSendClick = false;

  loadConfig();
  attachWhenReady();
  listenForPopupRequests();
  interceptSubmission();

  // The debounced `input` handler is fine for masking as-you-type, but it leaves a real gap:
  // type a secret and hit Enter (or paste and immediately click Send) faster than the 150ms
  // debounce, and the ORIGINAL unmasked text goes out before runMask() ever fires. Rather than
  // just shortening the debounce (still racy, just less often), intercept the actual submit
  // triggers - Enter and the site's Send button - in the capture phase at the document root,
  // which runs before the page's own framework-level handlers ever see the event. That lets
  // this force a synchronous mask pass first, then re-trigger the real send once the box
  // provably contains only masked text.
  function interceptSubmission() {
    document.addEventListener('keydown', onKeyDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
  }

  function onKeyDownCapture(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!inputEl || e.target !== inputEl) return;
    if (suppressNextEnter) {
      suppressNextEnter = false;
      return;
    }
    if (!settings.enabled) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    forceMaskNow();
    submitNow();
  }

  function onClickCapture(e) {
    if (!adapter.sendButtonSelector) return;
    const sendBtn = e.target.closest(adapter.sendButtonSelector);
    if (!sendBtn) return;
    if (suppressNextSendClick) {
      suppressNextSendClick = false;
      return;
    }
    if (!settings.enabled) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    forceMaskNow();
    submitNow();
  }

  // Skips the debounce entirely - masks whatever is in the box right now, synchronously.
  function forceMaskNow() {
    clearTimeout(debounceTimer);
    if (inputEl) runMask();
  }

  // Re-triggers the real send now that the box is guaranteed masked. Prefers clicking the
  // site's actual Send button (most reliable); falls back to re-dispatching a native Enter
  // keydown if no send button is found, for sites/states where the button selector is stale.
  function submitNow() {
    const sendBtn = adapter.sendButtonSelector && document.querySelector(adapter.sendButtonSelector);
    const sendBtnReady = sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true';
    if (sendBtnReady) {
      suppressNextSendClick = true;
      sendBtn.click();
      return;
    }
    if (!inputEl) return;
    suppressNextEnter = true;
    inputEl.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
    );
  }

  function listenForPopupRequests() {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'inframask:getTokens') {
        sendResponse({ tokens: tokenStore.entries(), enabled: settings.enabled, site: adapter.name });
      } else if (message?.type === 'inframask:clear') {
        tokenStore.clear();
        sendResponse({ ok: true });
      }
    });
  }

  function loadConfig() {
    loadSettings((loaded) => {
      settings = loaded;
    });
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        settings = normalize(changes[STORAGE_KEY].newValue);
      }
    });
  }

  function attachWhenReady() {
    // Scanning the whole document on every mutation is wasteful once both anchors are
    // found (ChatGPT streams dozens of DOM mutations per second while a response is being
    // written). Stop watching as soon as both are attached; a fresh find-on-demand check
    // runs only if one of them later disappears (e.g. the SPA swaps the composer).
    const observer = new MutationObserver(() => {
      tryAttachInput();
      tryAttachResponseObserver();
      if (inputEl && responseContainer && document.body.contains(inputEl)) {
        observer.disconnect();
        watchForDetachment();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    tryAttachInput();
    tryAttachResponseObserver();
  }

  // Lightweight fallback: if the attached input element is ever removed from the page
  // (SPA navigation swapping the composer out), re-run the heavier whole-document search.
  function watchForDetachment() {
    const checkInterval = setInterval(() => {
      if (!inputEl || !document.body.contains(inputEl)) {
        clearInterval(checkInterval);
        inputEl = null;
        responseContainer = null;
        attachWhenReady();
      }
    }, 2000);
  }

  function tryAttachInput() {
    const el = document.querySelector(adapter.inputSelector);
    if (!el || el === inputEl) return;
    inputEl = el;
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('paste', () => setTimeout(() => onInput(), 0));
    console.log('[InfraMask] attached to input box on', adapter.name);
  }

  function tryAttachResponseObserver() {
    const el = document.querySelector(adapter.responseContainerSelector);
    if (!el || el === responseContainer) return;
    responseContainer = el.closest('main') || document.body;
    const respObserver = new MutationObserver((mutations) => {
      if (!settings.enabled) return;
      mutations.forEach((m) => m.addedNodes.forEach((node) => unmaskNode(node)));
    });
    respObserver.observe(responseContainer, { childList: true, subtree: true, characterData: true });
  }

  function onInput() {
    if (!settings.enabled || !inputEl) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runMask, DEBOUNCE_MS);
  }

  function runMask() {
    const original = inputEl.textContent;
    const { text, changed, maskedCount } = maskText(original, tokenStore, { categories: settings.categories });
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
}
