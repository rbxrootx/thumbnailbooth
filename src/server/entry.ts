import { fileURLToPath } from "node:url";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ROOT } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface StartOptions {
  /** Force a port. Without it we try 4270 upward, then any free port. */
  port?: number;
  host?: string;
  uiDir?: string;
}

export interface RunningServer {
  port: number;
  url: string;
  /** Where config, history and workflows actually live. */
  home: string;
  close: () => Promise<void>;
}

export async function start(opts: StartOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  const app = await createApp({ uiDir: opts.uiDir ?? path.join(here, "..", "ui") });

  const candidates = opts.port ? [opts.port] : [4270, 4271, 4272, 4273, 4274, 0];
  let lastError: unknown;

  for (const port of candidates) {
    try {
      return await bind(app, host, port);
    } catch (err) {
      lastError = err;
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw lastError;
}

function bind(
  app: Awaited<ReturnType<typeof createApp>>,
  hostname: string,
  port: number,
): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      server.off("error", reject);
      resolve({
        port: info.port,
        url: `http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${info.port}`,
        home: ROOT,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
    server.on("error", reject);
  });
}
