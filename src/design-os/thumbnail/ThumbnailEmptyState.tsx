/**
 * ThumbnailEmptyState · Phase 6F pivot
 *
 * Shown when there's nothing actionable yet. Mode-aware:
 *   - episode: "Open a project or enter a YouTube title"
 *   - clip:    "Pick a clip in Engine first"
 *
 * Always offers the brand + identity setup escape hatches.
 */

import { GlassCard } from "../components";
import type { ThumbMode } from "./ThumbnailModeToggle";
import "./ThumbnailEmptyState.css";

export interface ThumbnailEmptyStateProps {
  /** When true, identity + brand are set up — empty state focuses on
   *  the data unit, not first-run setup. */
  setupComplete: boolean;
  mode: ThumbMode;
  onGoEngine?: () => void;
  onGoLibrary?: () => void;
  onOpenBrand?: () => void;
  onOpenIdentity?: () => void;
}

export function ThumbnailEmptyState({
  setupComplete, mode, onGoEngine, onGoLibrary, onOpenBrand, onOpenIdentity,
}: ThumbnailEmptyStateProps) {
  if (!setupComplete) {
    return (
      <GlassCard density="default" className="lc-thumb-empty">
        <span className="lc-thumb-empty-eb">Thumbnail studio · setup needed</span>
        <h2 className="lc-thumb-empty-h">Lock your identity before generating.</h2>
        <p className="lc-thumb-empty-sub">
          Upload at least 3 reference face crops, then save your brand preset.
          Kade uses the references to keep your face consistent across every variant —
          never a face description, always your real photos.
        </p>
        <div className="lc-thumb-empty-actions">
          <button type="button" className="lc-thumb-empty-cta" onClick={onOpenIdentity}>
            Upload identity references
          </button>
          <button type="button" className="lc-thumb-empty-cta-quiet" onClick={onOpenBrand}>
            Set brand preset
          </button>
        </div>
      </GlassCard>
    );
  }

  if (mode === "episode") {
    return (
      <GlassCard density="default" className="lc-thumb-empty">
        <span className="lc-thumb-empty-eb">Episode mode · no project</span>
        <h2 className="lc-thumb-empty-h">Open a project or enter a YouTube title.</h2>
        <p className="lc-thumb-empty-sub">
          Thumbnail studio generates episode covers for a long-form video.
          Open a project from Library, or paste a YouTube link into Create Clips —
          either way, Kade routes you back here with the episode loaded.
        </p>
        <div className="lc-thumb-empty-actions">
          <button type="button" className="lc-thumb-empty-cta" onClick={onGoLibrary}>
            Open Library
          </button>
          <button type="button" className="lc-thumb-empty-cta-quiet" onClick={onGoEngine}>
            Open Clipping Engine
          </button>
          <button type="button" className="lc-thumb-empty-cta-quiet" onClick={onOpenBrand}>
            Edit brand preset
          </button>
        </div>
      </GlassCard>
    );
  }

  // mode === "clip"
  return (
    <GlassCard density="default" className="lc-thumb-empty">
      <span className="lc-thumb-empty-eb">Clip mode · no clip selected</span>
      <h2 className="lc-thumb-empty-h">Pick a clip in Engine first.</h2>
      <p className="lc-thumb-empty-sub">
        Clip-cover mode generates per-clip thumbnails for the short-form output.
        Open Clipping Engine, pick a candidate, and Kade routes its title
        + metaphor into the prompt for you.
      </p>
      <div className="lc-thumb-empty-actions">
        <button type="button" className="lc-thumb-empty-cta" onClick={onGoEngine}>
          Open Clipping Engine
        </button>
        <button type="button" className="lc-thumb-empty-cta-quiet" onClick={onOpenBrand}>
          Edit brand preset
        </button>
      </div>
    </GlassCard>
  );
}
