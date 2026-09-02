import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { converge } from "../design/motion.js";

/**
 * The marks a real proof carries. These are structural, not ornament: the
 * crop marks show the trim, the dashed rule shows what survives Roblox's
 * corner rounding, and the registration target is the render's progress.
 */

/**
 * Printer's registration target.
 *
 * The plate travels into register as the render progresses: the loose ring
 * closes onto the crosshair and the centre dot lands when it is home. This is
 * progress made visible, not a spinner — nothing rotates forever.
 */
export function RegistrationTarget({
  size = 44, active = false, done = false, progress = 0,
}: { size?: number; active?: boolean; done?: boolean; progress?: number }) {
  const reduce = useReducedMotion();
  const c = size / 2;
  const r = size * 0.3;

  const settled = done ? 1 : Math.min(1, Math.max(0, progress));
  // Out of register at 0, home at 1.
  const offset = (1 - settled) * (size * 0.12);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <path
        d={`M${c} 0v${size} M0 ${c}h${size}`}
        stroke="currentColor"
        strokeWidth="0.75"
        opacity={done ? 0.35 : 0.55}
      />
      <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="0.75" opacity={0.55} />

      {/* The off-register plate, closing in. */}
      <motion.circle
        cx={c} cy={c} r={r * 0.55}
        fill="none" stroke="currentColor" strokeWidth="1.25"
        initial={false}
        animate={{
          x: reduce ? 0 : offset,
          y: reduce ? 0 : -offset * 0.6,
          opacity: active || settled > 0 ? (done ? 0.35 : 1) : 0,
        }}
        transition={converge}
      />

      <motion.circle
        cx={c} cy={c} r={1.5}
        fill="currentColor"
        initial={false}
        animate={{ scale: done ? 1 : 0.45 + settled * 0.55, opacity: done ? 1 : 0.5 }}
        transition={converge}
      />
    </svg>
  );
}

/** Corner crop marks, offset off the trim edge like the real thing. */
export function CropMarks({ inset = -10, length = 14 }: { inset?: number; length?: number }) {
  const corners = [
    { x: 0, y: 0, sx: 1, sy: 1 },
    { x: 1, y: 0, sx: -1, sy: 1 },
    { x: 0, y: 1, sx: 1, sy: -1 },
    { x: 1, y: 1, sx: -1, sy: -1 },
  ];
  return (
    <>
      {corners.map((corner, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: corner.x ? "100%" : 0,
            top: corner.y ? "100%" : 0,
            width: 1,
            height: 1,
          }}
        >
          <svg
            width={length + 12} height={length + 12}
            viewBox={`0 0 ${length + 12} ${length + 12}`}
            style={{
              position: "absolute",
              left: corner.sx > 0 ? inset : -(length + 12) - inset,
              top: corner.sy > 0 ? inset : -(length + 12) - inset,
              transform: `scale(${corner.sx}, ${corner.sy})`,
              transformOrigin: "center",
            }}
          >
            <path
              d={`M0 ${length + 12}V${12} M${length + 12} 0H${12}`}
              stroke="currentColor" strokeWidth="0.75"
            />
          </svg>
        </span>
      ))}
    </>
  );
}

/** The CMYK strip printed up the head of every proof. */
export function ColourBar({
  progress = 1, className = "",
}: { progress?: number; className?: string }) {
  // Process inks, then the greys a press check actually reads density from.
  const patches = [
    "var(--color-cyan)", "var(--color-magenta)", "var(--color-yellow)", "var(--color-ink)",
    "#8f8f93", "#c4c4c6", "#e2e2e3",
  ];
  return (
    <div className={`flex items-stretch gap-px ${className}`} aria-hidden>
      {patches.map((colour, i) => {
        const lit = progress >= (i + 1) / patches.length;
        return (
          <motion.span
            key={i}
            className="h-2 w-5"
            style={{ background: colour }}
            initial={false}
            animate={{ opacity: lit ? 1 : 0.22 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </div>
  );
}

/**
 * What an empty frame shows while the press is running.
 *
 * Wet process ink pooling in the fountain: five blobs of C, M, Y and K drift
 * and merge under a blur-plus-contrast gooey filter, so they fuse and split
 * like a lamp rather than sliding past each other. It is honestly abstract —
 * never a fake of the user's image — and it hands over the instant a real
 * streamed preview lands.
 */
export function PressRun({
  status, progress = 0, startedAt,
}: { status?: string; progress?: number; startedAt?: number }) {
  const reduce = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed((Date.now() - startedAt) / 1000);
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-stock-edge">
      {/* The lamp: ink diffusing in water. Soft radial fields drift and
          overlap so the colour genuinely mixes, rather than hard metaballs
          that would shout over the stock. */}
      <div aria-hidden className="absolute inset-[-25%]" style={{ filter: "blur(26px)" }}>
        {BLOBS.map((blob, i) => (
          <motion.span
            key={i}
            className="absolute"
            style={{
              width: `${blob.size}%`,
              height: `${blob.size * 1.25}%`,
              left: `${blob.x}%`,
              top: `${blob.y}%`,
              background: `radial-gradient(circle at 50% 50%, ${blob.ink} 0%, transparent 68%)`,
              opacity: blob.alpha,
              mixBlendMode: "multiply",
              willChange: "transform",
            }}
            animate={
              reduce
                ? undefined
                : { x: blob.dx, y: blob.dy, scale: blob.scale }
            }
            transition={{
              duration: blob.duration,
              repeat: Infinity,
              repeatType: "mirror",
              ease: "easeInOut",
              delay: blob.delay,
            }}
          />
        ))}
      </div>

      {/* Paper grain over the lamp, so it still reads as ink on stock. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, var(--color-ink) 0 1px, transparent 1px 5px)",
        }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <span className="text-ink/70">
          <RegistrationTarget size={40} active progress={progress} />
        </span>
        <div className="flex flex-col items-center gap-1 px-4 text-center">
          <p className="text-[12px] font-medium leading-snug text-ink/80">
            {status ?? "On the press…"}
          </p>
          {startedAt ? (
            <p className="tabular text-[11px] text-ink/55">{elapsed.toFixed(1)}s</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Irregular on purpose: matched periods would read as a machine, not a lamp. */
const BLOBS = [
  { ink: "var(--color-cyan)",    size: 58, x: -6, y: -4, dx: "34%",  dy: "62%",  scale: 1.25, alpha: 0.5,  duration: 17, delay: 0 },
  { ink: "var(--color-magenta)", size: 52, x: 46, y: 34, dx: "-40%", dy: "-52%", scale: 1.35, alpha: 0.42, duration: 21, delay: 1.8 },
  { ink: "var(--color-yellow)",  size: 60, x: 16, y: 44, dx: "46%",  dy: "-38%", scale: 1.2,  alpha: 0.38, duration: 15, delay: 0.9 },
  { ink: "var(--color-cyan)",    size: 40, x: 62, y: -8, dx: "-28%", dy: "78%",  scale: 1.4,  alpha: 0.34, duration: 24, delay: 3.4 },
];
