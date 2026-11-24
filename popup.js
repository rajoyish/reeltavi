const DEFAULTS = {
  showButton: true,
  doubleClick: true,
  autoFullscreenReels: false,
  keyboardShortcuts: true,
};

const status = document.getElementById('status');
const shortcutsNote = document.getElementById('shortcutsNote');
const NOTE_ON = shortcutsNote.textContent;
const NOTE_OFF = 'Keyboard shortcuts are off. Turn them on in Settings.';

const syncNote = (on) => {
  shortcutsNote.textContent = on ? NOTE_ON : NOTE_OFF;
  shortcutsNote.classList.toggle('off', !on);
};

chrome.storage.sync.get(DEFAULTS, (stored) => {
  for (const key of Object.keys(DEFAULTS)) {
    document.getElementById(key).checked = stored[key] ?? DEFAULTS[key];
  }
  syncNote(stored.keyboardShortcuts ?? true);
});

for (const key of Object.keys(DEFAULTS)) {
  const input = document.getElementById(key);
  input.addEventListener('change', () => {
    chrome.storage.sync.set({ [key]: input.checked });
    if (key === 'keyboardShortcuts') syncNote(input.checked);
  });
}

// Tabs: click, or Left/Right/Home/End when a tab has focus (WAI-ARIA tabs pattern).
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab, false));
  tab.addEventListener('keydown', (e) => {
    const at = tabs.indexOf(tab);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length], true);
  });
}

function setStatus(text) {
  status.textContent = text;
  setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 3000);
}

document.getElementById('fullscreenNow').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/([\w-]+\.)*facebook\.com\//.test(tab.url)) {
    setStatus('Open a Facebook video or Reel first.');
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'FBFS_FULLSCREEN_CURRENT' });
    setStatus(res?.ok ? 'Going fullscreen…' : 'No video found on this page yet.');
  } catch {
    setStatus('Reload the Facebook tab once, then try again.');
  }
});
