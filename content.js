/* ReelTavi – Video Controller for Facebook — content script
 * Places playback controls above the Reel's author row, or at the
 * bottom of a video when there is no author overlay:
 *   [ -10s ] [ play/pause ] [ +10s ]  00:04  [----o---- slider ----]  03:39  [ fullscreen ]
 * The bar hides when the mouse leaves the video, and after 3s idle
 * while playing. Double-click still toggles fullscreen, and the popup
 * can turn on auto-fullscreen for Reels.
 *
 * Chrome only allows fullscreen after a user gesture, so auto-fullscreen
 * is attempted on the video's `play` event. If the browser blocks it,
 * the bar pulses instead.
 */

const DEFAULTS = {
  showButton: true, // now means: show the custom control bar
  doubleClick: true,
  autoFullscreenReels: false,
};

let settings = { ...DEFAULTS };
const videoBars = new WeakMap();
let lastActiveVideo = null;

// Progress for downloads, sent by the service worker. Keyed by job key.
const downloadJobs = new Map();
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'REELTAVI_PROGRESS') return;
  const handler = downloadJobs.get(message.key);
  if (!handler) return;
  if (message.done || message.error) downloadJobs.delete(message.key);
  handler(message);
});

// The author overlay can be a sibling of the video wrapper. Only search
// within this player's branch, so adjacent Reels keep their own controls.
function positionControls(video) {
  const container = video.parentElement;
  const frame = video.getBoundingClientRect();
  if (frame.bottom <= 0 || frame.top >= innerHeight || !frame.height) return;

  let scope = container;
  while (scope !== document.fullscreenElement && scope.parentElement &&
         !scope.matches('main, article, [role="main"], [role="article"], [role="dialog"]')) {
    const parent = scope.parentElement;
    if (parent === document.body || parent.matches('[role="feed"]') ||
        parent.querySelectorAll('video').length > 1) break;
    scope = parent;
  }

  let authorTop = Infinity;
  for (const link of scope.querySelectorAll('a[href]')) {
    // Page handles, numeric profiles, and Facebook's longer page URLs.
    if (!/(^|\.)facebook\.com$/i.test(link.hostname) ||
        !/^\/(?:[\w.\-]+|(?:people|pages)\/[^/]+\/\d+)\/?$/.test(link.pathname) ||
        /^\/(?:reels?|watch|share|groups|audio|stories)\/?$/i.test(link.pathname)) continue;
    if (!link.textContent.trim() && !link.querySelector('img, image')) continue;
    const rect = link.getBoundingClientRect();
    if (rect.width && rect.height && rect.left >= frame.left - 1 &&
        rect.left < frame.left + frame.width / 2 &&
        rect.top >= frame.top + frame.height / 2 && rect.bottom <= frame.bottom + 1) {
      authorTop = Math.min(authorTop, rect.top);
    }
  }

  if (Number.isFinite(authorTop)) {
    const bottom = container.getBoundingClientRect().top + container.clientTop + container.clientHeight;
    container.style.setProperty('--fbfs-author-offset', `${Math.ceil(bottom - authorTop + 8)}px`);
  } else {
    container.style.removeProperty('--fbfs-author-offset');
  }
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  scanForVideos();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [key, change] of Object.entries(changes)) {
    settings[key] = change.newValue;
  }
  document.querySelectorAll('.fbfs-bar').forEach((bar) => {
    bar.style.display = settings.showButton ? '' : 'none';
  });
  scanForVideos();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'FBFS_FULLSCREEN_CURRENT') {
    const video = getActiveVideo();
    if (video) {
      toggleFullscreen(video);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'No video found on this page.' });
    }
    return true;
  }
  if (msg && msg.type === 'FBFS_GET_SETTINGS') {
    sendResponse({ ...settings });
    return true;
  }
});

function isReelPage() {
  return location.pathname.includes('/reel') || location.pathname.includes('/reels');
}

