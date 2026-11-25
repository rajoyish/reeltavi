# Changelog

All notable changes to ReelTavi are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.4.2] – 2026-11-25

### Fixed

- Downloads now check the selected video's permalink and try both Watch and Reel pages when playback data is missing. ReelTavi also recognizes progressive files in Facebook's DASH URL field and keeps a playable source when a page lookup fails.

## [1.4.1] – 2026-11-24

### Fixed

- **Volume reset on the next Reel.** Each new Reel started muted (the slider showed 0) because Facebook applies its own sound state to every new video. ReelTavi now remembers your volume and mute choice and applies it to every Reel and video, even after a page reload. A change you make with Facebook's own mute button is remembered too.
- **The control bar shook when hovering the speaker.** At some player widths, the volume slider pushed buttons onto an extra row, which moved the speaker away from the pointer and looped. The slider now opens as an overlay beside the speaker, so the bar's layout never changes.

## [1.4.0] – 2026-11-24

### Added

- **Keyboard shortcuts.** Space/K play/pause, ←/→ 5 s, J/L 10 s, 0–9 jump to 0–90%, M mute, +/− volume, ↑/↓ volume on regular videos, F fullscreen, D download menu, Shift+N/Shift+P next/previous Reel.
  - They work only while you're engaged with a player (pointer over it, focus in its controls, fullscreen, or on Reels), so Facebook's own shortcuts keep working elsewhere.
  - A switch in the popup turns them off.
- **Playback speed.** `<` and `>` step through 0.25× to 2×.
- **On-screen feedback.** Each shortcut shows a short label on the video, such as "Volume 60%" or "Forward 10 seconds".
- **Accessibility.**
  - Every control is reachable with Tab, and the bar stays visible while it has focus.
  - Buttons announce their state (Play/Pause, Mute/Unmute, Fullscreen/Exit fullscreen), and tooltips show the shortcut.
  - The seek slider reads as "0:05 of 0:20". Arrows move 5 s, Page Up/Down 10 s, and Home/End jump to the start or end.
  - Shortcut actions and download phases are announced to screen readers, once per phase rather than every percent.
  - The download menu supports Home/End, and Tab closes it.
  - Windows high-contrast (forced colors) and reduced-motion settings are respected.
- **Shortcuts tab** in the toolbar popup, listing every shortcut.

### Changed

- **Redesigned popup:** branded header, Settings/Shortcuts tabs with keyboard navigation, toggle switches with descriptions, automatic light and dark mode, and a fullscreen button that stays at the bottom.
- **Responsive control bar.** Narrow players such as 9:16 Reels use a two-row layout: the seek bar on top, playback controls bottom-left and Reel actions bottom-right. Wide videos keep the single row.
  - The bar's corners are now a pill on one row and a rounded card on two.
  - On very narrow players, the Reel buttons step aside while the volume slider is open.
- The download progress bar no longer jumps backwards while files start.

### Fixed

- **Full HD downloads failed with "Unsupported configuration…"** on computers without an AV1 hardware decoder, including most Macs. ReelTavi no longer forces hardware decoding. If converting to H.264 still fails, it saves the original video track instead.
- **"Cannot read properties of undefined (reading 'sendMessage')"** after the extension updated while Facebook was open. ReelTavi now asks you to refresh the page.

## [1.3.0] – 2026-11-22

First Chrome Web Store release.

### Added

- Control bar for Facebook videos and Reels: skip ±10 s, play/pause, volume slider and mute, time and seek bar, previous/next Reel, and fullscreen.
- Double-click fullscreen and optional auto-fullscreen for Reels.
- Auto-hiding controls.
- SD and Full HD downloads with progress in the video.
  - Full HD video and audio tracks are downloaded in parallel and converted to H.264 MP4 on the device.
  - Files are named `ReelTavi-<id>-<quality>.mp4`.
- Privacy policy, store listing and packaging script.

[1.4.2]: https://github.com/rajoyish/reeltavi/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/rajoyish/reeltavi/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/rajoyish/reeltavi/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/rajoyish/reeltavi/releases/tag/v1.3.0
