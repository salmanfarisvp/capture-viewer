import { AudioMonitor } from "./lib/audio-monitor.ts";
import { CaptureSession, describeMediaError, errName } from "./lib/capture.ts";
import { guessCaptureDevice, listDevices, matchAudioForVideo, shortLabel, unlockAudioDevices, type DeviceLists } from "./lib/devices.ts";
import { extensionFor, pickMimeType, Recorder, recordingSupported } from "./lib/recorder.ts";
import {
  ASPECTS,
  BITRATES,
  loadSettings,
  PRESETS,
  REC_FORMATS,
  ROTATIONS,
  saveSettings,
  SCALES,
  type Aspect,
  type Preset,
  type RecFormat,
  type Rotation,
  type Scale,
} from "./lib/settings.ts";
import { db, FrameTiming, ms, renderStats, type FrameMeta, type StatSection } from "./lib/nerd-stats.ts";
import { canvasToPng, copyPngToClipboard, renderFrame } from "./lib/snapshot.ts";
import { $, download, fillSelect, formatBytes, formatDuration, timestamp } from "./lib/util.ts";

const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

// ---------- Elements ----------
const app = $("app");
const video = $<HTMLVideoElement>("video");
const stage = $("stage");
const overlay = $("overlay");
const overlayMsg = $("overlayMsg");
const startBtn = $<HTMLButtonElement>("startBtn");
const videoSelect = $<HTMLSelectElement>("videoSelect");
const audioSelect = $<HTMLSelectElement>("audioSelect");
const presetSelect = $<HTMLSelectElement>("presetSelect");
const aspectSelect = $<HTMLSelectElement>("aspectSelect");
const scaleSelect = $<HTMLSelectElement>("scaleSelect");
const rotateSelect = $<HTMLSelectElement>("rotateSelect");
const muteBtn = $<HTMLButtonElement>("muteBtn");
const muteIcon = document.getElementById("muteIcon") as SVGPathElement | null;
const volume = $<HTMLInputElement>("volume");
const meterFill = $("meterFill");
const audioCtl = muteBtn.parentElement as HTMLElement;
const shotBtn = $<HTMLButtonElement>("shotBtn");
const recBtn = $<HTMLButtonElement>("recBtn");
const recLabel = $("recLabel");
const recBadge = $("recBadge");
const recTime = $("recTime");
const recSize = $("recSize");
const fsBtn = $<HTMLButtonElement>("fsBtn");
const settingsBtn = $<HTMLButtonElement>("settingsBtn");
const settingsDialog = $<HTMLDialogElement>("settingsDialog");
const recFormatSelect = $<HTMLSelectElement>("recFormatSelect");
const bitrateSelect = $<HTMLSelectElement>("bitrateSelect");
const shotModeSelect = $<HTMLSelectElement>("shotModeSelect");
const recSupport = $("recSupport");
const statusText = $("statusText");
const statsText = $("statsText");
const liveDot = $("liveDot");
const flash = $("flash");
const toastEl = $("toast");
const nerdPanel = $("nerdPanel");
const nerdBody = $("nerdBody");
const nerdToggle = $<HTMLInputElement>("nerdToggle");
$("versionText").textContent = VERSION === "dev" ? "dev build" : `v${VERSION}`;

// ---------- State ----------
const s = loadSettings();
const session = new CaptureSession();
const monitor = new AudioMonitor();
const recorder = new Recorder();
let devices: DeviceLists = { video: [], audio: [], audioLocked: false };
let running = false;
let openToken = 0;
/** The capture card is unplugged / not found: reconnect as soon as it shows up. */
let waitingForDevice = false;
let audioNote = "";
let recTimer: number | undefined;
let recStamp = "";
let hideControls = false;

const ICON_SOUND = "M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z";
const ICON_MUTED = "M4 9v6h4l5 4V5L8 9H4zm15.6 3 2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z";

// ---------- Small UI helpers ----------
let toastTimer: number | undefined;
function toast(msg: string, isError = false): void {
  toastEl.textContent = msg;
  toastEl.classList.toggle("error", isError);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), isError ? 6000 : 2500);
}

