import { Container, Graphics } from 'pixi.js';
import { ZONES, ZONE_MAP } from '@agent-move/shared';
import type { ZoneId } from '@agent-move/shared';

/** Adjacent zone pairs that should have subtle connection lines */
const ZONE_ADJACENCY: [ZoneId, ZoneId][] = [
  ['search', 'terminal'], ['terminal', 'web'],
  ['files', 'thinking'], ['thinking', 'messaging'],
  ['spawn', 'idle'], ['idle', 'tasks'],
  ['search', 'files'], ['terminal', 'thinking'], ['web', 'messaging'],
  ['files', 'spawn'], ['thinking', 'idle'], ['messaging', 'tasks'],
];

interface FlowParticle {
  fromZone: ZoneId;
  toZone: ZoneId;
  t: number; // 0..1 along the bezier
  speed: number;
  color: number;
  alpha: number;
}

const LINE_ALPHA_IDLE = 0.04;
const LINE_ALPHA_ACTIVE = 0.12;
const PARTICLE_SIZE = 3;
const PARTICLE_LIFETIME_MS = 1200;

/**
 * Animated bezier flow lines between adjacent zones.
 * Shows subtle connections and spawns glowing particles when agents transition.
 */
export class FlowLines {
  public readonly container = new Container();
  private linesGfx = new Graphics();
  private particleGfx = new Graphics();
  private particles: FlowParticle[] = [];
  private activeFlows = new Map<string, number>(); // "from->to" -> fade timer

  constructor() {
    this.container.addChild(this.linesGfx);
    this.container.addChild(this.particleGfx);
  }

  /** Call when an agent transitions between zones */
  triggerFlow(fromZone: ZoneId, toZone: ZoneId, agentColor: number): void {
    const key = `${fromZone}->${toZone}`;
    this.activeFlows.set(key, 2000); // active for 2s

    // Spawn 3 particles along the path
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        fromZone,
        toZone,
        t: -i * 0.15, // staggered start
        speed: 1 / PARTICLE_LIFETIME_MS,
        color: agentColor,
        alpha: 0.8,
      });
    }
  }

  private getZoneCenter(zoneId: ZoneId): { x: number; y: number } {
    const z = ZONE_MAP.get(zoneId);
    if (!z) return { x: 0, y: 0 };
    return { x: z.x + z.width / 2, y: z.y + z.height / 2 };
  }

  private bezierPoint(
    x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number
  ): { x: number; y: number } {
    const u = 1 - t;
    return {
      x: u * u * x0 + 2 * u * t * cx + t * t * x1,
      y: u * u * y0 + 2 * u * t * cy + t * t * y1,
    };
  }

  update(dt: number): void {
    // Decay active flows
    for (const [key, timer] of this.activeFlows) {
      const next = timer - dt;
      if (next <= 0) this.activeFlows.delete(key);
      else this.activeFlows.set(key, next);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += p.speed * dt;
      if (p.t > 1) {
        this.particles.splice(i, 1);
      }
    }

    // Draw connection lines
    this.linesGfx.clear();
    for (const [fromId, toId] of ZONE_ADJACENCY) {
      const from = this.getZoneCenter(fromId);
      const to = this.getZoneCenter(toId);
      const key1 = `${fromId}->${toId}`;
      const key2 = `${toId}->${fromId}`;
      const isActive = this.activeFlows.has(key1) || this.activeFlows.has(key2);
      const alpha = isActive ? LINE_ALPHA_ACTIVE : LINE_ALPHA_IDLE;

      // Determine a zone color for the line
      const zoneConfig = ZONE_MAP.get(fromId);
      const lineColor = zoneConfig?.color ?? 0x888888;

      const cx = (from.x + to.x) / 2;
      const cy = (from.y + to.y) / 2 - 20; // slight curve upward

      this.linesGfx.moveTo(from.x, from.y);
      this.linesGfx.quadraticCurveTo(cx, cy, to.x, to.y);
      this.linesGfx.stroke({ color: lineColor, width: 1, alpha });
    }

    // Draw particles
    this.particleGfx.clear();
    for (const p of this.particles) {
      if (p.t < 0) continue;
      const from = this.getZoneCenter(p.fromZone);
      const to = this.getZoneCenter(p.toZone);
      const cx = (from.x + to.x) / 2;
      const cy = (from.y + to.y) / 2 - 20;
      const pos = this.bezierPoint(from.x, from.y, cx, cy, to.x, to.y, p.t);
      const fadeAlpha = p.alpha * (1 - p.t * 0.5);

      this.particleGfx.circle(pos.x, pos.y, PARTICLE_SIZE)
        .fill({ color: p.color, alpha: fadeAlpha });
      // Glow ring
      this.particleGfx.circle(pos.x, pos.y, PARTICLE_SIZE * 2)
        .fill({ color: p.color, alpha: fadeAlpha * 0.3 });
    }
  }
}
