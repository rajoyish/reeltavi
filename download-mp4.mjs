import {
  BufferSource, BufferTarget, Conversion, Input, MP4, Mp4OutputFormat, Output, canEncodeVideo,
} from './vendor/mediabunny/mediabunny.min.mjs';

// QuickTime, Finder previews and Windows Media Player cannot open VP9 or AV1 inside MP4.
const PORTABLE_VIDEO = 'avc';
// Facebook's CDN limits each connection, so fetch files as parallel byte ranges.
const CHUNK = 2 * 1024 * 1024;
const CONNECTIONS = 6;

// Downloads a whole file into memory, calling onBytes(received, total) as data arrives.
async function fetchFile(url, onBytes, signal) {
  const get = (start, end) => fetch(url, {
    credentials: 'omit', signal, headers: { Range: `bytes=${start}-${end}` },
  }).then(response => {
    if (!response.ok) throw new Error('The video link expired. Refresh Facebook and try again.');
    return response;
  });

  const first = await get(0, CHUNK - 1);
  const total = Number(first.headers.get('Content-Range')?.split('/')[1]);
  if (first.status !== 206 || !(total > 0)) {
    // The server ignored the range: stream the whole response instead.
    const length = Number(first.headers.get('Content-Length')) || 0;
    const parts = [];
    let received = 0;
    for (const reader = first.body.getReader(); ;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;
      onBytes(received, Math.max(length, received));
    }
    return new Blob(parts).arrayBuffer();
  }

  const data = new Uint8Array(total);
  let received = 0;
  const readInto = async (response, offset) => {
    for (const reader = response.body.getReader(); ;) {
      const { done, value } = await reader.read();
      if (done) return;
      data.set(value, offset);
      offset += value.length;
      received += value.length;
      onBytes(received, total);
    }
  };
  const ranges = [];
  for (let start = CHUNK; start < total; start += CHUNK) ranges.push([start, Math.min(start + CHUNK, total) - 1]);
  const worker = async () => {
    for (let range; (range = ranges.shift());) await readInto(await get(...range), range[0]);
  };
  await Promise.all([readInto(first, 0), ...Array.from({ length: Math.min(CONNECTIONS, ranges.length) }, worker)]);
  if (received !== total) throw new Error('The download was incomplete. Try again.');
  return data.buffer;
}

// H.264 needs roughly 1.4x the bitrate of VP9/AV1 for similar quality. sourceBitrate is the
// track's real average; the manifest's bandwidth is a peak and would bloat the file.
function targetBitrate(sourceBitrate, height) {
  const cap = height >= 1080 ? 6_000_000 : height >= 720 ? 4_000_000 : 2_500_000;
  return sourceBitrate > 0 ? Math.min(cap, Math.max(800_000, Math.round(sourceBitrate * 1.4))) : cap;
}

// Joins the video track and the optional audio track into one MP4 Blob.
// Non-H.264 video is converted so the saved file opens in any player.
// onProgress(percent, phase) reports one 0–100 scale across downloading and converting.
export async function buildMp4({ video, audio, codec, bandwidth }, onProgress) {
  const willConvert = !/^avc[13]\./i.test(codec || '');
  // Share of the bar used by the download; conversion takes the rest.
  const downloadShare = willConvert ? 0.3 : 0.9;
  // Never let the bar move backwards (e.g. when a second file's size becomes known).
  let shown = 0;
  const report = (fraction, phase) => {
    shown = Math.max(shown, Math.min(100, Math.floor(fraction * 100)));
    onProgress(shown, phase);
  };

  const urls = [video, audio].filter(Boolean);
  const bytes = urls.map(() => ({ received: 0, total: 0 }));
  report(0, 'downloading');
  const buffers = await Promise.all(urls.map((url, i) => fetchFile(url, (received, total) => {
    bytes[i] = { received, total };
    // Until every file reports its size, keep the bar honest by assuming the unknown ones are large.
    const known = bytes.every(b => b.total);
    const sum = bytes.reduce((a, b) => a + b.received, 0);
    const size = bytes.reduce((a, b) => a + b.total, 0);
    report(downloadShare * (known ? sum / size : sum / (size * urls.length)), 'downloading');
  })));

  const onMuxProgress = (fraction, phase) => report(downloadShare + (1 - downloadShare) * fraction, phase);
  try {
    return await mux(buffers, { hasAudio: Boolean(audio), bandwidth, convertVideo: true }, onMuxProgress);
  } catch (error) {
    if (!error?.reeltaviConverting) throw error;
    // Chrome said it could convert, then failed mid-way (decoder or encoder refused the
    // real configuration). Save the original track instead: it plays in Chrome and VLC.
    shown = Math.floor(downloadShare * 100);
    return mux(buffers, { hasAudio: Boolean(audio), bandwidth, convertVideo: false }, onMuxProgress);
  }
}

async function mux(buffers, { hasAudio, bandwidth, convertVideo }, onProgress) {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const inputs = [];
  let phase = 'joining';
  try {
    const conversions = [];
    for (const [index, buffer] of buffers.entries()) {
      const input = new Input({ formats: [MP4], source: new BufferSource(buffer) });
      inputs.push(input);
      const isVideo = index === 0;
      let options;
      let transcode = false;
      if (isVideo) {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('This video has no picture track.');
        const size = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
        const seconds = await input.computeDuration();
        const sourceBitrate = seconds > 0 ? buffer.byteLength * 8 / seconds : bandwidth;
        // When Chrome cannot decode or encode, keep the original track: it still plays in Chrome and VLC.
        transcode = convertVideo && await track.getCodec() !== PORTABLE_VIDEO && await track.canDecode() &&
          await canEncodeVideo(PORTABLE_VIDEO, size);
        if (transcode) phase = 'converting';
        options = {
          // No hardwareAcceleration hint: mediabunny applies it to the decoder too, and
          // 'prefer-hardware' makes Chrome refuse AV1 on machines without an AV1 hardware
          // decoder. Chrome still picks the hardware encoder when one is available.
          video: transcode ? {
            codec: PORTABLE_VIDEO,
            bitrate: targetBitrate(sourceBitrate, Math.min(size.width, size.height)),
          } : {},
          audio: { discard: hasAudio },
        };
      } else {
        const track = await input.getPrimaryAudioTrack();
        if (!track) throw new Error('This video has no sound track.');
        transcode = await track.getCodec() !== 'aac';
        options = { video: { discard: true }, audio: transcode ? { codec: 'aac' } : {} };
      }
      const conversion = await Conversion.init({
        input, output, composable: true, ...options,
        // Copy packets untouched unless this track is being converted.
        ...(transcode ? {} : { copy: { mode: 'forced' } }),
      });
      if (!conversion.isValid || !conversion.utilizedTracks.some(track => track.type === (isVideo ? 'video' : 'audio'))) {
        throw new Error('These media tracks could not be saved as MP4.');
      }
      conversions.push(conversion);
    }
    const progress = conversions.map(() => 0);
    for (const [i, conversion] of conversions.entries()) {
      conversion.onProgress = value => {
        progress[i] = value;
        onProgress(Math.min(...progress), phase);
      };
    }
    onProgress(0, phase);
    await output.start();
    await Promise.all(conversions.map(conversion => conversion.execute()));
    await output.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    if (output.state === 'started') await output.cancel().catch(() => {});
    if (phase === 'converting' && error && typeof error === 'object') error.reeltaviConverting = true;
    throw error;
  } finally {
    for (const input of inputs) input.dispose();
  }
}
