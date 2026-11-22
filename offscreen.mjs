import { buildMp4 } from './download-mp4.mjs';

// Builds MP4 files from separate Facebook tracks. Chrome saves them from blob URLs,
// which stay valid only while this document is open.
const blobs = new Set();
let active = 0;

const report = (job, update) => chrome.runtime.sendMessage({ type: 'REELTAVI_BUILD_PROGRESS', job, ...update }).catch(() => {});

async function build(job) {
  active++;
  try {
    let tracks = job;
    if (job.manifest) {
      const response = await fetch(job.manifest, { credentials: 'omit', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('The video link expired. Refresh Facebook and try again.');
      tracks = dashDownload(await response.text(), response.url, job.quality);
      if (!tracks) throw new Error('This stream format is unavailable.');
    }
    let last = -1;
    let lastPhase = '';
    const blob = await buildMp4(tracks, (percent, phase) => {
      if (percent === last && phase === lastPhase) return;
      last = percent;
      lastPhase = phase;
      report(job, { percent, phase });
    });
    const url = URL.createObjectURL(blob);
    blobs.add(url);
    report(job, { done: true, url });
  } catch (error) {
    report(job, { error: error.message || 'Could not build the MP4.' });
  } finally {
    active--;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'REELTAVI_BUILD') {
    build(message.job);
    respond({ ok: true });
  } else if (message?.type === 'REELTAVI_RELEASE') {
    if (blobs.delete(message.url)) URL.revokeObjectURL(message.url);
    respond({ idle: active === 0 && blobs.size === 0 });
  }
});
