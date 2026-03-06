import type { AgentState, ZoneId } from '@agent-move/shared';
import { AGENT_PALETTES } from '@agent-move/shared';
import type { StateStore } from '../connection/state-store.js';

/** Zone-based bar colors */
const ZONE_COLORS: Record<string, string> = {
  files: '#34d399',
  terminal: '#fb923c',
  search: '#60a5fa',
  web: '#f59e0b',
  thinking: '#a78bfa',
  messaging: '#38bdf8',
  tasks: '#f472b6',
  idle: '#6b7280',
  spawn: '#6b7280',
};

interface ToolSpan {
  agentId: string;
  agentName: string;
  toolName: string;
  zone: ZoneId;
  startTime: number;
  endTime: number | null;
  outcome: 'success' | 'failure' | null;
  toolInput: string | null;
}

const MAX_SPANS = 500;
const LANE_HEIGHT = 28;
const LANE_GAP = 2;
const HEADER_HEIGHT = 32;
const LEFT_LABEL_WIDTH = 120;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MIN_WINDOW_MS = 10_000;       // 10s minimum zoom
const MAX_WINDOW_MS = 30 * 60_000;  // 30 min maximum zoom

export class WaterfallPanel {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltip: HTMLElement;
  private visible = false;

  private spans: ToolSpan[] = [];
  /** Ordered list of agent IDs that have swim lanes */
  private agentLanes: string[] = [];
  /** Map agentId -> display name */
  private agentNames = new Map<string, string>();
  /** Track last known tool per agent for span closing */
  private agentCurrentTool = new Map<string, string | null>();

  private _customizationLookup: ((agent: AgentState) => { displayName: string; colorIndex: number }) | null = null;

  setCustomizationLookup(lookup: (agent: AgentState) => { displayName: string; colorIndex: number }): void {
    this._customizationLookup = lookup;
    // Re-resolve existing lane names
    for (const [id] of this.agentNames) {
      const agent = this.store.getAgent(id);
      if (agent) this.agentNames.set(id, this.resolveDisplayName(agent));
    }
  }

  private resolveDisplayName(agent: AgentState): string {
    if (this._customizationLookup) {
      return this._customizationLookup(agent).displayName;
    }
    return agent.agentName ?? agent.projectName ?? agent.id.slice(0, 8);
  }

  /** Viewport: time range shown */
  private viewEndTime = Date.now();
  private viewWindowMs = DEFAULT_WINDOW_MS;
  private autoScroll = true;

  private animFrame: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Event handler references for cleanup
  private onSpawn: (agent: AgentState) => void;
  private onUpdate: (agent: AgentState) => void;
  private onIdle: (agent: AgentState) => void;
  private onShutdown: (agentId: string) => void;
  private onReset: (agents: Map<string, AgentState>) => void;

