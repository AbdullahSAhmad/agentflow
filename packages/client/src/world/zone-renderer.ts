import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { ZONES } from '@agent-move/shared';
import type { ZoneConfig, ZoneId } from '@agent-move/shared';
import { ZONE_DECORATORS } from './furniture.js';
import type { ZoneDecoratorFn } from './themes/theme-types.js';

interface ZoneDisplay {
  container: Container;
  staticBg: Graphics;
  glowBorder: Graphics;
  outerGlow: Graphics;
  config: ZoneConfig;
  agentCount: number;
  currentGlow: number;
}

const BORDER_RADIUS = 12;
const GLOW_ALPHA_IDLE = 0.15;
const GLOW_ALPHA_ACTIVE = 0.7;
const OUTER_GLOW_ALPHA_ACTIVE = 0.15;
const BORDER_WIDTH_IDLE = 1;
const BORDER_WIDTH_ACTIVE = 2;

// Glass panel colors
const GLASS_BG = 0x1a1a2e;
const GLASS_ALPHA = 0.55;
const GLASS_HIGHLIGHT = 0xffffff;
const GLASS_HIGHLIGHT_ALPHA = 0.04;

/** Renders glassmorphism zone panels for each activity zone */
export class ZoneRenderer {
  private zones = new Map<ZoneId, ZoneDisplay>();
  public readonly container = new Container();
  private themeDecorators: Record<string, ZoneDecoratorFn> | null = null;
  private useRetro = false;

  /** Override decorators with a custom theme */
  setThemeDecorators(decorators: Record<string, ZoneDecoratorFn>): void {
    this.themeDecorators = decorators;
    // Detect if this is a retro/pixel-art theme (office theme uses furniture)
    this.useRetro = !!decorators;
    this.rebuild();
  }

  constructor() {
    for (const zone of ZONES) {
      const zoneDisplay = this.createZone(zone);
      this.zones.set(zone.id, zoneDisplay);
      this.container.addChild(zoneDisplay.container);
    }
  }

  private createZone(config: ZoneConfig): ZoneDisplay {
    const container = new Container();
    container.position.set(config.x, config.y);

    // Outer glow (soft spread behind the panel)
    const outerGlow = new Graphics();
    container.addChild(outerGlow);

    // Static background — frosted glass or retro decorator
    const staticBg = new Graphics();
    this.drawRoom(staticBg, config);
    container.addChild(staticBg);

    // Dynamic glow border (animated when agents present)
    const glowBorder = new Graphics();
    container.addChild(glowBorder);

    // Zone label — top-left pill badge
    const labelStyle = new TextStyle({
      fontSize: 13,
      fontFamily: "'Inter', 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
      fill: 0xffffff,
      fontWeight: '600',
      letterSpacing: 0.5,
      dropShadow: {
        alpha: 0.6,
        blur: 4,
        color: 0x000000,
        distance: 0,
      },
    });
    const label = new Text({ text: `${config.icon} ${config.label}`, style: labelStyle });
    label.position.set(14, 10);
    container.addChild(label);

    // Label background pill
    const labelBg = new Graphics();
    const pillW = label.width + 20;
    const pillH = label.height + 8;
    labelBg.roundRect(6, 5, pillW, pillH, 8)
      .fill({ color: 0x000000, alpha: 0.3 });
    container.addChildAt(labelBg, container.children.length - 1);

    return { container, staticBg, glowBorder, outerGlow, config, agentCount: 0, currentGlow: 0 };
  }

  /** Draw the zone panel interior */
  private drawRoom(g: Graphics, config: ZoneConfig): void {
    if (this.useRetro) {
      // Use retro/themed decorator
      const decorator = this.themeDecorators?.[config.id] ?? ZONE_DECORATORS[config.id];
      if (decorator) {
        decorator(g, 0, 0, config.width, config.height);
        return;
      }
    }

    // Glassmorphism panel
    // Dark translucent background
    g.roundRect(0, 0, config.width, config.height, BORDER_RADIUS)
      .fill({ color: GLASS_BG, alpha: GLASS_ALPHA });

    // Subtle inner highlight at top edge (glass reflection)
    g.roundRect(1, 1, config.width - 2, config.height / 3, BORDER_RADIUS)
      .fill({ color: GLASS_HIGHLIGHT, alpha: GLASS_HIGHLIGHT_ALPHA });

    // Subtle inner border
    g.roundRect(0, 0, config.width, config.height, BORDER_RADIUS)
      .stroke({ color: config.color, width: BORDER_WIDTH_IDLE, alpha: GLOW_ALPHA_IDLE });
  }

  /** Update zone glow based on how many agents are present */
  setAgentCount(zoneId: ZoneId, count: number): void {
    const zone = this.zones.get(zoneId);
    if (!zone) return;
    zone.agentCount = count;
  }

  /** Smoothly transition zone glow each frame */
  update(dt: number): void {
    for (const zone of this.zones.values()) {
      const targetGlow = zone.agentCount > 0 ? 1 : 0;
      const speed = 3;
      zone.currentGlow += (targetGlow - zone.currentGlow) * Math.min(1, speed * dt / 1000);

      const alpha = GLOW_ALPHA_IDLE + (GLOW_ALPHA_ACTIVE - GLOW_ALPHA_IDLE) * zone.currentGlow;
      const borderWidth = BORDER_WIDTH_IDLE + (BORDER_WIDTH_ACTIVE - BORDER_WIDTH_IDLE) * zone.currentGlow;
      const outerAlpha = OUTER_GLOW_ALPHA_ACTIVE * zone.currentGlow;

      // Glow border
      zone.glowBorder.clear();
      if (zone.currentGlow > 0.01) {
        zone.glowBorder
          .roundRect(-1, -1, zone.config.width + 2, zone.config.height + 2, BORDER_RADIUS + 1)
          .stroke({ color: zone.config.color, width: borderWidth, alpha });
      }

      // Outer glow (soft spread)
      zone.outerGlow.clear();
      if (zone.currentGlow > 0.01) {
        const spread = 6 * zone.currentGlow;
        zone.outerGlow
          .roundRect(-spread, -spread, zone.config.width + spread * 2, zone.config.height + spread * 2, BORDER_RADIUS + spread)
          .stroke({ color: zone.config.color, width: spread, alpha: outerAlpha });
      }
    }
  }

  /**
   * Destroy and re-create all zone visuals from current ZONES data.
   * Called after layout recalculation.
   */
  rebuild(): void {
    const counts = new Map<ZoneId, number>();
    for (const [id, z] of this.zones) {
      counts.set(id, z.agentCount);
    }

    this.container.removeChildren();
    this.zones.clear();

    for (const zone of ZONES) {
      const zoneDisplay = this.createZone(zone);
      this.zones.set(zone.id, zoneDisplay);
      this.container.addChild(zoneDisplay.container);
      zoneDisplay.agentCount = counts.get(zone.id) ?? 0;
    }
  }

  /** Get zone config for positioning */
  getZoneConfig(zoneId: ZoneId): ZoneConfig | undefined {
    return this.zones.get(zoneId)?.config;
  }
}
