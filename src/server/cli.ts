import fs from "node:fs/promises";
import path from "node:path";
import { MODELS, ROBLOX_PRESETS, estimateCost, getModel } from "../shared/models.js";
import type { AspectRatio, RefImage, SizeTier } from "../shared/types.js";
import { JobError, normalizeRequest, runJob } from "./job.js";
import * as store from "./store.js";

/**
 * Headless commands, for agents and scripts.
 *
 * Everything human goes to stderr and everything machine-readable goes to
 * stdout, so `thumbnailbooth generate --json | jq` is always safe to pipe.
 */

interface Flags {
  _: string[];
  [key: string]: string | string[] | boolean | undefined;
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).replace(/-/g, "_");
    let value: string | boolean;
    if (eq !== -1) value = arg.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) value = argv[++i];
    else value = true;

    // Repeatable flags (--ref) collect rather than overwrite.
    const existing = flags[name];
    if (existing === undefined) flags[name] = value;
    else if (Array.isArray(existing)) existing.push(String(value));
    else flags[name] = [String(existing), String(value)];
  }
  return flags;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length ? v : undefined;
const list = (v: unknown): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [String(v)];

const out = (s: string) => process.stdout.write(s + "\n");
const note = (s: string) => process.stderr.write(s + "\n");

export const CLI_HELP = `
  thumbnailbooth — Roblox thumbnails, generated locally

  Usage
    $ thumbnailbooth                       Open the app in your browser
    $ thumbnailbooth generate [options]    Render without the UI
    $ thumbnailbooth models                List models, prices and key status
    $ thumbnailbooth history [--limit N]   List past jobs
    $ thumbnailbooth mcp                   Run as an MCP server over stdio

  generate
    --concept <text>     What is in the picture  (required)
    --title <text>       Bold title drawn into the image
    --model <id>         Default: gemini-3-pro-image
    --aspect <ratio>     16:9 (default), 1:1, 9:16, 21:9 ...
    --size <tier>        512px | 1K | 2K (default) | 4K
    --variants <n>       1-8, default 1
    --ref <file[:role]>  Reference image; role = style (default) | character | layout
    --style-rules <text> Replace the built-in Roblox house style
    --out <dir>          Also copy the finished PNGs here
    --json               Print machine-readable JSON to stdout
    --yes                Skip the cost confirmation

  Serving
    --port <n>           Port for the UI    (default 4270)
    --host <h>           Bind address       (default 127.0.0.1)
    --no-open            Do not open a browser
    --mcp-http           Also serve MCP at /mcp  (see README for the risks)

  API keys come from GEMINI_API_KEY / OPENAI_API_KEY, or from the app's Setup
  screen. Generating costs real money on your own key.
`;

/** Returns a process exit code. */
export async function runCli(command: string, argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const json = flags.json === true;

  switch (command) {
    case "models":
      return await cmdModels(json);
    case "history":
      return await cmdHistory(flags, json);
    case "generate":
      return await cmdGenerate(flags, json);
    default:
      note(`Unknown command "${command}".`);
      note(CLI_HELP);
      return 1;
  }
}

async function cmdModels(json: boolean): Promise<number> {
  const config = await store.configStatus();
  const rows = MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    key_configured: config[m.provider].configured,
    aspects: m.aspects,
    sizes: m.sizes,
    max_references: m.maxRefs,
    price_per_image_usd: Object.fromEntries(m.sizes.map((s) => [s, estimateCost(m.id, s, 1)])),
  }));

  if (json) {
    out(JSON.stringify({ models: rows, roblox_presets: ROBLOX_PRESETS }, null, 2));
    return 0;
  }

  for (const m of rows) {
    const prices = Object.entries(m.price_per_image_usd)
      .map(([size, cost]) => `${size} $${(cost as number).toFixed(3)}`)
      .join("  ");
    out(`${m.label}  (${m.id})`);
    out(`  ${m.provider}${m.key_configured ? " · key ready" : " · NO KEY"}   ${prices}`);
  }
  return 0;
}

