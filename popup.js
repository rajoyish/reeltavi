const DEFAULTS = {
  showButton: true,
  doubleClick: true,
  autoFullscreenReels: false,
};

const els = {
  showButton: document.getElementById('showButton'),
  doubleClick: document.getElementById('doubleClick'),
  autoFullscreenReels: document.getElementById('autoFullscreenReels'),
  fullscreenNow: document.getElementById('fullscreenNow'),
  status: document.getElementById('status'),
};

chrome.storage.sync.get(DEFAULTS, (stored) => {
  for (const key of Object.keys(DEFAULTS)) {
    els[key].checked = stored[key] !== undefined ? stored[key] : DEFAULTS[key];
  }
});

for (const key of Object.keys(DEFAULTS)) {
  els[key].addEventListener('change', () => {
    chrome.storage.sync.set({ [key]: els[key].checked });
  });
}

function setStatus(text) {
  els.status.textContent = text;
  setTimeout(() => { if (els.status.textContent === text) els.status.textContent = ''; }, 3000);
}

els.fullscreenNow.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('facebook.com')) {
    setStatus('Open a Facebook video or Reel first.');
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'FBFS_FULLSCREEN_CURRENT' });
    setStatus(res && res.ok ? 'Going fullscreen…' : 'No video found on this page yet.');
  } catch (err) {
    setStatus('Reload the Facebook tab once, then try again.');
  }
});
