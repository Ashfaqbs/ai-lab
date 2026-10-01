// Minimal by design: holds extension-wide on/off state and updates the toolbar badge.
// Never sees message content - masking/unmasking happen entirely in the content script.
importScripts('settings.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([self.InfraMaskSettings.STORAGE_KEY], (res) => {
    if (!res[self.InfraMaskSettings.STORAGE_KEY]) {
      self.InfraMaskSettings.saveSettings(self.InfraMaskSettings.DEFAULT_SETTINGS);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'inframask:masked' && sender.tab?.id) {
    chrome.action.setBadgeText({ text: String(message.count || ''), tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#c0392b', tabId: sender.tab.id });
  }
});
