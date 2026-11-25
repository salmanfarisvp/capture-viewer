import { PRESETS, type Preset } from "./settings.ts";

function stopStream(s: MediaStream | null): void {
  s?.getTracks().forEach((t) => t.stop());
}

export function errName(e: unknown): string {
  return e instanceof DOMException ? e.name : "";
}

export function describeMediaError(e: unknown): string {
  switch (errName(e)) {
    case "NotAllowedError":
      return "Camera/microphone permission was denied. Allow it in the browser's site settings (and in macOS System Settings > Privacy & Security), then retry.";
    case "NotFoundError":
      return "No capture card detected. Plug it in and it will connect automatically.";
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
      // A missing device shows up as OverconstrainedError on the deviceId constraint, not NotFoundError.
      const missing =
        name === "NotFoundError" || (name === "OverconstrainedError" && (e as { constraint?: string }).constraint === "deviceId");
      if (missing) throw new DOMException("Capture device not found", "NotFoundError");
      if (name !== "OverconstrainedError") throw e;
      // The device is there but can't do the requested quality: use whatever it offers by default.
      try {
        this.videoStream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
      } catch (e2) {
        if (errName(e2) === "OverconstrainedError") throw new DOMException("Capture device not found", "NotFoundError");
        throw e2;
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
