import type { AgentState, ZoneId } from '@agentflow/shared';
import { AGENT_PALETTES, ZONE_MAP, ZONES } from '@agentflow/shared';
import type { StateStore, ConnectionStatus } from '../connection/state-store.js';

type FilterMode = 'all' | 'active' | 'idle' | ZoneId;

/** Token sample for sparkline rendering */
interface TokenHistory {
  samples: number[]; // rolling buffer of total tokens at each sample time
}

export class Overlay {
  private store: StateStore;
  private agentListEl: HTMLElement;
  private statusEl: HTMLElement;
  private filterEl: HTMLElement;
  private refreshTimer: ReturnType<typeof setInterval>;
  private onAgentClick: ((agentId: string) => void) | null = null;
  private currentFilter: FilterMode = 'all';

  // Sparkline data: per-agent rolling token history (sampled every 2s, last 30 samples = 1min)
  private tokenHistory = new Map<string, TokenHistory>();
  private sparklineSampleTimer: ReturnType<typeof setInterval>;

  setAgentClickHandler(handler: (agentId: string) => void): void {
    this.onAgentClick = handler;
  }

  constructor(store: StateStore) {
    this.store = store;
    this.agentListEl = document.getElementById('agent-list')!;
    this.statusEl = document.getElementById('connection-status')!;

    // Create filter pills
    this.filterEl = document.createElement('div');
    this.filterEl.id = 'filter-pills';
    this.agentListEl.parentElement!.insertBefore(this.filterEl, this.agentListEl);
    this.renderFilters();

    // Listen for connection changes
    this.store.on('connection:status', (status) => this.updateConnectionStatus(status));

    // Listen to agent events for immediate updates
    this.store.on('agent:spawn', () => this.renderAgents());
    this.store.on('agent:update', () => this.renderAgents());
    this.store.on('agent:idle', () => this.renderAgents());
    this.store.on('agent:shutdown', () => this.renderAgents());
    this.store.on('state:reset', () => this.renderAgents());

    // Also refresh periodically for token count updates
    this.refreshTimer = setInterval(() => this.renderAgents(), 500);

    // Sample sparkline data every 2 seconds
    this.sparklineSampleTimer = setInterval(() => this.sampleSparklines(), 2000);
  }

  private sampleSparklines(): void {
    const agents = this.store.getAgents();
    for (const [id, agent] of agents) {
      let hist = this.tokenHistory.get(id);
      if (!hist) {
        hist = { samples: [] };
        this.tokenHistory.set(id, hist);
      }
      hist.samples.push(agent.totalInputTokens + agent.totalOutputTokens);
      // Keep last 30 samples (1 minute at 2s intervals)
      if (hist.samples.length > 30) hist.samples.shift();
    }
    // Clean up removed agents
    for (const id of this.tokenHistory.keys()) {
      if (!agents.has(id)) this.tokenHistory.delete(id);
    }
  }

