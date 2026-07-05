/**
 * OverlayTemplateGallery · Phase 6D
 *
 * Watermark + campaign overlay controls. Ported from
 * desktop/src/components/OverlayTemplateGallery.tsx (template list shape +
 * tier gate) and the watermark toggle pattern in BottomCockpit.
 *
 * Rules under the 2026-06-23 monetisation ladder
 * (Free Clipper / Pro $29 / Growth $79 / Agency $500):
 *   - Free users: "Liquid Clips" watermark is LOCKED on (cannot disable).
 *   - Pro+ ($29): watermark can be removed.
 *   - Growth+ ($79): campaign-safe overlays unlocked.
 *   - Campaign-stamped clips (clip.overlay set by the engine) display the
 *     campaign chip — never replaceable mid-bake.
 *
 * Local `tier: "solo"` rows display as "Pro+" CTAs; local `tier: "pro"`
 * rows display as "Growth+" CTAs. Local Tier names preserved for
 * compatibility with existing data tags.
 */

import { useState } from "react";
import { GlassCard } from "../components";
import { bus } from "../bridge";
import type { Tier } from "./ReactionControls";
// C1-T5 · 2026-07-05 · real paywall trigger. Was a dead
// bus.emit("toast", …) with copy that never charged anyone.
import { useWatermarkRemovalPaywall } from "../../lib/useWatermarkRemovalPaywall";
import { WatermarkTrialConfirmModal } from "../../components/paywall/WatermarkTrialConfirmModal";
import "./OverlayTemplateGallery.css";

export type OverlayTemplateId =
  | "none"
  | "logo-corner"
  | "lower-third-pill"
  | "title-card"
  | "campaign-stamped";

interface OverlaySpec {
  id: OverlayTemplateId;
  label: string;
  tier: Tier;
  description: string;
}

// 2026-06-23 · tier vocab cleanup: solo→pro, pro→growth (Tier union lost "solo")
const TEMPLATES: ReadonlyArray<OverlaySpec> = [
  { id: "none",              label: "Clean clip",        tier: "pro",    description: "No overlay · pure clip · Pro+ removes the Liquid watermark." },
  { id: "logo-corner",       label: "Logo corner",       tier: "pro",    description: "Custom logo bottom-right · 64px · safe-area honoured." },
  { id: "lower-third-pill",  label: "Lower-third pill",  tier: "growth", description: "Title / handle / role pill bottom-third · auto-shrinks for caption clash." },
  { id: "title-card",        label: "Title card",        tier: "growth", description: "3s opener card · Geist Mono eyebrow · animated wipe." },
  { id: "campaign-stamped",  label: "Campaign stamped",  tier: "free",   description: "Auto-applied when this clip belongs to an active campaign · cannot be replaced." },
];

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, growth: 2, agency: 3 };

export interface OverlayTemplateGalleryProps {
  userTier?: Tier;
  /** Set by the engine when a campaign clip is selected — locks campaign-stamped template. */
  campaignSlug?: string | null;
  initialOverlayId?: OverlayTemplateId;
}

