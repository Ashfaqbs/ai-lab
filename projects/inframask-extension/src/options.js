const { loadSettings, saveSettings } = window.InfraMaskSettings;

const enabledToggle = document.getElementById('enabledToggle');
const categoryInputs = {
  credentials: document.getElementById('cat-credentials'),
  infra: document.getElementById('cat-infra'),
  pii: document.getElementById('cat-pii'),
};
const statusEl = document.getElementById('statusEl');
const versionEl = document.getElementById('versionEl');

versionEl.textContent = chrome.runtime.getManifest().version;

loadSettings((settings) => {
  applyToForm(settings);
});

function applyToForm(settings) {
  enabledToggle.checked = settings.enabled;
  Object.keys(categoryInputs).forEach((key) => {
    categoryInputs[key].checked = settings.categories[key] !== false;
  });
}

function readFromForm() {
  const categories = {};
  Object.keys(categoryInputs).forEach((key) => {
    categories[key] = categoryInputs[key].checked;
  });
  return { enabled: enabledToggle.checked, categories };
}

function persist() {
  saveSettings(readFromForm(), () => {
    statusEl.textContent = 'Saved';
    clearTimeout(persist.timer);
    persist.timer = setTimeout(() => {
      statusEl.textContent = '';
    }, 1200);
  });
}

[enabledToggle, ...Object.values(categoryInputs)].forEach((input) => {
  input.addEventListener('change', persist);
});
