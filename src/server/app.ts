import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { configRoutes } from "./routes/config.js";
import { generateRoutes } from "./routes/generate.js";
import { libraryRoutes } from "./routes/library.js";
import * as store from "./store.js";

export interface AppOptions {
  /** Absolute path to the built UI. Omitted in dev, where Vite serves it. */
  uiDir?: string;
  /**
   * Expose MCP over Streamable HTTP at /mcp. Off by default: this endpoint can
   * spend the user's money, and anything able to reach the port could call it.
   */
  mcpHttp?: boolean;
  version?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
};

export async function createApp(opts: AppOptions = {}): Promise<Hono> {
  await store.init();
  const app = new Hono();

  app.route("/api", configRoutes);
  app.route("/api", generateRoutes);
  app.route("/api", libraryRoutes);

  app.get("/api/health", (c) => c.json({ ok: true, version: 1 }));

  if (opts.mcpHttp) {
    const { createMcpServer } = await import("./mcp.js");
    const { WebStandardStreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
    );

    app.all("/mcp", async (c) => {
      // A browser on any site could otherwise POST here via DNS rebinding and
      // spend the user's credit. Local tools and tunnels send no Origin.
      const origin = c.req.header("origin");
      if (origin && !isTrustedOrigin(origin)) {
        return c.json({ error: "Origin not allowed for MCP." }, 403);
      }

      // Stateless: one server and transport per request, so there is no
      // session to leak between callers.
      const server = createMcpServer(opts.version ?? "0.0.0");
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw);
    });
  }

  if (opts.uiDir) {
    const root = path.resolve(opts.uiDir);

    // Resolved from an absolute root rather than cwd, so `npx` works no
    // matter which directory the user happens to be standing in.
    app.get("*", async (c) => {
      const url = new URL(c.req.url);
      const requested = decodeURIComponent(url.pathname);
      const resolved = path.resolve(root, `.${requested}`);

      // Never serve outside the UI directory.
      const inRoot = resolved === root || resolved.startsWith(root + path.sep);
      const target = inRoot ? resolved : root;

      const file = await readFileOrNull(target);
      if (file) {
        return c.body(new Uint8Array(file), 200, {
          "content-type": MIME[path.extname(target)] ?? "application/octet-stream",
          "cache-control": requested.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        });
      }

      // SPA fallback.
      const index = await readFileOrNull(path.join(root, "index.html"));
      if (!index) return c.text("UI not built. Run `npm run build`.", 500);
      return c.body(new Uint8Array(index), 200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      });
    });
  }

  return app;
}

/** Only loopback origins are plausible for a tool bound to 127.0.0.1. */
function isTrustedOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function readFileOrNull(file: string): Promise<Buffer | null> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    return await fs.readFile(file);
  } catch {
    return null;
  }
}
