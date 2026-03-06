import { ZONES, AGENT_PALETTES, WORLD_WIDTH, WORLD_HEIGHT } from '@agent-move/shared';
import type { Camera } from '../world/camera.js';

const MAP_W = 200;
const MAP_H = 150;

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private _visible = false;
  private camera: Camera;
  private scaleX: number;
  private scaleY: number;

  constructor(camera: Camera, onNavigate: (worldX: number, worldY: number) => void) {
    this.camera = camera;
    this.scaleX = MAP_W / Math.max(1, WORLD_WIDTH);
    this.scaleY = MAP_H / Math.max(1, WORLD_HEIGHT);

    this.canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = MAP_W * dpr;
    this.canvas.height = MAP_H * dpr;
    this.canvas.id = 'minimap';
    this.canvas.style.cssText = `
      position: fixed; bottom: 12px; right: 12px;
      width: ${MAP_W}px; height: ${MAP_H}px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px; background: rgba(10,12,20,0.85);
      cursor: crosshair; z-index: 80; display: none;
      box-shadow: 0 2px 12px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);

    // Click to navigate
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldX = mx / this.scaleX;
      const worldY = my / this.scaleY;
      onNavigate(worldX, worldY);
    });
  }

  get visible(): boolean { return this._visible; }

  toggle(): void {
    this._visible = !this._visible;
    this.canvas.style.display = this._visible ? 'block' : 'none';
  }

  /** Render minimap each frame */
  render(agents: Array<{ x: number; y: number; colorIndex: number }>, viewport: { x: number; y: number; width: number; height: number; zoom: number }): void {
    if (!this._visible) return;

    // Recalculate scale each frame since world size can change
    this.scaleX = MAP_W / Math.max(1, WORLD_WIDTH);
    this.scaleY = MAP_H / Math.max(1, WORLD_HEIGHT);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.imageSmoothingEnabled = false;

    // Draw zones
    for (const zone of ZONES) {
      const zx = zone.x * this.scaleX;
      const zy = zone.y * this.scaleY;
      const zw = zone.width * this.scaleX;
      const zh = zone.height * this.scaleY;
      ctx.fillStyle = '#' + zone.color.toString(16).padStart(6, '0') + '30';
      ctx.strokeStyle = '#' + zone.color.toString(16).padStart(6, '0') + '60';
      ctx.lineWidth = 0.5;
      ctx.fillRect(zx, zy, zw, zh);
      ctx.strokeRect(zx, zy, zw, zh);

      // Zone name label
      ctx.save();
      ctx.fillStyle = '#' + zone.color.toString(16).padStart(6, '0') + 'aa';
      ctx.font = '600 8px "Inter", "SF Pro Text", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(zone.label, zx + zw / 2, zy + zh / 2, zw - 4);
      ctx.restore();
    }

    // Draw agents
    for (const agent of agents) {
      const palette = AGENT_PALETTES[agent.colorIndex % AGENT_PALETTES.length];
      ctx.fillStyle = '#' + palette.body.toString(16).padStart(6, '0');
      ctx.beginPath();
      ctx.arc(agent.x * this.scaleX, agent.y * this.scaleY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw viewport rectangle
    const vx = viewport.x * this.scaleX;
    const vy = viewport.y * this.scaleY;
    const vw = viewport.width * this.scaleX;
    const vh = viewport.height * this.scaleY;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
