/**
 * ReactionControls · Phase 6D
 *
 * Apple-style floating panel for split-screen / reaction layout pickers.
 * Uses the 8 approved split-screen SVGs already in
 * /public/brand/icons/action/split-screen/.
 *
 * Layout selection is local state — applying a layout fires a stub toast
 * (real layered render needs sidecar runtime). Tier-gated chips per the
 * 2026-06-23 monetisation ladder: local `tier: "solo"` items now display
 * as "Pro+" CTAs (Free Clipper → Pro $29), and local `tier: "pro"` items
 * display as "Growth+" CTAs (Pro → Growth $79). Local Tier names are
 * preserved for compatibility with existing data tags; only the
 * user-facing copy maps to the new ladder.
 */

import { useState } from "react";
import { GlassCard } from "../components";
import { bus } from "../bridge";
// BUG-008 · Train A2 (2026-07-12) · canonical tier read.
import { useCanonicalStudioTier } from "../state/useTierCaps";
import "./ReactionControls.css";

export type ReactionLayoutId =
  | "side-by-side"
  | "top-bottom"
  | "facecam-corner"
  | "reaction-under-clip"
  | "before-after"
  | "green-screen"
  | "podcast-commentary"
  | "quote-reaction";

// 2026-06-23 · vocab aligned with useTierCaps. Old "solo" (pre-rename name
// for the first paid tier) bumped to "pro". Old "pro" (advanced tier)
// bumped to "growth". "free" kept as alias for "clipper" since this
// local Tier is used for layout-gating logic, not user-visible labels.
// SOVEREIGN-2.2 · retires when useTierCaps becomes the only source.
export type Tier = "free" | "pro" | "growth" | "agency";

interface LayoutSpec {
  id: ReactionLayoutId;
  label: string;
  tier: Tier;
  svg: string;
  hint: string;
}

const LAYOUTS: ReadonlyArray<LayoutSpec> = [
  { id: "facecam-corner",      label: "Facecam corner",      tier: "free",  svg: "/brand/icons/action/split-screen/facecam-corner.svg",       hint: "Small face overlay · classic talking-head" },
  { id: "side-by-side",        label: "Side-by-side",        tier: "free",  svg: "/brand/icons/action/split-screen/side-by-side.svg",          hint: "Equal split · reaction vs clip" },
  { id: "top-bottom",          label: "Top / bottom",        tier: "free",  svg: "/brand/icons/action/split-screen/top-bottom.svg",            hint: "Stacked · reaction above, clip below" },
  { id: "reaction-under-clip", label: "Reaction under clip", tier: "pro",    svg: "/brand/icons/action/split-screen/reaction-under-clip.svg",   hint: "TikTok-native reaction layout" },
  { id: "before-after",        label: "Before / after",      tier: "pro",    svg: "/brand/icons/action/split-screen/before-after.svg",          hint: "Transition reveal · 2-state morph" },
  { id: "green-screen",        label: "Green screen",        tier: "growth", svg: "/brand/icons/action/split-screen/green-screen.svg",          hint: "Chroma key behind facecam" },
  { id: "podcast-commentary",  label: "Podcast commentary",  tier: "growth", svg: "/brand/icons/action/split-screen/podcast-commentary.svg",    hint: "Audio-anchored visual cue" },
  { id: "quote-reaction",      label: "Quote reaction",      tier: "growth", svg: "/brand/icons/action/split-screen/quote-reaction.svg",        hint: "Pull-quote card with reaction" },
];

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, growth: 2, agency: 3 };

export interface ReactionControlsProps {
  /** Initial selection. */
  initialLayoutId?: ReactionLayoutId;
  onChange?: (id: ReactionLayoutId) => void;
}

export function ReactionControls({
  initialLayoutId = "facecam-corner",
  onChange,
}: ReactionControlsProps) {
  // BUG-008 · Train A2 (2026-07-12) · canonical tier read replaces
  // the ``userTier?: Tier`` prop with a ``"free"`` default. Every
  // caller (TimelineStudio, future editor surfaces) now reads the
  // same source through this hook — one writer, no drift.
  const userTier: Tier = useCanonicalStudioTier();
  const [selected, setSelected] = useState<ReactionLayoutId>(initialLayoutId);
  const [hovered, setHovered] = useState<ReactionLayoutId | null>(null);

  const activeHint = LAYOUTS.find((l) => l.id === (hovered ?? selected))?.hint ?? "";

  const onSelect = (l: LayoutSpec) => {
    if (TIER_RANK[userTier] < TIER_RANK[l.tier]) {
      // Pricing pivot 2026-07-06 · every paid layout unlocks at Agency
      // ($99.99/mo). No Pro+/Growth+ leaks while those tiers are deferred.
      bus.emit("toast", {
        kind: "warning",
        title: "Layout locked",
        body: `${l.label} unlocks with Agency · $99.99/mo.`,
      });
      return;
    }
    setSelected(l.id);
    // Ship-lens Batch 3 (Dead-button audit · 2026-07-06) · dropped
    // the trailing "Preview only · bake lands with sidecar runtime"
    // info toast. `onChange` is the host wire · when the caller
    // wires it (persists / bakes via sidecar) the layout change is
    // real; when they don't, firing a toast that promises "bake"
    // later is a lie. Silent-select is honest: the local UI state
    // updates, the host wire (or absence of one) decides everything
    // else.
    onChange?.(l.id);
  };

  return (
    <GlassCard density="default" className="lc-rxn">
      <header className="lc-rxn-head">
        <span className="lc-rxn-eb">Reaction layout</span>
        <span className="lc-rxn-active" title={LAYOUTS.find((l) => l.id === selected)?.label}>
          {LAYOUTS.find((l) => l.id === selected)?.label ?? "—"}
        </span>
      </header>

      <div className="lc-rxn-grid">
        {LAYOUTS.map((l) => {
          const locked = TIER_RANK[userTier] < TIER_RANK[l.tier];
          const active = selected === l.id;
          return (
            <button
              key={l.id}
              type="button"
              className={`lc-rxn-tile ${active ? "is-active" : ""} ${locked ? "is-locked" : ""}`}
              onClick={() => onSelect(l)}
              onMouseEnter={() => setHovered(l.id)}
              onMouseLeave={() => setHovered(null)}
              aria-label={`${l.label}${locked ? ` (locked · ${l.tier}+ tier)` : ""}`}
              title={locked ? `${l.label} · ${l.tier}+ tier` : l.label}
            >
              <span className="lc-rxn-thumb">
                <img src={l.svg} alt="" draggable={false} />
                {locked && (
                  <span className="lc-rxn-lock" aria-hidden="true">
                    <LockGlyph />
                  </span>
                )}
              </span>
              <span className="lc-rxn-label">{l.label}</span>
              {l.tier !== "free" && (
                <span className={`lc-rxn-tier lc-rxn-tier-${l.tier}`}>
                  {l.tier.toUpperCase()}+
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="lc-rxn-hint">{activeHint}</p>
    </GlassCard>
  );
}

function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
