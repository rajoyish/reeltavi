# ReelTavi — Facebook Video Controller

Watch any Facebook Reel or video in true fullscreen, with your own control bar.

## What it does

- Places the **playback bar above the page name and avatar** when they appear over a Reel. Videos without an author overlay show the bar at the bottom.
  `−10s | ▶/⏸ | +10s | Speaker | 00:04 | Seek | 03:39 | ↑ | ↓ | Download | ⛶`
- **−10s / +10s** skip back and forward 10 seconds.
- **Play / pause** button, **current time and total duration**.
- Hover over the **speaker** to expand the volume slider. It collapses when you move away. From the keyboard, Tab to the speaker, then Tab to the slider and use the arrow keys for 1% adjustments. Click the speaker to toggle mute.
- On Reels, **↑** opens the previous Reel and **↓** opens the next. An unavailable direction is dimmed. Switching Reels leaves single-video fullscreen so the destination is visible.
- **Scrub slider** — drag it to jump to any point in the video.
- Click **Download** beside fullscreen, then choose **SD** or **Full HD** (shown as **HD** when Facebook's best copy is 720p). When only one quality exists, it downloads right away. Progress appears above the control bar, and the file is saved to Chrome's download folder (usually **Downloads**). When Facebook delivers separate video and sound tracks, ReelTavi joins them in the background, converting VP9/AV1 video to H.264 so the file opens in QuickTime, Finder and Windows players. The file includes the source audio even when the player is muted. Choose **Show in folder** when it finishes.
- The **fullscreen button** sits at the right end of the bar and stays accessible in fullscreen.
- **Controls auto-hide**: they disappear when the mouse leaves the video, and after 3 seconds idle while playing. Move the mouse back over the video to show them again. When paused, they stay visible while the mouse is over the video.
- **Double-click** any video to toggle fullscreen.
- Optional **auto-fullscreen for Reels**: when a Reel starts playing, the extension tries to fullscreen it. Turn it on in the extension popup.
- Click the extension icon in Chrome's toolbar for settings and a **"Make current video fullscreen"** button.

## Install (Chrome / Edge / Brave — load unpacked)

1. Unzip `facebook-fullscreen-reels-extension.zip`.
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped `facebook-fullscreen-reels-extension` folder.
5. Open Facebook and hover over a Reel or video to show its playback bar.

If you already installed v1.0, remove it first (or click **Reload** on its card in `chrome://extensions` after replacing the folder), then load the new version.

## Why auto-fullscreen sometimes doesn't trigger

Chrome only allows fullscreen after a recent click/tap. If a Reel starts playing on its own (e.g. auto-play while scrolling), Chrome may block the automatic request. In that case the bar pulses — one tap on its fullscreen button will go fullscreen.

## Files

- `manifest.json` — Manifest V3, runs only on `facebook.com`
- `content.js` — finds videos, builds the bottom control bar, handles seek / skip / fullscreen / auto-hide
- `content.css` — control bar styling
- `popup.html` / `popup.js` / `popup.css` — toolbar popup & settings
- `icons/` — extension icons
- `download-source.js`, `download-worker.js`, `download-mp4.mjs`, and `offscreen.html` / `offscreen.mjs` — find the selected video's media, start downloads, report progress, and combine MP4 tracks in a background offscreen document. The bundled MP4 library is [Mediabunny 1.66.2](https://www.npmjs.com/package/mediabunny/v/1.66.2) under [MPL 2.0](vendor/mediabunny/LICENSE).

Downloads support direct media files and single-period, unencrypted DASH streams with complete MP4 track URLs. Live streams and segmented playlists are unsupported. If a feed card has no identifiable video link, open the Reel or video on its own page and try again.

## Privacy

Settings use Chrome sync storage. Downloads request media from Facebook and its CDNs and process it locally. While a download runs, the extension keeps its details in Chrome session storage. Joined files are built in memory and handed to Chrome's downloads.