function getReelTargets(video) {
  const reelPage = isReelPage();
  const viewer = video.closest('[role="dialog"]') ||
    (reelPage ? document : video.closest('article, [role="article"]'));
  if (!viewer) return null;

  const targets = { previous: null, next: null };
  const labels = viewer.querySelectorAll(
    '[aria-label*="previous" i], [aria-label*="next" i], [title*="previous" i], [title*="next" i]'
  );
  for (const label of labels) {
    const button = label.closest('button, [role="button"], a[href]');
    if (!button || button.closest('.fbfs-bar, [hidden], [aria-hidden="true"]') ||
        !button.getClientRects().length) continue;
    const name = label.getAttribute('aria-label') || label.title || '';
    const match = /^(?:(?:go to|see|play|watch|view|show) (?:the )?)?(previous|next)(?: (reel|video|card))?$/i.exec(name.trim());
    if (!match || (!reelPage && match[2]?.toLowerCase() !== 'reel')) continue;
    const direction = match[1].toLowerCase();
    if (!targets[direction] || match[2]?.toLowerCase() === 'reel') targets[direction] = button;
  }

  // Some Reel feeds use vertically stacked players without navigation buttons.
  if (reelPage && (!targets.previous || !targets.next)) {
    const frame = video.getBoundingClientRect();
    const column = [...viewer.querySelectorAll('video')].filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.height >= 100 && Math.abs(rect.left - frame.left) < 8 &&
        Math.abs(rect.width - frame.width) < 8;
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const index = column.indexOf(video);
    if (index >= 0) {
      const before = column[index - 1];
      const after = column[index + 1];
      if (before && before.getBoundingClientRect().bottom <= frame.top + 1) targets.previous ??= before;
      if (after && after.getBoundingClientRect().top >= frame.bottom - 1) targets.next ??= after;
    }
  }
  return reelPage || targets.previous || targets.next ? targets : null;
}

function navigationAvailable(target) {
  return target && !target.closest(':disabled, [aria-disabled="true"], [inert]');
}

async function navigateReel(video, direction) {
  let target = getReelTargets(video)?.[direction];
  if (!navigationAvailable(target)) return;
  if (document.fullscreenElement && !document.fullscreenElement.contains(target)) {
    await document.exitFullscreen();
    target = getReelTargets(video)?.[direction];
    if (!navigationAvailable(target)) return;
  }
  if (target.matches('video')) target.scrollIntoView({ block: 'center' });
  else target.click();
}

function isReelVideo(video) {
  if (isReelPage()) return true;
  const w = video.videoWidth || video.clientWidth;
  const h = video.videoHeight || video.clientHeight;
  return w && h && h / w > 1.2;
}

function getFullscreenTarget(video) {
  // The bar lives inside the video's direct parent, so fullscreen that
  // parent and the bar stays visible inside fullscreen. Fall back to
  // climbing a few ancestors, then to the <video> itself.
  const container = video.parentElement;
  if (container && container.hasAttribute('data-fbfs')) return container;
  let el = video.parentElement;
  for (let i = 0; i < 5 && el; i++) {
    const r = el.getBoundingClientRect();
    const vr = video.getBoundingClientRect();
    if (r.width >= vr.width * 0.9 && r.height >= vr.height * 0.9 && r.width > 0) {
      if (r.height < window.innerHeight * 1.5) return el;
    }
    el = el.parentElement;
  }
  return video;
}

async function toggleFullscreen(video) {
  if (!video) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    const target = getFullscreenTarget(video);
    if (target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: 'hide' });
    } else if (video.requestFullscreen) {
      await video.requestFullscreen();
    } else if (video.webkitRequestFullscreen) {
      video.webkitRequestFullscreen();
    }
  } catch (err) {
    const bar = video.parentElement && video.parentElement.querySelector('.fbfs-bar');
    if (bar) bar.classList.add('fbfs-pulse');
    setTimeout(() => bar && bar.classList.remove('fbfs-pulse'), 1600);
    console.debug('[ReelTavi] Fullscreen blocked:', err && err.message);
  }
}

function getActiveVideo() {
  if (lastActiveVideo && document.contains(lastActiveVideo)) return lastActiveVideo;
  const videos = [...document.querySelectorAll('video')].filter((v) => v.clientHeight > 80);
  if (!videos.length) return null;
  const playing = videos.find((v) => !v.paused && !v.ended);
  if (playing) return playing;
  let best = null;
  let bestScore = -1;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    const visible = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const score = visible * r.width;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best;
}

