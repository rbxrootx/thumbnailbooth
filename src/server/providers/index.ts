import type { ProviderId } from "../../shared/types.js";
import { geminiAdapter } from "./gemini.js";
import { openaiAdapter } from "./openai.js";
import type { ProviderAdapter } from "./types.js";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
};

export function adapterFor(provider: ProviderId): ProviderAdapter | undefined {
  return ADAPTERS[provider];
}
