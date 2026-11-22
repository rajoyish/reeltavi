importScripts('download-source.js');

// Every download goes to Chrome's default download folder. Progress is sent to the
// Facebook tab that started it as REELTAVI_PROGRESS messages keyed by job.key.

const TRACKED = 'reeltavi-downloads';
let creatingOffscreen = null;
let pollTimer = null;

const notify = (job, update) =>
  chrome.tabs.sendMessage(job.tabId, { type: 'REELTAVI_PROGRESS', key: job.key, ...update }).catch(() => {});

async function tracked() {
  return (await chrome.storage.session.get(TRACKED))[TRACKED] || {};
}

// Serialize read-modify-write updates so simultaneous downloads do not overwrite each other.
let storageQueue = Promise.resolve();
function updateTracked(change) {
  const run = storageQueue.then(async () => {
    const all = await tracked();
    const result = change(all);
    await chrome.storage.session.set({ [TRACKED]: all });
    return result;
  });
  storageQueue = run.catch(() => {});
  return run;
}

async function track(downloadId, job) {
  await updateTracked(all => { all[downloadId] = job; });
  if (!job.blobUrl) pollProgress();
}

function untrack(downloadId) {
  return updateTracked(all => {
    const job = all[downloadId];
    delete all[downloadId];
    return job;
  });
}

// Chrome reports bytes only on request, so poll while direct files are downloading.
function pollProgress() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const all = await tracked();
    const direct = Object.entries(all).filter(([, job]) => !job.blobUrl);
    if (!direct.length) { clearInterval(pollTimer); pollTimer = null; return; }
    for (const [id, job] of direct) {
      const [item] = await chrome.downloads.search({ id: Number(id) });
      if (item?.state === 'in_progress' && item.totalBytes > 0) {
        notify(job, { percent: Math.floor(item.bytesReceived / item.totalBytes * 100), phase: 'downloading' });
      }
    }
  }, 500);
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (existing.length) return;
  creatingOffscreen ||= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS', 'DOM_PARSER'],
    justification: 'Join Facebook video and audio tracks into one MP4 file.',
  }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

// Chrome can drop the requested name for blob URLs (it then uses the blob's UUID), and other
// extensions may rename downloads. Supplying the name here keeps ReelTavi's file names.
const pendingNames = new Map();
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const filename = item.byExtensionId === chrome.runtime.id && pendingNames.get(item.url);
  if (!filename) return;
  pendingNames.delete(item.url);
  suggest({ filename, conflictAction: 'uniquify' });
});

async function saveToDownloads(url, job) {
  const filename = job.name + '.' + job.ext;
  pendingNames.set(url, filename);
  try {
    const downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    await track(downloadId, job);
  } finally {
    setTimeout(() => pendingNames.delete(url), 60000);
  }
}

async function startDownload(job, tabId) {
  const id = /^\d{1,30}$/.test(job?.id || '') ? job.id : String(Date.now());
  const quality = ['hd', 'sd', 'current'].includes(job?.quality) ? job.quality : 'hd';
  const height = Number.isInteger(job?.height) && job.height > 0 && job.height < 10000 ? job.height : null;
  const name = 'ReelTavi-' + id + (height ? '-' + height + 'p' : quality === 'current' ? '' : '-' + quality.toUpperCase());
  const key = crypto.randomUUID();
  const base = { key, tabId, name, ext: 'mp4' };

  const direct = facebookMediaUrl(job?.direct);
  if (direct) {
    base.ext = new URL(direct).pathname.match(/\.(webm|mov)$/i)?.[1].toLowerCase() || 'mp4';
    await saveToDownloads(direct, base);
    return key;
  }

  const manifest = facebookMediaUrl(job?.manifest);
  const video = facebookMediaUrl(job?.video);
  const audio = facebookMediaUrl(job?.audio);
  if ((!video && !manifest) || (job?.audio && !audio)) throw new Error('Invalid video source.');
  await ensureOffscreen();
  const codec = /^[\w.-]{1,64}$/.test(job?.codec || '') ? job.codec : '';
  const bandwidth = Number.isInteger(job?.bandwidth) && job.bandwidth > 0 ? job.bandwidth : 0;
  await chrome.runtime.sendMessage({ type: 'REELTAVI_BUILD', job: { ...base, video, audio, manifest, quality, codec, bandwidth } });
  return key;
}

async function releaseBlob(url) {
  const reply = await chrome.runtime.sendMessage({ type: 'REELTAVI_RELEASE', url }).catch(() => null);
  if (reply?.idle) await chrome.offscreen.closeDocument().catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;

  if (message?.type === 'REELTAVI_BUILD_PROGRESS' && !sender.tab) {
    const { job } = message;
    if (message.error) notify(job, { error: message.error });
    else if (message.done) {
      notify(job, { phase: 'saving' });
      saveToDownloads(message.url, { ...job, blobUrl: message.url }).catch(error => {
        notify(job, { error: error.message || 'Chrome could not save the file.' });
        releaseBlob(message.url);
      });
    } else notify(job, { percent: message.percent, phase: message.phase });
    return;
  }

  if (!sender.tab || !/^https:\/\/(?:[\w-]+\.)*facebook\.com\//i.test(sender.url || '')) return;
  if (message?.type === 'REELTAVI_DOWNLOAD') {
    startDownload(message.job, sender.tab.id).then(
      key => respond({ key }),
      error => respond({ error: error.message || 'Chrome could not start the download.' })
    );
    return true;
  }
  if (message?.type === 'REELTAVI_SHOW' && Number.isInteger(message.downloadId)) {
    chrome.downloads.show(message.downloadId);
  }
});

chrome.downloads.onChanged.addListener(async ({ id, state }) => {
  if (!state || state.current === 'in_progress') return;
  const job = await untrack(id);
  if (!job) return;
  if (job.blobUrl) releaseBlob(job.blobUrl);
  if (state.current === 'complete') {
    const [item] = await chrome.downloads.search({ id });
    const file = item?.filename.split(/[\\/]/).pop() || job.name + '.' + job.ext;
    notify(job, { done: true, file, downloadId: id });
  } else {
    const [item] = await chrome.downloads.search({ id });
    notify(job, { error: item?.error === 'USER_CANCELED' ? 'Download canceled.' : 'Download failed. Refresh Facebook and try again.' });
  }
});
