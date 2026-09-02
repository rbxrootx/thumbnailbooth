#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// Colours first — fail() uses them, and arg parsing can fail.
const c = makeColors();

const argv = process.argv.slice(2);
const COMMANDS = new Set(["generate", "models", "history", "mcp", "serve"]);
const command = COMMANDS.has(argv[0]) ? argv[0] : null;
const rest = command ? argv.slice(1) : argv;
const args = parseArgs(rest);

if (args.help && !command) {
  const { CLI_HELP } = await loadServer();
  process.stdout.write(`\n  thumbnailbooth ${pkg.version}${CLI_HELP}`);
  process.exit(0);
}

if (args.version) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const mod = await loadServer();

// Headless commands. Neither prints a banner, and `mcp` must keep stdout
// clean because that is the protocol channel.
if (command === "mcp") {
  await mod.runMcpStdio(pkg.version);
  // The transport owns the process from here.
} else if (command && command !== "serve") {
  process.exit(await mod.runCli(command, rest));
}

let server;
try {
  server = await mod.start({
    port: args.port,
    host: args.host,
    mcpHttp: args.mcpHttp,
    version: pkg.version,
  });
} catch (err) {
  if (err?.code === "EADDRINUSE") {
    fail(`Port ${args.port} is already in use.`,
         "Pick another with:  npx thumbnailbooth --port 4300");
  }
  fail("Couldn't start the server.", err?.message ?? String(err));
}

process.stdout.write(`
  ${c.bold}${c.cream}✦ ThumbnailBooth${c.reset}  ${c.dim}${pkg.version}${c.reset}

  ${c.dim}→${c.reset} ${c.cream}${server.url}${c.reset}
${args.mcpHttp ? `  ${c.dim}mcp${c.reset} ${c.cream}${server.url}/mcp${c.reset}\n` : ""}`);

if (args.open) {
  const ok = await openBrowser(server.url);
  process.stdout.write(ok
    ? `  ${c.dim}✓ opened in your browser${c.reset}\n`
    : `  ${c.dim}open the link above to get started${c.reset}\n`);
}

process.stdout.write(`  ${c.dim}~ ${server.home}${c.reset}\n\n`);
process.stdout.write(`  ${c.dim}Ctrl+C to stop${c.reset}\n\n`);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (closing) process.exit(0);
    closing = true;
    process.stdout.write(`\n  ${c.dim}stopping…${c.reset}\n`);
    await server.close().catch(() => {});
    process.exit(0);
  });
}

/* ------------------------------------------------------------------ util */

async function loadServer() {
  try {
    // Must be a file:// URL, not a bare path: Windows rejects "C:\\..." as an
    // unknown protocol in the ESM loader. pathToFileURL is correct everywhere.
    const entry = pathToFileURL(path.join(here, "..", "dist", "server", "index.js")).href;
    return await import(entry);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      fail("This copy of ThumbnailBooth isn't built.",
           "If you're working on the source, run:  npm run build");
    }
    fail("Couldn't load ThumbnailBooth.", err?.message ?? String(err));
  }
}

function parseArgs(argv) {
  const out = {
    port: undefined, host: undefined, open: true,
    help: false, version: false, mcpHttp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--version" || arg === "-v") out.version = true;
    else if (arg === "--no-open") out.open = false;
    else if (arg === "--mcp-http") out.mcpHttp = true;
    else if (arg === "--port" || arg === "-p") out.port = Number(argv[++i]);
    else if (arg.startsWith("--port=")) out.port = Number(arg.slice(7));
    else if (arg === "--host") out.host = argv[++i];
    else if (arg.startsWith("--host=")) out.host = arg.slice(7);
  }
  if (out.port !== undefined && !Number.isInteger(out.port)) {
    fail("--port needs a number.", "e.g.  npx thumbnailbooth --port 4300");
  }
  return out;
}

/** No dependency on `open` — three platforms, three commands. */
function openBrowser(url) {
  const windows = process.platform === "win32";
  const [cmd, cmdArgs] =
    process.platform === "darwin" ? ["open", [url]]
    // cmd.exe by name, and the empty argument is `start`'s window title —
    // without it a URL gets swallowed as the title.
    : windows ? [process.env.COMSPEC || "cmd.exe", ["/c", "start", "", url]]
    : ["xdg-open", [url]];

  return new Promise((resolve) => {
    try {
      // `detached` is what makes `start` unreliable on Windows; it exits
      // immediately there anyway.
      const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: !windows });
      child.on("error", () => resolve(false));
      child.on("spawn", () => { if (!windows) child.unref(); resolve(true); });
    } catch {
      resolve(false);
    }
  });
}

function makeColors() {
  const on = process.stdout.isTTY && !process.env.NO_COLOR;
  const esc = String.fromCharCode(27);
  const wrap = (code) => (on ? `${esc}[${code}m` : "");
  return {
    reset: wrap(0), bold: wrap(1), dim: wrap(2),
    cream: wrap("38;5;223"), red: wrap("38;5;210"),
  };
}

function fail(headline, detail) {
  process.stderr.write(`\n  ${c.red}✕ ${headline}${c.reset}\n`);
  if (detail) process.stderr.write(`  ${c.dim}${detail}${c.reset}\n`);
  process.stderr.write("\n");
  process.exit(1);
}
