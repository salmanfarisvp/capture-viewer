/**
 * "Stats for nerds": frame timing collection plus a small renderer for the overlay panel.
 */

/** Subset of VideoFrameCallbackMetadata (not in every TS DOM lib yet). */
export interface FrameMeta {
  presentedFrames: number;
  expectedDisplayTime: number;
  mediaTime: number;
  width: number;
  height: number;
  captureTime?: number;
  processingDuration?: number;
}

const WINDOW = 120;

function push(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/** Rolling frame interval / latency stats fed from requestVideoFrameCallback. */
export class FrameTiming {
  private intervals: number[] = [];
  private latencies: number[] = [];
  private last = 0;
  private firstPresented = -1;
  private callbacks = 0;
  presentedFrames = 0;

  reset(): void {
    this.intervals = [];
    this.latencies = [];
    this.last = 0;
    this.firstPresented = -1;
    this.callbacks = 0;
    this.presentedFrames = 0;
  }

  add(now: number, meta: FrameMeta | undefined): void {
    if (this.last) push(this.intervals, now - this.last);
    this.last = now;
    this.callbacks++;
    if (!meta) return;
    if (this.firstPresented < 0) this.firstPresented = meta.presentedFrames;
    this.presentedFrames = meta.presentedFrames;
    if (meta.captureTime) push(this.latencies, meta.expectedDisplayTime - meta.captureTime);
  }

  /** Average / worst frame interval and its standard deviation (jitter), in ms. */
  get interval(): { avg: number; max: number; jitter: number } {
    const a = avg(this.intervals);
    const variance = avg(this.intervals.map((x) => (x - a) ** 2));
    return { avg: a, max: this.intervals.length ? Math.max(...this.intervals) : 0, jitter: Math.sqrt(variance) };
  }

  /** Capture-to-display latency in ms, when the browser reports captureTime (Chrome). */
  get latency(): number | null {
    return this.latencies.length ? avg(this.latencies) : null;
  }

  /** Frames the compositor presented that we never got a callback for (i.e. not painted on time). */
  get skipped(): number {
    if (this.firstPresented < 0) return 0;
    return Math.max(0, this.presentedFrames - this.firstPresented + 1 - this.callbacks);
  }
}

export type StatValue = string | number | boolean | null | undefined;
export type StatSection = [title: string, rows: Array<[label: string, value: StatValue]>];

function fmt(v: StatValue): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
}

export function renderStats(el: HTMLElement, sections: StatSection[]): void {
  const frag = document.createDocumentFragment();
  for (const [title, rows] of sections) {
    const h = document.createElement("div");
    h.className = "nerd-h";
    h.textContent = title;
    const dl = document.createElement("dl");
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = fmt(value);
      dl.append(dt, dd);
    }
    frag.append(h, dl);
  }
  el.replaceChildren(frag);
}

export const ms = (v: number | null | undefined, digits = 1): string | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : `${v.toFixed(digits)} ms`;

export const db = (peak: number): string => (peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : "-∞ dBFS");
