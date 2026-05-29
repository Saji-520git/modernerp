// ─── Sound Engine — Web Audio API, zero dependencies, 100% offline ────────────

const LS_KEY = 'erp_sound';

function isEnabled(): boolean {
  try { return localStorage.getItem(LS_KEY) !== 'off'; } catch { return true; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AudioCtxClass: typeof AudioContext | null =
  typeof window !== 'undefined'
    ? (window.AudioContext || (window as any).webkitAudioContext || null)
    : null;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  // ── Lazy-init AudioContext ──────────────────────────────────────────────────

  private getCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (!AudioCtxClass) return null;
    try {
      this.ctx    = new AudioCtxClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4; // master volume — comfortable for shop floor
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch { return null; }
  }

  // ── Resume a suspended context (browsers require a user gesture first) ──────

  resume(): void {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => { /* ignore */ });
    }
  }

  // ── Low-level tone helper ───────────────────────────────────────────────────

  private tone(
    freq:       number,
    duration:   number,          // seconds
    type:       OscillatorType = 'sine',
    peakGain  = 1.0,
    startDelay = 0,              // seconds from now
  ): void {
    const ctx = this.getCtx();
    if (!ctx || !this.master) return;
    try {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env);
      env.connect(this.master);
      osc.type = type;
      osc.frequency.value = freq;
      const t = ctx.currentTime + startDelay;
      env.gain.setValueAtTime(peakGain, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.start(t);
      osc.stop(t + duration + 0.01);
    } catch { /* ignore */ }
  }

  // ── Public sound methods ────────────────────────────────────────────────────

  /** Item scanned / added to cart — short high beep */
  beep(): void {
    if (!isEnabled()) return;
    this.tone(880, 0.08, 'sine');
  }

  /** Payment confirmed — two ascending tones */
  success(): void {
    if (!isEnabled()) return;
    this.tone(523, 0.12, 'sine', 1.0, 0);
    this.tone(659, 0.12, 'sine', 1.0, 0.16);
  }

  /** Validation error / out of stock / not found */
  error(): void {
    if (!isEnabled()) return;
    this.tone(220, 0.15, 'sawtooth');
  }

  /** Cart cleared — descending sweep 440 → 330 Hz */
  clear(): void {
    if (!isEnabled()) return;
    const ctx = this.getCtx();
    if (!ctx || !this.master) return;
    try {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env);
      env.connect(this.master);
      osc.type = 'sine';
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.linearRampToValueAtTime(330, t + 0.2);
      env.gain.setValueAtTime(1.0, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.start(t);
      osc.stop(t + 0.21);
    } catch { /* ignore */ }
  }

  /** Cash drawer open — short mechanical noise burst */
  drawer(): void {
    if (!isEnabled()) return;
    const ctx = this.getCtx();
    if (!ctx || !this.master) return;
    try {
      const bufSize = Math.ceil(ctx.sampleRate * 0.06);
      const buf     = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data    = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      const env = ctx.createGain();
      src.buffer = buf;
      src.connect(env);
      env.connect(this.master);
      const t = ctx.currentTime;
      env.gain.setValueAtTime(1.0, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      src.start(t);
    } catch { /* ignore */ }
  }

  /** Very subtle keypress tick (optional — very quiet) */
  keypress(): void {
    if (!isEnabled()) return;
    const ctx = this.getCtx();
    if (!ctx || !this.master) return;
    try {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.connect(env);
      env.connect(this.master);
      osc.type = 'sine';
      osc.frequency.value = 1200;
      const t = ctx.currentTime;
      env.gain.setValueAtTime(0.03, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
      osc.start(t);
      osc.stop(t + 0.02);
    } catch { /* ignore */ }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const sound = new SoundEngine();
