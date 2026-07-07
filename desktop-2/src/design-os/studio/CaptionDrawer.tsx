/**
 * CaptionDrawer · Phase 6D
 *
 * Ported from desktop/src/components/captions/CaptionDrawer.tsx. Phase 6D
 * keeps the 8 pre-built style palettes + position picker + apply pattern.
 * Color picker simplified to a hue slider (no external lib).
 *
 * Uses the Design OS Drawer primitive. Dirty-state guard fires onDirtyClose
 * when the user has unsaved edits.
 *
 * Apply does NOT trigger a real caption bake — sidecar runtime would be
 * required. Apply is wired to a toast so the user knows the change is
 * preview-only in Phase 6D.
 */

import { useState, useEffect } from "react";
import { Drawer } from "../components";
// Ransom-paywall (Max · trigger #3 · 2026-07-07)
import { AssetRansomPaywall } from "../../components/paywall/AssetRansomPaywall";
import {
  decrementGuestClipsRemaining,
  isGuestQuotaExhausted,
} from "../routes/WelcomeRoute";
import { useTierCaps } from "../state/useTierCaps";
import "./CaptionDrawer.css";

export type CaptionStyle =
  | "fuchsia-pop" | "cyan-bold" | "amber-soft" | "white-clean"
  | "neon-strike" | "outline-only" | "highlight-block" | "drop-shadow";

export type CaptionPosition = "top" | "middle" | "bottom";

const STYLE_PRESETS: Array<{ id: CaptionStyle; label: string; preview: string; bg: string; fg: string }> = [
  { id: "fuchsia-pop",     label: "Fuchsia pop",     preview: "Aa", bg: "#ff1a8c", fg: "#ffffff" },
  { id: "cyan-bold",       label: "Cyan bold",       preview: "Aa", bg: "#07c7e0", fg: "#040414" },
  { id: "amber-soft",      label: "Amber soft",      preview: "Aa", bg: "#f59e0b", fg: "#1a1208" },
  { id: "white-clean",     label: "White clean",     preview: "Aa", bg: "#ffffff", fg: "#0b0b10" },
  { id: "neon-strike",     label: "Neon strike",     preview: "Aa", bg: "#000000", fg: "#39ff14" },
  { id: "outline-only",    label: "Outline only",    preview: "Aa", bg: "transparent", fg: "#ffffff" },
  { id: "highlight-block", label: "Highlight block", preview: "Aa", bg: "#ffd60a", fg: "#0b0b10" },
  { id: "drop-shadow",     label: "Drop shadow",     preview: "Aa", bg: "transparent", fg: "#ffffff" },
];

const POSITIONS: Array<{ id: CaptionPosition; label: string }> = [
  { id: "top",    label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "bottom", label: "Bottom" },
];

export interface CaptionDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Initial style + position so re-opens preserve the user's selection. */
  initialStyle?: CaptionStyle;
  initialPosition?: CaptionPosition;
  initialHue?: number; // 0..360
  /**
   * Ship-lens Batch 3 (Dead-button audit · 2026-07-06). When the host
   * wires `onApply`, the drawer's primary CTA persists the picked
   * values via the host + closes. When omitted, the CTA renames itself
   * to "Close preview" so the label doesn't lie about saving.
   */
  onApply?: (choice: { style: CaptionStyle; position: CaptionPosition; hue: number }) => void;
}

