import path from "node:path";
import { estimateCost, getModel } from "../shared/models.js";
import type {
  GenerateEvent, GenerateRequest, HistoryEntry, ResultImage,
} from "../shared/types.js";
import { adapterFor } from "./providers/index.js";
import * as store from "./store.js";

/**
 * One generation, independent of how it was asked for.
 *
 * The HTTP route, the CLI and the MCP server all run jobs through here, so a
 * fix to cost accounting or history never has to be made three times.
 */

/** What a caller can observe. `saved` carries where the image landed. */
export type JobEvent =
  | GenerateEvent
  | { type: "saved"; index: number; id: string; file: string; path: string; mimeType: string };

export interface JobResult {
  jobId: string;
  dir: string;
  images: Array<ResultImage & { path: string }>;
  errors: string[];
  estimatedCost: number;
  model: string;
  modelLabel: string;
}

export class JobError extends Error {
  constructor(message: string, readonly code: "no_model" | "no_key" | "bad_request") {
    super(message);
    this.name = "JobError";
  }
}

/** Validates the request and resolves the provider key, or explains why not. */
export async function prepare(req: GenerateRequest) {
  const spec = getModel(req.model);
  if (!spec) {
    throw new JobError(
      `Unknown model "${req.model}". Run "thumbnailbooth models" to see the available ones.`,
      "no_model",
    );
  }
  if (!req.concept?.trim() && !req.refs?.length) {
    throw new JobError("Describe the thumbnail, or attach a reference image.", "bad_request");
  }
  if (req.refs && req.refs.length > spec.maxRefs) {
    throw new JobError(`${spec.label} accepts at most ${spec.maxRefs} reference images.`, "bad_request");
  }

  const key = await store.getKey(spec.provider);
  if (!key) {
    const envName = spec.provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    throw new JobError(
      `No ${spec.provider === "gemini" ? "Gemini" : "OpenAI"} API key found. ` +
      `Set ${envName} in the environment, or run "npx thumbnailbooth" and add one in Setup.`,
      "no_key",
    );
  }

  const adapter = adapterFor(spec.provider);
  if (!adapter) throw new JobError(`No adapter for ${spec.provider}.`, "no_model");

  return { spec, key, adapter };
}

/** Normalises a loosely-typed request from a CLI flag or an MCP tool call. */
export function normalizeRequest(raw: Partial<GenerateRequest>): GenerateRequest {
  return {
    model: raw.model ?? "gemini-3-pro-image",
    concept: (raw.concept ?? "").toString(),
    title: raw.title || undefined,
    styleRules: raw.styleRules || undefined,
    aspect: raw.aspect ?? "16:9",
    size: raw.size ?? "2K",
    variants: Math.max(1, Math.min(Number(raw.variants) || 1, 8)),
    refs: (raw.refs ?? []).map((ref) => ({
      ...ref,
      data: ref.data.includes(",") ? ref.data.slice(ref.data.indexOf(",") + 1) : ref.data,
      mimeType: ref.mimeType || "image/png",
    })),
    seed: raw.seed,
  };
}

/**
 * Runs a job to completion and records it. `onEvent` receives the same stream
 * the browser sees, so a caller can report progress; it is optional because
 * the CLI and MCP mostly just want the finished paths.
 */
export async function runJob(
  request: GenerateRequest,
  onEvent?: (event: JobEvent) => void,
  signal: AbortSignal = new AbortController().signal,
): Promise<JobResult> {
  const { spec, key, adapter } = await prepare(request);

  const jobId = store.newJobId();
  const images: Array<ResultImage & { path: string }> = [];
  const errors: string[] = [];

  // Announce the job first: callers key their per-image paths off this id.
  onEvent?.({ type: "start", jobId, variants: request.variants });

  for await (const event of adapter.generate(request, key, signal)) {
    if (signal.aborted) break;

    if (event.type === "image") {
      const file = await store.saveImage(jobId, event.index, event.data, event.mimeType);
      const saved = {
        id: `${jobId}-${event.index}`,
        index: event.index,
        mimeType: event.mimeType,
        file,
        path: path.join(store.jobDir(jobId), file),
      };
      images.push(saved);
      // The bytes are already on disk; hand on a reference, not another copy.
      onEvent?.({ type: "saved", ...saved });
      continue;
    }

    if (event.type === "error") errors.push(event.message);
    onEvent?.(event);
  }

  const estimatedCost = estimateCost(request.model, request.size, images.length);

  if (images.length || (errors.length && !signal.aborted)) {
    const entry: HistoryEntry = {
      id: jobId,
      createdAt: new Date().toISOString(),
      request: { ...request, refs: request.refs?.map((r) => ({ ...r, data: "" })) },
      modelLabel: spec.label,
      provider: spec.provider,
      images: images.map(({ path: _p, ...rest }) => rest),
      usage: { imageCount: images.length, estimatedCost },
      error: images.length ? undefined : errors[0],
    };
    await store.appendHistory(entry).catch(() => {});
  }

  return {
    jobId,
    dir: store.jobDir(jobId),
    images,
    errors,
    estimatedCost,
    model: request.model,
    modelLabel: spec.label,
  };
}
