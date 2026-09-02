import { Hono } from "hono";
import { MODELS, ROBLOX_PRESETS } from "../../shared/models.js";
import { DEFAULT_STYLE_RULES } from "../prompt.js";
import * as store from "../store.js";
import { adapterFor } from "../providers/index.js";
import type { ProviderId } from "../../shared/types.js";

export const configRoutes = new Hono();

/** Everything the UI needs to render itself on boot, in one round trip. */
configRoutes.get("/status", async (c) => {
  const [config, prefs] = await Promise.all([store.configStatus(), store.getPrefs()]);
  return c.json({
    config,
    prefs,
    models: MODELS,
    presets: ROBLOX_PRESETS,
    defaultStyleRules: DEFAULT_STYLE_RULES,
    home: store.ROOT,
  });
});

/** Validates against the provider before saving — no silently bad keys. */
configRoutes.post("/keys", async (c) => {
  const { provider, key } = await c.req.json<{ provider: ProviderId; key: string }>();
  const adapter = adapterFor(provider);
  if (!adapter) return c.json({ ok: false, message: "Unknown provider." }, 400);

  if (!key || !key.trim()) {
    await store.setKey(provider, null);
    return c.json({ ok: true, cleared: true, config: await store.configStatus() });
  }

  const check = await adapter.validateKey(key.trim());
  if (!check.ok) return c.json({ ok: false, message: check.message }, 400);

  await store.setKey(provider, key.trim());
  return c.json({ ok: true, config: await store.configStatus() });
});

configRoutes.delete("/keys/:provider", async (c) => {
  await store.setKey(c.req.param("provider") as ProviderId, null);
  return c.json({ ok: true, config: await store.configStatus() });
});

configRoutes.post("/prefs", async (c) => {
  await store.setPrefs(await c.req.json());
  return c.json({ ok: true, prefs: await store.getPrefs() });
});
