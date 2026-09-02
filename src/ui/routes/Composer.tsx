import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AspectRatio, ExportPreset, SizeTier } from "../../shared/types.js";
import { estimateCost } from "../../shared/models.js";
import { useStore } from "../lib/store.js";
import { readAsRef } from "../lib/export.js";
import { ChipRow, ConceptField, DocketRow, SelectField, TextField } from "../components/Docket.js";
import { ProofFrame } from "../components/ProofFrame.js";
import { ColourBar, CropMarks, RegistrationTarget } from "../components/PressMarks.js";
import { Close, Plus, Stop, Warn } from "../components/Icons.js";
import { SetupBar } from "../components/SetupBar.js";
import { glide, settle } from "../design/motion.js";

const STARTERS = [
  "Noob vs pro", "Money pile", "Running from the boss",
  "Impossible lift", "Day 1 vs Day 100", "Giant egg hatch",
];

const ROLE_LABEL: Record<string, string> = {
  style: "STYLE",
  subject: "CHARACTER",
  composition: "LAYOUT",
};

const ROLE_HELP: Record<string, string> = {
  style: "Takes only the lighting, colour and finish. Nothing in this picture will appear in your thumbnail.",
  subject: "This character will be drawn into your thumbnail, wearing what they wear here.",
  composition: "Takes only the framing and where things sit in the frame.",
};

const ASPECT_LABEL: Record<string, string> = {
  "16:9": "16:9 — thumbnail", "1:1": "1:1 — icon", "9:16": "9:16 — vertical",
  "4:3": "4:3", "3:4": "3:4", "3:2": "3:2", "2:3": "2:3",
  "4:5": "4:5", "5:4": "5:4", "21:9": "21:9",
};