  constructor(private store: StateStore, parentEl: HTMLElement) {
    // Container
    this.container = document.createElement('div');
    this.container.id = 'waterfall-content';
    this.container.style.cssText = 'display:none;position:relative;width:100%;height:100%;overflow:hidden;';
    parentEl.appendChild(this.container);

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;display:block;cursor:crosshair;';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText =
      'display:none;position:absolute;pointer-events:none;' +
      'background:#1e1e2e;border:1px solid #444;border-radius:4px;padding:6px 10px;' +
      'color:#e0e0e0;font-size:11px;line-height:1.4;z-index:100;max-width:320px;white-space:pre-wrap;word-break:break-all;';
    this.container.appendChild(this.tooltip);

    // Bind events
    this.onSpawn = (agent) => this.handleSpawn(agent);
    this.onUpdate = (agent) => this.handleUpdate(agent);
    this.onIdle = (agent) => this.handleIdle(agent);
    this.onShutdown = (agentId) => this.handleShutdown(agentId);
    this.onReset = (agents) => this.handleReset(agents);

    this.store.on('agent:spawn', this.onSpawn);
    this.store.on('agent:update', this.onUpdate);
    this.store.on('agent:idle', this.onIdle);
    this.store.on('agent:shutdown', this.onShutdown);
    this.store.on('state:reset', this.onReset);

    // Mouse interactions
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });

    // Resize
    this.resizeObserver = new ResizeObserver(() => this.updateCanvasSize());
    this.resizeObserver.observe(this.container);

    // Seed from existing agents
    for (const [, agent] of this.store.getAgents()) {
      this.ensureLane(agent);
    }
  }

  show(): void {
    this.visible = true;
    this.container.style.display = '';
    this.autoScroll = true;
    this.updateCanvasSize();
    this.startRenderLoop();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
    this.stopRenderLoop();
    this.tooltip.style.display = 'none';
  }

  destroy(): void {
    this.store.off('agent:spawn', this.onSpawn);
    this.store.off('agent:update', this.onUpdate);
    this.store.off('agent:idle', this.onIdle);
    this.store.off('agent:shutdown', this.onShutdown);
    this.store.off('state:reset', this.onReset);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.resizeObserver?.disconnect();
    this.stopRenderLoop();
    this.container.remove();
  }

  // ── Event handlers ──

  private ensureLane(agent: AgentState): void {
    if (!this.agentLanes.includes(agent.id)) {
      this.agentLanes.push(agent.id);
    }
    this.agentNames.set(agent.id, this.resolveDisplayName(agent));
  }

  private handleSpawn(agent: AgentState): void {
    this.ensureLane(agent);
    this.agentCurrentTool.set(agent.id, null);
    this.updateCanvasSize();
  }

  private handleUpdate(agent: AgentState): void {
    this.ensureLane(agent);
    const prevTool = this.agentCurrentTool.get(agent.id) ?? null;
    const newTool = agent.currentTool;

    if (newTool !== prevTool) {
      const now = Date.now();
      // Close previous span
      this.closeOpenSpan(agent.id, now, agent.lastToolOutcome);
      // Open new span if there's a tool
      if (newTool) {
        this.openSpan(agent, newTool, now);
      }
      this.agentCurrentTool.set(agent.id, newTool);
    }
  }

  private handleIdle(agent: AgentState): void {
    const now = Date.now();
    this.closeOpenSpan(agent.id, now, agent.lastToolOutcome);
    this.agentCurrentTool.set(agent.id, null);
  }

  private handleShutdown(agentId: string): void {
    const now = Date.now();
    this.closeOpenSpan(agentId, now, null);
    this.agentCurrentTool.delete(agentId);
  }

  private handleReset(agents: Map<string, AgentState>): void {
    this.spans = [];
    this.agentLanes = [];
    this.agentNames.clear();
    this.agentCurrentTool.clear();
    for (const [, agent] of agents) {
      this.ensureLane(agent);
    }
    this.updateCanvasSize();
  }

  private openSpan(agent: AgentState, toolName: string, startTime: number): void {
    const span: ToolSpan = {
      agentId: agent.id,
      agentName: this.agentNames.get(agent.id) ?? this.resolveDisplayName(agent),
      toolName,
      zone: agent.currentZone,
      startTime,
      endTime: null,
      outcome: null,
      toolInput: agent.currentActivity ? agent.currentActivity.slice(0, 200) : null,
    };
    this.spans.push(span);
    this.trimSpans();
  }

  private closeOpenSpan(agentId: string, endTime: number, outcome: 'success' | 'failure' | null): void {
    // Find most recent open span for this agent
    for (let i = this.spans.length - 1; i >= 0; i--) {
      const s = this.spans[i];
      if (s.agentId === agentId && s.endTime === null) {
        s.endTime = endTime;
        s.outcome = outcome;
        break;
      }
    }
  }

  private trimSpans(): void {
    if (this.spans.length > MAX_SPANS) {
      this.spans.splice(0, this.spans.length - MAX_SPANS);
    }
  }

  // ── Canvas sizing ──

  private updateCanvasSize(): void {
    const w = this.container.clientWidth;
    const laneCount = Math.max(this.agentLanes.length, 1);
    const h = HEADER_HEIGHT + laneCount * (LANE_HEIGHT + LANE_GAP) + 8;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Render loop ──

  private startRenderLoop(): void {
    if (this.animFrame !== null) return;
    const loop = () => {
      if (!this.visible) return;
      this.draw();
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  private stopRenderLoop(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  // ── Drawing ──

  private draw(): void {
    const ctx = this.ctx;
    const W = this.container.clientWidth;
    const laneCount = Math.max(this.agentLanes.length, 1);
    const H = HEADER_HEIGHT + laneCount * (LANE_HEIGHT + LANE_GAP) + 8;

    // Update canvas size if lanes changed
    if (Math.abs(parseFloat(this.canvas.style.height) - H) > 1) {
      this.updateCanvasSize();
    }

    // Auto-scroll viewport
    if (this.autoScroll) {
      this.viewEndTime = Date.now();
    }

    const viewStart = this.viewEndTime - this.viewWindowMs;
    const timelineW = W - LEFT_LABEL_WIDTH;

    // Clear
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    // ── Time axis header ──
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, W, HEADER_HEIGHT);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT);
    ctx.lineTo(W, HEADER_HEIGHT);
    ctx.stroke();

    // Grid lines
    const gridIntervalMs = this.pickGridInterval();
    const firstGridTime = Math.ceil(viewStart / gridIntervalMs) * gridIntervalMs;

    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let t = firstGridTime; t <= this.viewEndTime; t += gridIntervalMs) {
      const x = LEFT_LABEL_WIDTH + ((t - viewStart) / this.viewWindowMs) * timelineW;
      // Vertical grid line
      ctx.strokeStyle = '#1f2937';
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, H);
      ctx.stroke();
      // Label
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(this.formatTime(t), x, HEADER_HEIGHT / 2);
    }

    // ── Swim lane labels ──
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '11px sans-serif';

    for (let i = 0; i < this.agentLanes.length; i++) {
      const agentId = this.agentLanes[i];
      const name = this.agentNames.get(agentId) ?? agentId.slice(0, 8);
      const y = HEADER_HEIGHT + i * (LANE_HEIGHT + LANE_GAP);

      // Lane background (alternating)
      ctx.fillStyle = i % 2 === 0 ? '#111827' : '#0f172a';
      ctx.fillRect(0, y, W, LANE_HEIGHT);

      // Label
      const agent = this.store.getAgent(agentId);
      const palette = agent ? AGENT_PALETTES[agent.colorIndex % AGENT_PALETTES.length] : null;
      ctx.fillStyle = palette ? `#${palette.body.toString(16).padStart(6, '0')}` : '#9ca3af';
      const displayName = name.length > 14 ? name.slice(0, 12) + '..' : name;
      ctx.fillText(displayName, LEFT_LABEL_WIDTH - 8, y + LANE_HEIGHT / 2);
    }

    // ── Separator line between labels and timeline ──
    ctx.strokeStyle = '#374151';
    ctx.beginPath();
    ctx.moveTo(LEFT_LABEL_WIDTH, 0);
    ctx.lineTo(LEFT_LABEL_WIDTH, H);
    ctx.stroke();

    // ── Bars ──
    for (const span of this.spans) {
      const end = span.endTime ?? Date.now();
      // Skip if entirely outside viewport
      if (end < viewStart || span.startTime > this.viewEndTime) continue;

      const laneIdx = this.agentLanes.indexOf(span.agentId);
      if (laneIdx < 0) continue;

      const clampedStart = Math.max(span.startTime, viewStart);
      const clampedEnd = Math.min(end, this.viewEndTime);

      const x1 = LEFT_LABEL_WIDTH + ((clampedStart - viewStart) / this.viewWindowMs) * timelineW;
      const x2 = LEFT_LABEL_WIDTH + ((clampedEnd - viewStart) / this.viewWindowMs) * timelineW;
      const barW = Math.max(x2 - x1, 2); // Minimum 2px width
      const y = HEADER_HEIGHT + laneIdx * (LANE_HEIGHT + LANE_GAP) + 3;
      const barH = LANE_HEIGHT - 6;

      // Fill with zone color
      const zoneColor = ZONE_COLORS[span.zone] ?? ZONE_COLORS.thinking;
      ctx.fillStyle = zoneColor;
      ctx.globalAlpha = span.endTime === null ? 0.7 : 0.85;
      ctx.beginPath();
      this.roundRect(ctx, x1, y, barW, barH, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border based on outcome
      if (span.outcome) {
        ctx.strokeStyle = span.outcome === 'success' ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.roundRect(ctx, x1, y, barW, barH, 3);
        ctx.stroke();
      }

      // Pulsing border for in-progress spans
      if (span.endTime === null) {
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 600));
        ctx.strokeStyle = `rgba(255,255,255,${pulse * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        this.roundRect(ctx, x1, y, barW, barH, 3);
        ctx.stroke();
      }

      // Tool name label inside bar (if wide enough)
      if (barW > 40) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const label = this.shortToolName(span.toolName);
        const maxChars = Math.floor((barW - 6) / 5.5);
        const text = label.length > maxChars ? label.slice(0, maxChars - 1) + '..' : label;
        ctx.fillText(text, x1 + 4, y + barH / 2);
      }
    }

    // ── "Now" marker ──
    if (this.autoScroll) {
      const nowX = LEFT_LABEL_WIDTH + timelineW;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(nowX, HEADER_HEIGHT);
      ctx.lineTo(nowX, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Empty state ──
    if (this.spans.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No tool spans recorded yet', W / 2, H / 2);
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private pickGridInterval(): number {
    // Choose a nice grid interval based on zoom level
    const candidates = [1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
    const timelineW = this.container.clientWidth - LEFT_LABEL_WIDTH;
    const minPixelGap = 60;
    for (const ms of candidates) {
      const pixelGap = (ms / this.viewWindowMs) * timelineW;
      if (pixelGap >= minPixelGap) return ms;
    }
    return 600_000;
  }

  private formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  private shortToolName(name: string): string {
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      return parts[parts.length - 1];
    }
    return name;
  }

  // ── Mouse interaction ──

  private hitTest(clientX: number, clientY: number): ToolSpan | null {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    if (mx < LEFT_LABEL_WIDTH || my < HEADER_HEIGHT) return null;

    const viewStart = this.viewEndTime - this.viewWindowMs;
    const timelineW = this.container.clientWidth - LEFT_LABEL_WIDTH;

    for (let i = this.spans.length - 1; i >= 0; i--) {
      const span = this.spans[i];
      const end = span.endTime ?? Date.now();
      if (end < viewStart || span.startTime > this.viewEndTime) continue;

      const laneIdx = this.agentLanes.indexOf(span.agentId);
      if (laneIdx < 0) continue;

      const clampedStart = Math.max(span.startTime, viewStart);
      const clampedEnd = Math.min(end, this.viewEndTime);

      const x1 = LEFT_LABEL_WIDTH + ((clampedStart - viewStart) / this.viewWindowMs) * timelineW;
      const x2 = LEFT_LABEL_WIDTH + ((clampedEnd - viewStart) / this.viewWindowMs) * timelineW;
      const barW = Math.max(x2 - x1, 2);
      const y = HEADER_HEIGHT + laneIdx * (LANE_HEIGHT + LANE_GAP) + 3;
      const barH = LANE_HEIGHT - 6;

      if (mx >= x1 && mx <= x1 + barW && my >= y && my <= y + barH) {
        return span;
      }
    }
    return null;
  }

  private handleMouseMove = (e: MouseEvent): void => {
    const span = this.hitTest(e.clientX, e.clientY);
    if (span) {
      const duration = (span.endTime ?? Date.now()) - span.startTime;
      let text = `${this.shortToolName(span.toolName)}\n`;
      text += `Duration: ${this.fmtDuration(duration)}\n`;
      text += `Zone: ${span.zone}`;
      if (span.outcome) text += `\nOutcome: ${span.outcome}`;

      this.tooltip.textContent = text;
      this.tooltip.style.display = '';
      const rect = this.container.getBoundingClientRect();
      const tx = e.clientX - rect.left + 12;
      const ty = e.clientY - rect.top - 10;
      this.tooltip.style.left = `${Math.min(tx, this.container.clientWidth - 200)}px`;
      this.tooltip.style.top = `${ty}px`;
      this.canvas.style.cursor = 'pointer';
    } else {
      this.tooltip.style.display = 'none';
      this.canvas.style.cursor = 'crosshair';
    }
  };

  private handleMouseLeave = (): void => {
    this.tooltip.style.display = 'none';
    this.canvas.style.cursor = 'crosshair';
  };

  private handleClick = (e: MouseEvent): void => {
    const span = this.hitTest(e.clientX, e.clientY);
    if (span) {
      const duration = (span.endTime ?? Date.now()) - span.startTime;
      let detail = `Tool: ${span.toolName}\n`;
      detail += `Agent: ${span.agentName}\n`;
      detail += `Zone: ${span.zone}\n`;
      detail += `Duration: ${this.fmtDuration(duration)}\n`;
      detail += `Start: ${new Date(span.startTime).toLocaleTimeString()}\n`;
      if (span.endTime) {
        detail += `End: ${new Date(span.endTime).toLocaleTimeString()}\n`;
      } else {
        detail += `Status: In progress\n`;
      }
      if (span.outcome) detail += `Outcome: ${span.outcome}\n`;
      if (span.toolInput) detail += `\nInput:\n${span.toolInput}`;

      this.tooltip.textContent = detail;
      this.tooltip.style.display = '';
      const rect = this.container.getBoundingClientRect();
      const tx = e.clientX - rect.left + 12;
      const ty = e.clientY - rect.top - 10;
      this.tooltip.style.left = `${Math.min(tx, this.container.clientWidth - 200)}px`;
      this.tooltip.style.top = `${Math.max(ty, 4)}px`;
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Zoom
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      const newWindow = Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, this.viewWindowMs * zoomFactor));

      // Zoom around mouse position
      const timelineW = this.container.clientWidth - LEFT_LABEL_WIDTH;
      const mouseRatio = Math.max(0, (mx - LEFT_LABEL_WIDTH) / timelineW);
      const viewStart = this.viewEndTime - this.viewWindowMs;
      const mouseTime = viewStart + mouseRatio * this.viewWindowMs;

      this.viewWindowMs = newWindow;
      // Adjust end time to keep mouse position stable
      this.viewEndTime = mouseTime + (1 - mouseRatio) * newWindow;
      this.autoScroll = false;
    } else {
      // Pan horizontally
      const panMs = (e.deltaX / (this.container.clientWidth - LEFT_LABEL_WIDTH)) * this.viewWindowMs;
      this.viewEndTime += panMs;
      this.autoScroll = false;
    }

    // Snap back to auto-scroll if near "now"
    if (Math.abs(this.viewEndTime - Date.now()) < 2000) {
      this.autoScroll = true;
    }
  };

  // ── Utility ──

  private fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60_000);
    const secs = Math.floor((ms % 60_000) / 1000);
    return `${mins}m ${secs}s`;
  }
}
