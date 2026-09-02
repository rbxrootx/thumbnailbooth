import type { GenerateEvent, GenerateRequest, ProviderId } from "../../shared/types.js";

export interface KeyCheck {
  ok: boolean;
  message?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  /** Cheap probe so the setup flow can confirm a key before the first render. */
  validateKey(key: string, signal?: AbortSignal): Promise<KeyCheck>;
  /**
   * Emits `partial` frames as they arrive, then one `image` per variant.
   * Must never throw — failures come back as `error` events so one bad
   * variant cannot take down the whole batch.
   */
  generate(
    req: GenerateRequest,
    key: string,
    signal: AbortSignal,
  ): AsyncGenerator<GenerateEvent>;
}

/** Thrown internally; routes turn it into an `error` event. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Maps an HTTP status to a message a non-engineer can act on. */
export function describeHttpError(status: number, body: string, provider: string): ProviderError {
  const detail = extractMessage(body);

  // Google returns 400 with its own wording for a bad key, so classify on the
  // message rather than the status. The user needs to know what to *do*.
  if (/api[ _-]?key not valid|API_KEY_INVALID|invalid[ _-]?api[ _-]?key|incorrect api key/i.test(body)) {
    return new ProviderError(
      `That ${provider} API key isn't valid. Check for a stray space when you pasted it, or create a fresh key and save it again in Setup.`,
      false,
      status,
    );
  }
  if (/billing|quota|insufficient|exceeded your current quota/i.test(body) && status !== 429) {
    return new ProviderError(
      `Your ${provider} account can't run this yet — it usually means billing isn't set up, or you're out of credit.`,
      false,
      status,
    );
  }

  switch (status) {
    case 400:
      return new ProviderError(detail ?? "The request was rejected as malformed.", false, 400);
    case 401:
    case 403:
      return new ProviderError(
        `Your ${provider} API key was rejected. Check it in Settings — it may be revoked, or lack image generation access.`,
        false,
        status,
      );
    case 404:
      return new ProviderError(
        detail ?? `That model isn't available on your ${provider} account.`,
        false,
        404,
      );
    case 429:
      return new ProviderError(
        `${provider} is rate limiting you. Wait a moment, or lower the variant count.`,
        true,
        429,
      );
    case 500: case 502: case 503: case 504:
      return new ProviderError(`${provider} had a server error. Worth retrying.`, true, status);
    default:
      return new ProviderError(detail ?? `${provider} returned HTTP ${status}.`, status >= 500, status);
  }
}

function extractMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message ?? parsed?.message ?? parsed?.[0]?.error?.message;
    return typeof msg === "string" ? msg : undefined;
  } catch {
    return body.trim().slice(0, 300) || undefined;
  }
}

/** Shared line-oriented SSE reader. Tolerates unknown event shapes. */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // Events are separated by a blank line; handle \n\n and \r\n\r\n.
      while ((sep = findBoundary(buffer)) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, "");
        const payload = raw
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!payload || payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload);
        } catch {
          // Non-JSON keepalive or comment — ignore.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function findBoundary(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

/**
 * Runs up to `limit` generators concurrently and interleaves their output,
 * so variant 2 can stream while variant 1 is still rendering.
 */
export async function* merge<T>(
  sources: Array<() => AsyncGenerator<T>>,
  limit = 3,
): AsyncGenerator<T> {
  const iters = new Map<number, AsyncGenerator<T>>();
  const pending = new Map<number, Promise<{ id: number; res: IteratorResult<T> }>>();
  let next = 0;

  const fill = () => {
    while (iters.size < limit && next < sources.length) {
      const id = next++;
      const it = sources[id]();
      iters.set(id, it);
      pending.set(id, it.next().then((res) => ({ id, res })));
    }
  };

  fill();
  while (pending.size) {
    const { id, res } = await Promise.race(pending.values());
    if (res.done) {
      pending.delete(id);
      iters.delete(id);
      fill();
    } else {
      yield res.value;
      const it = iters.get(id);
      if (it) pending.set(id, it.next().then((r) => ({ id, res: r })));
    }
  }
}

/**
 * Walks an arbitrary response object collecting anything that looks like an
 * inline image. Both providers have changed their response shapes recently,
 * so this stays deliberately structural rather than pinned to one schema.
 */
export function extractImages(node: unknown, out: Array<{ data: string; mimeType: string }> = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) extractImages(item, out);
    return out;
  }
  const rec = node as Record<string, unknown>;
  const data = rec.data ?? rec.b64_json ?? rec.bytesBase64Encoded;
  const mime = (rec.mime_type ?? rec.mimeType) as string | undefined;
  if (typeof data === "string" && data.length > 256) {
    const looksImage = !mime || mime.startsWith("image/");
    if (looksImage) out.push({ data, mimeType: mime ?? "image/png" });
  }
  for (const value of Object.values(rec)) {
    if (value && typeof value === "object") extractImages(value, out);
  }
  return out;
}
