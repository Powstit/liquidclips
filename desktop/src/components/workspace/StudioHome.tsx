// v0.7.78 — Studio Home (Liquid Clips 9.6 first-screen).
//
// Demo-standard intent router. Four central tiles map to the four user
// intents at first impression — Create / Import / Thumbnails / Script.
// Projects is deliberately omitted from the central grid in 9.6; it
// reaches the user via the side nav only.
//
// Studio Home is presentation only. All four onClick handlers route to
// existing App.tsx wiring via WorkstationRoom's prop chain. No data
// fetches, no state machine, no routing change.
//
// The Tile spec mirrors the existing cockpit-tile vocabulary in
// index.css (cockpit-tile + cockpit-tile-corner-* + cockpit-tile-halo +
// cockpit-tile-glyph) and reuses the same shared-layout transition
// targets (`layoutId="cockpit-create"` / `"cockpit-import"`) so the
// morph into UploadPortal still works.

import { motion, useReducedMotion } from "motion/react";
import { Sparkles, Layers, ImageIcon, ScrollText } from "lucide-react";

export function StudioHome({
  onCreate,
  onImport,
  onThumbnails,
  onScript,
  importing = false,
  userTier = null,
  remainingExports = null,
}: {
  /** Routes to the existing Create flow (App.tsx opens UploadPortal with
   *  intent="clips"). */
  onCreate: () => void;
  /** Routes to the existing Import flow (App.tsx fires the OS file picker
   *  directly via handleImportDirect). */
  onImport: () => void;
  /** Routes to the existing ThumbnailStudio modal. Optional; if unwired
   *  the tile renders in honest disabled state. */
  onThumbnails?: () => void;
  /** Routes to the existing lift_transcript pipeline (App.tsx opens
   *  UploadPortal with intent="script"). Optional; if unwired the tile
   *  renders in honest disabled state. */
  onScript?: () => void;
  /** True while handleImportDirect is in flight (OS picker open OR
   *  importReadyClips running). Dims the Import tile and shows a
   *  "preparing…" pill. */
  importing?: boolean;
  /** Current account tier. Used to show free/paid watermark status. */
  userTier?: "free" | "solo" | "pro" | "agency" | null;
  /** Free user's remaining exports. `null` means paid/unlimited. */
  remainingExports?: number | null;
}) {
  const reduced = useReducedMotion();

  return (
    <div className="flex w-full flex-col items-center gap-12">
      <header className="flex max-w-[640px] flex-col items-center gap-3 text-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
          studio
        </span>
        <h1 className="font-display text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          Studio&rsquo;s open.
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-ink-soft">
          Create, import, package, and publish clips from one workstation.
        </p>
        <QuotaPill userTier={userTier} remainingExports={remainingExports} />
      </header>

      <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
        <Tile
          layoutId="cockpit-create"
          icon={<Sparkles className="h-12 w-12" strokeWidth={1.5} />}
          title="Create"
          subtitle="Paste a link and start clipping."
          onClick={onCreate}
          reduced={!!reduced}
          delay={0}
        />
        <Tile
          layoutId="cockpit-import"
          icon={<Layers className="h-12 w-12" strokeWidth={1.5} />}
          title="Import"
          subtitle="Drop a video or pick a file."
          onClick={onImport}
          reduced={!!reduced}
          delay={0.12}
          busy={importing}
          busyLabel="preparing…"
        />
        <Tile
          layoutId="cockpit-thumbnails"
          icon={<ImageIcon className="h-12 w-12" strokeWidth={1.5} />}
          title="Thumbnails"
          subtitle="Turn a frame into a thumbnail pack."
          onClick={onThumbnails ?? (() => undefined)}
          disabled={!onThumbnails}
          reduced={!!reduced}
          delay={0.24}
        />
        <Tile
          layoutId="cockpit-script"
          icon={<ScrollText className="h-12 w-12" strokeWidth={1.5} />}
          title="Script"
          subtitle="Shape captions, hooks, and talking points."
          onClick={onScript ?? (() => undefined)}
          disabled={!onScript}
          reduced={!!reduced}
          delay={0.36}
        />
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-tertiary">
        or drop a video anywhere on this screen
      </p>
    </div>
  );
}