function formatTime(sec) {
  if (!isFinite(sec) || sec == null) return '00:00';
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_FULLSCREEN =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_EXIT_FULLSCREEN =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

function skipIcon(dir) {
  // Mirror only the arrow so both buttons share the same upright, centered digits.
  const mirror = dir > 0 ? ' transform="translate(32 0) scale(-1 1)"' : '';
  return `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <g${mirror} stroke-width="2">
      <path d="M16 5a11 11 0 1 1-10.34 7.24"/>
      <path d="m19.5 2-4 3 4 3"/>
    </g>
    <g transform="translate(4 4) scale(.75)" stroke-width="1.8">
      <path d="m10.5 14 2.5-1.8v8"/>
      <rect x="16" y="12.2" width="5.5" height="8" rx="2.75"/>
    </g>
  </svg>`;
}

function makeControls(video) {
  const bar = document.createElement('div');
  bar.className = 'fbfs-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Video controls');

  bar.innerHTML = `
    <button type="button" class="fbfs-ctrl fbfs-skip" data-skip="-10" title="Back 10 seconds" aria-label="Back 10 seconds">${skipIcon(-1)}</button>
    <button type="button" class="fbfs-ctrl fbfs-play" title="Play / pause" aria-label="Play or pause">${ICON_PLAY}</button>
    <button type="button" class="fbfs-ctrl fbfs-skip" data-skip="10" title="Forward 10 seconds" aria-label="Forward 10 seconds">${skipIcon(1)}</button>
    <div class="fbfs-volume" role="group" aria-label="Volume">
      <button type="button" class="fbfs-ctrl fbfs-sound" title="Mute" aria-label="Mute">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9h4l5-4v14l-5-4H3z"/>
          <path class="fbfs-waves" d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/>
          <path class="fbfs-cross" d="m16 9 5 6m0-6-5 6"/>
        </svg>
      </button>
      <input type="range" class="fbfs-volume-slider" min="0" max="100" step="1" aria-label="Volume">
      <span class="fbfs-volume-level" aria-hidden="true"></span>
    </div>
    <span class="fbfs-time fbfs-current">00:00</span>
    <input type="range" class="fbfs-seek" min="0" max="1000" value="0" step="1" aria-label="Seek">
    <span class="fbfs-time fbfs-duration">00:00</span>
    <button type="button" class="fbfs-ctrl" data-reel="previous" hidden title="Previous Reel" aria-label="Previous Reel">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>
    </button>
    <button type="button" class="fbfs-ctrl" data-reel="next" hidden title="Next Reel" aria-label="Next Reel">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <button type="button" class="fbfs-ctrl fbfs-download" title="Download video" aria-label="Download video" aria-haspopup="menu" aria-expanded="false">
      <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></svg>
    </button>
    <button type="button" class="fbfs-ctrl fbfs-fs" title="Fullscreen" aria-label="Fullscreen">${ICON_FULLSCREEN}</button>
    <div class="fbfs-download-status" hidden>
      <span class="fbfs-download-text" role="status"></span>
      <progress class="fbfs-download-progress" max="100" hidden aria-label="Download progress"></progress>
      <button type="button" class="fbfs-download-show" hidden>Show in folder</button>
    </div>
    <div class="fbfs-download-menu" role="menu" aria-label="Download quality" hidden></div>
  `;

  const playBtn = bar.querySelector('.fbfs-play');
  const soundBtn = bar.querySelector('.fbfs-sound');
  const volumeSlider = bar.querySelector('.fbfs-volume-slider');
  const volumeLevel = bar.querySelector('.fbfs-volume-level');
  const seek = bar.querySelector('.fbfs-seek');
  const currentEl = bar.querySelector('.fbfs-current');
  const durationEl = bar.querySelector('.fbfs-duration');
  const fsBtn = bar.querySelector('.fbfs-fs');
  let seeking = false;

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  // Clicks on the bar must not toggle Facebook's own play/pause.
  bar.addEventListener('click', (e) => e.stopPropagation());
  bar.addEventListener('dblclick', (e) => e.stopPropagation());
  bar.addEventListener('mousedown', (e) => e.stopPropagation());

  const download = bar.querySelector('.fbfs-download');
  const downloadStatus = bar.querySelector('.fbfs-download-status');
  const downloadText = bar.querySelector('.fbfs-download-text');
  const downloadProgress = bar.querySelector('.fbfs-download-progress');
  const downloadShow = bar.querySelector('.fbfs-download-show');
  const downloadMenu = bar.querySelector('.fbfs-download-menu');
  let statusTimer;
  let shownDownload = null;
  // percent: null hides the bar, undefined shows a busy bar, a number shows that progress.
  const showStatus = (text, { hold = false, percent = null, downloadId = null } = {}) => {
    clearTimeout(statusTimer);
    downloadText.textContent = text;
    downloadStatus.hidden = !text;
    downloadProgress.hidden = percent === null;
    if (percent === undefined) downloadProgress.removeAttribute('value');
    else if (percent !== null) downloadProgress.value = percent;
    shownDownload = downloadId;
    downloadShow.hidden = downloadId === null;
    if (text && !hold) statusTimer = setTimeout(() => showStatus(''), downloadId === null ? 6000 : 10000);
  };
  downloadShow.addEventListener('click', (e) => {
    stop(e);
    if (e.isTrusted && shownDownload !== null) chrome.runtime.sendMessage({ type: 'REELTAVI_SHOW', downloadId: shownDownload });
  });
  const closeMenu = (refocus) => {
    if (downloadMenu.hidden) return;
    downloadMenu.hidden = true;
    downloadMenu.replaceChildren();
    download.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outsideMenu, true);
    if (refocus) download.focus();
  };
  const outsideMenu = (e) => { if (!downloadMenu.contains(e.target) && e.target !== download) closeMenu(); };
  downloadMenu.addEventListener('keydown', (e) => {
    const items = [...downloadMenu.querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { stop(e); closeMenu(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      stop(e);
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });

  let downloading = false;
  const setDownloading = (value) => {
    downloading = value;
    download.disabled = value;
    download.classList.toggle('fbfs-busy', value);
  };
  const phaseText = {
    downloading: 'Downloading',
    converting: 'Converting to H.264',
    joining: 'Joining video and sound',
    saving: 'Saving to Downloads',
  };

  const startDownload = async ({ id, option }) => {
    setDownloading(true);
    showStatus('Starting ' + option.label + ' download…', { hold: true, percent: undefined });
    try {
      const { label, ...source } = option;
      const result = await chrome.runtime.sendMessage({ type: 'REELTAVI_DOWNLOAD', job: { id, ...source } });
      if (!result?.key) throw new Error(result?.error || 'Reload the extension and refresh Facebook to download.');
      downloadJobs.set(result.key, (update) => {
        if (update.error) {
          setDownloading(false);
          showStatus(update.error);
        } else if (update.done) {
          setDownloading(false);
          showStatus('Saved ' + update.file, { downloadId: update.downloadId });
        } else {
          const percent = Number.isFinite(update.percent) ? update.percent : undefined;
          const text = option.label + ' · ' + (phaseText[update.phase] || 'Downloading') +
            (percent === undefined ? '…' : ' ' + percent + '%');
          showStatus(text, { hold: true, percent });
        }
      });
    } catch (error) {
      setDownloading(false);
      showStatus(error.message || 'Could not start the download.');
    }
  };

  download.addEventListener('click', async (event) => {
    stop(event);
    if (!event.isTrusted || downloading) return;
    if (!downloadMenu.hidden) { closeMenu(); return; }
    setDownloading(true);
    showStatus('Finding video…', { hold: true, percent: undefined });
    let found;
    try {
      found = await findDownload(video);
    } catch (error) {
      showStatus(error.message || 'Could not start the download.');
      return;
    } finally {
      setDownloading(false);
    }
    if (found.options.length === 1) {
      startDownload({ id: found.id, option: found.options[0] });
      return;
    }
    showStatus('');
    // SD first, highest quality last, matching the order people scan resolutions.
    const options = [...found.options].sort((a, b) => (a.quality === 'sd' ? -1 : 0) - (b.quality === 'sd' ? -1 : 0));
    downloadMenu.replaceChildren(...options.map(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'fbfs-download-option';
      item.setAttribute('role', 'menuitem');
      item.textContent = option.label;
      item.addEventListener('click', (e) => {
        stop(e);
        if (!e.isTrusted) return;
        closeMenu(true);
        startDownload({ id: found.id, option });
      });
      return item;
    }));
    downloadMenu.hidden = false;
    download.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outsideMenu, true);
    downloadMenu.querySelector('button').focus();
  });

  playBtn.addEventListener('click', (e) => {
    stop(e);
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });

  let audibleVolume = video.volume || 0.5;
  const syncSound = () => {
    if (video.volume > 0) audibleVolume = video.volume;
    const silent = video.muted || video.volume === 0;
    soundBtn.classList.toggle('fbfs-muted', silent);
    soundBtn.title = silent ? 'Unmute' : 'Mute';
    soundBtn.setAttribute('aria-label', soundBtn.title);
    const percent = silent ? 0 : Math.round(video.volume * 100);
    volumeSlider.value = String(percent);
    volumeSlider.setAttribute('aria-valuetext', percent + '%');
    volumeLevel.textContent = percent + '%';
  };
  volumeSlider.addEventListener('input', (event) => {
    event.stopPropagation();
    video.volume = Number(volumeSlider.value) / 100;
    video.muted = video.volume === 0;
    syncSound();
  });
  volumeSlider.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      event.stopPropagation();
    }
  });
  soundBtn.addEventListener('click', (e) => {
    stop(e);
    const silent = video.muted || video.volume === 0;
    if (video.volume === 0) video.volume = audibleVolume;
    video.muted = !silent;
    syncSound();
  });
  video.addEventListener('volumechange', syncSound);
  syncSound();

  for (const button of bar.querySelectorAll('[data-reel]')) {
    button.addEventListener('click', (event) => {
      stop(event);
      navigateReel(video, button.dataset.reel).catch((error) => console.debug('[ReelTavi]', error));
    });
  }

  bar.querySelectorAll('.fbfs-skip').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      stop(e);
      const delta = Number(btn.dataset.skip || 0);
      video.currentTime = Math.min(
        Math.max(0, (video.currentTime || 0) + delta),
        isFinite(video.duration) ? video.duration : video.currentTime + delta
      );
    });
  });

  fsBtn.addEventListener('click', (e) => {
    stop(e);
    toggleFullscreen(video);
  });

  // Scrub through the video with the slider.
  seek.addEventListener('input', () => {
    seeking = true;
    if (isFinite(video.duration) && video.duration > 0) {
      video.currentTime = (Number(seek.value) / 1000) * video.duration;
      currentEl.textContent = formatTime(video.currentTime);
    }
  });
  seek.addEventListener('change', () => { seeking = false; });

  const syncPlayIcon = () => {
    playBtn.innerHTML = video.paused ? ICON_PLAY : ICON_PAUSE;
  };
  const syncTime = () => {
    if (isFinite(video.duration) && video.duration > 0) {
      durationEl.textContent = formatTime(video.duration);
      if (!seeking) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
    currentEl.textContent = formatTime(video.currentTime);
  };
  const syncFsIcon = () => {
    const inFs = !!document.fullscreenElement;
    fsBtn.innerHTML = inFs ? ICON_EXIT_FULLSCREEN : ICON_FULLSCREEN;
    fsBtn.classList.toggle('fbfs-active', inFs);
  };

  video.addEventListener('play', syncPlayIcon);
  video.addEventListener('pause', syncPlayIcon);
  video.addEventListener('timeupdate', syncTime);
  video.addEventListener('loadedmetadata', syncTime);
  video.addEventListener('durationchange', syncTime);
  document.addEventListener('fullscreenchange', syncFsIcon);

  syncPlayIcon();
  syncTime();
  syncFsIcon();

  bar.style.display = settings.showButton ? '' : 'none';
  return bar;
}

