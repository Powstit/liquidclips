// Small "i" affordance with a hover/focus tooltip. CSS-only (named group) so
// many can sit on one screen without colliding. Keep `text` short — one line
// of plain guidance, no marketing.
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
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-left font-sans text-[11px] font-normal normal-case leading-snug tracking-normal text-paper opacity-0 shadow-[0_8px_24px_rgba(15,15,18,0.18)] transition-opacity duration-100 group-hover/info:opacity-100 group-focus-within/info:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
