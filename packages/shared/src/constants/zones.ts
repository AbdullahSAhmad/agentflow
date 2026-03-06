import type { ZoneConfig } from '../types/zone.js';

/**
 * Responsive bento-grid zone layout.
 * Zones are defined by grid position (colStart/colSpan/rowStart/rowSpan)
 * on a 12-column grid with 3 rows of varying weight.
 *
 * Layout:
 * ┌─────────────┬──────────┬────────────┐
 * │  Search      │ Terminal │  Web       │  Row 0 (weight 5)
 * │  [col 0-4]   │ [col 5-7]│ [col 8-11] │
 * ├──────────┬───┴──────────┴──┬─────────┤
 * │  Files   │  Thinking       │ Msgs    │  Row 1 (weight 4)
 * │ [col 0-3]│  [col 4-8]      │[col 9-11]│
 * ├────┬─────┴──────────┬──────┴─────────┤
 * │Spwn│  Idle          │    Tasks       │  Row 2 (weight 3)
 * │0-2 │  [col 3-7]     │   [col 8-11]  │
 * └────┴────────────────┴────────────────┘
 *
 * x/y/width/height are computed by the LayoutEngine at runtime.
 * The defaults below are fallback values for the original fixed layout.
 */

export const GRID_COLS = 12;
export const ROW_WEIGHTS = [5, 4, 3];

export const ZONES: ZoneConfig[] = [
  // Row 0
  {
    id: 'search',
    label: 'Search',
    description: 'Grep, WebSearch — Research & lookup',
    icon: '\u{1F4DA}',
    color: 0xeab308,
    colStart: 0, colSpan: 5, rowStart: 0, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Bash commands — Server room',
    icon: '\u{1F4BB}',
    color: 0x22c55e,
    colStart: 5, colSpan: 3, rowStart: 0, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  {
    id: 'web',
    label: 'Web',
    description: 'WebFetch, Browser — Network hub',
    icon: '\u{1F310}',
    color: 0x8b5cf6,
    colStart: 8, colSpan: 4, rowStart: 0, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  // Row 1
  {
    id: 'files',
    label: 'Files',
    description: 'Read, Write, Edit, Glob — File storage',
    icon: '\u{1F4C1}',
    color: 0x3b82f6,
    colStart: 0, colSpan: 4, rowStart: 1, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  {
    id: 'thinking',
    label: 'Thinking',
    description: 'Planning, Questions — Conference area',
    icon: '\u{1F4AD}',
    color: 0xf97316,
    colStart: 4, colSpan: 5, rowStart: 1, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  {
    id: 'messaging',
    label: 'Messaging',
    description: 'SendMessage, Teams — Chat & relax',
    icon: '\u{1F4AC}',
    color: 0xec4899,
    colStart: 9, colSpan: 3, rowStart: 1, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  // Row 2
  {
    id: 'spawn',
    label: 'Spawn',
    description: 'Agent spawn/despawn — Entry portal',
    icon: '\u{1F300}',
    color: 0xa855f7,
    colStart: 0, colSpan: 3, rowStart: 2, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  {
    id: 'idle',
    label: 'Idle',
    description: 'Idle agents rest here — Kitchen & lounge',
    icon: '\u{2615}',
    color: 0x6b7280,
    colStart: 3, colSpan: 5, rowStart: 2, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'TaskCreate, TaskUpdate — Kanban & planning',
    icon: '\u{1F4CB}',
    color: 0x14b8a6,
    colStart: 8, colSpan: 4, rowStart: 2, rowSpan: 1,
    x: 0, y: 0, width: 0, height: 0,
  },
];

export const ZONE_MAP = new Map(ZONES.map((z) => [z.id, z]));

/** Dynamic world dimensions — updated by LayoutEngine */
let _worldWidth = 1100;
let _worldHeight = 980;

export function setWorldSize(w: number, h: number): void {
  _worldWidth = w;
  _worldHeight = h;
}

export const WORLD_WIDTH_GETTER = { get value() { return _worldWidth; } };
export const WORLD_HEIGHT_GETTER = { get value() { return _worldHeight; } };

/** Legacy static exports — for backward compat in files that import them */
export let WORLD_WIDTH = 1100;
export let WORLD_HEIGHT = 980;

export function updateWorldExports(w: number, h: number): void {
  WORLD_WIDTH = w;
  WORLD_HEIGHT = h;
  _worldWidth = w;
  _worldHeight = h;
}
