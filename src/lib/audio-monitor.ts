/**
 * Plays the capture-card audio through the speakers (with volume / mute)
 * and exposes a level meter. Uses Web Audio so the <video> element can stay muted.
 */
export class AudioMonitor {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private volume = 0.8;
  private muted = false;

  /** Must be called from a user gesture the first time (browser autoplay rules). */
  async resume(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.gain.connect(this.ctx.destination);
      this.applyGain();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  attach(stream: MediaStream | null): void {
    this.source?.disconnect();
    this.source = null;
    if (!stream || !this.ctx || !this.gain || !this.analyser) return;
    if (!stream.getAudioTracks().length) return;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.source.connect(this.gain);
  }

  get attached(): boolean {
    return this.source !== null;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
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

  private applyGain(): void {
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
    }
  }
}
