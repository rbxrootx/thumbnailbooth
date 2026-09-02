import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { estimateCost, getModel } from "../../shared/models.js";
import type { GenerateRequest, HistoryEntry, ResultImage } from "../../shared/types.js";
import { adapterFor } from "../providers/index.js";
import * as store from "../store.js";

export const generateRoutes = new Hono();

generateRoutes.post("/generate", async (c) => {
  const req = normalize(await c.req.json<GenerateRequest>());

  const spec = getModel(req.model);
  if (!spec) return c.json({ message: `Unknown model "${req.model}".` }, 400);
  if (!req.concept.trim() && !req.refs?.length) {
    return c.json({ message: "Describe the thumbnail, or attach a reference image." }, 400);
  }

  const adapter = adapterFor(spec.provider);
  const key = await store.getKey(spec.provider);
  if (!adapter || !key) {
    return c.json(
      { message: `No ${spec.provider === "gemini" ? "Gemini" : "OpenAI"} API key saved. Add one in Settings.` },
      401,
    );
  }

  if (req.refs && req.refs.length > spec.maxRefs) {
    return c.json({ message: `${spec.label} accepts at most ${spec.maxRefs} reference images.` }, 400);
  }

  const jobId = store.newJobId();
  const controller = new AbortController();

  return streamSSE(c, async (stream) => {
    // Client navigated away or hit Stop — cancel the upstream calls too,
    // otherwise we keep paying for images nobody will see.
    stream.onAbort(() => controller.abort());

    const images: ResultImage[] = [];
    const errors: string[] = [];

    const send = (event: unknown) => stream.writeSSE({ data: JSON.stringify(event) });

    await send({ type: "start", jobId, variants: req.variants });

    try {
      for await (const event of adapter.generate(req, key, controller.signal)) {
        if (controller.signal.aborted) break;

        if (event.type === "image") {
          const file = await store.saveImage(jobId, event.index, event.data, event.mimeType);
          const result: ResultImage = {
            id: `${jobId}-${event.index}`,
            index: event.index,
            mimeType: event.mimeType,
            file,
          };
          images.push(result);
          // Hand the UI a URL rather than re-sending the bytes it already streamed.
          await send({ type: "image", index: event.index, mimeType: event.mimeType,
                       url: `/api/image/${jobId}/${file}`, id: result.id });
          continue;
        }

        if (event.type === "error") errors.push(event.message);
        await send(event);
      }
    } catch (err) {
      await send({
        type: "error",
        message: `Generation failed: ${(err as Error).message}`,
        retryable: true,
      });
      errors.push((err as Error).message);
    }

    const usage = {
      imageCount: images.length,
      estimatedCost: estimateCost(req.model, req.size, images.length),
    };

    // Only record a job that produced something, or failed outright. An
    // aborted run leaves no half-written row in history.
    if (images.length || (errors.length && !controller.signal.aborted)) {
      const entry: HistoryEntry = {
        id: jobId,
        createdAt: new Date().toISOString(),
        request: stripRefData(req),
        modelLabel: spec.label,
        provider: spec.provider,
        images,
        usage,
        error: images.length ? undefined : errors[0],
      };
      await store.appendHistory(entry).catch(() => {});
    }

    await send({ type: "done", jobId, usage });
  });
});

/** Cost preview for the button, before anything is spent. */
generateRoutes.post("/estimate", async (c) => {
  const { model, size, variants } = await c.req.json<{
    model: string; size: GenerateRequest["size"]; variants: number;
  }>();
  return c.json({ cost: estimateCost(model, size, variants ?? 1) });
});

function normalize(raw: GenerateRequest): GenerateRequest {
  return {
    ...raw,
    concept: (raw.concept ?? "").toString(),
    variants: Math.max(1, Math.min(Number(raw.variants) || 1, 8)),
    refs: (raw.refs ?? []).map((ref) => ({
      ...ref,
      // Accept both `data:image/png;base64,AAAA` and bare base64.
      data: ref.data.includes(",") ? ref.data.slice(ref.data.indexOf(",") + 1) : ref.data,
      mimeType: ref.mimeType || sniffMime(ref.data),
    })),
  };
}

function sniffMime(data: string): string {
  const match = /^data:([^;,]+)/.exec(data);
  return match?.[1] ?? "image/png";
}

/** Reference bytes would bloat the index; history keeps only the metadata. */
function stripRefData(req: GenerateRequest): GenerateRequest {
  return {
    ...req,
    refs: req.refs?.map((r) => ({ ...r, data: "" })),
  };
}
