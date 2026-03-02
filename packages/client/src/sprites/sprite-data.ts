/**
 * Pixel art arrays for humanoid agent characters.
 * Each pixel is a palette key: 'body', 'outline', 'highlight', 'eye', 'skin', 'transparent'.
 * Main agents are 16x16, subagents are 12x12.
 *
 * Layout guide (main 16x16):
 *   Rows 0-2:  Hair (highlight) with outline border
 *   Row  3:    Hair sides + skin forehead
 *   Row  4:    Eyes (eye color) on skin face
 *   Row  5:    Skin face / mouth area
 *   Row  6:    Chin / jawline
 *   Row  7:    Neck / collar
 *   Rows 8-11: Shirt (body color) with skin-colored hands
 *   Rows 12-15: Pants (outline) and shoes
 */

export type PaletteKey = 'body' | 'outline' | 'highlight' | 'eye' | 'skin' | 'transparent';

export type SpriteFrame = PaletteKey[][];

const _ = 'transparent' as const;
const B = 'body' as const;
const O = 'outline' as const;
const H = 'highlight' as const;
const E = 'eye' as const;
const S = 'skin' as const;

// ── Main agent (16x16) ──────────────────────────────────

export const MAIN_IDLE_1: SpriteFrame = [
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // hair top
  [_, _, _, _, O, H, H, H, H, H, H, O, _, _, _, _],  // hair
  [_, _, _, O, H, H, H, H, H, H, H, H, O, _, _, _],  // hair full
  [_, _, _, O, H, S, S, S, S, S, S, H, O, _, _, _],  // hair sides + forehead
  [_, _, _, O, S, E, E, S, S, E, E, S, O, _, _, _],  // eyes open
  [_, _, _, O, S, S, S, S, S, S, S, S, O, _, _, _],  // face neutral
  [_, _, _, _, O, O, S, S, S, S, O, O, _, _, _, _],  // chin / jaw
  [_, _, _, _, _, O, B, B, B, B, O, _, _, _, _, _],  // collar
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt upper
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt lower
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // belt
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],  // legs
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],  // lower legs
  [_, _, _, _, O, O, O, _, _, O, O, O, _, _, _, _],  // shoes
];

export const MAIN_IDLE_2: SpriteFrame = [
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // hair top
  [_, _, _, _, O, H, H, H, H, H, H, O, _, _, _, _],  // hair
  [_, _, _, O, H, H, H, H, H, H, H, H, O, _, _, _],  // hair full
  [_, _, _, O, H, S, S, S, S, S, S, H, O, _, _, _],  // hair sides + forehead
  [_, _, _, O, S, O, O, S, S, O, O, S, O, _, _, _],  // eyes closed (blink)
  [_, _, _, O, S, S, S, S, S, S, S, S, O, _, _, _],  // face neutral
  [_, _, _, _, O, O, S, S, S, S, O, O, _, _, _, _],  // chin / jaw
  [_, _, _, _, _, O, B, B, B, B, O, _, _, _, _, _],  // collar
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt upper
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt lower
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // belt
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],  // legs
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],  // lower legs
  [_, _, _, _, O, O, O, _, _, O, O, O, _, _, _, _],  // shoes
];

export const MAIN_WALK_1: SpriteFrame = [
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // hair top
  [_, _, _, _, O, H, H, H, H, H, H, O, _, _, _, _],  // hair
  [_, _, _, O, H, H, H, H, H, H, H, H, O, _, _, _],  // hair full
  [_, _, _, O, H, S, S, S, S, S, S, H, O, _, _, _],  // hair sides + forehead
  [_, _, _, O, S, E, E, S, S, E, E, S, O, _, _, _],  // eyes open
  [_, _, _, O, S, S, S, S, S, S, S, S, O, _, _, _],  // face neutral
  [_, _, _, _, O, O, S, S, S, S, O, O, _, _, _, _],  // chin / jaw
  [_, _, _, _, _, O, B, B, B, B, O, _, _, _, _, _],  // collar
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt upper
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt lower
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // belt
  [_, _, _, _, O, O, _, _, _, O, O, _, _, _, _, _],  // legs stride
  [_, _, _, _, O, O, _, _, _, _, O, O, _, _, _, _],  // legs apart
  [_, _, _, O, O, O, _, _, _, _, O, O, O, _, _, _],  // shoes spread
];

