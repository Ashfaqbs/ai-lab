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
  let inputEl = null;
  let responseContainer = null;
  let suppressNextEnter = false;
  let suppressNextSendClick = false;

  loadConfig();
  attachWhenReady();
  listenForPopupRequests();
  interceptSubmission();

  // Masking happens exactly once, right before the message actually goes out - not on every
  // keystroke/paste. Two earlier, verified problems with masking live as-you-type drove this:
  //
  // 1. A rewrite-on-every-input approach still has a race: type a secret and hit Enter (or
  //    paste and immediately click Send) faster than a debounce window, and the ORIGINAL
  //    unmasked text could go out before a mask pass ever ran.
  // 2. Rewriting the whole editor on every keystroke fights ChatGPT's own editor. Verified
  //    live: `el.textContent` on this contentEditable silently drops ALL line breaks between
  //    paragraphs (a 3-line paste reads back as one run-on string), so every live mask pass
  //    was reading flattened text and writing it back - collapsing multi-line pasted content
  //    (exactly the YAML/.properties case this is meant to handle) into an unreadable, broken
  //    single block, and leaving the editor's internal paragraph structure corrupted enough
  //    that further edits stopped landing correctly.
  //
  // Masking once, synchronously, at the moment of submission avoids both: there's no window
  // between "masked" and "sent" for a race to exist in, and the DOM is never rewritten while
  // the user is still actively editing, so there's nothing to corrupt.
  //
  // The interception itself runs in the capture phase at the document root, which fires before
  // the page's own framework-level handlers ever see the event, regardless of where they
  // attach theirs.
  function interceptSubmission() {
    document.addEventListener('keydown', onKeyDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
  }

  function onKeyDownCapture(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const isComposer = isComposerTarget(e.target);
    // Temporary diagnostic log - shows exactly why interception did or didn't fire for this
    // Enter press. Remove once the "sent unmasked" bug is confirmed fixed.
    console.log('[InfraMask] Enter captured', {
      isComposer,
      targetTag: e.target && e.target.tagName,
      settingsEnabled: settings.enabled,
      suppressNextEnter,
    });
    if (!isComposer) return;
    if (suppressNextEnter) {
      suppressNextEnter = false;
      return;
    }
    if (!settings.enabled) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    console.log('[InfraMask] masking and resubmitting now');
    forceMaskNow();
    submitNow();
  }

  function onClickCapture(e) {
    if (!adapter.sendButtonSelector) return;
    const sendBtn = e.target.closest(adapter.sendButtonSelector);
    if (!sendBtn) return;
    console.log('[InfraMask] send button click captured', { suppressNextSendClick, settingsEnabled: settings.enabled });
    if (suppressNextSendClick) {
      suppressNextSendClick = false;
      return;
    }
    if (!settings.enabled) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    console.log('[InfraMask] masking and resubmitting now (button click)');

    // A send-button click doesn't carry the composer as e.target, so `inputEl` could still
    // be a stale reference here - refresh it from the live DOM before masking.
    const liveInput = resolveComposer();
    if (liveInput) inputEl = liveInput;

    forceMaskNow();
    submitNow();
  }

  // `adapter.inputSelector` is a comma-separated selector list (e.g. ChatGPT's
  // '#prompt-textarea, form [contenteditable="true"]"); a plain querySelector just returns
  // the first DOM-order match, which can be the WRONG box when the page has more than one
  // element matching it at once - e.g. an inline "edit previous message" contenteditable
  // sitting earlier in the DOM than the real composer. Preferring whichever match currently
  // has focus (or contains the focused node) makes this unambiguous: the user can only be
  // typing into one element at a time, and that's always the one we want.
  function resolveComposer() {
    const candidates = document.querySelectorAll(adapter.inputSelector);
    if (candidates.length === 0) return null;
    const active = document.activeElement;
    for (const candidate of candidates) {
      if (candidate === active || (active && candidate.contains(active))) return candidate;
    }
    for (const candidate of candidates) {
      if (candidate.offsetParent !== null) return candidate;
    }
    return candidates[0];
  }

  // Checking `e.target === inputEl` by strict reference used to leave a window where a
  // stale cached `inputEl` (the composer's DOM node was swapped by an SPA re-render) made
  // this function return without ever calling preventDefault() - so the REAL, unmasked
  // Enter keydown fell through to the page's own handler untouched. `watchForDetachment`
  // only re-scans every 2s, so a swap could silently bypass masking for up to that long.
  // Matching the live event target against the adapter's selector directly - and adopting
  // it as the new `inputEl` when it differs - closes that window: there's no reliance on a
  // cached reference staying fresh, and the cache self-heals on the very next keystroke.
  function isComposerTarget(target) {
    if (!(target instanceof Element)) return false;
    const match = target.closest(adapter.inputSelector);
    if (!match) return false;
    if (match !== inputEl) inputEl = match;
    return true;
  }

  function forceMaskNow() {
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
    const el = resolveComposer();
    if (!el || el === inputEl) return;
    inputEl = el;
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

  function runMask() {
    if (!settings.enabled) return;
    const original = getEditableText(inputEl);
    const { text, changed, maskedCount } = maskText(original, tokenStore, { categories: settings.categories });
    if (!changed) return;

    replaceEditableContent(inputEl, text);
    updateBadge(maskedCount);
  }

  // `el.textContent` silently drops line breaks between a contentEditable's paragraph
  // elements (verified live: a 3-line paste reads back as one run-on string with zero
  // separation) - `innerText` preserves them, but as a blank line (two newlines) between
  // paragraphs rather than one, so it's normalized back down to a single '\n' per line
  // boundary. Masking never runs mid-edit anymore (see interceptSubmission above), so this
  // only needs to be correct once, at submission time, not round-trip cleanly during typing.
  function getEditableText(el) {
    return el.innerText.replace(/\n{2,}/g, '\n');
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
})();
}
