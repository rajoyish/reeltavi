// Only Facebook media URLs may be passed from a page to the download worker.
function facebookMediaUrl(value, base) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value, base);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        /(^|\.)(facebook\.com|fbcdn\.net|fbsbx\.com)$/i.test(url.hostname)) return url.href;
  } catch { /* Not a media URL. */ }
  return null;
}

function videoIdFromLink(value) {
  const href = facebookMediaUrl(value, location.href);
  if (!href) return null;
  const url = new URL(href);
  if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
  const pathId = url.pathname.match(/\/(?:reels?|videos)\/(?:[^/]+\/)?(\d+)\/?$/);
  if (pathId) return pathId[1];
  if (/^\/(?:watch\/?|video\.php|video\/video\.php)$/.test(url.pathname)) {
    const id = url.searchParams.get('v');
    if (/^\d+$/.test(id || '')) return id;
  }
  return null;
}

function selectedVideo(video) {
  const explicit = video.closest('[data-video-id]')?.getAttribute('data-video-id');
  const explicitId = /^\d+$/.test(explicit || '') ? explicit : null;
  // Prefer the clicked card's permalink to the feed's current address.
  for (let el = video.parentElement; el && !el.matches('body, main, [role="main"], [role="feed"]'); el = el.parentElement) {
    if (el.querySelectorAll('video').length > 1) break;
    const links = new Map();
    for (const link of el.querySelectorAll('a[href]')) {
      const id = videoIdFromLink(link.href);
      if (id && (!explicitId || id === explicitId) && !links.has(id)) links.set(id, link.href);
    }
    if (links.size === 1) {
      const [id, permalink] = links.entries().next().value;
      return { id, permalink };
    }
    if (links.size > 1 || el.matches('article, [role="article"]')) break;
  }
  const pageId = videoIdFromLink(location.href);
  if (explicitId) return { id: explicitId, permalink: explicitId === pageId ? location.href : null };
  if (!pageId) return null;
  const visible = [...document.querySelectorAll('video')].filter(player => {
    const r = player.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  });
  return visible.length === 1 && visible[0] === video ? { id: pageId, permalink: location.href } : null;
}

// Highest SD height offered. Facebook labels 480p and lower as SD.
const SD_MAX_HEIGHT = 480;

function qualityLabel(height) {
  if (!height) return null;
  return (height >= 1080 ? 'Full HD' : height >= 720 ? 'HD' : 'SD') + ' · ' + height + 'p';
}

// Resolution as Facebook names it ("1080p"). Portrait videos report height > width, so
// fall back to the shorter side, which is what the "p" number means.
function repHeight(rep) {
  const label = Number(rep.getAttribute('FBQualityLabel')?.match(/(\d{3,4})p/i)?.[1]);
  if (label > 0) return label;
  const sides = ['width', 'height'].map(name => Number(rep.getAttribute(name))).filter(n => n > 0);
  return sides.length ? Math.min(...sides) : 0;
}

function dashTracks(xml, base) {
  if (typeof xml !== 'string') return null;
  if (xml.trimStart().startsWith('%3C') || xml.trimStart().startsWith('%3c')) {
    try { xml = decodeURIComponent(xml.replace(/\+/g, ' ')); } catch { return null; }
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.documentElement.localName !== 'MPD' || doc.documentElement.getAttribute('type') === 'dynamic' ||
      doc.querySelectorAll('Period').length !== 1 || doc.querySelector('ContentProtection, SegmentTemplate, SegmentList')) return null;

  const tracks = { video: [], audio: [] };
  for (const rep of doc.querySelectorAll('Representation')) {
    const group = rep.parentElement;
    const mime = rep.getAttribute('mimeType') || group.getAttribute('mimeType') || '';
    const kind = mime.split('/')[0];
    if (!['video/mp4', 'audio/mp4'].includes(mime)) continue;
    const entry = rep.querySelector(':scope > BaseURL');
    if (!entry) continue;
    let parentBase = base;
    for (const el of [doc.documentElement, group.parentElement, group]) {
      const prefix = el?.querySelector(':scope > BaseURL')?.textContent.trim();
      if (prefix) parentBase = facebookMediaUrl(prefix, parentBase);
    }
    const url = facebookMediaUrl(entry.textContent.trim(), parentBase);
    const codec = rep.getAttribute('codecs') || group.getAttribute('codecs') || '';
    if (url) tracks[kind].push({ url, codec, bandwidth: Number(rep.getAttribute('bandwidth')) || 0, height: repHeight(rep) });
  }
  // Do not silently discard audio if the manifest declares an unsupported audio representation.
  const expectsAudio = [...doc.querySelectorAll('AdaptationSet, Representation')].some(el =>
    el.getAttribute('contentType') === 'audio' || el.getAttribute('mimeType')?.startsWith('audio/'));
  const audio = tracks.audio.sort((a, b) => b.bandwidth - a.bandwidth)[0]?.url || null;
  if (!tracks.video.length || (expectsAudio && !audio)) return null;
  // Best first: tallest frame, then the codec cheapest to make portable, then highest bitrate.
  // H.264 needs no conversion; VP9 converts quickly; Chrome may not decode AV1 in WebCodecs.
  const rank = track => /^avc[13]\./i.test(track.codec) ? 3 : /^vp0?9/i.test(track.codec) ? 2 : /^av01/i.test(track.codec) ? 0 : 1;
  tracks.video.sort((a, b) => b.height - a.height || rank(b) - rank(a) || b.bandwidth - a.bandwidth);
  return { video: tracks.video, audio };
}

