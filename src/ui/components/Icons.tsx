/**
 * One drawn icon set, 16px grid, 1.5 stroke. Emoji and unicode glyphs are
 * not icons; a press check marks things with a pencil, not a sticker.
 */
type P = { className?: string };

const base = "shrink-0";
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ children, className }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden className={`${base} ${className ?? ""}`}>
      {children}
    </svg>
  );
}

export const Plus = (p: P) => <Svg {...p}><path {...stroke} d="M8 3.5v9M3.5 8h9" /></Svg>;
export const Close = (p: P) => <Svg {...p}><path {...stroke} d="M4 4l8 8M12 4l-8 8" /></Svg>;
export const Check = (p: P) => <Svg {...p}><path {...stroke} d="M3.5 8.5l3 3 6-7" /></Svg>;
export const Chevron = (p: P) => <Svg {...p}><path {...stroke} d="M4 6.5l4 4 4-4" /></Svg>;

export const Download = (p: P) => (
  <Svg {...p}><path {...stroke} d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13h10" /></Svg>
);

/** Grease-pencil circle: the mark that keeps a frame. */
export const Keep = (p: P) => (
  <Svg {...p}>
    <path {...stroke} d="M12.6 5.2c1.2 2.4-.4 5.4-3.4 6.5S2.9 11.3 2.6 8.8c-.3-2.6 2-5 5-5.4 2.3-.3 4.2.5 5 1.8z" />
  </Svg>
);

/** The struck rule: killed, disabled, declined. */
export const Strike = (p: P) => (
  <Svg {...p}><path {...stroke} d="M3 13L13 3M3.5 5.5h4M8.5 10.5h4" /></Svg>
);

export const Reroll = (p: P) => (
  <Svg {...p}>
    <path {...stroke} d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5" />
  </Svg>
);

export const Stop = (p: P) => (
  <Svg {...p}><rect {...stroke} x="4" y="4" width="8" height="8" rx="1" /></Svg>
);

export const Sheet = (p: P) => (
  <Svg {...p}><path {...stroke} d="M3.5 2.5h9v11h-9zM6 5.5h4M6 8h4M6 10.5h2.5" /></Svg>
);

export const Stack = (p: P) => (
  <Svg {...p}><path {...stroke} d="M2.5 5.5h7v7h-7zM5 5.5v-2h7v7h-2" /></Svg>
);

export const Grid = (p: P) => (
  <Svg {...p}><path {...stroke} d="M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5H9z" /></Svg>
);

export const Gear = (p: P) => (
  <Svg {...p}>
    <circle {...stroke} cx="8" cy="8" r="2.2" />
    <path {...stroke} d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" />
  </Svg>
);

export const Image = (p: P) => (
  <Svg {...p}>
    <rect {...stroke} x="2.5" y="3.5" width="11" height="9" rx="1" />
    <path {...stroke} d="M2.5 10l3-2.5 3 2.2 2.5-2 2.5 2.3" />
    <circle {...stroke} cx="6" cy="6.2" r=".9" />
  </Svg>
);

export const Trash = (p: P) => (
  <Svg {...p}><path {...stroke} d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Svg>
);

export const Key = (p: P) => (
  <Svg {...p}>
    <circle {...stroke} cx="5.5" cy="6.5" r="2.8" />
    <path {...stroke} d="M7.6 8.4L13 13.8M10.5 11.3l1.4-1.4" />
  </Svg>
);

export const Warn = (p: P) => (
  <Svg {...p}>
    <path {...stroke} d="M8 2.8L14.2 13H1.8zM8 6.6v3M8 11.3v.1" />
  </Svg>
);
