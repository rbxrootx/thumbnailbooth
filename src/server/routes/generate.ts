import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { estimateCost } from "../../shared/models.js";
import type { GenerateRequest } from "../../shared/types.js";
import { JobError, normalizeRequest, prepare, runJob } from "../job.js";

export const generateRoutes = new Hono();

generateRoutes.post("/generate", async (c) => {
  const req = normalizeRequest(await c.req.json<GenerateRequest>());

  // Fail before opening a stream, so the browser gets a real status code.
  try {
    await prepare(req);
  } catch (err) {
    if (err instanceof JobError) {
      return c.json({ message: err.message }, err.code === "no_key" ? 401 : 400);
    }
    throw err;
  }

  const controller = new AbortController();

  return streamSSE(c, async (stream) => {
    // The client navigated away or hit Stop; cancel upstream too, otherwise
    // we keep paying for images nobody will see.
    stream.onAbort(() => controller.abort());

    const send = (event: unknown) => stream.writeSSE({ data: JSON.stringify(event) });
    let jobId = "";

    try {
      const result = await runJob(req, (event) => {
        if (event.type === "saved") {
          void send({
            type: "image", index: event.index, id: event.id,
            mimeType: event.mimeType,
            url: `/api/image/${jobId}/${event.file}`,
          });
          return;
        }
        if (event.type === "start") jobId = event.jobId;
        void send(event);
      }, controller.signal);

      jobId = result.jobId;
      await send({
        type: "done",
        jobId: result.jobId,
        usage: { imageCount: result.images.length, estimatedCost: result.estimatedCost },
      });
    } catch (err) {
      await send({
        type: "error",
        message: err instanceof JobError ? err.message : `Generation failed: ${(err as Error).message}`,
        retryable: !(err instanceof JobError),
      });
    }
  });
});

/** Cost preview for the button, before anything is spent. */
generateRoutes.post("/estimate", async (c) => {
  const { model, size, variants } = await c.req.json<{
    model: string; size: GenerateRequest["size"]; variants: number;
  }>();
  return c.json({ cost: estimateCost(model, size, variants ?? 1) });
});
