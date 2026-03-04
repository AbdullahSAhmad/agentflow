/** Pixel-art character color palettes (12 palettes) */
export interface AgentPalette {
  name: string;
  body: number;     // clothing / shirt
  outline: number;  // outlines, pants, shoes
  highlight: number; // hair
  eye: number;      // eye whites / iris
  skin: number;     // face and hands
}

export const AGENT_PALETTES: AgentPalette[] = [
  { name: 'blue',    body: 0x4a90d9, outline: 0x2c5a8a, highlight: 0x7ab8f5, eye: 0xffffff, skin: 0xffdbac },
  { name: 'green',   body: 0x4caf50, outline: 0x2e7d32, highlight: 0x81c784, eye: 0xffffff, skin: 0xffdbac },
  { name: 'red',     body: 0xe57373, outline: 0xc62828, highlight: 0xffcdd2, eye: 0xffffff, skin: 0xffdbac },
  { name: 'purple',  body: 0xab47bc, outline: 0x6a1b9a, highlight: 0xce93d8, eye: 0xffffff, skin: 0xffdbac },
  { name: 'orange',  body: 0xff9800, outline: 0xe65100, highlight: 0xffcc80, eye: 0xffffff, skin: 0xffdbac },
  { name: 'cyan',    body: 0x26c6da, outline: 0x00838f, highlight: 0x80deea, eye: 0xffffff, skin: 0xffdbac },
  { name: 'pink',    body: 0xf06292, outline: 0xc2185b, highlight: 0xf8bbd0, eye: 0xffffff, skin: 0xffdbac },
  { name: 'teal',    body: 0x26a69a, outline: 0x00695c, highlight: 0x80cbc4, eye: 0xffffff, skin: 0xffdbac },
  { name: 'amber',   body: 0xffc107, outline: 0xff8f00, highlight: 0xffe082, eye: 0x333333, skin: 0xffdbac },
  { name: 'indigo',  body: 0x5c6bc0, outline: 0x283593, highlight: 0x9fa8da, eye: 0xffffff, skin: 0xffdbac },
  { name: 'lime',    body: 0x9ccc65, outline: 0x558b2f, highlight: 0xc5e1a5, eye: 0x333333, skin: 0xffdbac },
  { name: 'brown',   body: 0x8d6e63, outline: 0x4e342e, highlight: 0xbcaaa4, eye: 0xffffff, skin: 0xffdbac },
];

/** Background and UI colors */
export const COLORS = {
  background: 0x1a1e38,
  gridLine: 0x16213e,
  zoneBackground: 0x0f3460,
  zoneBorder: 0xe94560,
  text: 0xffffff,
  textDim: 0x888888,
  speechBubble: 0xffffff,
  speechText: 0x1a1a2e,
  relationshipLine: 0x555555,
  teamLine: 0x44ff44,
} as const;

/** Model pricing per million tokens (USD) */
export interface ModelPricing {
  input: number;
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4-5-20250620': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250514': { input: 3, output: 15 },
  'claude-sonnet-4-0-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 1, output: 5 },
};

/** Default pricing when model is unknown */
export const DEFAULT_PRICING: ModelPricing = { input: 3, output: 15 };

/** Get pricing for a model string (fuzzy match) */
export function getModelPricing(model: string | null): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  // Exact match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Fuzzy: check if model contains a known key
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key) || key.includes(model)) return pricing;
  }
  // Fuzzy by family name
  if (model.includes('opus')) return MODEL_PRICING['claude-opus-4-6'];
  if (model.includes('haiku')) return MODEL_PRICING['claude-haiku-4-5-20251001'];
  if (model.includes('sonnet')) return MODEL_PRICING['claude-sonnet-4-6'];
  return DEFAULT_PRICING;
}

/** Compute cost for an agent's token usage (in dollars) */
export function computeAgentCost(tokens: {
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  model: string | null;
}): number {
  const pricing = getModelPricing(tokens.model);
  return (tokens.totalInputTokens / 1_000_000) * pricing.input +
         (tokens.totalOutputTokens / 1_000_000) * pricing.output +
         (tokens.cacheReadTokens / 1_000_000) * pricing.input * 0.1 +
         (tokens.cacheCreationTokens / 1_000_000) * pricing.input * 1.25;
}