export function Composer() {
  const s = useStore();
  const spec = useStore((st) => st.modelSpec());
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const preset = useMemo(
    () => s.presets.find((p) => p.aspect === s.aspect),
    [s.presets, s.aspect],
  );

  const cost = estimateCost(s.model, s.size, s.variants);
  const providerReady = spec ? s.config[spec.provider].configured : false;
  const doneCount = s.frames.filter((f) => f.status === "done").length;
  const progress = s.frames.length ? doneCount / s.frames.length : 0;
  // A single-frame reprint occupies the press just as a full run does.
  const reprinting = !s.running && s.frames.some((f) => f.status === "rendering");
  const busy = s.running || reprinting;
  const canGenerate = Boolean(s.concept.trim() || s.refs.length) && providerReady && !busy;

  async function addFiles(files: FileList | File[]) {
    const max = spec?.maxRefs ?? 14;
    const room = max - s.refs.length;
    if (room <= 0) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, room);
    const read = await Promise.all(picked.map(readAsRef));
    // Style-only unless the user says otherwise — attaching a thumbnail should
    // borrow its look, not its props.
    s.patchDocket({
      refs: [...s.refs, ...read.map((r) => ({ ...r, role: "style" as const }))],
    });
  }

  async function useAsRef(index: number) {
    const frame = s.frames[index];
    if (!frame?.url) return;
    const res = await fetch(frame.url);
    const blob = await res.blob();
    const file = new File([blob], `take-${index + 1}.png`, { type: blob.type });
    await addFiles([file]);
  }

  /** Style -> Character -> Layout, and round again. */
  function cycleRole(index: number) {
    const order = ["style", "subject", "composition"] as const;
    s.patchDocket({
      refs: s.refs.map((ref, i) => {
        if (i !== index) return ref;
        const at = order.indexOf((ref.role ?? "style") as typeof order[number]);
        return { ...ref, role: order[(at + 1) % order.length] };
      }),
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 lg:flex-row lg:gap-6 lg:overflow-hidden lg:p-6">
      {/* ------------------------------------------------------- job docket */}
      <aside className="sheet-shadow flex w-full shrink-0 flex-col bg-stock text-ink lg:w-[380px]">
        <div className="flex items-center justify-between border-b border-stock-rule px-5 py-3">
          <h2 className="text-[13px] font-bold tracking-[-0.01em]" style={{ fontStretch: "92%" }}>
            Job docket
          </h2>
          <ColourBar progress={busy ? progress : 1} />
        </div>

        <SetupBar />

        <div className="min-h-0 lg:flex-1 lg:overflow-y-auto">
          <DocketRow legend="Concept" htmlFor="concept"
            hint="What is happening in the picture. Plain words work best.">
            <ConceptField id="concept" value={s.concept}
              onChange={(v) => s.patchDocket({ concept: v })} />
            <ChipRow items={STARTERS} onPick={(v) => s.patchDocket({ concept: v })} />
          </DocketRow>

          <DocketRow legend="Title text" htmlFor="title"
            hint="Drawn into the image as bold 3D lettering. Leave empty for clean space you can add your own text to.">
            <TextField id="title" value={s.title} placeholder="STRONGEST PUNCH SIMULATOR"
              onChange={(v) => s.patchDocket({ title: v })} big />
          </DocketRow>

          <DocketRow legend="Inks" htmlFor="model" hint={spec?.blurb}>
            <SelectField id="model" value={s.model}
              onChange={(v) => s.patchDocket({ model: v })}
              options={s.models.map((m) => ({
                value: m.id, label: m.label, sublabel: m.sublabel,
              }))} />
          </DocketRow>

          <DocketRow legend="Trim"
            hint={preset ? `Delivers ${preset.width}x${preset.height}. ${preset.note}` : undefined}>
            <div className="grid grid-cols-2 gap-4">
              <SelectField value={s.aspect}
                onChange={(v) => s.patchDocket({ aspect: v as AspectRatio })}
                options={(spec?.aspects ?? []).map((a) => ({
                  value: a, label: ASPECT_LABEL[a] ?? a,
                }))} />
              <SelectField value={s.size}
                onChange={(v) => s.patchDocket({ size: v as SizeTier })}
                options={(spec?.sizes ?? []).map((z) => ({ value: z, label: z }))} />
            </div>
          </DocketRow>

          <DocketRow legend="Frames"
            hint="How many different takes to print from this concept.">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <button key={n} type="button"
                  onClick={() => s.patchDocket({ variants: n })}
                  aria-pressed={s.variants === n}
                  className={`tabular h-8 w-8 border text-[13px] transition-colors ${
                    s.variants === n
                      ? "border-ink bg-ink text-stock"
                      : "border-stock-rule text-ink-70 hover:border-ink"
                  }`}>
                  {n}
                </button>
              ))}
            </div>
          </DocketRow>

          <DocketRow legend="References"
            hint={`Used for lighting and colour only — objects and scenery from a reference will not be copied. Tap a tag to change that. Up to ${spec?.maxRefs ?? 14}.`}>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void addFiles(e.dataTransfer.files);
              }}
              className={`border border-dashed p-2 transition-colors ${
                dragging ? "border-cyan bg-cyan/5" : "border-stock-rule"
              }`}
            >
              {s.refs.length ? (
                <ul className="mb-2 grid grid-cols-4 gap-1.5">
                  {s.refs.map((ref, i) => {
                    const role = ref.role ?? "style";
                    return (
                      <li key={`${ref.name}-${i}`} className="group relative aspect-square">
                        <img src={`data:${ref.mimeType};base64,${ref.data}`} alt={ref.name ?? ""}
                          className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => cycleRole(i)}
                          title={ROLE_HELP[role]}
                          aria-label={`${ref.name ?? "Reference"}: ${ROLE_LABEL[role]}. ${ROLE_HELP[role]} Click to change.`}
                          className={`absolute inset-x-0 bottom-0 py-[3px] text-[8.5px] font-semibold tracking-[0.09em] transition-colors ${
                            role === "style"
                              ? "bg-ink/80 text-stock hover:bg-ink"
                              : role === "subject"
                                ? "bg-magenta text-stock hover:brightness-110"
                                : "bg-cyan text-stock hover:brightness-110"
                          }`}
                        >
                          {ROLE_LABEL[role]}
                        </button>
                        <button type="button" aria-label={`Remove ${ref.name ?? "reference"}`}
                          onClick={() => s.patchDocket({ refs: s.refs.filter((_, j) => j !== i) })}
                          className="absolute right-0 top-0 grid h-5 w-5 place-items-center bg-ink/80 text-stock opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                          <Close />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <button type="button" onClick={() => fileInput.current?.click()}
                className="flex w-full items-center justify-center gap-1.5 py-2 text-[12.5px] text-ink-50 transition-colors hover:text-cyan">
                <Plus /> Add images
              </button>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden
                onChange={(e) => { void addFiles(e.target.files ?? []); e.target.value = ""; }} />
            </div>
          </DocketRow>

          <details className="group border-t border-stock-rule/70">
            <summary className="legend flex cursor-pointer items-center justify-between px-5 py-4 text-ink-50 transition-colors marker:content-none hover:text-ink [&::-webkit-details-marker]:hidden">
              Style rules
              <span className="text-[10px] normal-case tracking-normal">
                {s.useCustomRules ? "edited" : "house style"}
              </span>
            </summary>
            <div className="px-5 pb-4">
              <textarea
                value={s.useCustomRules ? s.styleRules : s.defaultStyleRules}
                onChange={(e) => s.patchDocket({ styleRules: e.target.value, useCustomRules: true })}
                rows={10}
                className="w-full resize-y border border-stock-rule bg-stock-edge/40 p-2 font-mono text-[11.5px] leading-relaxed text-ink-70 focus:border-cyan focus:outline-none"
              />
              {s.useCustomRules ? (
                <button type="button"
                  onClick={() => s.patchDocket({ useCustomRules: false, styleRules: s.defaultStyleRules })}
                  className="legend mt-2 text-cyan">
                  Reset to house style
                </button>
              ) : null}
            </div>
          </details>
        </div>

        {/* ------------------------------------------------ press foot */}
        <div className="border-t border-stock-rule bg-stock-edge/50 px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="legend flex items-center gap-1.5 text-ink-50">
              <span aria-hidden className="inline-block h-2 w-2 bg-yellow" />
              Estimated
            </span>
            <span className="tabular border-b-2 border-yellow pb-0.5 text-[15px] font-semibold text-ink">
              ${cost.toFixed(3)}
            </span>
          </div>

          {!providerReady ? (
            <p className="mb-3 flex items-start gap-1.5 text-[12px] leading-snug text-red-ink">
              <Warn className="mt-px" />
              <span>
                No {spec?.provider === "openai" ? "OpenAI" : "Gemini"} key yet — add one in
                Setup to print with {spec?.label}.
              </span>
            </p>
          ) : null}

          {/* The button becomes the press: it morphs into a progress rail
              rather than being replaced by a spinner. */}
          <motion.button
            layout
            type="button"
            disabled={!canGenerate && !busy}
            onClick={() => (busy ? s.stop() : void s.run())}
            className={`relative flex h-12 w-full items-center justify-center overflow-hidden text-[13px] font-bold tracking-[0.08em] transition-colors ${
              busy
                ? "bg-ink text-stock"
                : canGenerate
                  ? "bg-ink text-stock hover:bg-cyan"
                  : "cursor-not-allowed bg-stock-edge text-ink-50 ring-1 ring-inset ring-stock-rule"
            }`}
          >
            {busy ? (
              <motion.span
                className="absolute inset-y-0 left-0 bg-magenta"
                initial={{ width: 0 }}
                animate={{ width: `${(s.running ? progress : 0.5) * 100}%` }}
                transition={glide}
              />
            ) : null}
            <span className="relative flex items-center gap-2">
              {s.running ? (
                <><Stop /> STOP · {doneCount}/{s.frames.length}</>
              ) : reprinting ? (
                <><Stop /> STOP REPRINT</>
              ) : "GENERATE"}
            </span>
          </motion.button>
        </div>
      </aside>

      {/* ------------------------------------------------------ proof sheet */}
      <section className="flex min-w-0 flex-1 flex-col gap-4 lg:overflow-y-auto">
        <div className="sheet-shadow relative bg-stock text-ink">
          <div className="flex items-center justify-between border-b border-stock-rule px-6 py-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[13px] font-bold" style={{ fontStretch: "92%" }}>Proof</h2>
              {s.jobId ? (
                <span className="tabular text-[11px] text-ink-50">job {s.jobId.slice(0, 8)}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-4">
              {preset ? (
                <span className="tabular text-[11px] text-ink-50">
                  {preset.width}&times;{preset.height}
                </span>
              ) : null}
              <ColourBar progress={busy ? progress : 1} />
            </div>
          </div>

          <div className="relative px-5 py-6 sm:px-10 sm:py-9">
            <div className="relative text-ink-50">
              <CropMarks />
              {s.frames.length ? (
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns:
                      `repeat(auto-fit, minmax(min(100%, ${s.frames.length > 4 ? 200 : 260}px), 1fr))`,
                  }}
                >
                  {s.frames.map((frame, i) => (
                    <ProofFrame
                      key={frame.index}
                      frame={frame}
                      index={i}
                      aspect={s.aspect}
                      preset={preset}
                      kept={Boolean(frame.id && s.keptIds.includes(frame.id))}
                      onKeep={() => frame.id && s.toggleKept(frame.id)}
                      onUseAsRef={() => void useAsRef(frame.index)}
                      onReroll={() => void s.runFrame(frame.index)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyStock aspect={s.aspect} preset={preset} />
              )}
            </div>

            <AnimatePresence>
              {s.revised ? (
                <motion.span
                  initial={{ opacity: 0, scale: 1.15, rotate: -12 }}
                  animate={{ opacity: 1, scale: 1, rotate: -9 }}
                  exit={{ opacity: 0 }}
                  transition={settle}
                  className="pointer-events-none absolute right-8 top-6 select-none border-[2.5px] border-red px-3 py-1 text-[15px] font-bold tracking-[0.12em] text-red"
                >
                  REVISED
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>

          {s.runError ? (
            <p className="flex items-start gap-2 border-t border-stock-rule bg-red/5 px-6 py-3 text-[13px] text-red-ink">
              <Warn className="mt-0.5" /> {s.runError}
            </p>
          ) : null}
        </div>

        {/* Prior takes ride below as an overlay on the standing job — a
            reroll never destroys the take you are comparing against. */}
        <AnimatePresence>
          {s.takes.length > 1 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={settle}
              className="shrink-0"
            >
              <h3 className="legend mb-2 text-surround-300">Earlier takes</h3>
              <ul className="flex gap-2 overflow-x-auto pb-1">
                {s.takes.slice(1).map((take) => (
                  <li key={take.jobId} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => s.openTake(take.jobId)}
                      title={`Put this take back on the sheet — ${take.concept.slice(0, 60)}`}
                      className="flex gap-1 border border-transparent p-0.5 transition-colors hover:border-cyan focus-visible:border-cyan"
                    >
                      {take.urls.slice(0, 3).map((url) => (
                        <img key={url} src={url} alt=""
                          className="sheet-shadow-sm h-16 object-cover opacity-70 transition-opacity hover:opacity-100" />
                      ))}
                      <span className="sr-only">
                        Restore the take from {new Date(take.at).toLocaleTimeString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>
    </div>
  );
}

/** Empty press stock, with the target the first render will converge on. */
function EmptyStock({ aspect, preset }: { aspect: string; preset?: ExportPreset }) {
  return (
    <motion.div
      layout
      transition={settle}
      className="relative grid place-items-center border border-stock-rule/60 bg-stock-edge/40"
      style={{ aspectRatio: aspect.replace(":", "/") }}
    >
      {preset?.safeZone ? (
        <motion.div
          layout
          transition={settle}
          className="pointer-events-none absolute border border-dashed border-stock-rule"
          style={{
            inset: `${((preset.height - preset.safeZone.height) / 2 / preset.height) * 100}% ${
              ((preset.width - preset.safeZone.width) / 2 / preset.width) * 100}%`,
          }}
        />
      ) : null}
      <div className="flex flex-col items-center gap-4 text-center text-ink-50">
        <RegistrationTarget size={40} />
        <p className="max-w-[30ch] text-[13px] leading-snug">
          Empty stock. Describe the thumbnail on the docket, then press Generate.
        </p>
      </div>
    </motion.div>
  );
}
