import type { AgentState, TimelineEvent, ZoneId } from '@agentflow/shared';
import { AGENT_PALETTES } from '@agentflow/shared';
import type { StateStore } from '../connection/state-store.js';

/**
 * Timeline bar at the bottom of the canvas.
 * Shows a scrubber over the buffered event history.
 * Supports replay mode (stepping through past events) and live mode.
 */
export class Timeline {
  private el: HTMLElement;
  private store: StateStore;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private playBtn: HTMLButtonElement;
  private liveBtn: HTMLButtonElement;
  private timeLabel: HTMLElement;

  private isLive = true;
  private isPlaying = false;
  private playbackPosition = 0; // 0..1 normalized
  private playbackSpeed = 1;
  private lastFrameTime = 0;
  private animId: number | null = null;

  // Replay state
  private replayAgents = new Map<string, AgentState>();
  private onReplayState: ((agents: Map<string, AgentState>) => void) | null = null;

  constructor(store: StateStore) {
    this.store = store;

    // Create timeline bar
    this.el = document.createElement('div');
    this.el.id = 'timeline-bar';
    this.el.innerHTML = `
      <div class="timeline-controls">
        <button id="timeline-play" title="Play/Pause">&#9654;</button>
        <button id="timeline-live" class="active" title="Jump to Live">LIVE</button>
        <span id="timeline-time">--:--</span>
        <span id="timeline-speed" title="Click to change speed">1x</span>
      </div>
      <div class="timeline-track">
        <canvas id="timeline-canvas"></canvas>
      </div>
    `;
    document.getElementById('app')!.appendChild(this.el);

    this.canvas = this.el.querySelector('#timeline-canvas')! as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.playBtn = this.el.querySelector('#timeline-play')! as HTMLButtonElement;
    this.liveBtn = this.el.querySelector('#timeline-live')! as HTMLButtonElement;
    this.timeLabel = this.el.querySelector('#timeline-time')!;

    const speedBtn = this.el.querySelector('#timeline-speed')! as HTMLElement;

    // Resize canvas
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // Click on track to scrub
    this.canvas.addEventListener('mousedown', (e) => this.onTrackClick(e));
    this.canvas.addEventListener('mousemove', (e) => {
      if (e.buttons === 1) this.onTrackClick(e);
    });

    // Play/pause
    this.playBtn.addEventListener('click', () => {
      if (this.isLive) {
        // Switch to replay mode at current position
        this.isLive = false;
        this.liveBtn.classList.remove('active');
        this.playbackPosition = 1;
      }
      this.isPlaying = !this.isPlaying;
      this.playBtn.innerHTML = this.isPlaying ? '&#9646;&#9646;' : '&#9654;';
      if (this.isPlaying) {
        this.lastFrameTime = performance.now();
        this.startPlayback();
      } else {
        this.stopPlayback();
      }
    });

    // Live button
    this.liveBtn.addEventListener('click', () => this.goLive());

    // Speed toggle
    speedBtn.addEventListener('click', () => {
      const speeds = [0.5, 1, 2, 4, 8];
      const idx = speeds.indexOf(this.playbackSpeed);
      this.playbackSpeed = speeds[(idx + 1) % speeds.length];
      speedBtn.textContent = `${this.playbackSpeed}x`;
    });

    // When new timeline snapshot arrives, re-render
    this.store.on('timeline:snapshot', () => this.render());

    // Re-render periodically while live
    setInterval(() => {
      if (this.isLive) this.render();
    }, 1000);
  }

  setReplayCallback(cb: (agents: Map<string, AgentState>) => void): void {
    this.onReplayState = cb;
  }

  private resizeCanvas(): void {
    const track = this.canvas.parentElement!;
    const rect = track.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.render();
  }

  private getTimeRange(): { start: number; end: number } {
    const events = this.store.getTimeline();
    if (events.length === 0) {
      const now = Date.now();
      return { start: now - 60000, end: now };
    }
    return { start: events[0].timestamp, end: Math.max(events[events.length - 1].timestamp, Date.now()) };
  }

  render(): void {
    const w = this.canvas.width / window.devicePixelRatio;
    const h = this.canvas.height / window.devicePixelRatio;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const events = this.store.getTimeline();
    const { start, end } = this.getTimeRange();
    const range = end - start || 1;

    // Draw background track
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 4, w, h - 8);

