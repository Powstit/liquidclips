/**
 * ExportPanel · Phase 6D → C1-T3 real
 *
 * P0-03 (Claude 1 split · 2026-07-06) · Phase 6D "studio preview · not
 * real" copy retired. C1-T3 landed the real sidecar export at
 * `method_export_clip` (2026-07-05 · commit c766548). ExportPanel
 * still has two mount surfaces (TimelineStudio · ExportRoute) so it's
 * NOT deleted · it's the panel that surfaces format/preset/watermark
 * choices before the actual export runs.
 *
 * Behaviour today:
 *   - When the host wires `onExport`, click routes to the real
 *     `exportApi.exportClip` runner via the caller (see ExportRoute).
 *   - Without `onExport` (preview / demo / storybook), a user-facing
 *     toast points the user at the Workstation to run a real export
 *     (Ship-lens P2-003 fix · 2026-07-06). Prior copy leaked
 *     engineer voice about "onExport handler from host".
 *
 * Free users see a locked watermark notice + a clear upgrade route.
 */

import { useState } from "react";
import { GlassCard } from "../components";
import { bus, useEvent } from "../bridge";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import type { Clip, Platform } from "../engine/types";
import type { Tier } from "./ReactionControls";
// C1-T5 · 2026-07-05 · "Upgrade to remove" affordance next to the
// locked watermark line · uses the same shared paywall trigger the
// OverlayTemplateGallery toggle wires to.
import { useWatermarkRemovalPaywall } from "../../lib/useWatermarkRemovalPaywall";
import { WatermarkTrialConfirmModal } from "../../components/paywall/WatermarkTrialConfirmModal";
import "./ExportPanel.css";

export type ExportFormat = "9:16" | "1:1" | "16:9" | "original";
export type ExportPreset = "tiktok" | "reels" | "shorts" | "linkedin" | "custom";

const FORMATS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: "9:16",     label: "9:16 vertical",  hint: "Reels / TikTok / Shorts" },
  { id: "1:1",      label: "1:1 square",     hint: "Instagram feed · X" },
  { id: "16:9",     label: "16:9 widescreen", hint: "YouTube · LinkedIn" },
  { id: "original", label: "Original",       hint: "Source aspect, no crop" },
];

// 2026-06-23 · tier vocab aligned with useTierCaps via ReactionControls.Tier.
// LinkedIn preset bumped solo→pro (solo was the pre-rename label for pro).
// Custom preset bumped pro→growth (advanced tier in the new ladder).
const PRESETS: Array<{ id: ExportPreset; label: string; tier: Tier; platforms: Platform[] }> = [
  { id: "tiktok",   label: "TikTok",    tier: "free",   platforms: ["tiktok"] },
  { id: "reels",    label: "Reels",     tier: "free",   platforms: ["instagram"] },
  { id: "shorts",   label: "Shorts",    tier: "free",   platforms: ["youtube"] },
  { id: "linkedin", label: "LinkedIn",  tier: "pro",    platforms: ["linkedin"] },
  { id: "custom",   label: "Custom",    tier: "growth", platforms: [] },
];

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, growth: 2, agency: 3 };

export interface ExportPanelProps {
  clip: Clip | null;
  userTier?: Tier;
  initialFormat?: ExportFormat;
  initialPreset?: ExportPreset;
  /** Phase 6H · override watermark-locked from the host (driven by useTierCaps).
   *  When omitted, falls back to the legacy `userTier < solo` check. */
  watermarkLockedOverride?: boolean;
  /** Phase 6H · host-supplied export action. When provided, replaces the
   *  Phase 6D "Studio preview" toast with a real call. */
  onExport?: (params: { format: ExportFormat; preset: ExportPreset; watermark: boolean }) => void;
  /** Phase 6H · open the studio Caption Drawer from this panel. */
  onOpenCaptions?: () => void;
  /** Phase 6H · open the overlay template gallery from this panel. */
  onOpenOverlay?: () => void;
}

