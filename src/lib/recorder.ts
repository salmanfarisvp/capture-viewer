import type { RecFormat } from "./settings.ts";

/** H.264 + AAC in MP4: plays everywhere (QuickTime, Keynote, phones, editors). */
const MP4_H264 = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1.4d0028,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a",
];
/** Generic MP4: some browsers put VP9/Opus inside it, which QuickTime can't open. Only used when MP4 is forced. */
const MP4_ANY = ["video/mp4"];
const WEBM_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm;codecs=h264,opus", "video/webm"];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined";
}

export function pickMimeType(format: RecFormat): string | undefined {
  if (!recordingSupported()) return undefined;
  const order =
    format === "webm"
      ? [...WEBM_TYPES, ...MP4_H264, ...MP4_ANY]
      : format === "mp4"
        ? [...MP4_H264, ...MP4_ANY, ...WEBM_TYPES]
        : [...MP4_H264, ...WEBM_TYPES, ...MP4_ANY];
  return order.find((t) => MediaRecorder.isTypeSupported(t));
}

export function extensionFor(mime: string): string {
  return mime.startsWith("video/mp4") ? "mp4" : "webm";
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export class Recorder {
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private done: ((r: RecordingResult) => void) | null = null;
  bytes = 0;
  mimeType = "";

  get active(): boolean {
    return this.mr !== null && this.mr.state !== "inactive";
  }

  get elapsedMs(): number {
    return this.active ? performance.now() - this.startedAt : 0;
  }

  start(stream: MediaStream, opts: { format: RecFormat; videoMbps: number }): void {
    if (this.active) throw new Error("Already recording");
    const mimeType = pickMimeType(opts.format);
    const mr = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: Math.round(opts.videoMbps * 1_000_000),
      audioBitsPerSecond: 192_000,
    });
    this.mimeType = mr.mimeType || mimeType || "video/webm";
    this.chunks = [];
    this.bytes = 0;
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
        this.bytes += e.data.size;
      }
    };
    mr.onstop = () => {
      const result: RecordingResult = {
        blob: new Blob(this.chunks, { type: this.mimeType.split(";")[0] }),
        mimeType: this.mimeType,
        durationMs: performance.now() - this.startedAt,
      };
      this.chunks = [];
      this.mr = null;
      this.done?.(result);
      this.done = null;
    };
    this.mr = mr;
    this.startedAt = performance.now();
    mr.start(1000); // 1 s chunks so a crash loses at most a second and the size counter updates.
  }

  stop(): Promise<RecordingResult> {
    const mr = this.mr;
    if (!mr || mr.state === "inactive") return Promise.reject(new Error("Not recording"));
    return new Promise((resolve) => {
      this.done = resolve;
      mr.stop();
    });
  }
}
