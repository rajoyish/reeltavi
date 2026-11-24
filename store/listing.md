# Chrome Web Store listing: ReelTavi

Copy each section into the matching field of the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).

## Package

- Upload: `dist/reeltavi-1.4.1.zip` (build it with `./scripts/package.sh`)

## Store listing tab

**Name** (from manifest): ReelTavi – Video Controller for Facebook

**Summary** (from manifest, 132 characters max): Control playback, volume and fullscreen on Facebook videos and Reels, and download videos with audio.

**Category:** Tools (alternative: Photos & Videos)

**Language:** English

**Description:**

```
ReelTavi gives Facebook Reels and videos the control bar they're missing.

PLAYBACK CONTROLS
• Skip back or forward 10 seconds
• Play / pause, current time and total length
• Drag the seek bar to any point
• Hover the speaker for a volume slider; click to mute
• ↑ / ↓ buttons to move between Reels
• Fullscreen button, or double-click any video
• Optional auto-fullscreen when a Reel starts
• Controls hide on their own while you watch
• Fits any player: one row on wide videos, a tidy two-row layout on vertical Reels

KEYBOARD AND ACCESSIBILITY
• Space/K play, ←/→ 5 s, J/L 10 s, 0–9 jump, M mute, +/− volume
• < / > playback speed, F fullscreen, D download, Shift+N / Shift+P next or previous Reel
• Full shortcut list in the toolbar popup, with an on/off switch
• Every control works with Tab and screen readers, and changes are announced

DOWNLOADS IN SD OR FULL HD
• Click Download and choose SD or Full HD (1080p when available)
• Progress shows right in the video: downloading, converting, saving
• Files go straight to your Downloads folder, ready to play in QuickTime, Windows Media Player, VLC and on phones
• Full HD video is converted to H.264 on your computer so it opens anywhere, with sound included even if the video was muted

PRIVATE BY DESIGN
• No accounts, servers, analytics or tracking
• Videos are fetched from Facebook and processed on your device
• Works only on facebook.com

Please download only videos you own or have permission to save, and respect creators' rights.

ReelTavi isn't affiliated with, endorsed by or sponsored by Meta Platforms, Inc. Facebook is a trademark of Meta Platforms, Inc.
```

**Graphic assets:**

| Field | File |
|---|---|
| Store icon (128×128) | `icons/icon128.png` |
| Screenshots (1280×800) | `store/screenshots/1-control-bar.png`, `2-volume.png`, `3-download-quality.png`, `4-download-progress.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

**Homepage URL:** https://github.com/rajoyish/reeltavi
**Support URL:** https://github.com/rajoyish/reeltavi/issues

## Privacy practices tab

**Single purpose:**

```
Adds playback controls (skip, seek, volume, speed, Reel navigation, fullscreen, keyboard shortcuts) to Facebook videos and Reels, and lets the user download the video they are watching.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings (show control bar, double-click fullscreen, auto-fullscreen, keyboard shortcuts) and keeps track of downloads in progress in session storage. |
| `downloads` | Saves the video the user chooses to download into Chrome's download folder, reports progress, and opens the file's folder when the user clicks "Show in folder". |
| `offscreen` | Joins Facebook's separate video and audio tracks into one MP4, and converts the video to H.264, inside an offscreen document so the Facebook tab stays responsive. Uses DOMParser for Facebook's DASH manifests and blob URLs to hand the finished file to chrome.downloads. |
| Host permissions: `facebook.com`, `*.facebook.com` | Injects the control bar into Facebook pages and reads the page's video data to find the selected video's media links. |
| Host permissions: `*.fbcdn.net`, `*.fbsbx.com` | Facebook serves video files from these CDN domains; ReelTavi fetches the user's chosen video from them to build the download. |

**Remote code:** No, I am not using remote code. (All JavaScript, including Mediabunny, is bundled in the package.)

**Data usage:** Leave every data-type checkbox unchecked. ReelTavi doesn't collect or transmit user data; it processes page content locally only to deliver the user's requested download.

Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/rajoyish/reeltavi/blob/main/PRIVACY.md

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch)
- Regions: All regions

## Before submitting

1. Load `dist/` contents unpacked once more and test SD and Full HD on a Reel and on a regular video.
2. Review rejections for downloaders usually cite intellectual property. The description's "only videos you own or have permission to save" line helps; keep it.
