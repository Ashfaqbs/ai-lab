const { loadSettings, saveSettings } = window.InfraMaskSettings;

const enabledToggle = document.getElementById('enabledToggle');
const statusEl = document.getElementById('status');
const tokensEl = document.getElementById('tokens');
const clearBtn = document.getElementById('clearBtn');
const optionsBtn = document.getElementById('optionsBtn');

let activeTabId = null;

loadSettings((settings) => {
  enabledToggle.checked = settings.enabled;
});

enabledToggle.addEventListener('change', () => {
  loadSettings((settings) => {
    saveSettings({ ...settings, enabled: enabledToggle.checked });
  });
});

optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

clearBtn.addEventListener('click', () => {
  if (activeTabId == null) return;
  chrome.tabs.sendMessage(activeTabId, { type: 'inframask:clear' }, () => {
    void chrome.runtime.lastError; // mark as read so Chrome doesn't log an unchecked warning
    refresh();
  });
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
        void chrome.runtime.lastError; // mark as read so Chrome doesn't log an unchecked warning
        statusEl.textContent = 'Not an active AI chat tab (ChatGPT, Claude, or Gemini).';
        tokensEl.replaceChildren();
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
