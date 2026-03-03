/**
 * Synthesized sound effects using Web Audio API.
 * No audio files needed — all sounds are generated programmatically.
 */

export type SoundEvent = 'spawn' | 'zone-change' | 'tool-use' | 'idle' | 'shutdown';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private _volume = 0.3;
  private _muted = false;
  private initialized = false;
  private lastToolUseTime = 0;
  private static TOOL_USE_COOLDOWN = 300; // ms between tool-use sounds

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
  }

  /** Must be called from a user gesture to unlock AudioContext */
  init(): void {
    if (this.initialized) return;
    this.ctx = new AudioContext();
    this.initialized = true;
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.initialized = true;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private gain(): number {
    return this._muted ? 0 : this._volume;
  }

  play(event: SoundEvent): void {
    if (this._muted || this._volume === 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    switch (event) {
      case 'spawn':
        this.playSpawn(ctx);
        break;
      case 'zone-change':
        this.playZoneChange(ctx);
        break;
      case 'tool-use': {
        const now2 = performance.now();
        if (now2 - this.lastToolUseTime < SoundManager.TOOL_USE_COOLDOWN) return;
        this.lastToolUseTime = now2;
        this.playToolUse(ctx);
        break;
      }
      case 'idle':
        this.playIdle(ctx);
        break;
      case 'shutdown':
        this.playShutdown(ctx);
        break;
    }
  }

  /** Bright ascending chime — agent enters the office */
  private playSpawn(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const vol = this.gain() * 0.25;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.1);
      g.gain.linearRampToValueAtTime(vol, now + i * 0.1 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.35);
    });
  }

  /** Soft blip — agent moves to a new room */
  private playZoneChange(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const vol = this.gain() * 0.12;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.08);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** Soft tap — agent uses a tool */
  private playToolUse(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const vol = this.gain() * 0.06;

    // Gentle sine tap instead of noise burst
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.06);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /** Soft descending tone — agent goes idle */
  private playIdle(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const vol = this.gain() * 0.1;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(330, now + 0.2);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  /** Descending three-note farewell — agent leaves */
  private playShutdown(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const vol = this.gain() * 0.2;
    const notes = [659.25, 523.25, 392.0]; // E5, C5, G4

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.12);
      g.gain.linearRampToValueAtTime(vol, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.35);
    });
  }
}