export function OverlayTemplateGallery({
  userTier = "free",
  campaignSlug = null,
  initialOverlayId,
}: OverlayTemplateGalleryProps) {
  const defaultOverlay: OverlayTemplateId = campaignSlug ? "campaign-stamped" : (initialOverlayId ?? "none");
  const [selected, setSelected] = useState<OverlayTemplateId>(defaultOverlay);

  // 2026-06-23 · "pro" is the entry-paid tier (was "solo" pre-rename)
  const watermarkLocked = TIER_RANK[userTier] < TIER_RANK.pro;
  // Free users only: cannot toggle watermark off. Pro+ ($29) defaults to off.
  const [watermarkOn, setWatermarkOn] = useState(watermarkLocked || false);

  // C1-T5 · shared paywall trigger. Free clipper → Whop checkout ·
  // trial-active → confirmation modal + POST /me/trial/approve.
  const paywall = useWatermarkRemovalPaywall();

  const onSelectTemplate = (t: OverlaySpec) => {
    // Campaign clips can NEVER be replaced from this picker.
    if (campaignSlug) {
      bus.emit("toast", {
        kind: "warning",
        title: "Campaign overlay",
        body: "This clip is campaign-stamped — overlay is locked.",
      });
      return;
    }
    if (TIER_RANK[userTier] < TIER_RANK[t.tier]) {
      // 2026-06-23 ladder: pro→Pro+, growth→Growth+.
      const requiredLabel = t.tier === "pro" ? "Pro+" : t.tier === "growth" ? "Growth+" : "Agency";
      bus.emit("toast", {
        kind: "warning",
        title: "Overlay locked",
        body: `${t.label} unlocks at ${requiredLabel} tier.`,
      });
      return;
    }
    setSelected(t.id);
    bus.emit("toast", {
      kind: "info",
      title: "Overlay",
      body: "Preview only · bake lands with sidecar runtime.",
    });
  };

  return (
    <GlassCard density="default" className="lc-otg">
      <header className="lc-otg-head">
        <span className="lc-otg-eb">Overlay</span>
        <span className="lc-otg-active">
          {TEMPLATES.find((t) => t.id === selected)?.label ?? "Clean clip"}
          {campaignSlug && <span className="lc-otg-camp-pill">Campaign · {campaignSlug}</span>}
        </span>
      </header>

      <ul className="lc-otg-list">
        {TEMPLATES.map((t) => {
          const locked = TIER_RANK[userTier] < TIER_RANK[t.tier];
          const campaignForced = campaignSlug && t.id !== "campaign-stamped";
          const active = selected === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`lc-otg-row ${active ? "is-active" : ""} ${(locked || campaignForced) ? "is-locked" : ""}`}
                onClick={() => onSelectTemplate(t)}
                disabled={!!campaignForced}
                title={t.label}
              >
                <span className="lc-otg-radio" aria-hidden="true">{active ? "●" : "○"}</span>
                <div className="lc-otg-body">
                  <span className="lc-otg-label">{t.label}</span>
                  <span className="lc-otg-desc">{t.description}</span>
                </div>
                {t.tier !== "free" && (
                  <span className={`lc-otg-tier lc-otg-tier-${t.tier}`}>
                    {/* 2026-06-23 monetisation pass · local-tier → user-facing badge */}
                    {t.tier === "pro" ? "PRO+" : t.tier === "growth" ? "GROWTH+" : t.tier.toUpperCase()}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Watermark toggle */}
      <div className="lc-otg-watermark">
        <div className="lc-otg-watermark-body">
          <span className="lc-otg-watermark-eb">Liquid watermark</span>
          <span className="lc-otg-watermark-sub">
            {watermarkLocked
              ? "Locked on for Free · upgrade to Pro for clean exports."
              : watermarkOn
                ? "Visible bottom-left of every export."
                : "Off · clean export."}
          </span>
        </div>
        <button
          type="button"
          className={`lc-otg-watermark-toggle ${watermarkOn ? "is-on" : ""} ${watermarkLocked ? "is-locked" : ""}`}
          onClick={() => {
            if (watermarkLocked) {
              // C1-T5 · was `bus.emit("toast", …)` dead nudge.
              // Now: Free clipper → Whop checkout via
              // bus.emit("auth:open-panel"); trial-active →
              // confirmation modal → POST /me/trial/approve.
              paywall.trigger("OverlayTemplateGallery");
              return;
            }
            setWatermarkOn((v) => !v);
          }}
          aria-pressed={watermarkOn}
          aria-label="Toggle Liquid watermark"
          data-testid="watermark-toggle"
        >
          <span className="lc-otg-watermark-knob" aria-hidden="true" />
        </button>
      </div>
      <WatermarkTrialConfirmModal paywall={paywall} />
    </GlassCard>
  );
}