function setStatus(text: string): void {
  statusText.textContent = text;
}

function showOverlay(msg: string, buttonLabel: string | null): void {
  overlayMsg.textContent = msg;
  startBtn.hidden = buttonLabel === null;
  if (buttonLabel) startBtn.textContent = buttonLabel;
  overlay.hidden = false;
}

function hideOverlay(): void {
  overlay.hidden = true;
}

function updateControls(): void {
  const rec = recorder.active;
  liveDot.classList.toggle("live", running);
  shotBtn.disabled = !running;
  recBtn.disabled = !running || !recordingSupported();
  recBtn.classList.toggle("recording", rec);
  recLabel.textContent = rec ? "Stop" : "Record";
  // Changing devices mid-recording would end the recorded tracks.
  videoSelect.disabled = rec || devices.video.length === 0;
  audioSelect.disabled = rec || devices.video.length === 0;
  presetSelect.disabled = rec;
  audioCtl.classList.toggle("no-audio", !monitor.attached);
  muteIcon?.setAttribute("d", s.muted ? ICON_MUTED : ICON_SOUND);
  muteBtn.title = s.muted ? "Unmute monitor (M)" : "Mute monitor (M)";
}

function persist(): void {
  saveSettings(s);
}

// ---------- Selects ----------
function populateStaticSelects(): void {
  fillSelect(presetSelect, Object.entries(PRESETS).map(([k, v]) => [k, v.label]), s.preset);
  fillSelect(aspectSelect, Object.entries(ASPECTS).map(([k, v]) => [k, v.label]), s.aspect);
  fillSelect(scaleSelect, Object.entries(SCALES), s.scale);
  fillSelect(rotateSelect, Object.entries(ROTATIONS), String(s.rotation));
  fillSelect(recFormatSelect, Object.entries(REC_FORMATS), s.recFormat);
  fillSelect(bitrateSelect, BITRATES.map((b) => [String(b), `${b} Mbps`]), String(s.recBitrateMbps));
  shotModeSelect.value = s.shotMode;
  volume.value = String(s.volume);
  updateRecSupport();
}

function updateRecSupport(): void {
  if (!recordingSupported()) {
    recSupport.textContent = "Recording is not supported in this browser.";
    return;
  }
  const mime = pickMimeType(s.recFormat);
  recSupport.textContent = mime ? `Will record as ${mime}` : "No supported recording format found.";
}

function refreshDeviceSelects(): void {
  const activeId = session.videoTrack?.getSettings().deviceId ?? s.videoDeviceId ?? "";
  fillSelect(
    videoSelect,
    devices.video.map((d, i) => [d.deviceId, shortLabel(d, i, "Video")]),
    activeId,
  );
  const matched = matchAudioForVideo(currentVideoInfo(), devices.audio);
  fillSelect(
    audioSelect,
    [
      ["auto", matched ? `Auto: ${shortLabel(matched, 0, "Audio")}` : "Auto (no match found)"],
      ["none", "No audio"],
      ...devices.audio.map((d, i): [string, string] => [d.deviceId, shortLabel(d, i, "Audio")]),
    ],
    s.audio,
  );
  updateControls();
}

function currentVideoInfo(): MediaDeviceInfo | undefined {
  const id = session.videoTrack?.getSettings().deviceId ?? s.videoDeviceId;
  return devices.video.find((d) => d.deviceId === id);
}

// ---------- Capture lifecycle ----------
async function start(): Promise<void> {
  try {
    await monitor.resume();
  } catch {
    // Audio monitor will be retried on the next user gesture.
  }
  await open(true);
}

