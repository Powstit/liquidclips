/**
 * ThumbnailVariantGallery · Phase 6F
 *
 * Grid of generated thumbnail variants (A/B/C…) with:
 *   - winner state (top score gets fuchsia ring + "Winner" pill)
 *   - selection state (clicked variant gets selection bar)
 *   - per-variant score chip + breakdown bars (hook/clarity/contrast/face)
 *   - "Use as cover" CTA on the selected variant
 *
 * Reads from the engine session for live progress + uses SafeAreaOverlay
 * (toggled by the gallery toolbar) for the active preview.
 *
 * No publish logic. No file write. Cover selection routes through the
 * sidecar-stub (real RPC swaps in via single import change later).
 */

import { useMemo, useState } from "react";
import { GlassCard } from "../components";
import { SafeAreaOverlay } from "./SafeAreaOverlay";
import type { ThumbnailVariant } from "./types";
import "./ThumbnailVariantGallery.css";

export interface ThumbnailVariantGalleryProps {
  variants: ReadonlyArray<ThumbnailVariant>;
  /** Path of the currently set cover (so the row can show "Active cover"). */
  coverPath?: string | null;
  /** Fires when the user selects a variant. */
  onSelect?: (v: ThumbnailVariant) => void;
  /** Fires when the user clicks "Set as cover" on the selected variant. */
  onUseAsCover?: (v: ThumbnailVariant) => void;
  /** When true, a generation job is in flight — show pending tile. */
  pending?: boolean;
  /** 0..1 progress for the pending tile. */
  pendingPercent?: number | null;
  /** Phase 6F pivot · CTA label per mode (episode vs clip). */
  ctaLabel?: string;
  /** Label shown when cover is already set (per mode). */
  activeCoverLabel?: string;
  /** Pill text shown on the active cover variant (per mode). */
  coverPillLabel?: string;
}

export function ThumbnailVariantGallery({
  variants,
  coverPath,
  onSelect,
  onUseAsCover,
  pending = false,
  pendingPercent = null,
  ctaLabel = "Set as cover",
  activeCoverLabel = "Active cover",
  coverPillLabel = "Active cover",
}: ThumbnailVariantGalleryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(variants[0]?.id ?? null);
  const [showFaceGuide, setShowFaceGuide] = useState(false);
  const [showTitleGuide, setShowTitleGuide] = useState(false);

  // Recompute winner: highest score wins. Mark explicitly if not already set.
  const winnerId = useMemo(() => {
    if (variants.length === 0) return null;
    const explicit = variants.find((v) => v.isWinner);
    if (explicit) return explicit.id;
    const sorted = [...variants].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return sorted[0]?.id ?? null;
  }, [variants]);

  const selected = variants.find((v) => v.id === selectedId) ?? variants[0] ?? null;

  const onTileClick = (v: ThumbnailVariant) => {
    setSelectedId(v.id);
    onSelect?.(v);
  };

  return (
    <section className="lc-tvg">
      <header className="lc-tvg-head">
        <div className="lc-tvg-head-text">
          <span className="lc-tvg-eb">Variants</span>
          <span className="lc-tvg-count">
            {variants.length === 0 && !pending
              ? "No variants yet"
              : `${variants.length} ${variants.length === 1 ? "variant" : "variants"}`}
          </span>
        </div>
        <div className="lc-tvg-toolbar">
          <button
            type="button"
            aria-pressed={showFaceGuide}
            className={`lc-tvg-toggle ${showFaceGuide ? "is-on" : ""}`}
            onClick={() => setShowFaceGuide((v) => !v)}
            title="Toggle face safe-area guide"
          >
            Face guide
          </button>
          <button
            type="button"
            aria-pressed={showTitleGuide}
            className={`lc-tvg-toggle ${showTitleGuide ? "is-on" : ""}`}
            onClick={() => setShowTitleGuide((v) => !v)}
            title="Toggle title safe-area guide"
          >
            Title guide
          </button>
        </div>
      </header>

      {/* Grid */}
      <div className="lc-tvg-grid">
        {/* Pending tile */}
        {pending && (
          <article className="lc-tvg-pending">
            <div className="lc-tvg-pending-pulse" />
            <span className="lc-tvg-pending-eb">Generating</span>
            <span className="lc-tvg-pending-body">
              {pendingPercent != null
                ? `${Math.round(pendingPercent * 100)}%`
                : "Working…"}
            </span>
          </article>
        )}

        {variants.map((v, i) => {
          const isWinner = v.id === winnerId;
          const isSelected = selected?.id === v.id;
          const isCover = !!coverPath && coverPath === v.path;
          return (
            <article
              key={v.id}
              className={`lc-tvg-tile ${isSelected ? "is-selected" : ""} ${isWinner ? "is-winner" : ""}`}
              onClick={() => onTileClick(v)}
              tabIndex={0}
              role="button"
              aria-pressed={isSelected}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onTileClick(v);
                }
              }}
            >
              <div className="lc-tvg-frame">
                <img className="lc-tvg-poster" src={v.path} alt={v.name} draggable={false} />
                {isSelected && (showFaceGuide || showTitleGuide) && (
                  <SafeAreaOverlay
                    showFace={showFaceGuide}
                    showTitle={showTitleGuide}
                  />
                )}
                {/* Winner pill top-left */}
                {isWinner && (
                  <span className="lc-tvg-winner">Winner</span>
                )}
                {/* Cover pill bottom-right when this is the active cover */}
                {isCover && !pending && (
                  <span className="lc-tvg-cover">{coverPillLabel}</span>
                )}
                {/* Variant letter top-right */}
                <span className="lc-tvg-letter">{String.fromCharCode(65 + i)}</span>
              </div>

              {/* Meta */}
              <div className="lc-tvg-meta">
                <span className="lc-tvg-name" title={v.name}>{v.name}</span>
                <span className="lc-tvg-score" data-tone={toneFor(v.score ?? 0)}>
                  <span className="lc-tvg-score-num">{v.score ?? "—"}</span>
                  <span className="lc-tvg-score-unit">LC</span>
                </span>
              </div>

              {/* Breakdown bars */}
              {v.scoreBreakdown && (
                <div className="lc-tvg-breakdown">
                  {(["hook", "clarity", "contrast", "face"] as const).map((k) => {
                    const score = v.scoreBreakdown?.[k];
                    if (score == null) return null;
                    return (
                      <div key={k} className="lc-tvg-sub">
                        <span className="lc-tvg-sub-k">{k[0].toUpperCase()}</span>
                        <span className="lc-tvg-sub-bar">
                          <span className="lc-tvg-sub-fill" style={{ width: `${score}%` }} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Footer: selected-variant actions */}
      {selected && (
        <GlassCard density="quiet" className="lc-tvg-foot">
          <div className="lc-tvg-foot-text">
            <span className="lc-tvg-foot-eb">Selected</span>
            <span className="lc-tvg-foot-body">{selected.name}</span>
          </div>
          <button
            type="button"
            className="lc-tvg-cta"
            disabled={!!coverPath && coverPath === selected.path}
            onClick={() => onUseAsCover?.(selected)}
          >
            {coverPath === selected.path ? activeCoverLabel : ctaLabel}
          </button>
        </GlassCard>
      )}
    </section>
  );
}

function toneFor(score: number): "fx" | "cy" | "amber" | "dim" {
  if (score >= 85) return "fx";
  if (score >= 70) return "cy";
  if (score >= 55) return "amber";
  return "dim";
}
