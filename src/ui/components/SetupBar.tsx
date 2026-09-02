import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../lib/store.js";
import { Check, Chevron, Plus, Trash } from "./Icons.js";
import { snap } from "../design/motion.js";

/**
 * Saved setups: a docket you have used before, recalled by name. A press
 * shop keeps standing job tickets for repeat work; this is that.
 */
export function SetupBar() {
  const { workflows, loadWorkflows, saveWorkflow, applyWorkflow, removeWorkflow } = useStore();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => { void loadWorkflows(); }, [loadWorkflows]);

  async function commit() {
    if (!name.trim()) return;
    await saveWorkflow(name.trim());
    setName("");
    setNaming(false);
  }

  return (
    <div className="relative border-b border-stock-rule bg-stock-edge/40 px-5 py-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="legend flex items-center gap-1 text-ink-50 transition-colors hover:text-ink"
        >
          Saved setups
          <span className="tabular text-[10px]">({workflows.length})</span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={snap}>
            <Chevron />
          </motion.span>
        </button>

        {naming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commit();
                if (e.key === "Escape") { setNaming(false); setName(""); }
              }}
              placeholder="Name this setup"
              className="w-[136px] border-0 border-b border-stock-rule bg-transparent py-0.5 text-[12px] text-ink placeholder:text-ink-50 focus:border-cyan focus:outline-none"
            />
            <button type="button" onClick={() => void commit()} aria-label="Save setup"
              className="grid h-5 w-5 place-items-center text-cyan hover:text-ink">
              <Check />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setNaming(true)}
            className="legend flex items-center gap-1 text-ink-50 transition-colors hover:text-cyan">
            <Plus /> Save
          </button>
        )}
      </div>

      <AnimatePresence>
        {open ? (
          <motion.ul
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={snap}
            className="overflow-hidden"
          >
            {workflows.length === 0 ? (
              <li className="py-2 text-[12px] text-ink-50">
                Nothing saved yet. Set up a job you like, then press Save.
              </li>
            ) : (
              workflows.map((wf) => (
                <li key={wf.id} className="group flex items-center gap-2 py-1">
                  <button
                    type="button"
                    onClick={() => { applyWorkflow(wf.id); setOpen(false); }}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink-70 transition-colors hover:text-cyan"
                  >
                    {wf.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeWorkflow(wf.id)}
                    aria-label={`Delete ${wf.name}`}
                    className="text-ink-50 opacity-0 transition-opacity hover:text-red-ink group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash />
                  </button>
                </li>
              ))
            )}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