async function open(allowGuess: boolean): Promise<void> {
  const token = ++openToken;
  running = false;
  updateControls();
  setStatus("Opening capture device…");

  try {
    await session.openVideo(s.videoDeviceId, s.preset);
  } catch (e) {
    if (token !== openToken) return;
    if (errName(e) === "NotFoundError") {
      // Saved card is gone. If another capture card is plugged in (or the saved id went stale), use that.
      devices = await listDevices().catch(() => devices);
      if (token !== openToken) return;
      const guess = guessCaptureDevice(devices.video, true);
      if (allowGuess && guess && guess.deviceId !== s.videoDeviceId) {
        s.videoDeviceId = guess.deviceId;
        persist();
        return open(false);
      }
      waitForDevice();
      return;
    }
    setStatus("Not connected");
    showOverlay(describeMediaError(e), "Retry");
    return;
  }
  if (token !== openToken) return;

  devices = await listDevices();
  if (devices.audioLocked && s.audio !== "none") {
    try {
      await unlockAudioDevices();
      devices = await listDevices();
    } catch (e) {
      toast(`Audio: ${describeMediaError(e)}`, true);
    }
    if (token !== openToken) return;
  }
  const activeId = session.videoTrack?.getSettings().deviceId ?? null;

  // First run (or stale saved id): steer away from the built-in FaceTime camera towards the capture card.
  if (allowGuess && activeId !== s.videoDeviceId) {
    const guess = guessCaptureDevice(devices.video);
    if (guess && guess.deviceId !== activeId) {
      s.videoDeviceId = guess.deviceId;
      persist();
      return open(false);
    }
  }
  if (activeId) {
    s.videoDeviceId = activeId;
    persist();
  }

  const track = session.videoTrack;
  if (!track) return;
  track.addEventListener("ended", onVideoEnded, { once: true });
  timing.reset();
  video.srcObject = session.videoStream;
  await video.play().catch(() => undefined);

  await openAudio();
  if (token !== openToken) return;

  running = true;
  waitingForDevice = false;
  hideOverlay();
  refreshDeviceSelects();
  applyLayout();
  const label = currentVideoInfo()?.label || "capture device";
  setStatus(`Live: ${label}`);
  updateStats();
}

async function openAudio(): Promise<void> {
  session.closeAudio();
  monitor.attach(null);
  audioNote = "";

  let id: string | undefined;
  if (s.audio === "none") {
    audioNote = "audio off";
  } else if (s.audio === "auto" || !devices.audio.some((d) => d.deviceId === s.audio)) {
    id = matchAudioForVideo(currentVideoInfo(), devices.audio)?.deviceId;
    if (!id && devices.audioLocked) {
      audioNote = "microphone permission needed for audio";
    } else if (!id) {
      audioNote = "no matching audio input";
      if (devices.audio.length) toast("Couldn't match an audio input to this capture card. Pick it manually under Audio.");
    }
  } else {
    id = s.audio;
  }

  if (id) {
    try {
      const stream = await session.openAudio(id);
      monitor.attach(stream);
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        monitor.attach(null);
        updateControls();
      });
      const label = devices.audio.find((d) => d.deviceId === id)?.label;
      audioNote = label ? `audio: ${label}` : "audio on";
      // Only worth saying when a click would actually make sound (not muted / volume 0).
      if (monitor.needsGesture && !s.muted && s.volume > 0) toast("Click anywhere to turn on sound");
    } catch (e) {
      audioNote = "audio failed";
      toast(`Audio: ${describeMediaError(e)}`, true);
    }
  }
  updateControls();
  updateStats();
}

function waitForDevice(message = "No capture card detected. Plug it in and it will connect automatically."): void {
  running = false;
  waitingForDevice = true;
  setStatus("Waiting for capture card");
  showOverlay(message, "Retry now");
  refreshDeviceSelects();
}

function onVideoEnded(): void {
  if (!running) return;
  if (recorder.active) void stopRecording();
  session.close();
  monitor.attach(null);
  video.srcObject = null;
  waitForDevice("The capture card was disconnected. It will reconnect automatically when plugged back in.");
}