export const MAIN_WALK_2: SpriteFrame = [
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // hair top
  [_, _, _, _, O, H, H, H, H, H, H, O, _, _, _, _],  // hair
  [_, _, _, O, H, H, H, H, H, H, H, H, O, _, _, _],  // hair full
  [_, _, _, O, H, S, S, S, S, S, S, H, O, _, _, _],  // hair sides + forehead
  [_, _, _, O, S, E, E, S, S, E, E, S, O, _, _, _],  // eyes open
  [_, _, _, O, S, S, S, S, S, S, S, S, O, _, _, _],  // face neutral
  [_, _, _, _, O, O, S, S, S, S, O, O, _, _, _, _],  // chin / jaw
  [_, _, _, _, _, O, B, B, B, B, O, _, _, _, _, _],  // collar
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt upper
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt lower
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // belt
  [_, _, _, _, _, O, O, _, _, _, O, O, _, _, _, _],  // legs stride
  [_, _, _, _, O, O, _, _, _, _, O, O, _, _, _, _],  // legs apart
  [_, _, _, O, O, O, _, _, _, O, O, O, _, _, _, _],  // shoes spread
];

export const MAIN_WORKING: SpriteFrame = [
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // hair top
  [_, _, _, _, O, H, H, H, H, H, H, O, _, _, _, _],  // hair
  [_, _, _, O, H, H, H, H, H, H, H, H, O, _, _, _],  // hair full
  [_, _, _, O, H, S, S, S, S, S, S, H, O, _, _, _],  // hair sides + forehead
  [_, _, _, O, S, E, E, S, S, E, E, S, O, _, _, _],  // eyes focused
  [_, _, _, O, S, S, O, O, O, O, S, S, O, _, _, _],  // mouth open (working)
  [_, _, _, _, O, O, S, S, S, S, O, O, _, _, _, _],  // chin / jaw
  [_, _, _, _, _, O, B, B, B, B, O, _, _, _, _, _],  // collar
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt upper
  [_, _, S, S, O, B, B, B, B, B, B, O, S, S, _, _],  // arms extended + hands
  [_, _, _, S, O, B, B, B, B, B, B, O, S, _, _, _],  // shirt + hands
  [_, _, _, _, O, B, B, B, B, B, B, O, _, _, _, _],  // shirt lower
  [_, _, _, _, _, O, O, O, O, O, O, _, _, _, _, _],  // belt
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],  // legs
  [_, _, _, _, _, O, O, _, _, O, O, _, _, _, _, _],  // lower legs
  [_, _, _, _, O, O, O, _, _, O, O, O, _, _, _, _],  // shoes
];

// ── Subagent (12x12) ────────────────────────────────────

export const SUB_IDLE_1: SpriteFrame = [
  [_, _, _, O, O, O, O, O, O, _, _, _],  // hair top
  [_, _, O, H, H, H, H, H, H, O, _, _],  // hair
  [_, O, H, H, S, S, S, S, H, H, O, _],  // hair sides + forehead
  [_, O, S, E, S, S, S, S, E, S, O, _],  // eyes open
  [_, O, S, S, S, S, S, S, S, S, O, _],  // face
  [_, _, O, O, S, S, S, S, O, O, _, _],  // chin
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt
  [_, S, O, B, B, B, B, B, B, O, S, _],  // shirt + hands
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt lower
  [_, _, _, O, O, _, _, O, O, _, _, _],  // legs
  [_, _, _, O, O, _, _, O, O, _, _, _],  // lower legs
  [_, _, O, O, O, _, _, O, O, O, _, _],  // shoes
];

