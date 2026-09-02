import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

/** Dev API server. Vite proxies /api here and serves the UI itself. */
const port = Number(process.env.PORT ?? 4271);
const app = await createApp();

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`  api  http://127.0.0.1:${info.port}`);
});
