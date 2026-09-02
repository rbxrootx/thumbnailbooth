import type {
  ConfigStatus, ExportPreset, GenerateRequest, HistoryEntry, ModelSpec,
  ProviderId, SavedWorkflow,
} from "../../shared/types.js";

export interface Bootstrap {
  config: ConfigStatus;
  prefs: Record<string, unknown>;
  models: ModelSpec[];
  presets: ExportPreset[];
  defaultStyleRules: string;
  home: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  bootstrap: () => json<Bootstrap>("/api/status"),

  saveKey: (provider: ProviderId, key: string) =>
    json<{ ok: boolean; config: ConfigStatus }>("/api/keys", {
      method: "POST",
      body: JSON.stringify({ provider, key }),
    }),

  clearKey: (provider: ProviderId) =>
    json<{ ok: boolean; config: ConfigStatus }>(`/api/keys/${provider}`, { method: "DELETE" }),

  savePrefs: (prefs: Record<string, unknown>) =>
    json<{ ok: boolean }>("/api/prefs", { method: "POST", body: JSON.stringify(prefs) }),

  history: () => json<{ entries: HistoryEntry[] }>("/api/history"),

  favorite: (id: string, favorite: boolean) =>
    json<{ ok: boolean }>(`/api/history/${id}/favorite`, {
      method: "POST",
      body: JSON.stringify({ favorite }),
    }),

  deleteEntry: (id: string) => json<{ ok: boolean }>(`/api/history/${id}`, { method: "DELETE" }),

  workflows: () => json<{ workflows: SavedWorkflow[] }>("/api/workflows"),

  saveWorkflow: (wf: Partial<SavedWorkflow>) =>
    json<{ workflow: SavedWorkflow }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify(wf),
    }),

  deleteWorkflow: (id: string) =>
    json<{ ok: boolean }>(`/api/workflows/${id}`, { method: "DELETE" }),
};

/* ----------------------------------------------------------- generation */

export type StreamEvent =
  | { type: "start"; jobId: string; variants: number }
  | { type: "status"; index: number; message: string }
  | { type: "partial"; index: number; data: string; mimeType: string }
  | { type: "image"; index: number; id: string; url: string; mimeType: string }
  | { type: "done"; jobId: string; usage?: { imageCount: number; estimatedCost: number } }
  | { type: "error"; index?: number; message: string; retryable: boolean };

/**
 * POSTs the job and reads the SSE response. EventSource can't POST, so this
 * parses the stream directly.
 */
export async function generate(
  req: GenerateRequest,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `Generation failed (${res.status})`;
    try {
      message = JSON.parse(text).message ?? message;
    } catch { /* keep the fallback */ }
    throw new ApiError(message, res.status);
  }
  if (!res.body) throw new ApiError("No response stream from the server.", 500);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as StreamEvent);
      } catch { /* ignore a malformed frame rather than killing the run */ }
    }
  }
}
