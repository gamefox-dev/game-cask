// Basic Web Audio output for BGT: the game pushes int16 mono PCM; we
// schedule AudioBufferSourceNodes back-to-back. No AudioWorklet required.
// Audio starts locked; the first user gesture creates/resumes the context
// (no autoplay assumptions, required by iOS Safari).

import type { AudioSink } from '../runtime/host';

export const AUDIO_RATE = 48000;
const MAX_AHEAD_S = 0.3;
const MIN_LEAD_S = 0.02;

export class WebAudioSink implements AudioSink {
  readonly sampleRate = AUDIO_RATE;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private nextTime = 0;
  droppedFrames = 0;
  playedFrames = 0;
  unlocked = false;
  private unlockCbs: Array<() => void> = [];
  private disposers: Array<() => void> = [];

  get state(): string {
    return this.ctx ? this.ctx.state : 'locked';
  }

  /** Install one-shot gesture listeners that unlock audio. */
  armUnlock(target: EventTarget = window): void {
    const handler = () => void this.unlock();
    for (const t of ['pointerdown', 'keydown', 'touchend']) {
      target.addEventListener(t, handler, { capture: true });
      this.disposers.push(() => target.removeEventListener(t, handler, { capture: true }));
    }
  }

  onUnlock(cb: () => void): void {
    this.unlockCbs.push(cb);
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        try {
          this.ctx = new Ctor({ sampleRate: AUDIO_RATE, latencyHint: 'interactive' });
        } catch {
          this.ctx = new Ctor();
        }
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0.5;
        this.gain.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      if (this.ctx.state === 'running' && !this.unlocked) {
        this.unlocked = true;
        for (const d of this.disposers) d();
        for (const cb of this.unlockCbs) cb();
      }
    } catch {
      /* stays locked; a later gesture retries */
    }
  }

  push(samples: Int16Array): number {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || ctx.state !== 'running' || samples.length === 0) {
      this.droppedFrames += samples.length;
      return 0;
    }
    const now = ctx.currentTime;
    if (this.nextTime < now + MIN_LEAD_S) this.nextTime = now + MIN_LEAD_S;
    const room = Math.floor((now + MAX_AHEAD_S - this.nextTime) * AUDIO_RATE);
    const n = Math.max(0, Math.min(samples.length, room));
    this.droppedFrames += samples.length - n;
    if (n === 0) return 0;
    // If the context fell back to a different rate, let the buffer carry our
    // rate: Web Audio resamples AudioBuffers to the context rate.
    const buf = ctx.createBuffer(1, n, AUDIO_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = samples[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain!);
    src.start(this.nextTime);
    this.nextTime += n / AUDIO_RATE;
    this.playedFrames += n;
    return n;
  }

  queued(): number {
    if (!this.ctx || !this.unlocked) return 0;
    return Math.max(0, Math.round((this.nextTime - this.ctx.currentTime) * AUDIO_RATE));
  }

  close(): void {
    for (const d of this.disposers) d();
    void this.ctx?.close();
  }
}
