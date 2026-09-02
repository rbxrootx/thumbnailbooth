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
  /** Serve MCP over Streamable HTTP at /mcp. */
  mcpHttp?: boolean;
  version?: string;
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
  const app = await createApp({
    uiDir: opts.uiDir ?? path.join(here, "..", "ui"),
    mcpHttp: opts.mcpHttp,
    version: opts.version,
  });

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

/**
 * MCP over stdio, for clients that launch the server as a child process
 * (Claude Desktop, Claude Code, Cursor, Codex).
 *
 * stdout is the protocol channel — nothing may be printed to it but JSON-RPC,
 * so diagnostics go to stderr.
 */
export async function runMcpStdio(version: string): Promise<void> {
  const { createMcpServer } = await import("./mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { init } = await import("./store.js");

  await init();
  const server = createMcpServer(version);
  await server.connect(new StdioServerTransport());
  process.stderr.write("thumbnailbooth mcp: ready on stdio\n");
}

export { runCli, CLI_HELP } from "./cli.js";