  private renderFilters(): void {
    const filters: { label: string; value: FilterMode }[] = [
      { label: 'All', value: 'all' },
      { label: 'Active', value: 'active' },
      { label: 'Idle', value: 'idle' },
    ];

    this.filterEl.innerHTML = filters.map(f =>
      `<button class="filter-pill${this.currentFilter === f.value ? ' active' : ''}" data-filter="${f.value}">${f.label}</button>`
    ).join('') + `
      <select class="filter-zone-select" title="Filter by zone">
        <option value="">Zone...</option>
        ${ZONES.map(z => `<option value="${z.id}" ${this.currentFilter === z.id ? 'selected' : ''}>${z.icon} ${z.label}</option>`).join('')}
      </select>
    `;

    // Bind filter clicks
    this.filterEl.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentFilter = (btn as HTMLElement).dataset.filter as FilterMode;
        (this.filterEl.querySelector('.filter-zone-select') as HTMLSelectElement).value = '';
        this.renderFilters();
        this.renderAgents();
      });
    });

    // Bind zone select
    const zoneSelect = this.filterEl.querySelector('.filter-zone-select') as HTMLSelectElement;
    zoneSelect.addEventListener('change', () => {
      if (zoneSelect.value) {
        this.currentFilter = zoneSelect.value as ZoneId;
      } else {
        this.currentFilter = 'all';
      }
      this.renderFilters();
      this.renderAgents();
    });
  }

  private updateConnectionStatus(status: ConnectionStatus): void {
    this.statusEl.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
    this.statusEl.className = status === 'connected' ? 'connected' : 'disconnected';
  }

  private shortenId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  private formatTokens(input: number, output: number): string {
    const total = input + output;
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M tokens`;
    if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K tokens`;
    return `${total} tokens`;
  }

  private hexToCSS(hex: number): string {
    return '#' + hex.toString(16).padStart(6, '0');
  }

  private roleBadge(role: string): string {
    const badges: Record<string, { label: string; color: string }> = {
      'main': { label: 'MAIN', color: '#4a90d9' },
      'subagent': { label: 'SUB', color: '#ab47bc' },
      'team-lead': { label: 'LEAD', color: '#ff9800' },
      'team-member': { label: 'MEMBER', color: '#26c6da' },
    };
    const b = badges[role] ?? { label: role.toUpperCase(), color: '#888' };
    return `<span style="
      background: ${b.color}33;
      color: ${b.color};
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      margin-left: 6px;
    ">${b.label}</span>`;
  }

  private filterAgents(agents: AgentState[]): AgentState[] {
    switch (this.currentFilter) {
      case 'all':
        return agents;
      case 'active':
        return agents.filter(a => !a.isIdle);
      case 'idle':
        return agents.filter(a => a.isIdle);
      default:
        // Zone filter
        return agents.filter(a => a.currentZone === this.currentFilter);
    }
  }

  private renderAgents(): void {
    let agents = Array.from(this.store.getAgents().values());
    const totalCount = agents.length;

    // Apply filter
    agents = this.filterAgents(agents);

    if (agents.length === 0) {
      const filterMsg = this.currentFilter !== 'all'
        ? `No ${this.currentFilter} agents (${totalCount} total)`
        : 'No active agents';
      this.agentListEl.innerHTML = `<div style="color: #666; font-style: italic;">${filterMsg}</div>`;
      return;
    }

    // Sort: non-idle first, then by spawn time
    agents.sort((a, b) => {
      if (a.isIdle !== b.isIdle) return a.isIdle ? 1 : -1;
      return a.spawnedAt - b.spawnedAt;
    });

    // Build parent-child tree: render subagents nested under parent
    const allAgentsMap = this.store.getAgents();
    const parentAgents = agents.filter(a => a.role !== 'subagent');
    const subAgents = agents.filter(a => a.role === 'subagent');
    const orphanSubs: AgentState[] = [];

    // Map parentId -> subagents that are in the filtered list
    const childrenOf = new Map<string, AgentState[]>();
    for (const sub of subAgents) {
      if (sub.parentId && allAgentsMap.has(sub.parentId)) {
        let list = childrenOf.get(sub.parentId);
        if (!list) { list = []; childrenOf.set(sub.parentId, list); }
        list.push(sub);
      } else {
        orphanSubs.push(sub);
      }
    }

    // Count all subagents per parent (from full agent list, not just filtered)
    const subCountOf = new Map<string, number>();
    for (const a of allAgentsMap.values()) {
      if (a.parentId) {
        subCountOf.set(a.parentId, (subCountOf.get(a.parentId) ?? 0) + 1);
      }
    }

    // Render tree: parent card, then indented children
    let html = '';
    for (const parent of parentAgents) {
      html += this.renderCard(parent, false, subCountOf.get(parent.id) ?? 0);
      const children = childrenOf.get(parent.id);
      if (children && children.length > 0) {
        html += `<div class="subagent-group">`;
        for (const child of children) {
          html += this.renderCard(child, true);
        }
        html += `</div>`;
      }
    }
    // Orphan subagents (parent not visible or not found)
    for (const orphan of orphanSubs) {
      html += this.renderCard(orphan, true);
    }

    this.agentListEl.innerHTML = html;

    // Attach click handlers
    this.agentListEl.querySelectorAll('.agent-card[data-agent-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.agentId;
        if (id && this.onAgentClick) this.onAgentClick(id);
      });
    });

    // Render sparklines onto canvases
    this.agentListEl.querySelectorAll('.sparkline-canvas').forEach((canvas) => {
      const agentId = (canvas as HTMLElement).dataset.agentId;
      if (agentId) this.drawSparkline(canvas as HTMLCanvasElement, agentId);
    });
  }

  private renderCard(agent: AgentState, isChild = false, subCount = 0): string {
    const palette = AGENT_PALETTES[agent.colorIndex % AGENT_PALETTES.length];
    const borderColor = this.hexToCSS(palette.body);
    const zone = ZONE_MAP.get(agent.currentZone);
    const zoneName = zone ? zone.label : agent.currentZone;
    const toolText = agent.currentTool ?? 'none';
    const tokens = this.formatTokens(agent.totalInputTokens, agent.totalOutputTokens);
    const name = agent.projectName || this.shortenId(agent.sessionId);
    const opacity = agent.isIdle ? '0.6' : '1';
    const childClass = isChild ? ' agent-card-child' : '';
    const subBadge = subCount > 0 ? `<span class="sub-count" title="${subCount} subagent${subCount > 1 ? 's' : ''}">${subCount} sub${subCount > 1 ? 's' : ''}</span>` : '';

    return `<div class="agent-card${childClass}" data-agent-id="${agent.id}" style="border-left: 3px solid ${borderColor}; opacity: ${opacity};">
      <div class="card-top-row">
        <div class="name">${isChild ? '<span class="child-connector">└</span>' : ''}${name}${this.roleBadge(agent.role)}${subBadge}</div>
        <canvas class="sparkline-canvas" data-agent-id="${agent.id}" width="60" height="20"></canvas>
      </div>
      ${agent.taskDescription ? `<div class="task-desc" title="${this.escAttr(agent.taskDescription)}">${this.esc(this.truncate(agent.taskDescription, 48))}</div>` : ''}
      <div class="zone">${zone?.icon ?? ''} ${zoneName} · ${toolText}</div>
      <div style="color: #666; font-size: 11px; margin-top: 3px;">${tokens}</div>
    </div>`;
  }

  private drawSparkline(canvas: HTMLCanvasElement, agentId: string): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hist = this.tokenHistory.get(agentId);
    if (!hist || hist.samples.length < 2) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Calculate deltas (token increments per sample)
    const deltas: number[] = [];
    for (let i = 1; i < hist.samples.length; i++) {
      deltas.push(Math.max(0, hist.samples[i] - hist.samples[i - 1]));
    }

    const maxDelta = Math.max(...deltas, 1);
    const stepX = w / Math.max(deltas.length - 1, 1);

    // Draw area fill
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < deltas.length; i++) {
      const x = i * stepX;
      const y = h - (deltas[i] / maxDelta) * (h - 2) - 1;
      ctx.lineTo(x, y);
    }
    ctx.lineTo((deltas.length - 1) * stepX, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(74, 222, 128, 0.15)';
    ctx.fill();

    // Draw line
    ctx.beginPath();
    for (let i = 0; i < deltas.length; i++) {
      const x = i * stepX;
      const y = h - (deltas[i] / maxDelta) * (h - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  dispose(): void {
    clearInterval(this.refreshTimer);
    clearInterval(this.sparklineSampleTimer);
  }
}
