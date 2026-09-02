import type { AspectRatio, ExportPreset, ModelSpec, SizeTier } from "./types.js";

/**
 * Model catalogue. Only models with pricing we could verify are listed —
 * an unpriced model would silently break the cost estimator.
 *
 * Sources checked 2026-08-30: ai.google.dev/gemini-api/docs/pricing,
 * developers.openai.com/api/docs/models/gpt-image-2
 */

const GEMINI_ASPECTS: AspectRatio[] = [
  "16:9", "1:1", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9",
];

/** OpenAI takes explicit WxH, so we only offer aspects with clean exact sizes. */
const OPENAI_ASPECTS: AspectRatio[] = [
  "16:9", "1:1", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9",
];

export const MODELS: ModelSpec[] = [
  {
    id: "gemini-3-pro-image",
    provider: "gemini",
    label: "Nano Banana Pro",
    sublabel: "gemini-3-pro-image",
    aspects: GEMINI_ASPECTS,
    sizes: ["1K", "2K", "4K"],
    maxRefs: 14,
    maxPerCall: 1,
    streams: true,
    blurb: "Best text rendering and instruction following. The default for thumbnails.",
  },
  {
    id: "gemini-3.1-flash-image",
    provider: "gemini",
    label: "Nano Banana 2",
    sublabel: "gemini-3.1-flash-image",
    aspects: GEMINI_ASPECTS,
    sizes: ["512px", "1K", "2K", "4K"],
    maxRefs: 14,
    maxPerCall: 1,
    streams: true,
    blurb: "Fast and much cheaper. Great for exploring concepts before a Pro render.",
  },
  {
    id: "gemini-3.1-flash-lite-image",
    provider: "gemini",
    label: "Flash Lite",
    sublabel: "gemini-3.1-flash-lite-image",
    aspects: GEMINI_ASPECTS,
    sizes: ["1K"],
    maxRefs: 14,
    maxPerCall: 1,
    streams: true,
    blurb: "Cheapest option. Good for bulk idea generation at 1K only.",
  },
  {
    id: "gemini-2.5-flash-image",
    provider: "gemini",
    label: "Nano Banana (2.5)",
    sublabel: "gemini-2.5-flash-image",
    aspects: ["16:9", "1:1", "9:16", "4:3", "3:4"],
    sizes: ["1K"],
    maxRefs: 14,
    maxPerCall: 1,
    streams: true,
    blurb: "Previous generation. Kept for consistency with older workflows.",
  },
  {
    id: "gpt-image-2",
    provider: "openai",
    label: "GPT Image 2",
    sublabel: "gpt-image-2",
    aspects: OPENAI_ASPECTS,
    sizes: ["1K", "2K", "4K"],
    maxRefs: 16,
    maxPerCall: 4,
    streams: true,
    blurb: "Reasons before drawing. Very strong at legible text and photoreal comps.",
  },
];

export function getModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}

export const DEFAULT_MODEL = "gemini-3-pro-image";

/** USD per output image. Estimates — providers bill by token. */
const PRICE_PER_IMAGE: Record<string, Partial<Record<SizeTier, number>>> = {
  "gemini-3-pro-image": { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
  "gemini-3.1-flash-image": { "512px": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 },
  "gemini-3.1-flash-lite-image": { "1K": 0.0336 },
  "gemini-2.5-flash-image": { "1K": 0.039 },
  "gpt-image-2": { "1K": 0.03, "2K": 0.05, "4K": 0.08 },
};

export function pricePerImage(modelId: string, size: SizeTier): number {
  const row = PRICE_PER_IMAGE[modelId];
  if (!row) return 0;
  return row[size] ?? Object.values(row)[0] ?? 0;
}

export function estimateCost(modelId: string, size: SizeTier, variants: number): number {
  return pricePerImage(modelId, size) * Math.max(1, variants);
}

/**
 * Exact-aspect pixel sizes for OpenAI. Every entry satisfies its constraints:
 * both edges divisible by 16, max edge 3840, ratio <= 3:1, 655,360-8,294,400 px.
 * Notably 1920x1080 is NOT valid (1080/16 = 67.5) — we render 16:9 at
 * 2048x1152 or 3840x2160 and downscale on export.
 */
const OPENAI_SIZES: Record<AspectRatio, Partial<Record<SizeTier, string>>> = {
  "16:9": { "1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160" },
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
  "9:16": { "1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840" },
  "4:3": { "1K": "1152x864", "2K": "1920x1440", "4K": "3200x2400" },
  "3:4": { "1K": "864x1152", "2K": "1440x1920", "4K": "2400x3200" },
  "3:2": { "1K": "1200x800", "2K": "1920x1280", "4K": "3456x2304" },
  "2:3": { "1K": "800x1200", "2K": "1280x1920", "4K": "2304x3456" },
  "4:5": { "1K": "896x1120", "2K": "1536x1920", "4K": "2560x3200" },
  "5:4": { "1K": "1120x896", "2K": "1920x1536", "4K": "3200x2560" },
  "21:9": { "1K": "1680x720", "2K": "2688x1152", "4K": "3808x1632" },
};

export function openaiSize(aspect: AspectRatio, size: SizeTier): string {
  const row = OPENAI_SIZES[aspect];
  return row?.[size] ?? row?.["2K"] ?? "2048x1152";
}

/** Roblox delivery targets. Generation happens at exact aspect, then downscales. */
export const ROBLOX_PRESETS: ExportPreset[] = [
  {
    id: "thumbnail",
    label: "Game thumbnail",
    aspect: "16:9",
    width: 1920,
    height: 1080,
    note: "16:9 gallery image. Up to 10 per experience.",
  },
  {
    id: "icon",
    label: "Game icon",
    aspect: "1:1",
    width: 512,
    height: 512,
    safeZone: { width: 420, height: 420 },
    note: "Corners get rounded — keep key art inside the 420x420 safe zone.",
  },
];
