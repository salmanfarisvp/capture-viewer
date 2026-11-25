import { PRESETS, type Preset } from "./settings.ts";

function stopStream(s: MediaStream | null): void {
  s?.getTracks().forEach((t) => t.stop());
}

function errName(e: unknown): string {
  return e instanceof DOMException ? e.name : "";
}

export function describeMediaError(e: unknown): string {
  switch (errName(e)) {
    case "NotAllowedError":
      return "Camera/microphone permission was denied. Allow it in the browser's site settings (and in macOS System Settings > Privacy & Security), then retry.";
    case "NotFoundError":
      return "No capture device found. Plug in the capture card and retry.";
    case "NotReadableError":
      return "The capture card is busy. Close OBS, QuickTime, Zoom or another tab that is using it, then retry.";
    case "OverconstrainedError":
      return "The capture card does not support the selected quality. Try another quality preset.";
    case "SecurityError":
      return "Camera access is blocked on this page. Open it over https:// or http://localhost.";
    default:
      return e instanceof Error ? e.message : String(e);
  }
}

/** Holds the live video and (optional) audio streams for one capture card. */
export class CaptureSession {
  videoStream: MediaStream | null = null;
  audioStream: MediaStream | null = null;

  get videoTrack(): MediaStreamTrack | undefined {
    return this.videoStream?.getVideoTracks()[0];
  }

  get audioTrack(): MediaStreamTrack | undefined {
    return this.audioStream?.getAudioTracks()[0];
  }

  /** Video + audio tracks together, for recording. */
  combined(): MediaStream {
    const tracks: MediaStreamTrack[] = [];
    if (this.videoTrack) tracks.push(this.videoTrack);
    if (this.audioTrack) tracks.push(this.audioTrack);
    return new MediaStream(tracks);
  }

  async openVideo(deviceId: string | null, preset: Preset): Promise<MediaStream> {
    stopStream(this.videoStream);
    this.videoStream = null;

    const p = PRESETS[preset];
    const base: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : {};
    const sized: MediaTrackConstraints = {
      ...base,
      ...(p.width ? { width: { ideal: p.width } } : {}),
      ...(p.height ? { height: { ideal: p.height } } : {}),
      ...(p.fps ? { frameRate: { ideal: p.fps } } : {}),
    };

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({ video: sized, audio: false });
    } catch (e) {
      const name = errName(e);
      if (name === "OverconstrainedError") {
        // Fall back to whatever the device offers by default.
        this.videoStream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
      } else if (name === "NotFoundError" && deviceId) {
        // Saved device id is stale (ids can change after reinstalling the browser, etc).
        this.videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw e;
      }
    }
    return this.videoStream;
  }

  async openAudio(deviceId: string): Promise<MediaStream> {
    this.closeAudio();
    // Capture-card audio is program audio, not a voice call: turn off all voice processing.
    this.audioStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48000 },
      },
    });
    return this.audioStream;
  }

  closeAudio(): void {
    stopStream(this.audioStream);
    this.audioStream = null;
  }

  close(): void {
    stopStream(this.videoStream);
    this.videoStream = null;
    this.closeAudio();
  }
}
