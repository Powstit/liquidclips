import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useRegisterModal } from "../../design-os/components/ModalPortal";
import type {
  Clip,
  EditState,
  PlatformKey,
} from "../../fixtures/fakeEditor.preview";
import { formatTime } from "../../fixtures/fakeEditor.preview";
import { EngineRightRail } from "./EngineRightRail";
import { EngineTimeline } from "./EngineTimeline";

interface EngineEditorOverlayProps {
  clip: Clip;
  edit: EditState;
  setEdit: (patch: Partial<EditState>) => void;
  onClose: () => void;
  onRegenerate: () => void;
  togglePlatform: (key: PlatformKey) => void;
  onWhopSubmit: () => void;
  onAyrsharePublish: () => void;
  stamp: string;
  /** Lane 2 — present when the Browser overlay handed a URL/campaign into Engine. */
  importedFromBrowser?: boolean;
}

export function EngineEditorOverlay({
  clip,
  edit,
  setEdit,
  onClose,
  onRegenerate,
  togglePlatform,
  onWhopSubmit,
  onAyrsharePublish,
  stamp,
  importedFromBrowser = false,
}: EngineEditorOverlayProps) {
  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · full-viewport
  // overlay registers with ModalPortal for Esc + shared scroll-lock.
  // Component only mounts when the caller sets it up · always open.
  useRegisterModal({ id: "engine-editor-overlay", open: true, onEscape: onClose });

  const ratioClass = {
    "9": "lc2-engine-ratio-9",
    "45": "lc2-engine-ratio-45",
    "1": "lc2-engine-ratio-1",
    "16": "lc2-engine-ratio-16",
  }[edit.ratio];

  const showReaction =
    edit.reactionSource !== "off" &&
    (edit.layout === "reaction" || (clip.reaction && edit.layout !== "split"));

  const captionText = useMemo(() => {
    const words = `${clip.hl} ${clip.rest}`.split(" ");
    const hi = Math.min(2, words.length - 1);
    return words.map((w, i) => (i === hi ? { word: w, highlight: true } : { word: w, highlight: false }));
  }, [clip.hl, clip.rest]);

  const captionClass = `lc2-engine-cap lc2-engine-cap-${edit.captionStyle} lc2-engine-cap-${edit.captionPosition}`;

  // Portal to document.body so the overlay escapes the .lc-page containing
  // block (perspective:1200px on .lc-page would otherwise re-anchor our
  // position:fixed to .lc-page instead of the viewport).
  const overlay = (
    <section
      className="lc2-engine-editor open"
      role="dialog"
      aria-modal="true"
      aria-label="Engine editor"
    >
      <div className="lc2-engine-ed-top">
        <button type="button" className="lc2-engine-ed-back" onClick={onClose} aria-label="back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="lc2-engine-ed-title">
          {clip.hl} {clip.rest}
        </div>
        <span className="lc2-engine-ed-score">{clip.score}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="lc2-engine-btn" onClick={onRegenerate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
          </svg>
          Regenerate
        </button>
        <div className="lc2-engine-ratio-toggle">
          {(["9", "45", "1", "16"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={edit.ratio === r ? "on" : ""}
              onClick={() => setEdit({ ratio: r })}
            >
              {r === "9" ? "9:16" : r === "45" ? "4:5" : r === "1" ? "1:1" : "16:9"}
            </button>
          ))}
        </div>
        <button type="button" className="lc2-engine-btn-primary" onClick={onAyrsharePublish}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 3l14 9-14 9V3z" />
          </svg>
          Export
        </button>
      </div>

      <div className="lc2-engine-ed-body">
        <div className="lc2-engine-stage">
          <div
            className={`lc2-engine-canvas ${ratioClass}${edit.layout === "split" ? " split" : ""}${
              showReaction ? " hasreaction" : ""
            }`}
          >
            <div className="lc2-engine-c-subj">
              {edit.layout === "split" && (
                <span className="lc2-engine-split-tag" aria-hidden="true">main</span>
              )}
            </div>
            <div className="lc2-engine-split-b">
              {edit.layout === "split" && (
                <span className="lc2-engine-split-tag" aria-hidden="true">
                  {importedFromBrowser ? "second clip · imported from browser" : "second clip"}
                </span>
              )}
              {edit.layout === "split" && importedFromBrowser && (
                <span className="lc2-engine-split-imported-chip">imported from browser</span>
              )}
            </div>
            <div className="lc2-engine-splitline" />
            {showReaction && (
              <div className={`lc2-engine-reaction lc2-engine-reaction-${edit.reactionCorner}`} style={{ width: `${edit.reactionSize}%` }}>
                <span className="lc2-engine-rlbl">REACTION</span>
              </div>
            )}
            <div
              className="lc2-engine-reframe-box"
              style={{ opacity: edit.reframeTrack ? 0.5 : 0 }}
            >
              <span>auto-track</span>
            </div>
            <div className={captionClass} style={{ fontSize: `${edit.captionSize}%` }}>
              {edit.captionStyle === "clean" ? (
                <span className="lc2-engine-cap-line">
                  {captionText.map((w, i) =>
                    w.highlight ? (
                      <span key={i} className="lc2-engine-cap-hl" style={{ color: edit.captionHighlight }}>
                        {w.word}{" "}
                      </span>
                    ) : (
                      <span key={i}>{w.word} </span>
                    )
                  )}
                </span>
              ) : (
                captionText.map((w, i) =>
                  w.highlight ? (
                    <span
                      key={i}
                      className="lc2-engine-cap-hl"
                      style={
                        edit.captionStyle === "karaoke"
                          ? { background: edit.captionHighlight }
                          : { color: edit.captionHighlight }
                      }
                    >
                      {w.word}{" "}
                    </span>
                  ) : (
                    <span key={i}>{w.word} </span>
                  )
                )
              )}
            </div>
            <div className="lc2-engine-ewm">
              <i />
              <span>{stamp}</span>
            </div>
            <div className="lc2-engine-scrub">
              <button
                type="button"
                className={`lc2-engine-pp${edit.playing ? " playing" : ""}`}
                onClick={() => setEdit({ playing: !edit.playing })}
                aria-label={edit.playing ? "pause" : "play"}
              />
              <span className="lc2-engine-ptime">
                {formatTime(Math.round(((edit.playhead - 8) / 84) * clip.dur))} / {formatTime(clip.dur)}
              </span>
            </div>
          </div>
        </div>

        <EngineRightRail
          clip={clip}
          edit={edit}
          setEdit={setEdit}
          togglePlatform={togglePlatform}
          onWhopSubmit={onWhopSubmit}
        />
      </div>

      <div className="lc2-engine-ed-timeline">
        <EngineTimeline clip={clip} edit={edit} setEdit={setEdit} />
      </div>
    </section>
  );

  return createPortal(overlay, document.body);
}