function attachToVideo(video) {
  if (videoBars.has(video)) return;
  lastActiveVideo = video;

  const container = video.parentElement;
  if (!container) return;
  container.setAttribute('data-fbfs', '');
  container.classList.add('fbfs-wrap');
  const style = getComputedStyle(container);
  if (style.position === 'static') container.style.position = 'relative';

  const bar = makeControls(video);
  videoBars.set(video, bar);
  container.appendChild(bar);

  // --- Hide the controls when the mouse goes out of focus ---
  // Show on hover / movement, hide on mouse-leave, and hide after
  // 3 seconds idle while the video is playing.
  let idleTimer = null;
  const showControls = () => {
    container.classList.remove('fbfs-controls-hidden');
    if (idleTimer) clearTimeout(idleTimer);
    if (!video.paused) {
      idleTimer = setTimeout(() => {
        container.classList.add('fbfs-controls-hidden');
      }, 3000);
    }
  };
  const hideControls = () => {
    if (idleTimer) clearTimeout(idleTimer);
    container.classList.add('fbfs-controls-hidden');
  };
  container.addEventListener('mouseenter', () => {
    positionControls(video);
    showControls();
  });
  container.addEventListener('mousemove', showControls);
  container.addEventListener('mouseleave', hideControls);
  video.addEventListener('play', showControls);
  video.addEventListener('pause', () => {
    // Keep the bar visible when paused, so Play is always reachable
    // while the mouse is still over the video.
    if (idleTimer) clearTimeout(idleTimer);
    container.classList.remove('fbfs-controls-hidden');
  });
  // Start hidden until the mouse is over the video.
  container.classList.add('fbfs-controls-hidden');

  video.addEventListener('play', () => {
    lastActiveVideo = video;
    if (settings.autoFullscreenReels && isReelVideo(video) && !document.fullscreenElement) {
      setTimeout(() => {
        if (!video.paused && !document.fullscreenElement) toggleFullscreen(video);
      }, 350);
    }
  });
  video.addEventListener('click', () => { lastActiveVideo = video; });
}

