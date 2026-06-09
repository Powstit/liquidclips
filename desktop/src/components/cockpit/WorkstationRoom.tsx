// v0.6.35 — Workstation room (new home).
//
// Replaces UnifiedDropZone + WorkspaceDashboard on the `view.kind === "empty"`
// surface. The room shows two large tactile tiles — Create and Import — and
// nothing else. Everything that used to live underneath (rank, affiliate,
// scheduled, active, leaderboard) is now reached via the AvatarOrbit dropdown
// in the top-right (see AvatarPanel.tsx). Sponsored Rewards live only on Earn.
//
// Tiles breathe at rest, tilt toward the cursor, and morph into UploadPortal
// when tapped via shared layoutId. The whole room is a calm launch pad — the
// dopamine surfaces are ambient (orbit ring + signal line) rather than
// stacked dashboard cards.
//
// ship-lens v0.7.13 Tier 1 fixes landed:
//   T1.3 — New optional `importing` prop (default false). When true the
//          Import tile dims to opacity-50, takes pointer-events-none, and
//          shows a small "preparing…" pill at the top of the tile so the
//          user sees the click took even before the OS file picker pops.
//          Back-compat: prop is optional with a default, so every existing
//          caller compiles without changes.
//   T1.1 (related) — `dropError` is still rendered inline (success+error
//          toasts under the tile row) for the empty-view case; App.tsx
//          additionally mounts a root-level GlobalToast that survives the
//          empty → results transition triggered by handleImportDirect.

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Sparkles, Layers, ImageIcon, ScrollText } from "lucide-react";
import { SponsoredBannerCarousel } from "../earn/SponsoredBannerCarousel";

