import { Graphics } from 'pixi.js';

const BG_COLOR = 0x0a0c14;

/**
 * Minimal dark background fill for the glassmorphism theme.
 * Replaces the old brick-wall building shell.
 */
export function createGrid(worldW: number, worldH: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, worldW, worldH).fill(BG_COLOR);
  return g;
}