// quality: 'hd' picks the tallest video track; 'sd' picks the best track at SD_MAX_HEIGHT or below.
function pickDashTrack(videos, quality) {
  if (quality !== 'sd') return videos[0];
  return videos.find(track => track.height && track.height <= SD_MAX_HEIGHT) || videos[videos.length - 1];
}

function dashDownload(xml, base, quality = 'hd') {
  const tracks = dashTracks(xml, base);
  if (!tracks) return null;
  const track = pickDashTrack(tracks.video, quality);
  return { video: track.url, audio: tracks.audio, height: track.height || null, codec: track.codec, bandwidth: track.bandwidth };
}

function isMediaFile(url) {
  return url && /\.(?:mp4|webm|mov)$/i.test(new URL(url).pathname);
}

function isByteRange(url) {
  return /[?&](?:bytestart|byteend)=/i.test(url);
}

function sourcesFromDocument(doc, id, pageUrl) {
  const found = { hd: null, sd: null, other: null, dash: null, manifest: null };
  const direct = value => {
    const url = facebookMediaUrl(value);
    return url && !/\.(?:mpd|m3u8)$/i.test(new URL(url).pathname) && !isByteRange(url) ? url : null;
  };
  const first = values => values.map(direct).find(Boolean) || null;
  for (const script of doc.querySelectorAll('script[type="application/json"], script[data-sjs]')) {
    const json = script.textContent;
    if (!json.includes(id)) continue;
    let data;
    try { data = JSON.parse(json); } catch { continue; }
    const pending = [data];
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== 'object') continue;
      if ([node.id, node.videoId, node.video_id].some(value => String(value) === id)) {
        const media = node.creation_story?.short_form_video_context?.playback_video || node;
        const legacy = media.videoDeliveryLegacyFields || media;
        const delivery = media.videoDeliveryResponseFragment?.videoDeliveryResponseResult;
        const urls = Array.isArray(delivery?.progressive_urls) ? delivery.progressive_urls : [];
        const progressive = quality => first(urls
          .filter(item => String(item?.metadata?.quality).toLowerCase() === quality)
          .map(item => item.progressive_url));
        found.hd ||= first([legacy.browser_native_hd_url, legacy.playable_url_quality_hd]) || progressive('hd') || direct(legacy.hd_src);
        found.sd ||= direct(legacy.browser_native_sd_url) || progressive('sd') || first([legacy.playable_url, legacy.sd_src]);
        const playableDash = facebookMediaUrl(legacy.playable_url_dash);
        found.other ||= first(urls.map(item => item?.progressive_url)) || (isMediaFile(playableDash) ? direct(playableDash) : null);
        const manifests = Array.isArray(delivery?.dash_manifests) ? delivery.dash_manifests : [];
        const legacyXml = legacy.dash_manifest || legacy.playlist || legacy.dash_manifest_xml_string || legacy.manifest_xml;
        for (const [index, xml] of [legacyXml, ...manifests.map(m => m?.manifest_xml)].entries()) {
          if (found.dash) break;
          const base = index === 0 ? legacy.dash_manifest_url : delivery?.dash_manifest_urls?.[index - 1]?.manifest_url;
          found.dash = dashTracks(xml, facebookMediaUrl(base, pageUrl) || pageUrl);
        }
        const manifestUrls = Array.isArray(delivery?.dash_manifest_urls) ? delivery.dash_manifest_urls : [];
        const candidates = [...manifestUrls.map(item => item?.manifest_url), legacy.dash_manifest_url, playableDash];
        found.manifest ||= candidates.map(value => facebookMediaUrl(value)).find(url =>
          url && !isMediaFile(url) && !/\.m3u8$/i.test(new URL(url).pathname)) || null;
      }
      for (const child of Object.values(node)) if (child && typeof child === 'object') pending.push(child);
    }
  }
  return downloadOptions(found);
}