export function WorkstationRoom({
  onCreate,
  onImport,
  onThumbnails,
  onScript,
  dragHoverActive = false,
  dropError = null,
  userTier = null,
  importing = false,
}: {
  /** Single-click Create: opens the compact URL/file portal. The portal
   *  auto-focuses its URL input — no second click to start typing. */
  onCreate: () => void;
  /** Single-click Import: fires the OS file picker directly. No modal in
   *  between — the picker IS the next surface. */
  onImport: () => void;
  /** v0.7.1 — placeholder tile for the thumbnail-pack feature. Daniel
   *  is wiring this later; for now the onClick fires a "coming soon"
   *  toast via the parent so the surface stays informative, not dead. */
  onThumbnails?: () => void;
  /** v0.7.1 — placeholder tile for the script / transcripts feature.
   *  Same pattern as onThumbnails: parent owns the toast. */
  onScript?: () => void;
  /** P0 #5 — driven by App.tsx's tauri://drag-enter/leave listeners. When
   *  true, the room renders a dashed cyan drop affordance with a "Drop a
   *  video to start" hint so the user has a visible target. */
  dragHoverActive?: boolean;
  /** P0 #6 — ephemeral error from a rejected drop (e.g. unsupported file
   *  type). Auto-cleared by App.tsx after 4s. */
  dropError?: string | null;
  /** Drives the SponsoredBannerCarousel mounted below the tiles — tier
   *  controls which campaigns show as locked vs unlocked. */
  userTier?: "free" | "solo" | "pro" | "agency" | null;
  /** ship-lens v0.7.13 T1.3 — true while handleImportDirect is in flight
   *  (OS file picker open OR sidecar.importReadyClips running). Dims the
   *  Import tile, blocks pointer events, and shows a "preparing…" pill
   *  so a second click before the picker pops doesn't look like a no-op.
   *  Defaults to false so every existing caller compiles unchanged. */
  importing?: boolean;
}) {
  const reduced = useReducedMotion();
  const [greeting, setGreeting] = useState("");

  // Tiny ambient — the eyebrow re-rolls on mount so each session lands with a
  // slightly different feel without becoming a feature. No data, no risk of
  // wrongness.
  useEffect(() => {
    const lines = [
      "what are we making",
      "ready when you are",
      "drop in",
      "studio's open",
      "your move",
    ];
    setGreeting(lines[Math.floor(Math.random() * lines.length)] ?? lines[0]);
  }, []);

  return (
    <div className="workstation-room flex w-full flex-col items-center justify-center gap-12 pt-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
          workstation
        </span>
        <h1 className="font-display text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          {greeting}
        </h1>
      </header>

      {/* v0.7.1 — 4 tiles in a single row on wide screens; collapses to
          2 cols on narrow. Same Tile component, same Sparkles/Layers
          vibe via lucide. Thumbnails + Script are placeholders Daniel
          wires later — onClick is a parent-owned "coming soon" toast.
          When the prop isn't wired the tile dims + becomes non-interactive
          so the surface still reads as "feature exists, not ready yet"
          instead of looking dead. */}
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          layoutId="cockpit-create"
          icon={<Sparkles className="h-12 w-12" strokeWidth={1.5} />}
          title="Create"
          subtitle="paste a link · drop a video"
          onClick={onCreate}
          reduced={!!reduced}
          delay={0}
        />
        <Tile
          layoutId="cockpit-import"
          icon={<Layers className="h-12 w-12" strokeWidth={1.5} />}
          title="Import"
          subtitle="bring in ready clips"
          onClick={onImport}
          reduced={!!reduced}
          delay={0.15}
          busy={importing}
          busyLabel="preparing…"
        />
        <Tile
          layoutId="cockpit-thumbnails"
          icon={<ImageIcon className="h-12 w-12" strokeWidth={1.5} />}
          title="Thumbnails"
          subtitle="cover pack from one frame"
          onClick={onThumbnails ?? (() => undefined)}
          disabled={!onThumbnails}
          reduced={!!reduced}
          delay={0.3}
        />
        <Tile
          layoutId="cockpit-script"
          icon={<ScrollText className="h-12 w-12" strokeWidth={1.5} />}
          title="Script"
          subtitle="transcript · captions ready"
          onClick={onScript ?? (() => undefined)}
          disabled={!onScript}
          reduced={!!reduced}
          delay={0.45}
        />
      </div>

      {/* v0.7.1 — Sponsored rewards banners surface on the home screen
          too, not just the Earn page. Reads campaigns from the live
          backend; renders skeleton on load + an honest retry tile on
          failure. Tier prop gates which banners show as locked. */}
      <div className="w-full max-w-[1080px] px-4">
        <SponsoredBannerCarousel tier={userTier} />
      </div>

      {/* P0 #6 — inline ephemeral error for rejected drops. Mounted under
          the tiles so it doesn't push the centered layout around. */}
      <AnimatePresence>
        {dropError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            role="alert"
            className="rounded-full border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-2 font-mono text-[11px] text-[var(--color-danger)]"
          >
            {dropError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* P0 #5 — Visible drop affordance. Mounted as a full-room overlay so a
          user dragging a file from Finder sees an explicit target instead of
          a blank surface. Cyan dashed border (cockpit accent), centered hint,
          and the Invader sprite as the "drop here" landmark.
          pointer-events-none so it never steals clicks from the tiles when a
          ghost drag event lingers. */}
      <AnimatePresence>
        {dragHoverActive && (
          <motion.div
            data-drop-target="workstation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="pointer-events-none fixed inset-4 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-cyan-400 bg-cyan-400/5 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              {/* Invader sprite as the landmark — simple inline SVG so we
                  don't have to plumb the canvas/sprite asset over from the
                  invaders module. Matches the splash game's geometric
                  invader look. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 16"
                className="h-10 w-14 fill-cyan-400 drop-shadow-[0_0_18px_rgba(34,211,238,0.65)]"
              >
                <rect x="3" y="2" width="2" height="2" />
                <rect x="19" y="2" width="2" height="2" />
                <rect x="5" y="4" width="14" height="2" />
                <rect x="3" y="6" width="2" height="2" />
                <rect x="7" y="6" width="2" height="2" />
                <rect x="15" y="6" width="2" height="2" />
                <rect x="19" y="6" width="2" height="2" />
                <rect x="3" y="8" width="18" height="2" />
                <rect x="5" y="10" width="2" height="2" />
                <rect x="9" y="10" width="6" height="2" />
                <rect x="17" y="10" width="2" height="2" />
                <rect x="1" y="12" width="2" height="2" />
                <rect x="7" y="12" width="2" height="2" />
                <rect x="15" y="12" width="2" height="2" />
                <rect x="21" y="12" width="2" height="2" />
              </svg>
              <span className="font-mono text-[12px] uppercase tracking-[0.24em] text-cyan-300">
                Drop a video to start
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/70">
                MP4 · MOV · MKV · WEBM
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
  /** v0.7.1 — placeholder tiles (Thumbnails / Script) when the feature
   *  isn't wired yet. Dims the tile + suppresses hover/tap motion + adds
   *  a small "soon" pill so users read it as "coming" not "broken". */
  disabled?: boolean;
  /** ship-lens v0.7.13 T1.3 — true while the parent action is in flight
   *  (e.g. handleImportDirect waiting on the OS file picker + sidecar
   *  importReadyClips). Suppresses clicks via pointer-events-none AND
   *  the onClick guard, dims to opacity-50, and renders busyLabel as a
   *  pill at the top of the tile. Independent of `disabled` because the
   *  semantic differs — disabled = feature not yet wired, busy = wired
   *  but in flight. */
  busy?: boolean;
  busyLabel?: string;
}) {
  // ship-lens v0.7.13 T1.3 — busy is treated like disabled for the
  // interactive surface (no hover lift, no click) but the visual cue is
  // a "preparing…" pill instead of the "soon" pill so the user reads it
  // as work-in-progress not feature-missing.
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
      {/* HUD bracket corners — fuchsia dashed, only at the four corners.
          No background fill, no full outline; the icon hovers in space and
          the brackets read as a targeting reticle around it. */}
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

      {/* Ambient halo — fuchsia glow behind the icon. No background plate. */}
      <span aria-hidden="true" className="cockpit-tile-halo" />

      <span className="cockpit-tile-glyph relative z-10 text-fuchsia">
        {icon}
      </span>
      <span className="relative z-10 flex flex-col items-center gap-1">
        <span className="font-display text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {title}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {subtitle}
        </span>
      </span>
    </motion.button>
  );
}