async function onDeviceChange(): Promise<void> {
  try {
    devices = await listDevices();
  } catch {
    return;
  }
  refreshDeviceSelects();
  const target = waitingForDevice
    ? (devices.video.find((d) => d.deviceId === s.videoDeviceId) ?? guessCaptureDevice(devices.video, true))
    : undefined;
  if (!running && target) {
    s.videoDeviceId = target.deviceId;
    persist();
    toast("Capture card connected");
    await open(false);
  } else if (running && !session.audioTrack && s.audio === "auto" && !recorder.active) {
    await openAudio();
    refreshDeviceSelects();
  }
}

// ---------- Layout / aspect ----------
function isSideways(): boolean {
  return s.rotation === 90 || s.rotation === 270;
}

/** Aspect ratio of the source as shown, i.e. after rotation. */
function sourceRatio(): number {
  const r = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  return isSideways() ? 1 / r : r;
}

function frameRatio(): number | null {
  if (s.aspect === "window") return null;
  if (s.aspect === "native") return sourceRatio();
  return ASPECTS[s.aspect].ratio;
}

function applyLayout(): void {
  const r = frameRatio();
  stage.classList.toggle("window", r === null);
  if (r !== null) stage.style.setProperty("--ar", r.toFixed(5));
  stage.classList.toggle("sideways", isSideways());
  stage.style.setProperty("--rot", `${s.rotation}deg`);
  video.style.objectFit = s.scale === "crop" ? "cover" : s.scale === "stretch" ? "fill" : "contain";
}

// ---------- Stats ----------
let frameCount = 0;
let frameWindowStart = performance.now();
let measuredFps = 0;

const timing = new FrameTiming();

type RVFCVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number };
function countFrames(now: number, meta: FrameMeta): void {
  frameCount++;
  timing.add(now, meta);
  (video as RVFCVideo).requestVideoFrameCallback?.(countFrames);
}
(video as RVFCVideo).requestVideoFrameCallback?.(countFrames);

function updateStats(): void {
  if (!running) {
    statsText.textContent = "";
    return;
  }
  const parts: string[] = [];
  if (video.videoWidth) parts.push(`${video.videoWidth}×${video.videoHeight}`);
  const declared = session.videoTrack?.getSettings().frameRate;
  if (measuredFps > 0) parts.push(`${measuredFps.toFixed(0)} fps`);
  else if (declared) parts.push(`${Math.round(declared)} fps`);
  if (audioNote) parts.push(audioNote);
  statsText.textContent = parts.join("  ·  ");
}

setInterval(() => {
  const now = performance.now();
  measuredFps = (frameCount * 1000) / (now - frameWindowStart);
  frameCount = 0;
  frameWindowStart = now;
  updateStats();
}, 1000);

function meterLoop(): void {
  meterFill.style.width = `${Math.round(monitor.level() * 100)}%`;
  requestAnimationFrame(meterLoop);
}
requestAnimationFrame(meterLoop);

// ---------- Stats for nerds ----------
function round(v: number | undefined, digits = 0): string | null {
  return v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits);
}

function shortId(id: string | undefined): string | null {
  return id ? `${id.slice(0, 8)}…` : null;
}

