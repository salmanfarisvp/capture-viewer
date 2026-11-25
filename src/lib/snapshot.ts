import type { Scale } from "./settings.ts";

/**
 * Render the current video frame to a canvas.
 * ratio = null -> full source frame at native resolution.
 * ratio = n    -> frame as displayed with that aspect ratio and scale mode, at (close to) native resolution.
 */
export function renderFrame(video: HTMLVideoElement, ratio: number | null, scale: Scale): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error("No video frame available yet");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  const src = vw / vh;
  if (ratio === null || Math.abs(ratio - src) < 0.001) {
    canvas.width = vw;
    canvas.height = vh;
    ctx.drawImage(video, 0, 0, vw, vh);
    return canvas;
  }

  if (scale === "crop") {
    // Output fits inside the source; cut the overflow evenly.
    const outW = ratio > src ? vw : Math.round(vh * ratio);
    const outH = ratio > src ? Math.round(vw / ratio) : vh;
    canvas.width = outW;
    canvas.height = outH;
    ctx.drawImage(video, (vw - outW) / 2, (vh - outH) / 2, outW, outH, 0, 0, outW, outH);
    return canvas;
  }

  // fit / stretch: output encloses the source.
  const outW = ratio > src ? Math.round(vh * ratio) : vw;
  const outH = ratio > src ? vh : Math.round(vw / ratio);
  canvas.width = outW;
  canvas.height = outH;
  if (scale === "stretch") {
    ctx.drawImage(video, 0, 0, outW, outH);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(video, (outW - vw) / 2, (outH - vh) / 2, vw, vh);
  }
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
  });
}

export async function copyPngToClipboard(blob: Promise<Blob>): Promise<void> {
  if (!("ClipboardItem" in window) || !navigator.clipboard?.write) {
    throw new Error("Clipboard images are not supported in this browser");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
