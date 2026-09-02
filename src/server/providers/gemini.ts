import type { GenerateEvent, GenerateRequest } from "../../shared/types.js";
import { getModel } from "../../shared/models.js";
import { buildPrompt } from "../prompt.js";
import {
  describeHttpError, extractImages, merge, ProviderError, readSSE,
  type KeyCheck, type ProviderAdapter,
} from "./types.js";

/**
 * Google Gemini via the Interactions API.
 *
 * Note: generateContent became legacy when Interactions hit GA in June 2026.
 * We target POST /v1beta/interactions, which is also what gives us native
 * aspect_ratio + image_size instead of having to coax dimensions out of a prompt.
 */

const BASE = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",

  async validateKey(key, signal): Promise<KeyCheck> {
    try {
      const res = await fetch(`${BASE}/models?pageSize=1`, {
        headers: { "x-goog-api-key": key },
        signal,
      });
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, message: describeHttpError(res.status, body, "Gemini").message };
    } catch (err) {
      return { ok: false, message: `Couldn't reach Google: ${(err as Error).message}` };
    }
  },

  async *generate(req, key, signal) {
    const spec = getModel(req.model);
    const variants = Math.max(1, Math.min(req.variants || 1, 8));

    // Interactions returns one image per call, so variants fan out as
    // independent requests. Independent seeds also give genuinely different
    // compositions rather than near-duplicates.
    const sources = Array.from({ length: variants }, (_, index) =>
      () => generateOne(req, key, index, signal));

    yield* merge(sources, Math.min(3, variants));

    void spec;
  },
};

async function* generateOne(
  req: GenerateRequest,
  key: string,
  index: number,
  signal: AbortSignal,
): AsyncGenerator<GenerateEvent> {
  const { prompt, system } = buildPrompt(req);

  const input: unknown[] = [{ type: "text", text: prompt }];
  for (const ref of req.refs ?? []) {
    input.push({ type: "image", mime_type: ref.mimeType, data: ref.data });
  }

  const body: Record<string, unknown> = {
    model: req.model,
    input,
    system_instruction: system,
    response_format: {
      type: "image",
      mime_type: "image/png",
      aspect_ratio: req.aspect,
      image_size: req.size,
    },
    stream: true,
  };
  if (req.model.includes("pro")) {
    body.generation_config = { thinking_level: "high" };
  }

  yield { type: "status", index, message: "Sending to Gemini…" };

  let res: Response;
  try {
    res = await fetch(`${BASE}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    yield { type: "error", index, message: `Couldn't reach Google: ${(err as Error).message}`, retryable: true };
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    const e = describeHttpError(res.status, text, "Gemini");
    yield { type: "error", index, message: e.message, retryable: e.retryable };
    return;
  }

  const contentType = res.headers.get("content-type") ?? "";

  // The API may answer a streamed request with a plain JSON body. Handle both
  // rather than assuming, so a server-side change can't break generation.
  if (!contentType.includes("event-stream") || !res.body) {
    try {
      const json = await res.json();
      const images = extractImages(json);
      if (!images.length) {
        yield { type: "error", index, message: refusalMessage(json), retryable: false };
        return;
      }
      yield { type: "image", index, data: images[0].data, mimeType: images[0].mimeType };
    } catch (err) {
      yield { type: "error", index, message: `Unreadable response from Gemini: ${(err as Error).message}`, retryable: true };
    }
    return;
  }

  let emitted = false;
  let lastPayload: unknown = null;
  let lastImage: { data: string; mimeType: string } | undefined;
  try {
    for await (const event of readSSE(res.body, signal)) {
      lastPayload = event;
      const images = extractImages(event);
      if (!images.length) {
        const note = thoughtOf(event);
        if (note) yield { type: "status", index, message: note };
        continue;
      }
      const final = isFinal(event);
      lastImage = images[0];
      for (const img of images) {
        if (final) {
          emitted = true;
          yield { type: "image", index, data: img.data, mimeType: img.mimeType };
        } else {
          yield { type: "partial", index, data: img.data, mimeType: img.mimeType };
        }
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    yield { type: "error", index, message: `Stream from Gemini broke: ${(err as Error).message}`, retryable: true };
    return;
  }

  if (!emitted) {
    // The stream ended without saying so; the newest frame is the render.
    const fallback = lastImage ?? extractImages(lastPayload)[0];
    if (fallback) {
      yield { type: "image", index, data: fallback.data, mimeType: fallback.mimeType };
    } else {
      yield { type: "error", index, message: refusalMessage(lastPayload), retryable: false };
    }
  }
}

/**
 * Only an explicit completion counts as the finished render. Anything else
 * carrying an image is a progressive frame — a payload that merely contains
 * `output_image` is not enough, because progressive frames carry it too, and
 * treating one as final makes every variant emit twice. Whatever arrives last
 * is promoted at end of stream, so nothing is lost if the API never says so.
 */
function isFinal(event: unknown): boolean {
  const rec = event as Record<string, unknown> | null;
  const status = rec?.status;
  const type = rec?.type;
  if (typeof status === "string" && ["completed", "succeeded"].includes(status)) return true;
  if (typeof type === "string" && /partial|progress|delta|thought/.test(type)) return false;
  return typeof type === "string" && /completed|succeeded|\.done$/.test(type);
}

function thoughtOf(event: unknown): string | undefined {
  const rec = event as Record<string, unknown> | null;
  const type = rec?.type;
  if (typeof type === "string" && type.includes("thought")) return "Thinking through the composition…";
  if (typeof type === "string" && type.includes("progress")) return "Rendering…";
  return undefined;
}

/** Gemini answers a blocked prompt with text instead of an image. */
function refusalMessage(payload: unknown): string {
  const rec = payload as Record<string, unknown> | null;
  const text = rec?.output_text;
  if (typeof text === "string" && text.trim()) {
    return `Gemini returned text instead of an image: "${text.trim().slice(0, 240)}"`;
  }
  return "Gemini returned no image. The prompt may have been blocked by safety filters — try rewording it.";
}

export { ProviderError };
