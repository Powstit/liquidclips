import { useEffect, useRef, useState } from "react";

// Premium info icon + accessible tooltip. Replaces the inline grey hint lines
// that turned the editor into a docs page. Click/hover/focus reveal; click-
// outside or Escape close. Positioned above the trigger so we never collide
// with the input below it.

export function InfoTip({
  text,
  size = "sm",
  side = "top",
}: {
  text: string;
  size?: "sm" | "md";
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dim = size === "sm" ? "h-3.5 w-3.5 text-[9px]" : "h-4 w-4 text-[10px]";
  const pos =
    side === "top"
      ? "bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2"
      : "top-[calc(100%+8px)] left-1/2 -translate-x-1/2";
  const arrow =
    side === "top"
      ? "top-full left-1/2 -translate-x-1/2 border-t-ink border-x-transparent border-b-transparent"
      : "bottom-full left-1/2 -translate-x-1/2 border-b-ink border-x-transparent border-t-transparent";

  return (
    <span ref={wrap} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="More info"
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className={`${dim} grid place-items-center rounded-full border border-line bg-paper font-mono italic text-text-tertiary transition-colors hover:border-fuchsia hover:text-fuchsia focus:border-fuchsia focus:text-fuchsia focus:outline-none`}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute ${pos} z-50 w-60 rounded-lg bg-ink px-3 py-2 font-sans text-[11px] leading-snug text-paper shadow-[0_8px_24px_rgba(10,10,15,0.25)]`}
        >
          {text}
          <span
            aria-hidden
            className={`absolute ${arrow} h-0 w-0 border-[5px] border-solid`}
          />
        </span>
      )}
    </span>
  );
}
