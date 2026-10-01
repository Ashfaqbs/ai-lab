const enabledToggle = document.getElementById('enabledToggle');
const statusEl = document.getElementById('status');
const tokensEl = document.getElementById('tokens');
const clearBtn = document.getElementById('clearBtn');

let activeTabId = null;

chrome.storage.local.get(['inframaskEnabled'], (res) => {
  enabledToggle.checked = res.inframaskEnabled !== false;
});

enabledToggle.addEventListener('change', () => {
  chrome.storage.local.set({ inframaskEnabled: enabledToggle.checked });
});

clearBtn.addEventListener('click', () => {
  if (activeTabId == null) return;
  chrome.tabs.sendMessage(activeTabId, { type: 'inframask:clear' }, () => refresh());
});

function refresh() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) {
      statusEl.textContent = 'No active tab.';
      return;
    }
    activeTabId = tab.id;
    chrome.tabs.sendMessage(tab.id, { type: 'inframask:getTokens' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        statusEl.textContent = 'Not an active AI chat tab (ChatGPT, Claude, or Gemini).';
        tokensEl.innerHTML = '';
        return;
      }
      statusEl.textContent = `Site: ${res.site} — ${res.tokens.length} value(s) masked this session.`;
      tokensEl.replaceChildren(
        ...res.tokens.map((t) => {
          const row = document.createElement('div');
          const strong = document.createElement('strong');
          strong.textContent = t.token;
          row.appendChild(strong);
          return row;
        })
      );
    });
  });
}

refresh();