// Facebook covers Reels with transparent overlays, so a double-click rarely targets the
// <video> itself. Match the pointer to the video underneath it instead.
function videoAtPoint(x, y) {
  return [...document.querySelectorAll('video')].find((video) => {
    if (!videoBars.has(video)) return false;
    const r = video.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
}

document.addEventListener('dblclick', (e) => {
  if (!settings.doubleClick || !e.isTrusted) return;
  // Leave double-clicks on links, buttons, text fields and the control bar alone.
  if (e.target.closest?.('a[href], button, input, textarea, select, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"], .fbfs-bar')) return;
  const video = videoAtPoint(e.clientX, e.clientY);
  if (!video) return;
  e.preventDefault();
  e.stopPropagation();
  toggleFullscreen(video);
}, true);

function scanForVideos() {
  document.querySelectorAll('video').forEach((video) => {
    if (video.clientWidth < 100 || video.clientHeight < 100) return;
    attachToVideo(video);
    positionControls(video);
    const frame = video.getBoundingClientRect();
    if (frame.bottom <= 0 || frame.top >= innerHeight) return;
    const targets = getReelTargets(video);
    for (const button of videoBars.get(video).querySelectorAll('[data-reel]')) {
      button.hidden = !targets;
      button.disabled = !navigationAvailable(targets?.[button.dataset.reel]);
    }
  });
}

let scanPending = false;
function scheduleScan() {
  if (scanPending) return;
  scanPending = true;
  requestAnimationFrame(() => {
    scanPending = false;
    scanForVideos();
  });
}

const observer = new MutationObserver((changes) => {
  if (changes.some(({ target }) => !target.closest?.('.fbfs-bar'))) scheduleScan();
});
observer.observe(document.documentElement, {
  childList: true, subtree: true,
  attributeFilter: ['disabled', 'aria-disabled', 'aria-label', 'title', 'hidden'],
});

let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    scheduleScan();
  }
}, 1000);
window.addEventListener('scroll', scheduleScan, { passive: true });
window.addEventListener('resize', scheduleScan);
document.addEventListener('fullscreenchange', scheduleScan);

scanForVideos();