async function cmdHistory(flags: Flags, json: boolean): Promise<number> {
  const limit = Number(str(flags.limit) ?? 20);
  const entries = await store.readHistory(limit);
  const rows = entries.map((e) => ({
    job_id: e.id,
    created_at: e.createdAt,
    concept: e.request.concept,
    model: e.modelLabel,
    estimated_cost_usd: e.usage?.estimatedCost ?? 0,
    paths: e.images.map((i) => path.join(store.jobDir(e.id), i.file ?? "")),
    error: e.error,
  }));

  if (json) {
    out(JSON.stringify({ jobs: rows }, null, 2));
    return 0;
  }
  if (!rows.length) {
    note("No jobs yet.");
    return 0;
  }
  for (const r of rows) {
    out(`${r.created_at}  ${r.model}  $${r.estimated_cost_usd.toFixed(3)}`);
    out(`  ${r.concept.slice(0, 80) || "(no concept)"}`);
    for (const p of r.paths) out(`  ${p}`);
  }
  return 0;
}

async function cmdGenerate(flags: Flags, json: boolean): Promise<number> {
  const concept = str(flags.concept) ?? "";
  const refs: RefImage[] = [];

  for (const entry of list(flags.ref)) {
    // file[:role] — but a Windows drive letter also uses a colon, so only
    // treat the tail as a role when it actually names one.
    const at = entry.lastIndexOf(":");
    const tail = at > 1 ? entry.slice(at + 1) : "";
    const isRole = ["style", "character", "layout"].includes(tail);
    const file = isRole ? entry.slice(0, at) : entry;
    const role = !isRole ? "style" : tail === "character" ? "subject" : tail === "layout" ? "composition" : "style";

    try {
      const bytes = await fs.readFile(path.resolve(file));
      const ext = path.extname(file).toLowerCase();
      refs.push({
        data: bytes.toString("base64"),
        mimeType: ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png",
        name: path.basename(file),
        role: role as RefImage["role"],
      });
    } catch {
      note(`Couldn't read reference image: ${file}`);
      return 1;
    }
  }

  if (!concept.trim() && !refs.length) {
    note("Nothing to render. Pass --concept \"a noob lifting a giant dumbbell\".");
    return 1;
  }

  const request = normalizeRequest({
    concept,
    title: str(flags.title),
    model: str(flags.model),
    aspect: str(flags.aspect) as AspectRatio | undefined,
    size: str(flags.size) as SizeTier | undefined,
    variants: Number(str(flags.variants) ?? 1),
    styleRules: str(flags.style_rules),
    refs,
  });

  const spec = getModel(request.model);
  const cost = estimateCost(request.model, request.size, request.variants);

  if (!json) {
    note(`${spec?.label ?? request.model} · ${request.aspect} ${request.size} · ` +
         `${request.variants} frame${request.variants > 1 ? "s" : ""} · about $${cost.toFixed(3)}`);
  }

  try {
    const result = await runJob(request, (event) => {
      if (json) return;
      if (event.type === "saved") note(`  done  ${event.path}`);
      else if (event.type === "error") note(`  failed  ${event.message}`);
    });

    const copied: string[] = [];
    const dest = str(flags.out);
    if (dest) {
      await fs.mkdir(path.resolve(dest), { recursive: true });
      for (const image of result.images) {
        const target = path.join(path.resolve(dest), `${result.jobId}-${image.file}`);
        await fs.copyFile(image.path, target);
        copied.push(target);
      }
    }

    if (json) {
      out(JSON.stringify({
        ok: result.images.length > 0,
        job_id: result.jobId,
        directory: result.dir,
        paths: result.images.map((i) => i.path),
        copied_to: copied,
        estimated_cost_usd: result.estimatedCost,
        model: result.model,
        errors: result.errors,
      }, null, 2));
    } else if (result.images.length) {
      note(`\nSpent about $${result.estimatedCost.toFixed(3)}.`);
      for (const p of copied.length ? copied : result.images.map((i) => i.path)) out(p);
    }

    return result.images.length ? 0 : 1;
  } catch (err) {
    const message = err instanceof JobError ? err.message : `Generation failed: ${(err as Error).message}`;
    if (json) out(JSON.stringify({ ok: false, error: message }, null, 2));
    else note(message);
    return 1;
  }
}
