/**
 * Plays the capture-card audio through the speakers (with volume / mute)
 * and exposes a level meter. Uses Web Audio so the <video> element can stay muted.
 *
 * The AudioContext can only start after a user gesture, but the capture stream may be
 * opened before that (auto-start when permission was already granted). So attach()
 * remembers the stream and it gets wired up as soon as the context exists.
 */
export class AudioMonitor {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private volume = 0.8;
  private muted = false;

  /** Must be called from a user gesture the first time (browser autoplay rules). */
  async resume(): Promise<void> {
    if (!this.ctx) this.createContext();
    if (this.ctx && this.ctx.state !== "running") await this.ctx.resume();
    if (!this.source) this.connect();
  }

  /** True when there is audio to play but the browser is still waiting for a click/key press. */
  get needsGesture(): boolean {
    return this.stream !== null && (!this.ctx || this.ctx.state !== "running");
  }

  attach(stream: MediaStream | null): void {
    this.source?.disconnect();
    this.source = null;
    this.stream = stream?.getAudioTracks().length ? stream : null;
    this.connect();
  }

  /** A capture stream is attached (it may still be waiting for a user gesture to play). */
  get attached(): boolean {
    return this.stream !== null;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  /** Audio-output details for the stats panel. */
  info(): { state: string; sampleRate: number; baseLatency: number; outputLatency: number } | null {
    if (!this.ctx) return null;
    return {
      state: this.ctx.state,
      sampleRate: this.ctx.sampleRate,
      baseLatency: this.ctx.baseLatency ?? 0,
      outputLatency: this.ctx.outputLatency ?? 0,
    };
  }

  /** Peak level 0..1 of the incoming audio (independent of volume / mute). */
  level(): number {
    if (!this.analyser || !this.buf || !this.source) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let peak = 0;
    for (const s of this.buf) {
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
    return Math.min(1, peak);
  }

  private createContext(sampleRate?: number): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = new AudioContext({ latencyHint: "interactive", ...(sampleRate ? { sampleRate } : {}) });
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.gain.connect(this.ctx.destination);
    this.gain.gain.value = this.muted ? 0 : this.volume;
  }

  private connect(): void {
    if (!this.stream || !this.ctx || !this.gain || !this.analyser || this.source) return;
    try {
      this.source = this.ctx.createMediaStreamSource(this.stream);
    } catch (e) {
      // Firefox refuses streams whose sample rate differs from the context's: rebuild at the stream's rate.
      const rate = this.stream.getAudioTracks()[0]?.getSettings().sampleRate;
      if (!rate || rate === this.ctx.sampleRate) throw e;
      const wasRunning = this.ctx.state === "running";
      this.createContext(rate);
      this.source = this.ctx!.createMediaStreamSource(this.stream);
      if (wasRunning) void this.ctx!.resume();
    }
    this.source.connect(this.analyser);
    this.source.connect(this.gain);
  }

  private applyGain(): void {
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
    }
  }
}
