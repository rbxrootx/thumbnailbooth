import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Chevron } from "./Icons.js";
import { snap } from "../design/motion.js";

/**
 * The job docket's field vocabulary. A real ticket prints a legend and a
 * ruled value area — no numbered steps, because the order carries nothing
 * the reader needs.
 */

export function DocketRow({
  legend, hint, children, htmlFor,
}: {
  legend: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="border-t border-stock-rule/70 px-5 py-4 first:border-t-0">
      <label htmlFor={htmlFor} className="legend block text-ink-50">
        {legend}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? <p className="mt-2 text-[12px] leading-snug text-ink-50">{hint}</p> : null}
    </div>
  );
}

const fieldBase =
  "w-full bg-transparent text-ink placeholder:text-ink-50 " +
  "border-0 border-b border-stock-rule focus:border-cyan focus:outline-none " +
  "focus-visible:outline-none transition-colors py-1";

export function TextField({
  value, onChange, placeholder, id, big,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
  big?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldBase} ${big ? "text-[19px] font-semibold" : "text-[14px]"}`}
      style={big ? { fontStretch: "94%" } : undefined}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

/** The concept, set in the sheet's own display type at full scale — the
 *  words are the material being worked, not metadata about it. */
export function ConceptField({
  value, onChange, id,
}: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      placeholder="A bacon-hair noob lifting a giant golden dumbbell while a buff pro watches in shock"
      className={`${fieldBase} resize-none text-[20px] font-semibold leading-[1.25] tracking-[-0.015em]`}
      style={{ fontStretch: "92%" }}
    />
  );
}

/**
 * An authored listbox. A native <select> opens an OS menu that has nothing to
 * do with this world, and it forces the model's explanation to be glued into
 * the option string; here the sublabel gets its own line.
 */
export function SelectField<T extends string>({
  value, onChange, options, id, disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; sublabel?: string }>;
  id?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (open) {
      listRef.current?.focus();
    } else if (wasOpen.current) {
      // Closing returns the caret to where the user left the docket.
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  function commit(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home": e.preventDefault(); setActiveIndex(0); break;
      case "End": e.preventDefault(); setActiveIndex(options.length - 1); break;
      case "Enter": case " ":
        e.preventDefault();
        commit(activeIndex);
        break;
      case "Escape": e.preventDefault(); setOpen(false); break;
      case "Tab": setOpen(false); break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex w-full items-center justify-between gap-2 border-0 border-b border-stock-rule py-1 text-left text-[14px] text-ink transition-colors hover:border-ink focus:border-cyan focus:outline-none disabled:cursor-not-allowed disabled:text-ink-50"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={snap} className="text-ink-50">
          <Chevron />
        </motion.span>
      </button>

      {open ? (
        <motion.ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={`${listId}-${activeIndex}`}
            onKeyDown={onKeyDown}
            initial={{ y: -4 }}
            animate={{ y: 0 }}
            transition={snap}
            className="sheet-shadow absolute left-0 right-0 top-full z-20 mt-1 max-h-[260px] overflow-y-auto bg-stock outline-none ring-1 ring-stock-rule"
          >
            {options.map((option, i) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActiveIndex(i)}
                  onClick={() => commit(i)}
                  className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${
                    i === activeIndex ? "bg-cyan/10" : ""
                  }`}
                >
                  <span className={`mt-0.5 w-3.5 shrink-0 ${isSelected ? "text-cyan" : "text-transparent"}`}>
                    <Check />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] leading-tight text-ink">{option.label}</span>
                    {option.sublabel ? (
                      <span className="tabular mt-0.5 block text-[11px] leading-tight text-ink-50">
                        {option.sublabel}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
        </motion.ul>
      ) : null}
    </div>
  );
}

/** Concept starters. Chips, not cards — they are one-tap seeds. */
export function ChipRow({
  items, onPick,
}: { items: string[]; onPick: (value: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onPick(item)}
          className="border border-stock-rule px-2 py-1 text-[11.5px] text-ink-70 transition-colors hover:border-cyan hover:text-cyan"
        >
          {item}
        </button>
      ))}
    </div>
  );
}
