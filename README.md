# Capture Viewer

View a USB HDMI capture card in the browser, with audio, aspect ratio control, screenshots and recording. A lightweight replacement for opening OBS just to see a Raspberry Pi (or any HDMI source) on your laptop.

Runs entirely in the browser. No server, no install, nothing leaves your machine.

## Features

- **Live video** from any UVC capture card (MS2109 / MS2130 dongles, Cam Link, etc.), up to 4K30 / 1080p60
- **Live audio** from the card, with voice processing turned off (no echo cancellation, noise suppression or auto gain), volume, mute and a level meter
- **Auto pairing**: picks the capture card over the built-in FaceTime camera and matches the card's own audio input (never falls back to the laptop mic)
- **Frame aspect**: Native, 16:9, 16:10, 4:3, 21:9, 1:1, 9:16, Fill window
- **Scale**: Fit (letterbox), Crop (fill), Stretch
- **Screenshot**: full-resolution PNG download, or copy to clipboard. Full source frame or "as displayed" (with the chosen frame and scale)
- **Recording**: MP4 (H.264/AAC) when the browser supports it, otherwise WebM. Selectable bitrate
- **Fullscreen / hide controls** with auto-hiding toolbar, for a second monitor or projector
- **Hot-plug**: reconnects automatically when the card is unplugged and plugged back in
- Settings remembered per browser

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `S` | Screenshot (PNG download) |
| `Shift` + `S` | Screenshot to clipboard |
| `R` | Start / stop recording |
| `F` | Fullscreen (or double-click the video) |
| `M` | Mute / unmute monitor |
| `A` | Next frame aspect |
| `C` | Next scale mode |
| `H` | Hide / show controls |
| `?` | Settings and shortcuts |

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev          # dev server with hot reload (http://localhost:3000)
bun run typecheck
bun run build        # production build into dist/
bun run preview      # serve dist/ on http://localhost:4173
```

Camera access only works on a secure origin: `https://` or `http://localhost`. Opening `dist/index.html` straight from disk works in Chrome but not reliably elsewhere, so prefer `bun run preview` or the hosted version.

## Project layout

```
src/
  index.html            UI shell
  styles.css
  main.ts               wiring: UI, keyboard, lifecycle
  lib/
    capture.ts          getUserMedia for the card's video and audio, error messages
    devices.ts          device listing, capture-card detection, audio pairing
    audio-monitor.ts    Web Audio playback, volume, level meter
    recorder.ts         MediaRecorder wrapper, format selection
    snapshot.ts         frame grabbing with aspect / scale
    settings.ts         options and persisted settings
scripts/
  build.ts              Bun.build with version injection
  preview.ts            static server for dist/
  release.ts            version bump + tag
```

## Releases

Releases are driven by git tags.

```sh
bun run release patch     # or minor | major | 1.2.3
git push --follow-tags
```

`bun run release` checks the tree is clean, runs typecheck and build, bumps `package.json`, commits and creates an annotated `vX.Y.Z` tag. Pushing the tag runs `.github/workflows/release.yml`, which verifies the tag matches `package.json`, builds, and publishes a GitHub Release with `capture-viewer-vX.Y.Z.zip` and auto-generated notes. Tags with a suffix (for example `v0.3.0-beta.1`) are marked as pre-releases.

## Hosting

### GitHub Pages

1. Repo **Settings > Pages > Source: GitHub Actions**.
2. Push to `main`. `.github/workflows/pages.yml` builds and deploys.

The build uses relative asset paths, so it works at `https://<user>.github.io/<repo>/` without extra config.

### Vercel

Import the repo. `vercel.json` already sets the Bun install/build commands and `dist` as output. It also sends a `Permissions-Policy` header allowing camera, microphone and fullscreen.

## Browser notes

- **Chrome / Edge / Arc / Brave** (recommended): best support, MP4 recording, clipboard screenshots.
- **Safari**: works, records MP4. Grant camera and microphone when asked.
- **Firefox**: works, records WebM only.
- macOS: if you denied access once, re-enable it in **System Settings > Privacy & Security > Camera / Microphone** for your browser.
- "The capture card is busy": close OBS, QuickTime or any other app or tab using it. Only one app can usually read a UVC device at a time.
- Measured FPS is shown in the status bar. USB 2 dongles (MS2109) usually top out at 1080p30.
- Long recordings are kept in memory until you stop, so for multi-hour sessions prefer a lower bitrate.

## Roadmap

- Multiple inputs side by side
- Network source (stream from a capture Pi via go2rtc / ustreamer) using the same viewer

## License

MIT
