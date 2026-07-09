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

import { useEffect, useRef, useState } from "react";
import { GlassCard } from "../components";
import { bus } from "../bridge";
import type { Tier } from "./ReactionControls";
// C1-T5 · 2026-07-05 · real paywall trigger. Was a dead
// bus.emit("toast", …) with copy that never charged anyone.
import { AssetRansomPaywall } from "../../components/paywall/AssetRansomPaywall";
// cp-16 · 2026-07-06 · self-healing wrapper. Sovereign-Operator Protocol —
// a picker failure renders a KadeRepairScreen instead of crashing Studio,
// and HQ Admin gets a FailureRecord for the Intercession LLM.
import { Watchdog } from "../../lib/watchdog/Watchdog";
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

// Pricing pivot 2026-07-06 · every paid overlay unlocks at Agency
// ($99.99/mo) — the sole paid plan today. Local tier keys retained for
// TIER_RANK ordering compatibility but user-visible copy points at Agency.
const TEMPLATES: ReadonlyArray<OverlaySpec> = [
  { id: "none",              label: "Clean clip",        tier: "pro",    description: "No overlay · pure clip · Agency removes the Liquid watermark." },
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
  /**
   * Ship-lens Batch 3 P1-BATCH3-006 fix (2026-07-06). When the host
   * wires `onChange`, the picked overlay id gets persisted / baked
   * via the caller. When omitted, selection is local-only · the
   * gallery no longer emits a misleading "preview only · bake lands
   * with sidecar runtime" toast.
   */
  onChange?: (id: OverlayTemplateId) => void;
}

export function OverlayTemplateGallery({
  userTier = "free",
  campaignSlug = null,
  initialOverlayId,
  onChange,
}: OverlayTemplateGalleryProps) {
  const defaultOverlay: OverlayTemplateId = campaignSlug ? "campaign-stamped" : (initialOverlayId ?? "none");
  const [selected, setSelected] = useState<OverlayTemplateId>(defaultOverlay);

  // 2026-06-23 · "pro" is the entry-paid tier (was "solo" pre-rename)
  const watermarkLocked = TIER_RANK[userTier] < TIER_RANK.pro;
  // Free users only: cannot toggle watermark off. Pro+ ($29) defaults to off.
  const [watermarkOn, setWatermarkOn] = useState(watermarkLocked || false);

  // 2026-07-07 · unified ransom-paywall pattern (replaces C1-T5
  // useWatermarkRemovalPaywall). Toggle-off on free tier fires ransom;
  // on unlock tier flips to agency and watermark removal takes effect.
  const [ransomOpen, setRansomOpen] = useState(false);

  // cp-16 · 2026-07-06 · silent-select audit fix.
  // Batch 3 dropped the misleading "Preview only · bake lands with sidecar
  // runtime" toast. Ship-lens flagged the resulting no-signal state YELLOW.
  // We replace the lie with an honest, dismissible "Picked · {label}" pill
  // + a fuchsia pulse ring / checkmark tick on the just-selected row.
  // The pill uses a CSS keyframe (200ms slide-down, 1.5s auto-dismiss)
  // that echoes the Remotion visual language without spinning up a full
  // composition for a micro-interaction.
  const [pickedPill, setPickedPill] = useState<{ id: OverlayTemplateId; label: string } | null>(
    null,
  );
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
    };
  }, []);

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
      // Pricing pivot 2026-07-06 · every paid overlay unlocks at Agency
      // ($99.99/mo). No Pro+/Growth+ leaks while those tiers are deferred.
      bus.emit("toast", {
        kind: "warning",
        title: "Overlay locked",
        body: `${t.label} unlocks with Agency · $99.99/mo.`,
      });
      return;
    }
    setSelected(t.id);
    // cp-16 · 2026-07-06 · surface an unambiguous "I did the thing" signal.
    // The row already animates via the .is-active class transition; the
    // pill is the second, non-modal confirmation that auto-dismisses.
    setPickedPill({ id: t.id, label: t.label });
    if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
    pillTimerRef.current = setTimeout(() => setPickedPill(null), 1500);
    // Ship-lens Batch 3 P1-BATCH3-006 fix (2026-07-06) · dropped the
    // "Preview only · bake lands with sidecar runtime" info toast.
    // Same pattern as CaptionDrawer / StudioTimelineRail / ReactionControls:
    // silent selection is honest, the host wire (or absence of one)
    // owns whether the choice persists / bakes. onChange callback
    // remains the wire-in point for a real overlay pick.
    onChange?.(t.id);
  };

  return (
    <Watchdog
      id="pipeline/cp-16/overlay-gallery"
      label="Overlay template picker"
      cluster="pipeline"
      source="design-os/studio/OverlayTemplateGallery.tsx:143"
    >
      <GlassCard density="default" className="lc-otg">
      {/* cp-16 · picked-confirmation pill (200ms slide-down · auto-dismiss 1.5s) */}
      {pickedPill && (
        <div
          className="lc-otg-picked-pill"
          role="status"
          aria-live="polite"
          data-testid="overlay-picked-pill"
          key={pickedPill.id}
        >
          <span className="lc-otg-picked-pill-tick" aria-hidden="true">✓</span>
          <span className="lc-otg-picked-pill-label">Picked · {pickedPill.label}</span>
        </div>
      )}

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
                <span className="lc-otg-radio" aria-hidden="true">
                  {active ? "●" : "○"}
                  {/* cp-16 · fuchsia pulse ring + checkmark drop on the just-picked row */}
                  {active && <span className="lc-otg-tick" aria-hidden="true">✓</span>}
                </span>
                <div className="lc-otg-body">
                  <span className="lc-otg-label">{t.label}</span>
                  <span className="lc-otg-desc">{t.description}</span>
                </div>
                {t.tier !== "free" && (
                  <span className={`lc-otg-tier lc-otg-tier-${t.tier}`}>
                    {/* Pricing pivot 2026-07-06 · every paid tier badge
                        collapses to "AGENCY" — the sole paid plan today. */}
                    AGENCY
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
              ? "Locked on for Free · upgrade to Agency for clean exports."
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
              setRansomOpen(true);
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
        <AssetRansomPaywall
          trigger="watermark-removal"
          isOpen={ransomOpen}
          assetPreview={{
            kind: "node",
            content: (
              <div style={{ padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 14, opacity: 0.72, marginBottom: 4 }}>Overlay</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>
                  Clean clip · watermark off
                </div>
              </div>
            ),
          }}
          onDismiss={() => setRansomOpen(false)}
          onUnlocked={async () => {
            setRansomOpen(false);
            setWatermarkOn(false);
          }}
        />
      </GlassCard>
    </Watchdog>
  );
}
