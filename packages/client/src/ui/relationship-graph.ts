import type { AgentState } from '@agent-move/shared';
import { AGENT_PALETTES } from '@agent-move/shared';
import type { StateStore } from '../connection/state-store.js';

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  colorIndex: number;
  phase: AgentState['phase'];
  role: AgentState['role'];
  parentId: string | null;
  teamName: string | null;
  messageTarget: string | null;
  agentName: string | null;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: 'parent-child' | 'teammate' | 'message';
}

const NODE_RADIUS = 20;
const CLICK_RADIUS = 25;
const SPRING_LENGTH = 120;
const REPULSION = 4000;
const SPRING_K = 0.005;
const DAMPING = 0.9;
const MAX_VELOCITY = 3;
const CENTER_GRAVITY = 0.01;

const PHASE_COLORS: Record<AgentState['phase'], string> = {
  running: '#4caf50',
  idle: '#9e9e9e',
  compacting: '#9c27b0',
};

const ROLE_LABELS: Partial<Record<AgentState['role'], string>> = {
  main: 'MAIN',
  subagent: 'SUB',
  'team-lead': 'LEAD',
};

function hexToCSS(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
}

export class RelationshipGraph {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private animFrame: number | null = null;
  private visible = false;
  private messageAnimT = 0;
  private store: StateStore;
  private _customizationLookup: ((agent: AgentState) => { displayName: string; colorIndex: number }) | null = null;

  setCustomizationLookup(lookup: (agent: AgentState) => { displayName: string; colorIndex: number }): void {
    this._customizationLookup = lookup;
    // Re-resolve existing node labels
    for (const [id, node] of this.nodes) {
      const agent = this.store.getAgent(id);
      if (agent) {
        node.label = this.resolveDisplayName(agent);
        node.colorIndex = this.resolveColorIndex(agent);
      }
    }
  }

  private resolveDisplayName(agent: AgentState): string {
    if (this._customizationLookup) {
      return this._customizationLookup(agent).displayName;
    }
    return agent.agentName ?? agent.projectName ?? agent.id.slice(0, 8);
  }

  private resolveColorIndex(agent: AgentState): number {
    if (this._customizationLookup) {
      return this._customizationLookup(agent).colorIndex;
    }
    return agent.colorIndex;
  }

  // Event listeners we need to clean up
  private listeners: Array<{ event: string; fn: (...args: any[]) => void }> = [];

  constructor(store: StateStore, parentEl: HTMLElement) {
    this.store = store;

    this.container = document.createElement('div');
    this.container.id = 'relationship-content';
    this.container.style.display = 'none';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.position = 'relative';

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    parentEl.appendChild(this.container);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;

    this.canvas.addEventListener('click', this.onClick);

    // Observe resize
    const ro = new ResizeObserver(() => this.resizeCanvas());
    ro.observe(this.container);

    // Subscribe to store events
    const bind = <T extends Parameters<StateStore['on']>[0]>(
      event: T,
      fn: Parameters<StateStore['on']>[1],
    ) => {
      store.on(event, fn as any);
      this.listeners.push({ event, fn });
    };

    bind('state:reset', () => this.rebuildFromStore());
    bind('agent:spawn', () => this.rebuildFromStore());
    bind('agent:update', () => this.rebuildFromStore());
    bind('agent:idle', () => this.rebuildFromStore());
    bind('agent:shutdown', () => this.rebuildFromStore());
  }

  show(): void {
    this.visible = true;
    this.container.style.display = 'block';
    this.resizeCanvas();
    this.rebuildFromStore();
    this.startLoop();
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
    this.stopLoop();
  }

  destroy(): void {
    this.stopLoop();
    this.canvas.removeEventListener('click', this.onClick);
    for (const { event, fn } of this.listeners) {
      this.store.off(event as any, fn as any);
    }
    this.listeners.length = 0;
    this.container.remove();
  }

  // ---- internal ----

  private resizeCanvas(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private rebuildFromStore(): void {
    const agents = this.store.getAgents();
    const existingIds = new Set<string>();

    for (const [id, agent] of agents) {
      existingIds.add(id);
      let node = this.nodes.get(id);
      if (!node) {
        const cx = this.canvas.width / (window.devicePixelRatio || 1) / 2;
        const cy = this.canvas.height / (window.devicePixelRatio || 1) / 2;
        node = {
          id,
          label: this.resolveDisplayName(agent),
          x: cx + (Math.random() - 0.5) * 100,
          y: cy + (Math.random() - 0.5) * 100,
          vx: 0,
          vy: 0,
          colorIndex: this.resolveColorIndex(agent),
          phase: agent.phase,
          role: agent.role,
          parentId: agent.parentId,
          teamName: agent.teamName,
          messageTarget: agent.messageTarget,
          agentName: agent.agentName,
        };
        this.nodes.set(id, node);
      } else {
        // Update mutable fields
        node.phase = agent.phase;
        node.role = agent.role;
        node.parentId = agent.parentId;
        node.teamName = agent.teamName;
        node.messageTarget = agent.messageTarget;
        node.label = this.resolveDisplayName(agent);
        node.colorIndex = this.resolveColorIndex(agent);
        node.agentName = agent.agentName;
      }
    }

    // Remove stale nodes
    for (const id of this.nodes.keys()) {
      if (!existingIds.has(id)) this.nodes.delete(id);
    }

    this.rebuildEdges();
  }

  private rebuildEdges(): void {
    this.edges = [];
    const nodeArr = Array.from(this.nodes.values());

    // Parent-child edges
    for (const node of nodeArr) {
      if (node.parentId && this.nodes.has(node.parentId)) {
        this.edges.push({ source: node.parentId, target: node.id, kind: 'parent-child' });
      }
    }

    // Teammate edges (same teamName, avoid duplicates)
    const teamGroups = new Map<string, string[]>();
    for (const node of nodeArr) {
      if (node.teamName) {
        let arr = teamGroups.get(node.teamName);
        if (!arr) {
          arr = [];
          teamGroups.set(node.teamName, arr);
        }
        arr.push(node.id);
      }
    }
    for (const members of teamGroups.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          // Skip if already connected by parent-child
          const alreadyConnected = this.edges.some(
            (e) =>
              e.kind === 'parent-child' &&
              ((e.source === members[i] && e.target === members[j]) ||
                (e.source === members[j] && e.target === members[i])),
          );
          if (!alreadyConnected) {
            this.edges.push({ source: members[i], target: members[j], kind: 'teammate' });
          }
        }
      }
    }

