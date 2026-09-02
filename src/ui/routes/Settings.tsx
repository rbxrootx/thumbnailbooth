import { useState } from "react";
import type { ProviderId } from "../../shared/types.js";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { Check, Key, Warn } from "../components/Icons.js";

const PROVIDERS: Array<{
  id: ProviderId; name: string; where: string; url: string; note: string;
}> = [
  {
    id: "gemini",
    name: "Google Gemini",
    where: "aistudio.google.com/app/apikey",
    url: "https://aistudio.google.com/app/apikey",
    note: "Runs Nano Banana Pro and the Flash Image models. Best text rendering.",
  },
  {
    id: "openai",
    name: "OpenAI",
    where: "platform.openai.com/api-keys",
    url: "https://platform.openai.com/api-keys",
    note: "Runs GPT Image 2. Strong photoreal composition.",
  },
];

export function Settings() {
  return (
    <div className="mx-auto w-full max-w-[720px] overflow-y-auto p-6">
      <div className="sheet-shadow bg-stock text-ink">
        <div className="border-b border-stock-rule px-6 py-4">
          <h2 className="text-[15px] font-bold" style={{ fontStretch: "92%" }}>Setup</h2>
        </div>
        <div className="divide-y divide-stock-rule/70">
          {PROVIDERS.map((provider) => (
            <KeyRow key={provider.id} {...provider} />
          ))}
        </div>
        <StorageNote />
      </div>
    </div>
  );
}

export function KeyRow({
  id, name, where, url, note,
}: { id: ProviderId; name: string; where: string; url: string; note: string }) {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.set);
  const status = config[id];

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.saveKey(id, value.trim());
      setConfig("config", res.config);
      setValue("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    const res = await api.clearKey(id);
    setConfig("config", res.config);
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[14px] font-semibold">{name}</h3>
        {status.configured ? (
          <span className="flex items-center gap-1.5 text-[12px] text-cyan">
            <Check /> saved <span className="tabular text-ink-50">{status.hint}</span>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[12.5px] text-ink-50">{note}</p>

      {status.configured ? (
        <button type="button" onClick={() => void clear()}
          className="legend mt-3 text-ink-50 underline decoration-stock-rule underline-offset-4 hover:text-red-ink">
          Remove this key
        </button>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Key className="pointer-events-none absolute left-0 top-2 text-ink-50" />
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void save()}
                placeholder={`Paste your ${name} key`}
                autoComplete="off"
                className="w-full border-0 border-b border-stock-rule bg-transparent py-1 pl-6 font-mono text-[13px] text-ink placeholder:text-ink-50 focus:border-cyan focus:outline-none"
              />
            </div>
            <button type="button" onClick={() => void save()} disabled={busy || !value.trim()}
              className="bg-ink px-4 text-[12px] font-bold tracking-[0.08em] text-stock transition-colors hover:bg-cyan disabled:cursor-not-allowed disabled:bg-stock-rule/60 disabled:text-ink-50">
              {busy ? "CHECKING" : "SAVE"}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-ink-50">
            Get one free at{" "}
            <a href={url} target="_blank" rel="noreferrer" className="text-cyan underline">
              {where}
            </a>
          </p>
        </>
      )}

      {error ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-snug text-red-ink">
          <Warn className="mt-px" /> {error}
        </p>
      ) : null}
    </div>
  );
}

function StorageNote() {
  const home = useStore((s) => s.home);
  return (
    <p className="border-t border-stock-rule bg-stock-edge/50 px-6 py-4 text-[12px] leading-relaxed text-ink-50">
      Keys are written to <span className="tabular text-ink-70">{home}/config.json</span> on this
      machine only, inside your user folder, with owner-only permissions where your operating
      system supports them. They are sent to Google and OpenAI to make your images and nowhere
      else. The file is not encrypted, so treat it like any other file holding a password.
    </p>
  );
}