// Builds up to two choices, SD and the highest quality (Full HD when Facebook offers 1080p).
function downloadOptions({ hd, sd, other, dash, manifest }) {
  const options = [];
  const add = option => {
    const key = option.direct || option.video || option.manifest + option.quality;
    if (!options.some(o => (o.direct || o.video || o.manifest + o.quality) === key)) options.push(option);
  };
  const dashOption = (quality) => {
    const track = pickDashTrack(dash.video, quality);
    return { quality, height: track.height || null, video: track.url, audio: dash.audio, codec: track.codec, bandwidth: track.bandwidth };
  };

  // Highest quality: DASH carries 1080p; Facebook's progressive "HD" file is usually 720p.
  const top = dash?.video[0];
  if (top && (top.height >= 1080 || !hd)) add(dashOption('hd'));
  else if (hd) add({ quality: 'hd', height: null, direct: hd });
  else if (manifest) add({ quality: 'hd', height: null, manifest });

  // SD: the progressive SD file already includes audio.
  if (sd && sd !== hd) add({ quality: 'sd', height: null, direct: sd });
  else if (dash) add(dashOption('sd'));
  else if (manifest) add({ quality: 'sd', height: null, manifest });

  // A progressive file of unknown quality is the last resort.
  if (!options.length && other) add({ quality: 'current', height: null, direct: other });

  for (const option of options) {
    option.label = qualityLabel(option.height) ||
      ({ sd: 'SD', current: 'Video' }[option.quality] || (option.manifest ? 'Highest quality' : 'HD'));
  }
  return options.length ? options : null;
}

async function findDownload(video) {
  if (video.mediaKeys || video.duration === Infinity) throw new Error('Downloads are available for unprotected, finished videos.');
  const { id, permalink } = selectedVideo(video) || {};
  let options = id && sourcesFromDocument(document, id, location.href);
  const direct = facebookMediaUrl(video.currentSrc || video.src);
  if (!options && isMediaFile(direct) && !isByteRange(direct)) {
    options = [{ quality: 'current', height: video.videoHeight || null, label: qualityLabel(video.videoHeight) || 'Video', direct }];
  }
  // Watch and Reel permalinks can return different playback data for the same video.
  if ((!options || options.length < 2) && id) {
    const paths = new Set();
    if (permalink) {
      const link = new URL(permalink);
      // Normalize to the current Facebook origin to keep the request in the signed-in session.
      if (!link.pathname.startsWith('//')) paths.add(link.pathname + link.search);
    }
    paths.add('/watch/?v=' + id);
    paths.add('/reel/' + id + '/');
    const signal = AbortSignal.timeout(20000);
    for (const path of paths) {
      const url = new URL(path, location.origin);
      if (signal.aborted || options?.length === 2) break;
      if (url.origin !== location.origin) continue;
      try {
        const page = await fetch(url, { credentials: 'same-origin', signal });
        if (!page.ok) continue;
        const doc = new DOMParser().parseFromString(await page.text(), 'text/html');
        const fetched = sourcesFromDocument(doc, id, page.url || url.href);
        if (fetched && fetched.length > (options?.length || 0)) options = fetched;
      } catch {
        // A failed lookup should not discard sources already found on another page.
      }
    }
  }
  if (!options) throw new Error(id ? 'Facebook did not provide a downloadable file for this video.' :
    'Open this video on its own Facebook page, then try Download again.');
  return { id: id || null, options };
}