function collectStats(): StatSection[] {
  const sections: StatSection[] = [];
  const vt = session.videoTrack;
  const vs = vt?.getSettings();
  const caps = vt?.getCapabilities?.();
  const preset = PRESETS[s.preset];
  const q = video.getVideoPlaybackQuality?.();
  const iv = timing.interval;

  sections.push([
    "Video",
    [
      ["Device", currentVideoInfo()?.label],
      ["Device id", shortId(vs?.deviceId)],
      ["Track", vt ? `${vt.readyState}${vt.muted ? " (muted)" : ""}` : null],
      ["Requested", preset.width ? `${preset.width}×${preset.height} @ ${preset.fps}` : "device default"],
      ["Negotiated", vs?.width ? `${vs.width}×${vs.height} @ ${round(vs.frameRate, 2)}` : null],
      ["Decoded", video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : null],
      ["Aspect", vs?.aspectRatio ? round(vs.aspectRatio, 4) : video.videoHeight ? round(sourceRatio(), 4) : null],
      ["Resize mode", (vs as { resizeMode?: string } | undefined)?.resizeMode],
      [
        "Device max",
        caps?.width?.max ? `${caps.width.max}×${caps.height?.max ?? "?"} @ ${round(caps.frameRate?.max, 0) ?? "?"}` : null,
      ],
    ],
  ]);

  const dpr = window.devicePixelRatio || 1;
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  sections.push([
    "Display",
    [
      ["Viewport", sw ? `${sw}×${sh} css · ${Math.round(sw * dpr)}×${Math.round(sh * dpr)} px` : null],
      ["Pixel ratio", round(dpr, 2)],
      ["Scale", video.videoHeight && sh ? `${((sh * dpr) / video.videoHeight).toFixed(2)}× (${s.scale})` : s.scale],
      ["Frame", ASPECTS[s.aspect].label],
      ["Rotation", `${s.rotation}°`],
    ],
  ]);

  sections.push([
    "Timing",
    [
      ["Measured fps", measuredFps ? measuredFps.toFixed(1) : null],
      ["Frame interval", iv.avg ? `${ms(iv.avg)} (max ${ms(iv.max)})` : null],
      ["Jitter", ms(iv.jitter, 2)],
      ["Latency", ms(timing.latency) ?? "n/a in this browser"],
      ["Presented", timing.presentedFrames || null],
      ["Skipped", timing.presentedFrames ? timing.skipped : null],
      ["Dropped", q ? `${q.droppedVideoFrames} / ${q.totalVideoFrames}` : null],
    ],
  ]);

  const at = session.audioTrack;
  const as = at?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
  const out = monitor.info();
  const audioDev = devices.audio.find((d) => d.deviceId === as?.deviceId);
  sections.push([
    "Audio",
    at
      ? [
          ["Device", audioDev?.label],
          ["Track", `${at.readyState}${at.muted ? " (muted)" : ""}`],
          ["Format", `${as?.sampleRate ? `${as.sampleRate} Hz` : "? Hz"} · ${as?.channelCount ?? "?"} ch${as?.sampleSize ? ` · ${as.sampleSize}-bit` : ""}`],
          ["Input latency", ms(as?.latency !== undefined ? as.latency * 1000 : undefined)],
          ["Processing", `AEC ${as?.echoCancellation ? "on" : "off"} · NS ${as?.noiseSuppression ? "on" : "off"} · AGC ${as?.autoGainControl ? "on" : "off"}`],
          ["Output", out ? `${out.sampleRate} Hz · ${out.state}` : "not started"],
          ["Output latency", out ? `${ms(out.baseLatency * 1000)} base + ${ms(out.outputLatency * 1000)} device` : null],
          ["Peak", db(monitor.level())],
          ["Monitor", s.muted ? "muted" : `${Math.round(s.volume * 100)}%`],
        ]
      : [["Status", audioNote || "no audio"]],
  ]);

  const recRows: Array<[string, string | null]> = [["Format", recorder.active ? recorder.mimeType : (pickMimeType(s.recFormat) ?? null)]];
  if (recorder.active) {
    const secs = recorder.elapsedMs / 1000;
    recRows.push(["Elapsed", formatDuration(recorder.elapsedMs)]);
    recRows.push(["Size", formatBytes(recorder.bytes)]);
    recRows.push(["Actual rate", secs > 1 ? `${((recorder.bytes * 8) / secs / 1e6).toFixed(2)} Mbps` : null]);
  }
  recRows.push(["Target rate", `${s.recBitrateMbps} Mbps video · 192 kbps audio`]);
  sections.push(["Recording", recRows]);

  return sections;
}

let nerdTimer: number | undefined;
function setNerdStats(on: boolean): void {
  s.nerdStats = on;
  nerdToggle.checked = on;
  nerdPanel.hidden = !on;
  clearInterval(nerdTimer);
  if (on) {
    const tick = () => renderStats(nerdBody, collectStats());
    tick();
    nerdTimer = window.setInterval(tick, 500);
  }
  persist();
}

