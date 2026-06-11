// ───── IG-012 brand-kit primitive ─────
// LoadingSkeleton — brand-locked "I'm loading" surface. Three variants:
//   - "card-grid"  : N×9:16 cards with the library-card-corner bracket
//                    span treatment + working-bar shimmer inside each.
//   - "list"       : N stacked rows with bracket corners + shimmer.
//   - "hero"       : single full-width skeleton for hero panels.
//
// Brand contract: never use raw grey blocks (`bg-paper-warm` plates with no
// chrome). Always wrap with library-card-corner spans so the loading state
// reads as the same world as the populated state — only the content slot is
// shimmering.

export function LoadingSkeleton({
  variant = "card-grid",
  count = 6,
  message,
}: {
  variant?: "card-grid" | "list" | "hero";
  count?: number;
  /** Optional Geist Mono mono-caption shown below the skeletons. Keeps the
   *  room conversational ("Reading local clip history…") rather than silent. */
  message?: string;
}) {
  return (
    <div className="relative">
      {variant === "card-grid" && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: count }).map((_, i) => (
            <SkeletonCard key={i} delayMs={i * 80} />
          ))}
        </div>
      )}

      {variant === "list" && (
        <div className="space-y-3">
          {Array.from({ length: count }).map((_, i) => (
            <SkeletonRow key={i} delayMs={i * 80} />
          ))}
        </div>
      )}

      {variant === "hero" && (
        <div className="library-card relative aspect-[16/9] rounded-2xl overflow-hidden">
          <span className="library-card-corner library-card-corner-tl" />
          <span className="library-card-corner library-card-corner-tr" />
          <span className="library-card-corner library-card-corner-bl" />
          <span className="library-card-corner library-card-corner-br" />
          <div className="absolute inset-0 bg-paper-warm" />
          <div className="working-bar absolute inset-x-12 bottom-12" />
        </div>
      )}

      {message && (
        <div className="mt-6 grid place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <span>{message}<span className="blink">_</span></span>
        </div>
      )}
    </div>
  );
}

function SkeletonCard({ delayMs }: { delayMs: number }) {
  return (
    <div className="library-card relative aspect-[9/16] rounded-2xl overflow-hidden">
      <span className="library-card-corner library-card-corner-tl" />
      <span className="library-card-corner library-card-corner-tr" />
      <span className="library-card-corner library-card-corner-bl" />
      <span className="library-card-corner library-card-corner-br" />
      <div className="absolute inset-0 bg-paper-warm" />
      <div className="working-bar absolute inset-x-6 bottom-6" style={{ animationDelay: `${delayMs}ms` }} />
    </div>
  );
}

function SkeletonRow({ delayMs }: { delayMs: number }) {
  return (
    <div className="library-card relative rounded-xl px-4 py-4 flex items-center gap-4">
      <span className="library-card-corner library-card-corner-tl" />
      <span className="library-card-corner library-card-corner-tr" />
      <span className="library-card-corner library-card-corner-bl" />
      <span className="library-card-corner library-card-corner-br" />
      <div className="h-10 w-10 rounded-lg bg-paper-warm flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="working-bar w-3/4" style={{ animationDelay: `${delayMs}ms` }} />
        <div className="working-bar w-1/2" style={{ animationDelay: `${delayMs + 80}ms` }} />
      </div>
    </div>
  );
}