export const SUB_IDLE_2: SpriteFrame = [
  [_, _, _, O, O, O, O, O, O, _, _, _],  // hair top
  [_, _, O, H, H, H, H, H, H, O, _, _],  // hair
  [_, O, H, H, S, S, S, S, H, H, O, _],  // hair sides + forehead
  [_, O, S, O, S, S, S, S, O, S, O, _],  // eyes closed (blink)
  [_, O, S, S, S, S, S, S, S, S, O, _],  // face
  [_, _, O, O, S, S, S, S, O, O, _, _],  // chin
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt
  [_, S, O, B, B, B, B, B, B, O, S, _],  // shirt + hands
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt lower
  [_, _, _, O, O, _, _, O, O, _, _, _],  // legs
  [_, _, _, O, O, _, _, O, O, _, _, _],  // lower legs
  [_, _, O, O, O, _, _, O, O, O, _, _],  // shoes
];

export const SUB_WALK_1: SpriteFrame = [
  [_, _, _, O, O, O, O, O, O, _, _, _],  // hair top
  [_, _, O, H, H, H, H, H, H, O, _, _],  // hair
  [_, O, H, H, S, S, S, S, H, H, O, _],  // hair sides + forehead
  [_, O, S, E, S, S, S, S, E, S, O, _],  // eyes open
  [_, O, S, S, S, S, S, S, S, S, O, _],  // face
  [_, _, O, O, S, S, S, S, O, O, _, _],  // chin
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt
  [_, S, O, B, B, B, B, B, B, O, S, _],  // shirt + hands
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt lower
  [_, _, O, O, _, _, _, O, O, _, _, _],  // legs stride
  [_, _, O, O, _, _, _, _, O, O, _, _],  // legs apart
  [_, O, O, O, _, _, _, _, O, O, O, _],  // shoes spread
];

export const SUB_WALK_2: SpriteFrame = [
  [_, _, _, O, O, O, O, O, O, _, _, _],  // hair top
  [_, _, O, H, H, H, H, H, H, O, _, _],  // hair
  [_, O, H, H, S, S, S, S, H, H, O, _],  // hair sides + forehead
  [_, O, S, E, S, S, S, S, E, S, O, _],  // eyes open
  [_, O, S, S, S, S, S, S, S, S, O, _],  // face
  [_, _, O, O, S, S, S, S, O, O, _, _],  // chin
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt
  [_, S, O, B, B, B, B, B, B, O, S, _],  // shirt + hands
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt lower
  [_, _, _, O, O, _, _, _, O, O, _, _],  // legs stride
  [_, _, O, O, _, _, _, _, O, O, _, _],  // legs apart
  [_, O, O, O, _, _, _, _, O, O, O, _],  // shoes spread
];

export const SUB_WORKING: SpriteFrame = [
  [_, _, _, O, O, O, O, O, O, _, _, _],  // hair top
  [_, _, O, H, H, H, H, H, H, O, _, _],  // hair
  [_, O, H, H, S, S, S, S, H, H, O, _],  // hair sides + forehead
  [_, O, S, E, S, S, S, S, E, S, O, _],  // eyes open
  [_, O, S, O, O, O, O, O, O, S, O, _],  // mouth open (working)
  [_, _, O, O, S, S, S, S, O, O, _, _],  // chin
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt
  [S, S, O, B, B, B, B, B, B, O, S, S],  // arms extended + hands
  [_, _, O, B, B, B, B, B, B, O, _, _],  // shirt lower
  [_, _, _, O, O, _, _, O, O, _, _, _],  // legs
  [_, _, _, O, O, _, _, O, O, _, _, _],  // lower legs
  [_, _, O, O, O, _, _, O, O, O, _, _],  // shoes
];

// ── Exports grouped by role ─────────────────────────────

export interface SpriteSet {
  idle: [SpriteFrame, SpriteFrame];
  walk: [SpriteFrame, SpriteFrame];
  working: SpriteFrame;
  size: number;
}

export const MAIN_SPRITES: SpriteSet = {
  idle: [MAIN_IDLE_1, MAIN_IDLE_2],
  walk: [MAIN_WALK_1, MAIN_WALK_2],
  working: MAIN_WORKING,
  size: 16,
};

export const SUB_SPRITES: SpriteSet = {
  idle: [SUB_IDLE_1, SUB_IDLE_2],
  walk: [SUB_WALK_1, SUB_WALK_2],
  working: SUB_WORKING,
  size: 12,
};