// ---------- Screenshot ----------
async function screenshot(toClipboard: boolean): Promise<void> {
  if (!running) return;
  try {
    let ratio: number | null = null;
    if (s.shotMode === "displayed") {
      ratio = s.aspect === "window" ? stage.clientWidth / Math.max(1, stage.clientHeight) : frameRatio();
    }
    const canvas = renderFrame(video, ratio, s.scale, s.rotation);
    flash.classList.remove("go");
    void flash.offsetWidth; // restart animation
    flash.classList.add("go");
    const name = `capture-${timestamp()}.png`;
    if (toClipboard) {
      await copyPngToClipboard(canvasToPng(canvas));
      toast(`Screenshot copied (${canvas.width}×${canvas.height})`);
    } else {
      download(await canvasToPng(canvas), name);
      toast(`Saved ${name}`);
    }
  } catch (e) {
    toast(`Screenshot failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

// ---------- Recording ----------
function startRecording(): void {
  if (!running || recorder.active) return;
  try {
    recorder.start(session.combined(), { format: s.recFormat, videoMbps: s.recBitrateMbps });
  } catch (e) {
    toast(`Recording failed: ${e instanceof Error ? e.message : String(e)}`, true);
    return;
  }
  recStamp = timestamp();
  recBadge.hidden = false;
  recTime.textContent = "00:00";
  recSize.textContent = "";
  recTimer = window.setInterval(() => {
    recTime.textContent = formatDuration(recorder.elapsedMs);
    recSize.textContent = recorder.bytes ? formatBytes(recorder.bytes) : "";
  }, 250);
  if (!session.audioTrack) toast("Recording video only (no audio input)");
  updateControls();
}

async function stopRecording(): Promise<void> {
  if (!recorder.active) return;
  clearInterval(recTimer);
  recBadge.hidden = true;
  const result = await recorder.stop();
  updateControls();
  const name = `capture-${recStamp}.${extensionFor(result.mimeType)}`;
  download(result.blob, name);
  toast(`Saved ${name} (${formatDuration(result.durationMs)}, ${formatBytes(result.blob.size)})`);
}

function toggleRecording(): void {
  if (recorder.active) void stopRecording();
  else startRecording();
}

// ---------- Fullscreen / immersive ----------
function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    toast("Fullscreen is not available here", true);
  }
}

function updateImmersive(): void {
  app.classList.toggle("immersive", isFullscreen() || hideControls);
  poke();
}

let idleTimer: number | undefined;
function poke(): void {
  app.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (app.classList.contains("immersive") && !settingsDialog.open && !app.querySelector("select:focus")) {
      app.classList.add("idle");
    }
  }, 2500);
}

// ---------- Cycling helpers ----------
function cycle<T extends string>(keys: T[], current: T): T {
  const i = keys.indexOf(current);
  return keys[(i + 1) % keys.length] ?? current;
}

// ---------- Events ----------
startBtn.addEventListener("click", () => void start());

videoSelect.addEventListener("change", () => {
  s.videoDeviceId = videoSelect.value;
  s.audio = "auto"; // follow the new card's own audio
  persist();
  void open(false);
});

audioSelect.addEventListener("change", () => {
  s.audio = audioSelect.value;
  persist();
  void openAudio().then(refreshDeviceSelects);
});

presetSelect.addEventListener("change", () => {
  s.preset = presetSelect.value as Preset;
  persist();
  if (running || session.videoStream) void open(false);
});

aspectSelect.addEventListener("change", () => {
  s.aspect = aspectSelect.value as Aspect;
  persist();
  applyLayout();
});

function setRotation(r: Rotation): void {
  s.rotation = r;
  rotateSelect.value = String(r);
  persist();
  applyLayout();
}

rotateSelect.addEventListener("change", () => setRotation(Number(rotateSelect.value) as Rotation));

scaleSelect.addEventListener("change", () => {
  s.scale = scaleSelect.value as Scale;
  persist();
  applyLayout();
});

recFormatSelect.addEventListener("change", () => {
  s.recFormat = recFormatSelect.value as RecFormat;
  persist();
  updateRecSupport();
});

bitrateSelect.addEventListener("change", () => {
  s.recBitrateMbps = Number(bitrateSelect.value);
  persist();
});

shotModeSelect.addEventListener("change", () => {
  s.shotMode = shotModeSelect.value === "displayed" ? "displayed" : "full";
  persist();
});

volume.addEventListener("input", () => {
  s.volume = Number(volume.value);
  monitor.setVolume(s.volume);
  if (s.muted && s.volume > 0) {
    s.muted = false;
    monitor.setMuted(false);
    updateControls();
  }
  persist();
});

function toggleMute(): void {
  s.muted = !s.muted;
  monitor.setMuted(s.muted);
  persist();
  updateControls();
}

nerdToggle.addEventListener("change", () => setNerdStats(nerdToggle.checked));
$("nerdClose").addEventListener("click", () => setNerdStats(false));

muteBtn.addEventListener("click", toggleMute);
shotBtn.addEventListener("click", (e) => void screenshot(e.shiftKey));
recBtn.addEventListener("click", toggleRecording);
fsBtn.addEventListener("click", () => void toggleFullscreen());
settingsBtn.addEventListener("click", () => settingsDialog.showModal());

video.addEventListener("resize", () => {
  applyLayout();
  updateStats();
});
video.addEventListener("dblclick", () => void toggleFullscreen());

document.addEventListener("fullscreenchange", updateImmersive);
document.addEventListener("mousemove", poke);
navigator.mediaDevices?.addEventListener?.("devicechange", () => void onDeviceChange());

// Browsers only allow audio playback after a user gesture; resume on the first one.
const resumeAudio = () =>
  void monitor
    .resume()
    .catch(() => undefined)
    .then(updateControls);
document.addEventListener("pointerdown", resumeAudio);
document.addEventListener("keydown", resumeAudio);

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // keep Cmd+R, Cmd+S etc. for the browser
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  if (settingsDialog.open && e.key !== "?") return;

  switch (e.key.toLowerCase()) {
    case "s":
      void screenshot(e.shiftKey);
      break;
    case "r":
      toggleRecording();
      break;
    case "f":
      void toggleFullscreen();
      break;
    case "m":
      toggleMute();
      break;
    case "a":
      s.aspect = cycle(Object.keys(ASPECTS) as Aspect[], s.aspect);
      aspectSelect.value = s.aspect;
      persist();
      applyLayout();
      toast(`Frame: ${ASPECTS[s.aspect].label}`);
      break;
    case "c":
      s.scale = cycle(Object.keys(SCALES) as Scale[], s.scale);
      scaleSelect.value = s.scale;
      persist();
      applyLayout();
      toast(`Scale: ${SCALES[s.scale]}`);
      break;
    case "o":
      setRotation(((s.rotation + 90) % 360) as Rotation);
      toast(`Rotate: ${ROTATIONS[s.rotation]}`);
      break;
    case "i":
      setNerdStats(!s.nerdStats);
      break;
    case "h":
      hideControls = !hideControls;
      updateImmersive();
      break;
    case "?":
      if (settingsDialog.open) settingsDialog.close();
      else settingsDialog.showModal();
      break;
    default:
      return;
  }
  e.preventDefault();
});

window.addEventListener("beforeunload", (e) => {
  if (recorder.active) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------- Boot ----------
async function boot(): Promise<void> {
  populateStaticSelects();
  applyLayout();
  monitor.setVolume(s.volume);
  monitor.setMuted(s.muted);
  setNerdStats(s.nerdStats);
  updateControls();

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus("Unavailable");
    showOverlay(
      "This browser can't access capture devices on this page. Open it over https:// or from http://localhost (run `bun run dev`).",
      null,
    );
    return;
  }

  // If camera permission was granted before, start straight away (no click needed).
  try {
    const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
    if (perm.state === "granted") {
      await open(true);
      return;
    }
  } catch {
    // Permissions API doesn't know "camera" in this browser: wait for the click.
  }
  setStatus("Idle");
}

void boot();
