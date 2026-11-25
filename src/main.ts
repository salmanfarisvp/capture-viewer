import { AudioMonitor } from "./lib/audio-monitor.ts";
import { CaptureSession, describeMediaError } from "./lib/capture.ts";
import { guessCaptureDevice, listDevices, matchAudioForVideo, shortLabel, type DeviceLists } from "./lib/devices.ts";
import { extensionFor, pickMimeType, Recorder, recordingSupported } from "./lib/recorder.ts";
import {
  ASPECTS,
  BITRATES,
  loadSettings,
  PRESETS,
  REC_FORMATS,
  saveSettings,
  SCALES,
  type Aspect,
  type Preset,
  type RecFormat,
  type Scale,
} from "./lib/settings.ts";
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
$("versionText").textContent = VERSION === "dev" ? "dev build" : `v${VERSION}`;

// ---------- State ----------
const s = loadSettings();
const session = new CaptureSession();
const monitor = new AudioMonitor();
const recorder = new Recorder();
let devices: DeviceLists = { video: [], audio: [] };
let running = false;
let openToken = 0;
let waitingForDevice: string | null = null;
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
    setStatus("Not connected");
    showOverlay(describeMediaError(e), "Retry");
    return;
  }
  if (token !== openToken) return;

  devices = await listDevices();
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
  video.srcObject = session.videoStream;
  await video.play().catch(() => undefined);

  await openAudio();
  if (token !== openToken) return;

  running = true;
  waitingForDevice = null;
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
    if (!id) {
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
    } catch (e) {
      audioNote = "audio failed";
      toast(`Audio: ${describeMediaError(e)}`, true);
    }
  }
  updateControls();
  updateStats();
}

function onVideoEnded(): void {
  if (!running) return;
  running = false;
  waitingForDevice = s.videoDeviceId;
  if (recorder.active) void stopRecording();
  session.close();
  monitor.attach(null);
  video.srcObject = null;
  setStatus("Disconnected");
  showOverlay("The capture card was disconnected. It will reconnect automatically when plugged back in.", "Retry now");
  updateControls();
}

async function onDeviceChange(): Promise<void> {
  try {
    devices = await listDevices();
  } catch {
    return;
  }
  refreshDeviceSelects();
  if (!running && waitingForDevice && devices.video.some((d) => d.deviceId === waitingForDevice)) {
    toast("Capture card reconnected");
    await open(false);
  } else if (running && !session.audioTrack && s.audio === "auto" && !recorder.active) {
    await openAudio();
    refreshDeviceSelects();
  }
}

// ---------- Layout / aspect ----------
function sourceRatio(): number {
  return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
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
  video.style.objectFit = s.scale === "crop" ? "cover" : s.scale === "stretch" ? "fill" : "contain";
}

// ---------- Stats ----------
let frameCount = 0;
let frameWindowStart = performance.now();
let measuredFps = 0;

type RVFCVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
function countFrames(): void {
  frameCount++;
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

// ---------- Screenshot ----------
async function screenshot(toClipboard: boolean): Promise<void> {
  if (!running) return;
  try {
    let ratio: number | null = null;
    if (s.shotMode === "displayed") {
      ratio = s.aspect === "window" ? stage.clientWidth / Math.max(1, stage.clientHeight) : frameRatio();
    }
    const canvas = renderFrame(video, ratio, s.scale);
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
const resumeAudio = () => void monitor.resume().catch(() => undefined);
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