function Tile({
  layoutId,
  icon,
  title,
  subtitle,
  onClick,
  reduced,
  delay,
  disabled = false,
  busy = false,
  busyLabel,
}: {
  layoutId: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  reduced: boolean;
  delay: number;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
}) {
  const interactionBlocked = disabled || busy;
  return (
    <motion.button
      layoutId={layoutId}
      type="button"
      onClick={interactionBlocked ? undefined : onClick}
      disabled={interactionBlocked}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.92 }}
      animate={
        reduced
          ? { opacity: disabled ? 0.55 : busy ? 0.5 : 1 }
          : { opacity: disabled ? 0.55 : busy ? 0.5 : 1, y: 0, scale: 1 }
      }
      transition={
        reduced
          ? { duration: 0.18 }
          : { delay, type: "spring", stiffness: 280, damping: 26 }
      }
      whileHover={
        reduced || interactionBlocked
          ? undefined
          : { scale: 1.04, transition: { type: "spring", stiffness: 360, damping: 22 } }
      }
      whileTap={reduced || interactionBlocked ? undefined : { scale: 0.96 }}
      className={`cockpit-tile group relative flex h-[220px] w-[220px] flex-col items-center justify-center gap-3 bg-transparent outline-none ${interactionBlocked ? "cursor-not-allowed" : ""} ${busy ? "pointer-events-none" : ""}`}
      aria-label={`${title} — ${subtitle}${disabled ? " (coming soon)" : ""}${busy ? " (preparing)" : ""}`}
      aria-busy={busy || undefined}
    >
      {disabled && !busy && (
        <span className="absolute right-3 top-3 rounded-full border border-fuchsia/30 bg-paper px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-fuchsia">
          soon
        </span>
      )}
      {busy && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-paper px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-fuchsia">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-fuchsia" />
          </span>
          {busyLabel ?? "working"}
        </span>
      )}
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

      <span aria-hidden="true" className="cockpit-tile-halo" />

      <span className="cockpit-tile-glyph relative z-10 text-fuchsia">
        {icon}
      </span>
      <span className="relative z-10 flex flex-col items-center gap-1.5">
        <span className="font-display text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {title}
        </span>
        <span className="px-2 text-center font-sans text-[12px] leading-snug text-text-tertiary">
          {subtitle}
        </span>
      </span>
    </motion.button>
  );
}

/** P1 — Honest free/paid + quota status above the tiles. Mirrors the
 *  legacy DropZone pill so users see watermark and remaining clips before
 *  they start a job.
 *  v0.7.78 — Premium variant bumped: tier name (Solo / Pro / Agency)
 *  carries the identity, Sparkles glyph + cyan glow add the "premium feel"
 *  the small mono pill lacked. Free pill chrome unchanged. */
function QuotaPill({
  userTier,
  remainingExports,
}: {
  userTier?: "free" | "solo" | "pro" | "agency" | null;
  remainingExports?: number | null;
}) {
  if (userTier === null) return null;
  if (userTier === "free") {
    return (
      <p className="rounded-full border border-fuchsia/30 bg-paper px-3 py-1 font-mono text-[11px] text-fuchsia">
        {remainingExports ?? "—"} of 100 free clips left &middot; watermark on export
      </p>
    );
  }
  const tierLabel =
    userTier === "solo"
      ? "Solo"
      : userTier === "pro"
      ? "Pro"
      : userTier === "agency"
      ? "Agency"
      : "Premium";
  return (
    <p
      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-paper px-4 py-1.5 font-mono text-[11px] text-cyan-400 shadow-[0_0_18px_rgba(0,229,255,0.25)]"
    >
      <Sparkles className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
      {tierLabel} &middot; clean exports &middot; no watermark
    </p>
  );
}
