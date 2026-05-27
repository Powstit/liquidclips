// Small "i" affordance with a hover/focus tooltip. CSS-only (named group) so
// many can sit on one screen without colliding. Keyboard-accessible: the
// trigger is tabbable and the tooltip reveals on focus-within too. Keep `text`
// short — one line of plain guidance, no marketing.
//
// Spotlight hover: icon turns fuchsia, tooltip lifts 2px + fades in, top edge
// gets a thin fuchsia accent so the eye reads it as a deliberate affordance.
export function InfoHint({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`group/info relative inline-flex items-center align-middle ${className}`}>
      <span
        tabIndex={0}
        role="img"
        aria-label={text}
        className="inline-grid h-[14px] w-[14px] cursor-help select-none place-items-center rounded-full border border-line bg-paper font-mono text-[9px] font-bold leading-none text-text-tertiary transition-colors hover:border-fuchsia hover:text-fuchsia-deep focus:border-fuchsia focus:outline-none"
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[240px] -translate-x-1/2 translate-y-0.5 rounded-lg border border-fuchsia/40 border-t-fuchsia bg-ink px-2.5 py-1.5 text-left font-sans text-[11px] font-normal normal-case leading-snug tracking-normal text-paper opacity-0 shadow-[0_8px_24px_rgba(15,15,18,0.18)] transition duration-150 ease-out group-hover/info:translate-y-0 group-hover/info:opacity-100 group-focus-within/info:translate-y-0 group-focus-within/info:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
