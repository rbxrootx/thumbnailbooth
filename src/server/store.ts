import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type {
  ConfigStatus, HistoryEntry, ProviderId, SavedWorkflow,
} from "../shared/types.js";

/**
 * Sole owner of ~/.thumbnailbooth. Everything on disk goes through here.
 * Deliberately dependency-free: no native modules, so `npx` can never fail
 * to build on a user's machine.
 */

export const ROOT = process.env.THUMBNAILBOOTH_HOME
  ? path.resolve(process.env.THUMBNAILBOOTH_HOME)
  : path.join(os.homedir(), ".thumbnailbooth");

const CONFIG_PATH = path.join(ROOT, "config.json");
const HISTORY_DIR = path.join(ROOT, "history");
const INDEX_PATH = path.join(HISTORY_DIR, "index.ndjson");
const WORKFLOW_DIR = path.join(ROOT, "workflows");

interface Config {
  keys: Partial<Record<ProviderId, string>>;
  prefs: Record<string, unknown>;
}

const EMPTY: Config = { keys: {}, prefs: {} };

export async function init(): Promise<void> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.mkdir(WORKFLOW_DIR, { recursive: true });
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    await writeConfig(EMPTY);
  }
}

async function readConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { keys: parsed.keys ?? {}, prefs: parsed.prefs ?? {} };
  } catch {
    return { ...EMPTY };
  }
}

async function writeConfig(cfg: Config): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  // 0600 from creation — never briefly world-readable.
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.rename(tmp, CONFIG_PATH);
  await fs.chmod(CONFIG_PATH, 0o600).catch(() => {});
}

const ENV_KEY: Record<ProviderId, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openai: ["OPENAI_API_KEY"],
};

/**
 * Keys stay server-side; the UI only ever learns that one exists.
 * The environment wins over the config file, so an agent or CI run can supply
 * a key without touching the user's saved settings.
 */
export async function getKey(provider: ProviderId): Promise<string | undefined> {
  for (const name of ENV_KEY[provider] ?? []) {
    const fromEnv = process.env[name];
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  }
  const cfg = await readConfig();
  const key = cfg.keys[provider];
  return key && key.trim() ? key.trim() : undefined;
}

export async function setKey(provider: ProviderId, key: string | null): Promise<void> {
  const cfg = await readConfig();
  if (key === null || key.trim() === "") delete cfg.keys[provider];
  else cfg.keys[provider] = key.trim();
  await writeConfig(cfg);
}

export async function configStatus(): Promise<ConfigStatus> {
  const cfg = await readConfig();
  const describe = (k?: string) =>
    k && k.trim()
      ? { configured: true, hint: `…${k.trim().slice(-4)}` }
      : { configured: false };
  return { gemini: describe(cfg.keys.gemini), openai: describe(cfg.keys.openai) };
}

export async function getPrefs(): Promise<Record<string, unknown>> {
  return (await readConfig()).prefs;
}

export async function setPrefs(prefs: Record<string, unknown>): Promise<void> {
  const cfg = await readConfig();
  cfg.prefs = { ...cfg.prefs, ...prefs };
  await writeConfig(cfg);
}

/* ---------------------------------------------------------------- history */

export function newJobId(): string {
  // Sortable by time, so the history dir browses chronologically in Finder.
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export function jobDir(jobId: string): string {
  return path.join(HISTORY_DIR, jobId);
}

export async function saveImage(
  jobId: string,
  index: number,
  data: string,
  mimeType: string,
): Promise<string> {
  const dir = jobDir(jobId);
  await fs.mkdir(dir, { recursive: true });
  const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const file = `${String(index + 1).padStart(2, "0")}.${ext}`;
  await fs.writeFile(path.join(dir, file), Buffer.from(data, "base64"));
  return file;
}

/** Appends one line. Only called once a job has at least one image or a final error. */
export async function appendHistory(entry: HistoryEntry): Promise<void> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.appendFile(INDEX_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Streams the index rather than reading it whole — history is append-only and
 * grows without bound.
 */
export async function readHistory(limit = 200, offset = 0): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  try {
    await fs.access(INDEX_PATH);
  } catch {
    return entries;
  }
  const rl = readline.createInterface({
    input: createReadStream(INDEX_PATH, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as HistoryEntry);
    } catch {
      // A torn final line from an interrupted write — skip it.
    }
  }
  // Newest first.
  entries.reverse();
  return entries.slice(offset, offset + limit);
}

/** Rewrites the index. Used for favourite toggles and deletes — both rare. */
async function rewriteHistory(mutate: (all: HistoryEntry[]) => HistoryEntry[]): Promise<void> {
  const all = (await readHistory(Number.MAX_SAFE_INTEGER)).reverse();
  const next = mutate(all);
  const tmp = `${INDEX_PATH}.tmp`;
  await fs.writeFile(tmp, next.map((e) => JSON.stringify(e)).join("\n") + (next.length ? "\n" : ""), "utf8");
  await fs.rename(tmp, INDEX_PATH);
}

export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  await rewriteHistory((all) =>
    all.map((e) => (e.id === id ? { ...e, favorite } : e)));
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await rewriteHistory((all) => all.filter((e) => e.id !== id));
  await fs.rm(jobDir(id), { recursive: true, force: true });
}

export async function readImageFile(jobId: string, file: string): Promise<Buffer> {
  // Guard against traversal — jobId and file both come off the wire.
  const safeJob = path.basename(jobId);
  const safeFile = path.basename(file);
  return fs.readFile(path.join(HISTORY_DIR, safeJob, safeFile));
}

/* -------------------------------------------------------------- workflows */

export async function listWorkflows(): Promise<SavedWorkflow[]> {
  await fs.mkdir(WORKFLOW_DIR, { recursive: true });
  const files = (await fs.readdir(WORKFLOW_DIR)).filter((f) => f.endsWith(".json"));
  const out: SavedWorkflow[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(WORKFLOW_DIR, f), "utf8")));
    } catch { /* skip unreadable workflow */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveWorkflow(wf: SavedWorkflow): Promise<SavedWorkflow> {
  await fs.mkdir(WORKFLOW_DIR, { recursive: true });
  const next = { ...wf, updatedAt: new Date().toISOString() };
  await fs.writeFile(
    path.join(WORKFLOW_DIR, `${path.basename(next.id)}.json`),
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return next;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await fs.rm(path.join(WORKFLOW_DIR, `${path.basename(id)}.json`), { force: true });
}

/** Stable short hash, used to dedupe identical reference images. */
export function hashData(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 12);
}
