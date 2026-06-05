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

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Sparkles, Layers } from "lucide-react";

export function WorkstationRoom({
  onCreate,
  onImport,
}: {
  /** Single-click Create: opens the compact URL/file portal. The portal
   *  auto-focuses its URL input — no second click to start typing. */
  onCreate: () => void;
  /** Single-click Import: fires the OS file picker directly. No modal in
   *  between — the picker IS the next surface. */
  onImport: () => void;
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

      <div className="grid grid-cols-2 gap-8">
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
        />
      </div>
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
}: {
  layoutId: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  reduced: boolean;
  delay: number;
}) {
  return (
    <motion.button
      layoutId={layoutId}
      type="button"
      onClick={onClick}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.92 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={
        reduced
          ? { duration: 0.18 }
          : { delay, type: "spring", stiffness: 280, damping: 26 }
      }
      whileHover={
        reduced
          ? undefined
          : { scale: 1.04, transition: { type: "spring", stiffness: 360, damping: 22 } }
      }
      whileTap={reduced ? undefined : { scale: 0.96 }}
      className="cockpit-tile group relative flex h-[220px] w-[220px] flex-col items-center justify-center gap-3 bg-transparent outline-none"
      aria-label={`${title} — ${subtitle}`}
    >
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
