import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { Keep, Sheet, Trash } from "../components/Icons.js";
import { settle } from "../design/motion.js";

/** The file: every job this machine has printed, newest first. */
export function History({ onOpen }: { onOpen: () => void }) {
  const history = useStore((s) => s.history);
  const loadHistory = useStore((s) => s.loadHistory);
  const restore = useStore((s) => s.restore);
  const [query, setQuery] = useState("");

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((entry) =>
      entry.request.concept.toLowerCase().includes(q) ||
      (entry.request.title ?? "").toLowerCase().includes(q) ||
      entry.modelLabel.toLowerCase().includes(q));
  }, [history, query]);

  const spend = history.reduce((sum, e) => sum + (e.usage?.estimatedCost ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-[1100px] overflow-y-auto p-6">
      <div className="mb-4 flex items-end justify-between gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your jobs"
          className="w-[300px] border-0 border-b border-surround-500 bg-transparent py-1.5 text-[14px] text-stock placeholder:text-surround-300 focus:border-cyan focus:outline-none"
        />
        <p className="tabular text-[12px] text-surround-300">
          {history.length} job{history.length === 1 ? "" : "s"} · ${spend.toFixed(2)} spent
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="sheet-shadow grid place-items-center bg-stock px-6 py-20 text-center text-ink">
          <Sheet className="text-ink-50" />
          <p className="mt-3 max-w-[34ch] text-[13px] leading-snug text-ink-50">
            {history.length
              ? "No jobs match that search."
              : "Nothing printed yet. Everything you generate is filed here automatically."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {filtered.map((entry, i) => (
              <motion.li
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ ...settle, delay: Math.min(i, 8) * 0.03 }}
                className="sheet-shadow-sm flex gap-4 bg-stock p-3 text-ink"
              >
                <div className="flex shrink-0 gap-1.5">
                  {entry.images.slice(0, 4).map((img) => (
                    <img
                      key={img.id}
                      src={`/api/image/${entry.id}/${img.file}`}
                      alt=""
                      className="h-16 w-auto max-w-[112px] object-cover"
                    />
                  ))}
                  {entry.images.length === 0 ? (
                    <div className="grid h-16 w-24 place-items-center bg-stock-edge text-[10px] text-ink-50">
                      no image
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">
                    {entry.request.concept || <span className="text-ink-50">Untitled job</span>}
                  </p>
                  {entry.request.title ? (
                    <p className="truncate text-[12px] text-ink-70">“{entry.request.title}”</p>
                  ) : null}
                  <p className="tabular mt-1 text-[11px] text-ink-50">
                    {new Date(entry.createdAt).toLocaleString()} · {entry.modelLabel} ·{" "}
                    {entry.request.aspect} {entry.request.size}
                    {entry.usage ? ` · $${entry.usage.estimatedCost.toFixed(3)}` : ""}
                  </p>
                  {entry.error ? (
                    <p className="mt-1 text-[11.5px] text-red-ink">{entry.error}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end justify-between">
                  <div className="flex gap-1">
                    <IconButton
                      label={entry.favorite ? "Remove mark" : "Mark as keeper"}
                      active={entry.favorite}
                      onClick={async () => {
                        await api.favorite(entry.id, !entry.favorite);
                        void loadHistory();
                      }}
                    >
                      <Keep />
                    </IconButton>
                    <IconButton
                      label="Delete this job"
                      onClick={async () => {
                        await api.deleteEntry(entry.id);
                        void loadHistory();
                      }}
                    >
                      <Trash />
                    </IconButton>
                  </div>
                  <button
                    type="button"
                    onClick={() => { restore(entry); onOpen(); }}
                    className="legend text-cyan underline decoration-cyan/30 underline-offset-4 hover:decoration-cyan"
                  >
                    Open on the press
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function IconButton({
  children, label, onClick, active,
}: { children: React.ReactNode; label: string; onClick: () => void | Promise<void>; active?: boolean }) {
  return (
    <button
      type="button" title={label} aria-label={label}
      onClick={() => void onClick()}
      className={`grid h-7 w-7 place-items-center border transition-colors ${
        active ? "border-red bg-red text-stock" : "border-stock-rule text-ink-50 hover:border-ink hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
