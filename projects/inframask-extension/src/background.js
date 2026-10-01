// Minimal by design: holds extension-wide on/off state and updates the toolbar badge.
// Never sees message content - masking/unmasking happen entirely in the content script.

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['inframaskEnabled'], (res) => {
    if (typeof res.inframaskEnabled !== 'boolean') {
      chrome.storage.local.set({ inframaskEnabled: true });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'inframask:masked' && sender.tab?.id) {
    chrome.action.setBadgeText({ text: String(message.count || ''), tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#c0392b', tabId: sender.tab.id });
  }
});
