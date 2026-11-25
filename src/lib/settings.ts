export type Aspect = "native" | "16:9" | "16:10" | "4:3" | "21:9" | "1:1" | "9:16" | "window";
export type Scale = "fit" | "crop" | "stretch";
export type Preset = "auto" | "2160p30" | "1080p60" | "1080p30" | "720p60" | "720p30" | "480p30";
export type RecFormat = "auto" | "mp4" | "webm";
export type ShotMode = "full" | "displayed";
/** "auto" = pick the audio input that belongs to the capture card, "none" = no audio. */
export type AudioChoice = "auto" | "none" | (string & {});

export interface Settings {
  videoDeviceId: string | null;
  audio: AudioChoice;
  preset: Preset;
  aspect: Aspect;
  scale: Scale;
  muted: boolean;
  volume: number;
  recFormat: RecFormat;
  recBitrateMbps: number;
  shotMode: ShotMode;
}

export const DEFAULTS: Settings = {
  videoDeviceId: null,
  audio: "auto",
  preset: "1080p60",
  aspect: "native",
  scale: "fit",
  muted: false,
  volume: 0.8,
  recFormat: "auto",
  recBitrateMbps: 12,
  shotMode: "full",
};

export const PRESETS: Record<Preset, { label: string; width?: number; height?: number; fps?: number }> = {
  auto: { label: "Auto (device default)" },
  "2160p30": { label: "4K 30 fps", width: 3840, height: 2160, fps: 30 },
  "1080p60": { label: "1080p 60 fps", width: 1920, height: 1080, fps: 60 },
  "1080p30": { label: "1080p 30 fps", width: 1920, height: 1080, fps: 30 },
  "720p60": { label: "720p 60 fps", width: 1280, height: 720, fps: 60 },
  "720p30": { label: "720p 30 fps", width: 1280, height: 720, fps: 30 },
  "480p30": { label: "480p 30 fps", width: 640, height: 480, fps: 30 },
};

export const ASPECTS: Record<Aspect, { label: string; ratio: number | null }> = {
  native: { label: "Native (source)", ratio: null },
  "16:9": { label: "16:9", ratio: 16 / 9 },
  "16:10": { label: "16:10", ratio: 16 / 10 },
  "4:3": { label: "4:3", ratio: 4 / 3 },
  "21:9": { label: "21:9", ratio: 21 / 9 },
  "1:1": { label: "1:1", ratio: 1 },
  "9:16": { label: "9:16 (portrait)", ratio: 9 / 16 },
  window: { label: "Fill window", ratio: null },
};

export const SCALES: Record<Scale, string> = {
  fit: "Fit (letterbox)",
  crop: "Crop (fill)",
  stretch: "Stretch",
};

export const REC_FORMATS: Record<RecFormat, string> = {
  auto: "Auto (MP4 if supported)",
  mp4: "MP4 (H.264)",
  webm: "WebM (VP9/VP8)",
};

export const BITRATES = [4, 8, 12, 20, 30] as const;

const KEY = "capture-viewer:settings:v1";

function isKeyOf<T extends object>(obj: T, k: unknown): k is keyof T {
  return typeof k === "string" && k in obj;
}

export function loadSettings(): Settings {
  const s: Settings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const p = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    if (typeof p.videoDeviceId === "string") s.videoDeviceId = p.videoDeviceId;
    if (typeof p.audio === "string") s.audio = p.audio;
    if (isKeyOf(PRESETS, p.preset)) s.preset = p.preset;
    if (isKeyOf(ASPECTS, p.aspect)) s.aspect = p.aspect;
    if (isKeyOf(SCALES, p.scale)) s.scale = p.scale;
    if (typeof p.muted === "boolean") s.muted = p.muted;
    if (typeof p.volume === "number" && p.volume >= 0 && p.volume <= 1) s.volume = p.volume;
    if (isKeyOf(REC_FORMATS, p.recFormat)) s.recFormat = p.recFormat;
    if (typeof p.recBitrateMbps === "number" && p.recBitrateMbps > 0) s.recBitrateMbps = p.recBitrateMbps;
    if (p.shotMode === "full" || p.shotMode === "displayed") s.shotMode = p.shotMode;
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore (private mode, quota, sandboxed iframe).
  }
}