export function ExportPanel({
  clip, userTier = "free", initialFormat = "9:16", initialPreset = "tiktok",
  watermarkLockedOverride,
  onExport, onOpenCaptions, onOpenOverlay,
}: ExportPanelProps) {
  const runtime = useRuntimeInfo();
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [preset, setPreset] = useState<ExportPreset>(initialPreset);
  const [pretending, setPretending] = useState<{ progress: number } | null>(null);

  // Drive a fake render bar on click — purely visual, no file write.
  useEvent("engine:progress", (p) => {
    if (p.stage === "bake" && p.percent != null && pretending) {
      setPretending({ progress: p.percent });
    }
  });

  const isMock = runtime.mode === "mock";
  // Free tier has watermark locked on; first paid tier (pro) unlocks it.
  const watermarkLocked = watermarkLockedOverride ?? (TIER_RANK[userTier] < TIER_RANK.pro);
  const watermarkOn = watermarkLocked; // Free: forced on. Pro+: off (toggleable later)

  // C1-T5 · shared paywall trigger. Fires the same flow as the
  // OverlayTemplateGallery watermark toggle: Free → Whop checkout ·
  // trial-active → confirmation modal → POST /me/trial/approve.
  const paywall = useWatermarkRemovalPaywall();

  const canClick = !!clip;

  const onClickExport = () => {
    if (!clip) return;
    if (onExport) {
      onExport({ format, preset, watermark: watermarkOn });
      return;
    }
    // P0-03 · C1-T3 real export handler landed 2026-07-05 · P2-003 fix
    // 2026-07-06 · user-facing toast copy (previously engineer-speak
    // about "onExport handler from host"). This branch fires when the
    // panel is mounted outside its normal export flow (studio preview,
    // storybook, deep-link). Direct the user to the Workstation where
    // the real export runner is wired.
    if (isMock) {
      bus.emit("toast", {
        kind: "info",
        title: "Preview mode",
        body: "Open this clip from the Workstation to run a real export.",
      });
      return;
    }
    bus.emit("toast", {
      kind: "info",
      title: "Export not available here",
      body: "Publish from the Workstation to run the export pipeline.",
    });
  };

  return (
    <GlassCard density="default" className="lc-exp">
      <header className="lc-exp-head">
        <span className="lc-exp-eb">Export</span>
        {isMock && (
          <span className="lc-exp-mode">Preview mode</span>
        )}
      </header>

      {/* Format chips */}
      <section className="lc-exp-section">
        <span className="lc-exp-section-eb">Format</span>
        <div className="lc-exp-formats">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`lc-exp-format ${format === f.id ? "is-active" : ""}`}
              onClick={() => setFormat(f.id)}
              title={f.hint}
            >
              <span className="lc-exp-format-label">{f.label}</span>
              <span className="lc-exp-format-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Preset chips */}
      <section className="lc-exp-section">
        <span className="lc-exp-section-eb">Preset</span>
        <div className="lc-exp-presets">
          {PRESETS.map((p) => {
            const locked = TIER_RANK[userTier] < TIER_RANK[p.tier];
            return (
              <button
                key={p.id}
                type="button"
                className={`lc-exp-preset ${preset === p.id ? "is-active" : ""} ${locked ? "is-locked" : ""}`}
                onClick={() => {
                  if (locked) {
                    // 2026-06-23 ladder: pro→Pro+, growth→Growth+.
                    const requiredLabel = p.tier === "pro" ? "Pro+" : p.tier === "growth" ? "Growth+" : "Agency";
                    bus.emit("toast", {
                      kind: "warning",
                      title: "Preset locked",
                      body: `${p.label} unlocks at ${requiredLabel} tier.`,
                    });
                    return;
                  }
                  setPreset(p.id);
                }}
                aria-pressed={preset === p.id}
              >
                {p.label}
                {p.tier !== "free" && (
                  <span className="lc-exp-preset-tier">
                    {/* 2026-06-23 ladder mapping for display */}
                    {" · "}{p.tier === "pro" ? "Pro+" : p.tier === "growth" ? "Growth+" : `${p.tier}+`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Watermark line */}
      <div className="lc-exp-watermark">
        <span className="lc-exp-watermark-dot" aria-hidden="true" />
        <span className="lc-exp-watermark-body">
          {watermarkLocked
            ? "Liquid watermark locked on (Free tier)."
            : "Watermark off · clean export."}
        </span>
        {watermarkLocked && (
          <button
            type="button"
            className="lc-exp-watermark-upgrade"
            onClick={() => paywall.trigger("ExportPanel")}
            data-testid="watermark-upgrade-cta"
            style={{
              marginLeft: "auto",
              padding: "4px 12px",
              borderRadius: 999,
              border: "1px solid var(--color-fuchsia, #ff1a8c)",
              background: "var(--color-fuchsia, #ff1a8c)",
              color: "var(--color-paper, #14141b)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {paywall.isTrialActive ? "Charge now →" : "Upgrade to remove →"}
          </button>
        )}
      </div>
      <WatermarkTrialConfirmModal paywall={paywall} />

      {/* Phase 6H · Drawer/Gallery shortcuts when host provides them */}
      {(onOpenCaptions || onOpenOverlay) && (
        <div className="lc-exp-drawers">
          {onOpenCaptions && (
            <button
              type="button"
              className="lc-exp-drawer-btn"
              onClick={onOpenCaptions}
              disabled={!clip}
            >
              <span className="lc-exp-drawer-eb">Edit</span>
              <span>Caption style</span>
            </button>
          )}
          {onOpenOverlay && (
            <button
              type="button"
              className="lc-exp-drawer-btn"
              onClick={onOpenOverlay}
              disabled={!clip}
            >
              <span className="lc-exp-drawer-eb">Pick</span>
              <span>Overlay layout</span>
            </button>
          )}
        </div>
      )}

      {/* Big CTA */}
      <button
        type="button"
        className="lc-exp-cta"
        disabled={!canClick}
        onClick={onClickExport}
      >
        {!clip
          ? "Pick a clip first"
          : onExport
            ? `Render ${format} · ${preset}`
            : isMock
              ? "Preview mode · Publish from Workstation to run a real export"
              : "Export clip"}
      </button>

      {!isMock && (
        <p className="lc-exp-foot">
          Real export wiring lands after the sidecar runtime is installed.
        </p>
      )}
    </GlassCard>
  );
}
