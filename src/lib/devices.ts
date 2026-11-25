export interface DeviceLists {
  video: MediaDeviceInfo[];
  audio: MediaDeviceInfo[];
  /** Audio inputs exist but are hidden (no ids / labels) because microphone permission hasn't been granted. */
  audioLocked: boolean;
}

export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const audioIn = all.filter((d) => d.kind === "audioinput");
  return {
    video: all.filter((d) => d.kind === "videoinput" && d.deviceId),
    audio: audioIn.filter((d) => d.deviceId && d.label && d.deviceId !== "default" && d.deviceId !== "communications"),
    audioLocked: audioIn.length > 0 && audioIn.every((d) => !d.deviceId || !d.label),
  };
}

/**
 * Video is opened with camera permission only, so browsers hide audio inputs until the
 * microphone is allowed too. Ask once (briefly opening the default mic) so they can be listed.
 */
export async function unlockAudioDevices(): Promise<void> {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  s.getTracks().forEach((t) => t.stop());
}

/** Built-in / phone cameras that are almost never the capture card. */
const NOT_CAPTURE = /facetime|isight|built-?in|integrated|continuity|iphone|ipad|desk view|obs virtual|virtual camera|snap camera|zoom/i;
const CAPTURE_HINT = /capture|hdmi|usb video|usb3|ms21\d\d|macrosilicon|cam ?link|elgato|avermedia|magewell|uvc|video ?grabber|534d/i;

/**
 * Best guess for the capture card among video inputs.
 * strict = only devices whose name looks like a capture card (never an ordinary webcam).
 */
export function guessCaptureDevice(video: MediaDeviceInfo[], strict = false): MediaDeviceInfo | undefined {
  const hinted = video.find((d) => CAPTURE_HINT.test(d.label));
  if (hinted || strict) return hinted;
  return video.find((d) => d.label && !NOT_CAPTURE.test(d.label));
}

/** USB vendor:product id that Chrome appends to labels, e.g. "USB Video (534d:2109)". */
function usbId(label: string): string | null {
  const m = /\(([0-9a-f]{4}:[0-9a-f]{4})\)/i.exec(label);
  return m?.[1]?.toLowerCase() ?? null;
}

const STOP_WORDS = new Set(["usb", "audio", "video", "digital", "input", "device", "microphone", "mic", "camera", "default", "the"]);

function tokens(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );
}

/**
 * Find the audio input that belongs to the same physical capture card.
 * Returns undefined rather than guessing, so we never silently record the laptop mic.
 */
export function matchAudioForVideo(video: MediaDeviceInfo | undefined, audio: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  if (!video) return undefined;
  if (video.groupId) {
    const sameGroup = audio.find((a) => a.groupId === video.groupId);
    if (sameGroup) return sameGroup;
  }
  const id = usbId(video.label);
  if (id) {
    const sameUsb = audio.find((a) => usbId(a.label) === id);
    if (sameUsb) return sameUsb;
  }
  const vt = tokens(video.label);
  if (vt.size) {
    const byWords = audio.find((a) => [...tokens(a.label)].some((t) => vt.has(t)));
    if (byWords) return byWords;
  }
  // Generic dongles often show up as "USB Video" + "USB Digital Audio" with nothing else in common.
  if (/usb video/i.test(video.label)) {
    return audio.find((a) => /usb (digital )?audio/i.test(a.label));
  }
  return undefined;
}

export function shortLabel(d: MediaDeviceInfo, index: number, kind: "Video" | "Audio"): string {
  return d.label || `${kind} input ${index + 1}`;
}