    // Message target edges
    for (const node of nodeArr) {
      if (node.messageTarget) {
        // Find target node by agentName
        const target = nodeArr.find((n) => n.agentName === node.messageTarget);
        if (target) {
          this.edges.push({ source: node.id, target: target.id, kind: 'message' });
        }
      }
    }
  }

  private startLoop(): void {
    if (this.animFrame !== null) return;
    const loop = () => {
      if (!this.visible) return;
      this.simulate();
      this.draw();
      this.messageAnimT = (this.messageAnimT + 0.02) % 1;
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  private simulate(): void {
    const nodes = Array.from(this.nodes.values());
    if (nodes.length === 0) return;

    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const cx = w / 2;
    const cy = h / 2;

    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Spring attraction for edges
    const connectedSet = new Set<string>();
    for (const edge of this.edges) {
      const a = this.nodes.get(edge.source);
      const b = this.nodes.get(edge.target);
      if (!a || !b) continue;
      connectedSet.add(edge.source);
      connectedSet.add(edge.target);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - SPRING_LENGTH;
      const force = SPRING_K * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    for (const node of nodes) {
      node.vx += (cx - node.x) * CENTER_GRAVITY;
      node.vy += (cy - node.y) * CENTER_GRAVITY;
    }

    // Apply velocity with damping and max velocity
    for (const node of nodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > MAX_VELOCITY) {
        node.vx = (node.vx / speed) * MAX_VELOCITY;
        node.vy = (node.vy / speed) * MAX_VELOCITY;
      }
      node.x += node.vx;
      node.y += node.vy;
      // Keep in bounds
      node.x = Math.max(NODE_RADIUS, Math.min(w - NODE_RADIUS, node.x));
      node.y = Math.max(NODE_RADIUS + 15, Math.min(h - NODE_RADIUS - 15, node.y));
    }
  }

  private draw(): void {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Draw edges
    for (const edge of this.edges) {
      const a = this.nodes.get(edge.source);
      const b = this.nodes.get(edge.target);
      if (!a || !b) continue;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      if (edge.kind === 'teammate') {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1.5;
      } else if (edge.kind === 'message') {
        ctx.setLineDash([]);
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 2;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1.5;
      }

      ctx.stroke();
      ctx.setLineDash([]);

      // Animated dots for message edges
      if (edge.kind === 'message') {
        const t = this.messageAnimT;
        for (let i = 0; i < 3; i++) {
          const tt = (t + i * 0.33) % 1;
          const dotX = a.x + (b.x - a.x) * tt;
          const dotY = a.y + (b.y - a.y) * tt;
          ctx.beginPath();
          ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#ffcc80';
          ctx.fill();
        }
      }
    }

    // Draw nodes
    for (const node of this.nodes.values()) {
      const palette = AGENT_PALETTES[node.colorIndex % AGENT_PALETTES.length];
      const bodyColor = hexToCSS(palette.body);
      const phaseColor = PHASE_COLORS[node.phase] ?? PHASE_COLORS.idle;

      // Phase ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, NODE_RADIUS + 3, 0, Math.PI * 2);
      ctx.strokeStyle = phaseColor;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Filled circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = bodyColor;
      ctx.fill();

      // Role badge above node
      const roleLabel = ROLE_LABELS[node.role];
      if (roleLabel) {
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#aaa';
        ctx.fillText(roleLabel, node.x, node.y - NODE_RADIUS - 8);
      }

      // Label below node
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ddd';
      ctx.fillText(truncate(node.label, 12), node.x, node.y + NODE_RADIUS + 14);
    }
  }

  private onClick = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let closest: GraphNode | null = null;
    let closestDist = CLICK_RADIUS;

    for (const node of this.nodes.values()) {
      const dx = node.x - mx;
      const dy = node.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = node;
      }
    }

    if (closest) {
      this.canvas.dispatchEvent(
        new CustomEvent('node-click', { detail: { agentId: closest.id }, bubbles: true }),
      );
    }
  };
}
