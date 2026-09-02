/**
 * The contract shared by the server and the UI.
 * Provider-specific shapes never cross this boundary — adapters translate.
 */

export type ProviderId = "gemini" | "openai";

export type AspectRatio =
  | "16:9" | "1:1" | "9:16" | "4:3" | "3:4"
  | "3:2" | "2:3" | "4:5" | "5:4" | "21:9";

export type SizeTier = "512px" | "1K" | "2K" | "4K";

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  /** Marketing name, e.g. "Nano Banana Pro" */
  label: string;
  /** API id shown as a subtitle, e.g. "gemini-3-pro-image" */
  sublabel: string;
  aspects: AspectRatio[];
  sizes: SizeTier[];
  maxRefs: number;
  /** Variants we can ask for in one call; we fan out beyond this. */
  maxPerCall: number;
  /** Whether the adapter emits `partial` frames. */
  streams: boolean;
  blurb: string;
}

export interface GenerateRequest {
  model: string;
  /** The scene description. */
  concept: string;
  /** Optional bold title text to render into the image. */
  title?: string;
  /** Style rules — becomes the system instruction. */
  styleRules?: string;
  aspect: AspectRatio;
  size: SizeTier;
  variants: number;
  /** Reference images as data URLs or bare base64. */
  refs?: RefImage[];
  seed?: number;
}

export interface RefImage {
  /** Bare base64, no data: prefix. */
  data: string;
  mimeType: string;
  name?: string;
  /** How the model should treat it, folded into the prompt. */
  role?: "subject" | "style" | "composition" | "avatar";
}

/** One image produced by a generation. */
export interface ResultImage {
  id: string;
  /** Index within the batch of variants. */
  index: number;
  mimeType: string;
  width?: number;
  height?: number;
  /** Path relative to the history dir, once persisted. */
  file?: string;
}

export type GenerateEvent =
  | { type: "start"; jobId: string; variants: number }
  | { type: "status"; index: number; message: string }
  /** A progressive preview frame. `data` is bare base64. */
  | { type: "partial"; index: number; data: string; mimeType: string }
  /** A finished image. `data` is bare base64. */
  | { type: "image"; index: number; data: string; mimeType: string }
  | { type: "done"; jobId: string; usage?: UsageReport }
  | { type: "error"; index?: number; message: string; retryable: boolean };

export interface UsageReport {
  inputTokens?: number;
  outputTokens?: number;
  imageCount: number;
  /** Our own estimate, in USD. */
  estimatedCost: number;
}

/** A persisted generation, one line in history/index.ndjson. */
export interface HistoryEntry {
  id: string;
  createdAt: string;
  request: GenerateRequest;
  modelLabel: string;
  provider: ProviderId;
  images: ResultImage[];
  usage?: UsageReport;
  favorite?: boolean;
  error?: string;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Composer field state. */
  form: Partial<GenerateRequest>;
  /** Canvas state, when the workflow was authored as a graph. */
  graph?: { nodes: unknown[]; edges: unknown[] };
}

export interface ConfigStatus {
  gemini: { configured: boolean; hint?: string };
  openai: { configured: boolean; hint?: string };
}

/** A delivery target. Generation happens at an exact aspect, then downscales. */
export interface ExportPreset {
  id: string;
  label: string;
  aspect: AspectRatio;
  width: number;
  height: number;
  /** Inner region that survives corner rounding, if any. */
  safeZone?: { width: number; height: number };
  note: string;
}
