import {
  BufferTarget, Conversion, Input, MP4, Mp4OutputFormat, Output, UrlSource, canEncodeVideo,
} from './vendor/mediabunny/mediabunny.min.mjs';

// QuickTime, Finder previews and Windows Media Player cannot open VP9 or AV1 inside MP4.
const PORTABLE_VIDEO = 'avc';

// Joins the video track and the optional audio track into one MP4 Blob.
// Non-H.264 video is converted so the saved file opens in any player.
export async function buildMp4({ video, audio }, onProgress) {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const inputs = [];
  let converting = false;
  try {
    const conversions = [];
    for (const [index, url] of [video, audio].entries()) {
      if (!url) continue;
      const input = new Input({ formats: [MP4], source: new UrlSource(url, {
        requestInit: { credentials: 'omit' },
        getRetryDelay: () => null,
      }) });
      inputs.push(input);
      const isVideo = index === 0;
      let options;
      let transcode = false;
      if (isVideo) {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('This video has no picture track.');
        const size = { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() };
        transcode = await track.getCodec() !== PORTABLE_VIDEO && await canEncodeVideo(PORTABLE_VIDEO, size);
        converting ||= transcode;
        options = { video: transcode ? { codec: PORTABLE_VIDEO } : {}, audio: { discard: Boolean(audio) } };
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
        onProgress(Math.floor(Math.min(...progress) * 100), converting);
      };
    }
    onProgress(0, converting);
    await output.start();
    await Promise.all(conversions.map(conversion => conversion.execute()));
    await output.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    if (output.state === 'started') await output.cancel().catch(() => {});
    throw error;
  } finally {
    for (const input of inputs) input.dispose();
  }
}