export function CaptionDrawer({
  open, onClose,
  initialStyle = "fuchsia-pop",
  initialPosition = "bottom",
  initialHue = 320,
  onApply,
}: CaptionDrawerProps) {
  const [style, setStyle] = useState<CaptionStyle>(initialStyle);
  const [position, setPosition] = useState<CaptionPosition>(initialPosition);
  const [hue, setHue] = useState(initialHue);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Reset dirty flag when drawer reopens
  useEffect(() => {
    if (!open) return;
    setStyle(initialStyle);
    setPosition(initialPosition);
    setHue(initialHue);
    setDirty(false);
    setConfirming(false);
  }, [open, initialStyle, initialPosition, initialHue]);

  const markDirty = () => { if (!dirty) setDirty(true); };

  const onTryClose = () => {
    if (dirty) {
      setConfirming(true);
      return;
    }
    onClose();
  };

  const onConfirmDiscard = () => {
    setConfirming(false);
    setDirty(false);
    onClose();
  };

  // Ransom-paywall (Max · trigger #3 · 2026-07-07) · custom-caption
  // export deflects free-tier clippers when the picked style is
  // non-default. Same handlePublishClick / execute split as trigger
  // #1 · onUnlocked calls doPrimary directly (no gate closure loop).
  const tier = useTierCaps();
  const [ransomOpen, setRansomOpen] = useState(false);
  const isCustomStyle = style !== "fuchsia-pop"; // default preset per initialStyle
  const doPrimary = () => {
    if (onApply) {
      onApply({ style, position, hue });
      if (tier.tier === "clipper") {
        // Ransom-paywall RP-P1-007 pattern · decrement at the
        // atomic "captions committed to clip" moment.
        decrementGuestClipsRemaining();
      }
    }
    setDirty(false);
    onClose();
  };
  const onPrimary = () => {
    if (tier.tier === "clipper" && isCustomStyle && isGuestQuotaExhausted()) {
      setRansomOpen(true);
      return;
    }
    doPrimary();
  };

  const activePreset = STYLE_PRESETS.find((p) => p.id === style)!;

  return (
    <>
    {/* Ransom-paywall (Max · trigger #3 · 2026-07-07) · asset preview
     *  is a styled Aa swatch so the user sees exactly the look they
     *  built. onUnlocked calls doPrimary (no gate closure). */}
    <AssetRansomPaywall
      trigger="custom-caption-export"
      assetPreview={{
        kind: "node",
        content: (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: "100%",
              height: "100%",
              background: activePreset.bg,
              color: activePreset.fg,
              fontSize: "72px",
              fontWeight: 900,
              letterSpacing: "-0.02em",
            }}
          >
            {activePreset.preview}
          </div>
        ),
      }}
      isOpen={ransomOpen}
      onUnlocked={async () => {
        setRansomOpen(false);
        doPrimary();
      }}
      onDismiss={() => setRansomOpen(false)}
    />
    <Drawer
      open={open}
      onClose={onTryClose}
      dirty={dirty}
      onDirtyClose={() => setConfirming(true)}
      eyebrow="Studio · captions"
      title="Caption style"
      width={440}
      id="caption-drawer"
    >
      <div className="lc-cap-drawer">
        {/* Live preview */}
        <div className="lc-cap-preview-frame">
          <div
            className={`lc-cap-preview lc-cap-preview-${position}`}
            style={{
              color: activePreset.fg,
              backgroundColor: activePreset.bg === "transparent" ? `hsl(${hue}, 60%, 50%)` : activePreset.bg,
            }}
          >
            <span>Caption preview</span>
          </div>
        </div>

        {/* Styles grid */}
        <section className="lc-cap-section">
          <span className="lc-cap-eb">Style</span>
          <div className="lc-cap-styles">
            {STYLE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`lc-cap-style ${style === p.id ? "is-active" : ""}`}
                onClick={() => { setStyle(p.id); markDirty(); }}
                title={p.label}
                aria-label={p.label}
              >
                <span
                  className="lc-cap-style-swatch"
                  style={{
                    color: p.fg,
                    backgroundColor: p.bg === "transparent" ? "rgba(255,255,255,0.05)" : p.bg,
                  }}
                >
                  {p.preview}
                </span>
                <span className="lc-cap-style-label">{p.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Position picker */}
        <section className="lc-cap-section">
          <span className="lc-cap-eb">Position</span>
          <div className="lc-cap-positions">
            {POSITIONS.map((pp) => (
              <button
                key={pp.id}
                type="button"
                className={`lc-cap-pos ${position === pp.id ? "is-active" : ""}`}
                onClick={() => { setPosition(pp.id); markDirty(); }}
              >
                {pp.label}
              </button>
            ))}
          </div>
        </section>

        {/* Hue slider (only meaningful for transparent presets) */}
        <section className="lc-cap-section">
          <span className="lc-cap-eb">Accent hue</span>
          <input
            type="range"
            min={0} max={360}
            value={hue}
            onChange={(e) => { setHue(Number(e.target.value)); markDirty(); }}
            className="lc-cap-hue"
            style={{
              background: `linear-gradient(to right,
                hsl(0,80%,55%), hsl(45,80%,55%), hsl(90,80%,55%),
                hsl(135,80%,55%), hsl(180,80%,55%), hsl(225,80%,55%),
                hsl(270,80%,55%), hsl(315,80%,55%), hsl(360,80%,55%))`,
            }}
            aria-label="Caption accent hue"
          />
          <span className="lc-cap-hue-readout">hue · {hue}°</span>
        </section>

        {/* Apply / Discard */}
        <footer className="lc-cap-foot">
          <button
            type="button"
            className="lc-cap-btn lc-cap-btn-quiet"
            onClick={onTryClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="lc-cap-btn"
            onClick={onPrimary}
            disabled={!dirty}
          >
            {onApply ? "Apply style" : "Close preview"}
          </button>
        </footer>

        {/* Dirty-state confirm overlay */}
        {confirming && (
          <div className="lc-cap-confirm">
            <p className="lc-cap-confirm-h">Discard unsaved caption edits?</p>
            <div className="lc-cap-confirm-actions">
              <button type="button" className="lc-cap-btn lc-cap-btn-quiet" onClick={() => setConfirming(false)}>
                Keep editing
              </button>
              <button type="button" className="lc-cap-btn lc-cap-btn-danger" onClick={onConfirmDiscard}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
    </>
  );
}
