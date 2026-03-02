import type { Application, Container } from 'pixi.js';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_SPEED = 0.001;

/**
 * Pan/zoom controls for the world container.
 * - Mouse wheel to zoom (0.5x to 3x)
 * - Click and drag to pan
 */
export class Camera {
  private zoom = 1;
  private dragging = false;
  private lastMouse = { x: 0, y: 0 };

  constructor(
    private app: Application,
    private world: Container,
  ) {
    const canvas = app.canvas;

    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    const oldZoom = this.zoom;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom - e.deltaY * ZOOM_SPEED));

    // Zoom towards cursor position
    const rect = this.app.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomRatio = this.zoom / oldZoom;
    this.world.position.x = mouseX - (mouseX - this.world.position.x) * zoomRatio;
    this.world.position.y = mouseY - (mouseY - this.world.position.y) * zoomRatio;

    this.world.scale.set(this.zoom);
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Only pan with left click or middle click
    if (e.button !== 0 && e.button !== 1) return;
    this.dragging = true;
    this.lastMouse.x = e.clientX;
    this.lastMouse.y = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastMouse.x;
    const dy = e.clientY - this.lastMouse.y;
    this.world.position.x += dx;
    this.world.position.y += dy;
    this.lastMouse.x = e.clientX;
    this.lastMouse.y = e.clientY;
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  /** Programmatically set zoom level */
  setZoom(z: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    this.world.scale.set(this.zoom);
  }

  /** Get current zoom */
  getZoom(): number {
    return this.zoom;
  }

  /** Zoom in by a step amount, centered on viewport */
  zoomIn(): void {
    this.zoomBy(1.2);
  }

  /** Zoom out by a step amount, centered on viewport */
  zoomOut(): void {
    this.zoomBy(1 / 1.2);
  }

  /** Reset to fit the world in the viewport (accounting for sidebar) */
  resetView(worldW: number, worldH: number, sidebarW = 300): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const availW = screenW - sidebarW;
    const pad = 16;
    const scaleX = (availW - pad * 2) / worldW;
    const scaleY = (screenH - pad * 2) / worldH;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    this.setZoom(fitZoom);
    this.world.position.set(
      (availW - worldW * fitZoom) / 2,
      (screenH - worldH * fitZoom) / 2,
    );
  }

  /** Pan camera to center on a world coordinate */
  panTo(worldX: number, worldY: number): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const sidebarW = 300;
    const cx = (screenW - sidebarW) / 2;
    const cy = screenH / 2;
    this.world.position.x = cx - worldX * this.zoom;
    this.world.position.y = cy - worldY * this.zoom;
  }

  private zoomBy(factor: number): void {
    const oldZoom = this.zoom;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    this.zoom = newZoom;
    // Zoom centered on viewport center
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const cx = screenW / 2;
    const cy = screenH / 2;
    const zoomRatio = newZoom / oldZoom;
    this.world.position.x = cx - (cx - this.world.position.x) * zoomRatio;
    this.world.position.y = cy - (cy - this.world.position.y) * zoomRatio;
    this.world.scale.set(this.zoom);
  }

  destroy(): void {
    const canvas = this.app.canvas;
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerUp);
  }
}