    // Draw event markers
    for (const event of events) {
      const x = ((event.timestamp - start) / range) * w;
      const color = this.getEventColor(event);
      ctx.fillStyle = color;

      if (event.type === 'agent:spawn') {
        // Taller marker for spawns
        ctx.fillRect(x - 1, 2, 3, h - 4);
      } else if (event.type === 'agent:shutdown') {
        ctx.fillRect(x - 1, 2, 3, h - 4);
      } else {
        // Small dot for updates
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x, h / 2 - 2, 2, 4);
        ctx.globalAlpha = 1;
      }
    }

    // Draw time ticks
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const tickInterval = this.getTickInterval(range);
    const firstTick = Math.ceil(start / tickInterval) * tickInterval;
    for (let t = firstTick; t <= end; t += tickInterval) {
      const x = ((t - start) / range) * w;
      ctx.fillRect(x, 0, 1, 3);
      const d = new Date(t);
      ctx.fillText(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), x, h - 1);
    }

    // Draw playback position (if not live)
    if (!this.isLive) {
      const px = this.playbackPosition * w;
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();

      // Timestamp label
      const posTime = start + this.playbackPosition * range;
      this.timeLabel.textContent = new Date(posTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else {
      // Live indicator line at the end
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w - 1, 0);
      ctx.lineTo(w - 1, h);
      ctx.stroke();

      this.timeLabel.textContent = 'LIVE';
    }
  }

  private getTickInterval(rangeMs: number): number {
    if (rangeMs < 5 * 60 * 1000) return 60 * 1000; // 1 min ticks for <5min range
    if (rangeMs < 15 * 60 * 1000) return 2 * 60 * 1000;
    return 5 * 60 * 1000; // 5 min ticks
  }

  private getEventColor(event: TimelineEvent): string {
    switch (event.type) {
      case 'agent:spawn': return '#a855f7';
      case 'agent:shutdown': return '#f87171';
      case 'agent:idle': return '#6b7280';
      case 'agent:update': {
        const palette = AGENT_PALETTES[event.agent.colorIndex % AGENT_PALETTES.length];
        return '#' + palette.body.toString(16).padStart(6, '0');
      }
    }
  }

  private onTrackClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pos = Math.max(0, Math.min(1, x / rect.width));

    this.isLive = false;
    this.liveBtn.classList.remove('active');
    this.playbackPosition = pos;
    this.isPlaying = false;
    this.playBtn.innerHTML = '&#9654;';
    this.stopPlayback();

    this.reconstructState();
    this.render();
  }

  private goLive(): void {
    this.isLive = true;
    this.isPlaying = false;
    this.playBtn.innerHTML = '&#9654;';
    this.liveBtn.classList.add('active');
    this.stopPlayback();

    // Signal to restore live state
    if (this.onReplayState) {
      this.onReplayState(this.store.getAgents());
    }
    this.render();
  }

  private startPlayback(): void {
    if (this.animId) return;
    this.lastFrameTime = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = now - this.lastFrameTime;
      this.lastFrameTime = now;

      const { start, end } = this.getTimeRange();
      const range = end - start || 1;
      // Advance by dt * speed in timeline space
      const advance = (dt * this.playbackSpeed) / range;
      this.playbackPosition = Math.min(1, this.playbackPosition + advance);

      if (this.playbackPosition >= 1) {
        // Reached the end → go live
        this.goLive();
        return;
      }

      this.reconstructState();
      this.render();
      this.animId = requestAnimationFrame(tick);
    };
    this.animId = requestAnimationFrame(tick);
  }

  private stopPlayback(): void {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  /**
   * Reconstruct agent state at the current playback position
   * by replaying events from the timeline buffer.
   */
  private reconstructState(): void {
    const events = this.store.getTimeline();
    const { start, end } = this.getTimeRange();
    const range = end - start || 1;
    const targetTime = start + this.playbackPosition * range;

    this.replayAgents.clear();

    for (const event of events) {
      if (event.timestamp > targetTime) break;

      switch (event.type) {
        case 'agent:spawn':
        case 'agent:update':
        case 'agent:idle':
          this.replayAgents.set(event.agent.id, { ...event.agent });
          break;
        case 'agent:shutdown':
          this.replayAgents.delete(event.agent.id);
          break;
      }
    }

    if (this.onReplayState) {
      this.onReplayState(this.replayAgents);
    }
  }
}
