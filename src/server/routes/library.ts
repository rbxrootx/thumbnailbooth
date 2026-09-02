import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { SavedWorkflow } from "../../shared/types.js";
import * as store from "../store.js";

export const libraryRoutes = new Hono();

/* ---------------------------------------------------------------- history */

libraryRoutes.get("/history", async (c) => {
  const limit = Number(c.req.query("limit") ?? 200);
  const offset = Number(c.req.query("offset") ?? 0);
  return c.json({ entries: await store.readHistory(limit, offset) });
});

libraryRoutes.post("/history/:id/favorite", async (c) => {
  const { favorite } = await c.req.json<{ favorite: boolean }>();
  await store.setFavorite(c.req.param("id"), favorite);
  return c.json({ ok: true });
});

libraryRoutes.delete("/history/:id", async (c) => {
  await store.deleteHistoryEntry(c.req.param("id"));
  return c.json({ ok: true });
});

/** Serves generated images off disk. Paths are basename-guarded in the store. */
libraryRoutes.get("/image/:jobId/:file", async (c) => {
  try {
    const buf = await store.readImageFile(c.req.param("jobId"), c.req.param("file"));
    const file = c.req.param("file");
    const type = file.endsWith(".jpg") ? "image/jpeg"
      : file.endsWith(".webp") ? "image/webp" : "image/png";
    return c.body(new Uint8Array(buf), 200, {
      "content-type": type,
      "cache-control": "private, max-age=31536000, immutable",
    });
  } catch {
    return c.text("Not found", 404);
  }
});

/* -------------------------------------------------------------- workflows */

libraryRoutes.get("/workflows", async (c) => c.json({ workflows: await store.listWorkflows() }));

libraryRoutes.post("/workflows", async (c) => {
  const body = await c.req.json<Partial<SavedWorkflow>>();
  const now = new Date().toISOString();
  const workflow: SavedWorkflow = {
    id: body.id ?? randomUUID(),
    name: body.name?.trim() || "Untitled workflow",
    createdAt: body.createdAt ?? now,
    updatedAt: now,
    form: body.form ?? {},
    graph: body.graph,
  };
  return c.json({ workflow: await store.saveWorkflow(workflow) });
});

libraryRoutes.delete("/workflows/:id", async (c) => {
  await store.deleteWorkflow(c.req.param("id"));
  return c.json({ ok: true });
});
