import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ExportPreset } from "../../shared/types.js";
import type { Frame } from "../lib/store.js";
import { downloadAtPreset, downloadOriginal } from "../lib/export.js";
import { Download, Image as ImageIcon, Keep, Reroll, Warn } from "./Icons.js";
import { PressRun, RegistrationTarget } from "./PressMarks.js";
import { glide, settle } from "../design/motion.js";

/**
 * One frame in the sheet's live area.
 *
 * The reveal is the signature moment. Each streamed preview is another pass of
 * the press, resolving further out of flat tone; the finished image fades in
 * *over* the last preview rather than replacing it, so the picture never
 * flashes back to bare stock on the way to being done.
 */
export function ProofFrame({
  frame, aspect, preset, index, kept, onKeep, onUseAsRef, onReroll,
}: {
  frame: Frame;
  aspect: string;
  preset?: ExportPreset;
  index: number;
  kept: boolean;
  onKeep: () => void;
  onUseAsRef: () => void;
  onReroll: () => void;
}) {
  const reduce = useReducedMotion();
  const [passes, setPasses] = useState(0);
  const [finalLoaded, setFinalLoaded] = useState(false);
  const [creep, setCreep] = useState(0);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const lastPartial = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (frame.partial && frame.partial !== lastPartial.current) {
      lastPartial.current = frame.partial;
      setPasses((p) => p + 1);
    }
  }, [frame.partial]);

  useEffect(() => {
    if (frame.status === "rendering") setStartedAt((t) => t ?? Date.now());
    if (frame.status === "waiting") setStartedAt(undefined);
  }, [frame.status]);

  useEffect(() => {
    if (frame.status !== "rendering") return;
    // Providers do not all stream previews. The plate still has to look like
    // it is travelling into register, so creep toward — never onto — home.
    const id = setInterval(() => setCreep((c) => c + (0.82 - c) * 0.06), 400);
    return () => clearInterval(id);
  }, [frame.status]);

  const finished = frame.status === "done";
  const partial = frame.partial ?? lastPartial.current;
  // Blur falls off with each pass; the final image lands sharp.
  const partialBlur = Math.max(2, 18 / (passes + 1));
  const progress = finished ? 1 : Math.max(creep, Math.min(0.9, passes * 0.28));

  return (
    <motion.figure
      layout
      transition={settle}
      className="group relative m-0"
      style={{ aspectRatio: aspect.replace(":", "/") }}
    >
      <div className="absolute inset-0 bg-stock-edge/60" />

      {/* Last preview stays put underneath so nothing ever shows through. */}
      {partial ? (
        <motion.img
          src={partial}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          initial={false}
          animate={{
            opacity: 1,
            filter: reduce ? "none" : `blur(${partialBlur}px) saturate(0.7)`,
          }}
          transition={glide}
          draggable={false}
        />
      ) : null}

      {frame.url ? (
        <motion.img
          src={frame.url}
          alt={`Proof ${index + 1}`}
          onLoad={() => setFinalLoaded(true)}
          className="absolute inset-0 h-full w-full object-cover"
          initial={false}
          animate={{
            opacity: finalLoaded ? 1 : 0,
            filter: reduce || finalLoaded ? "blur(0px)" : "blur(10px)",
          }}
          transition={glide}
          draggable={false}
        />
      ) : null}

      {!partial && !frame.url && frame.status !== "failed" ? (
        frame.status === "waiting" ? (
          <div className="absolute inset-0 grid place-items-center text-ink-50">
            <RegistrationTarget progress={0} />
            <span className="sr-only">Queued</span>
          </div>
        ) : (
          <PressRun status={frame.message} progress={progress} startedAt={startedAt} />
        )
      ) : null}

      {frame.status === "failed" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stock-edge/60 px-5 text-center">
          <Warn className="text-red-ink" />
          <p className="text-[12.5px] leading-snug text-ink-70">{frame.error}</p>
          <button
            type="button"
            onClick={onReroll}
            className="legend mt-1 text-cyan underline decoration-cyan/40 hover:decoration-cyan"
          >
            Reprint this frame
          </button>
        </div>
      ) : null}

      {preset?.safeZone && (partial || frame.url) ? (
        <div
          className="pointer-events-none absolute border border-dashed border-cyan/70"
          style={{
            left: `${((preset.width - preset.safeZone.width) / 2 / preset.width) * 100}%`,
            top: `${((preset.height - preset.safeZone.height) / 2 / preset.height) * 100}%`,
            right: `${((preset.width - preset.safeZone.width) / 2 / preset.width) * 100}%`,
            bottom: `${((preset.height - preset.safeZone.height) / 2 / preset.height) * 100}%`,
          }}
        />
      ) : null}

      <span className="tabular pointer-events-none absolute -top-px left-1.5 text-[10px] font-medium text-ink-50 mix-blend-multiply">
        {String(index + 1).padStart(2, "0")}
      </span>

      {kept ? <GreasePencilRing /> : null}

      {finished ? (
        <figcaption className="absolute inset-x-0 bottom-0 flex translate-y-1 items-center justify-end gap-px p-1.5 opacity-0 transition-[opacity,transform] duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
          <FrameAction label={kept ? "Remove keeper mark" : "Mark as keeper"} onClick={onKeep} active={kept}>
            <Keep />
          </FrameAction>
          <FrameAction label="Use as a reference" onClick={onUseAsRef}>
            <ImageIcon />
          </FrameAction>
          <FrameAction label="Reprint just this frame" onClick={onReroll}>
            <Reroll />
          </FrameAction>
          <FrameAction
            label={preset ? `Download ${preset.width}x${preset.height}` : "Download"}
            onClick={() => {
              const stem = `thumbnail-${String(index + 1).padStart(2, "0")}`;
              return preset
                ? downloadAtPreset(frame.url!, preset, stem)
                : downloadOriginal(frame.url!, stem);
            }}
          >
            <Download />
          </FrameAction>
        </figcaption>
      ) : null}
    </motion.figure>
  );
}

/** The keeper mark: a grease pencil loop, drawn, not a rounded CSS box. */
function GreasePencilRing() {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full text-red"
      aria-hidden
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={settle}
    >
      {/* Hand-drawn: overshoots where it closes, as a real one does. */}
      <motion.path
        d="M52 7 C24 6 7 24 6 48 C5 74 25 94 52 94 C79 94 95 74 94 49 C93 25 77 8 50 7 C40 7 32 10 27 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.svg>
  );
}

function FrameAction({
  children, label, onClick, active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => void onClick()}
      className={`grid h-7 w-7 place-items-center backdrop-blur-sm transition-colors ${
        active ? "bg-red text-stock" : "bg-ink/70 text-stock hover:bg-ink"
      }`}
    >
      {children}
    </button>
  );
}
