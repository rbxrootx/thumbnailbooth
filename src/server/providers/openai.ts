import type { GenerateEvent, GenerateRequest } from "../../shared/types.js";
import { openaiSize } from "../../shared/models.js";
import { buildPrompt } from "../prompt.js";
import {
  describeHttpError, extractImages, merge, readSSE,
  type KeyCheck, type ProviderAdapter,
} from "./types.js";

/**
 * OpenAI GPT Image.
 *
 * Two endpoints: /images/generations for text-only, /images/edits whenever
 * reference images are attached (edits accepts up to 16 and is the only way
 * to pass references). Sizes are explicit WxH — see openaiSize(), which only
 * ever returns dimensions satisfying OpenAI's divisible-by-16 rule.
 */

const BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export const openaiAdapter: ProviderAdapter = {
  id: "openai",

  async validateKey(key, signal): Promise<KeyCheck> {
    try {
      const res = await fetch(`${BASE}/models`, {
        headers: { authorization: `Bearer ${key}` },
        signal,
      });
      if (res.ok) return { ok: true };
      const body = await res.text();
      return { ok: false, message: describeHttpError(res.status, body, "OpenAI").message };
    } catch (err) {
      return { ok: false, message: `Couldn't reach OpenAI: ${(err as Error).message}` };
    }
  },

  async *generate(req, key, signal) {
    const variants = Math.max(1, Math.min(req.variants || 1, 8));
    const sources = Array.from({ length: variants }, (_, index) =>
      () => generateOne(req, key, index, signal));
    yield* merge(sources, Math.min(3, variants));
  },
};

async function* generateOne(
  req: GenerateRequest,
  key: string,
  index: number,
  signal: AbortSignal,
): AsyncGenerator<GenerateEvent> {
  const { prompt, system } = buildPrompt(req);
  const size = openaiSize(req.aspect, req.size);
  const hasRefs = Boolean(req.refs?.length);

  // The Images API has no system role, so style rules ride along with the prompt.
  const fullPrompt = `${system}\n\n---\n\n${prompt}`;

  yield { type: "status", index, message: hasRefs ? "Sending references to OpenAI…" : "Sending to OpenAI…" };

  let res: Response;
  try {
    res = hasRefs
      ? await postEdits(req, fullPrompt, size, key, signal)
      : await postGenerations(req, fullPrompt, size, key, signal);
  } catch (err) {
    if (signal.aborted) return;
    yield { type: "error", index, message: `Couldn't reach OpenAI: ${(err as Error).message}`, retryable: true };
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    const e = describeHttpError(res.status, text, "OpenAI");
    yield { type: "error", index, message: e.message, retryable: e.retryable };
    return;
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (!contentType.includes("event-stream") || !res.body) {
    try {
      const json = await res.json();
      const images = extractImages(json);
      if (!images.length) {
        yield { type: "error", index, message: "OpenAI returned no image data.", retryable: false };
        return;
      }
      yield { type: "image", index, data: images[0].data, mimeType: images[0].mimeType };
    } catch (err) {
      yield { type: "error", index, message: `Unreadable response from OpenAI: ${(err as Error).message}`, retryable: true };
    }
    return;
  }

  let emitted = false;
  let last: unknown = null;
  try {
    for await (const event of readSSE(res.body, signal)) {
      last = event;
      const rec = event as Record<string, unknown>;
      const type = typeof rec?.type === "string" ? rec.type : "";

      if (type.includes("error")) {
        const msg = (rec.error as Record<string, unknown> | undefined)?.message;
        yield {
          type: "error", index,
          message: typeof msg === "string" ? msg : "OpenAI reported an error mid-render.",
          retryable: false,
        };
        return;
      }

      const images = extractImages(event);
      if (!images.length) continue;

      if (type.includes("completed") || type.endsWith(".done")) {
        emitted = true;
        yield { type: "image", index, data: images[0].data, mimeType: images[0].mimeType };
      } else {
        yield { type: "partial", index, data: images[0].data, mimeType: images[0].mimeType };
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    yield { type: "error", index, message: `Stream from OpenAI broke: ${(err as Error).message}`, retryable: true };
    return;
  }

  if (!emitted) {
    const images = extractImages(last);
    if (images.length) {
      yield { type: "image", index, data: images[0].data, mimeType: images[0].mimeType };
    } else {
      yield { type: "error", index, message: "OpenAI finished without returning an image.", retryable: true };
    }
  }
}

function postGenerations(
  req: GenerateRequest, prompt: string, size: string, key: string, signal: AbortSignal,
): Promise<Response> {
  return fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: req.model,
      prompt,
      n: 1,
      size,
      output_format: "png",
      stream: true,
      partial_images: 2,
    }),
    signal,
  });
}

function postEdits(
  req: GenerateRequest, prompt: string, size: string, key: string, signal: AbortSignal,
): Promise<Response> {
  const form = new FormData();
  form.append("model", req.model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size);
  form.append("output_format", "png");
  form.append("stream", "true");
  form.append("partial_images", "2");

  // Repeated `image[]` fields — the documented way to pass multiple references.
  for (const [i, ref] of (req.refs ?? []).slice(0, 16).entries()) {
    const bytes = Buffer.from(ref.data, "base64");
    const blob = new Blob([new Uint8Array(bytes)], { type: ref.mimeType });
    const ext = ref.mimeType.includes("jpeg") ? "jpg" : ref.mimeType.includes("webp") ? "webp" : "png";
    form.append("image[]", blob, ref.name || `reference-${i + 1}.${ext}`);
  }

  return fetch(`${BASE}/images/edits`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal,
  });
}
