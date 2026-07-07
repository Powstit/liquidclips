/**
 * ThumbnailModeToggle · Phase 6F pivot
 *
 * Pill-style toggle at the top of Thumbnail Studio. Switches between:
 *   - Episode mode (default · long-form YouTube thumbnail)
 *   - Clip cover mode (per-clip · disabled when no clip selected)
 *
 * Both modes share the same 8 bricks underneath; only the data binding
 * changes (title source, CTA copy, persistence key).
 */

import "./ThumbnailModeToggle.css";

export type ThumbMode = "episode" | "clip";

export interface ThumbnailModeToggleProps {
  mode: ThumbMode;
  onChange: (m: ThumbMode) => void;
  /** True when a clip is selected via Engine → allows clip-mode. */
  clipAvailable: boolean;
  /** Display label for the active clip (shown in the disabled hint). */
  clipLabel?: string;
}

export function ThumbnailModeToggle({
  mode, onChange, clipAvailable, clipLabel,
}: ThumbnailModeToggleProps) {
  return (
    <div className="lc-tmt" role="radiogroup" aria-label="Thumbnail mode">
      <span className="lc-tmt-eb">Mode</span>
      <div className="lc-tmt-pills">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "episode"}
          className={`lc-tmt-pill ${mode === "episode" ? "is-active" : ""}`}
          onClick={() => onChange("episode")}
        >
          <span className="lc-tmt-pill-title">Episode thumbnail</span>
          <span className="lc-tmt-pill-sub">Long-form YouTube</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "clip"}
          aria-disabled={!clipAvailable}
          className={`lc-tmt-pill ${mode === "clip" ? "is-active" : ""} ${!clipAvailable ? "is-locked" : ""}`}
          onClick={() => clipAvailable && onChange("clip")}
          title={!clipAvailable
            ? "Pick a clip in Engine to unlock clip-cover mode."
            : clipLabel ? `Cover for: ${clipLabel}` : "Per-clip cover"}
        >
          <span className="lc-tmt-pill-title">Clip cover</span>
          <span className="lc-tmt-pill-sub">
            {clipAvailable ? (clipLabel ?? "Selected clip") : "Pick a clip first"}
          </span>
        </button>
      </div>
    </div>
  );
}
