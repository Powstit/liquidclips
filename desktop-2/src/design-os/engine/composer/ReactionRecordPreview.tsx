/**
 * ReactionRecordPreview · Composer D · Live Reaction Record preview.
 *
 * ⚠ IRON GATE IG-COMPOSER-JJ · Reaction-mode split preview.
 *
 * Renders inside the Composer canvas while a reaction recording is
 * active. Splits the visible area based on the selected layout:
 *
 *   * top-bottom  → camera on top half · "REC · Screen" tile below
 *   * side-by-side → camera on left half · "REC · Screen" on right
 *   * grid-2x2   → camera top-left · "REC · Screen" top-right · blanks below
 *   * pip-tr / tl / br / bl → "REC · Screen" full · camera PIP in the named corner
 *   * solo → "REC · Screen" full (camera hidden)
 *
 * The screen half stays a static indicator with a live timer — we
 * intentionally do NOT stream scap frames into the webview during
 * recording (fps drops on Intel Macs are not bullet-proof).
 */

import { useEffect, useRef, type ReactElement } from "react";
import type { ReactionLayout } from "./reactionRecord";
import "./ReactionRecordPreview.css";

export interface ReactionRecordPreviewProps {
  visible: boolean;
  layout: ReactionLayout;
  stream: MediaStream | null;
  elapsedMs: number;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ReactionRecordPreview(props: ReactionRecordPreviewProps): ReactElement | null {
  const { visible, layout, stream, elapsedMs } = props;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
      el.muted = true;
      void el.play();
    } else {
      el.srcObject = null;
    }
    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);

  if (!visible) return null;

  const timer = formatElapsed(elapsedMs);
  const screenTile = (
    <div className="lc-rr-screen-tile" data-testid="reaction-record-screen-tile">
      <span className="lc-rr-screen-dot">●</span>
      <span className="lc-rr-screen-label">Screen</span>
      <span className="lc-rr-screen-timer">{timer}</span>
    </div>
  );
  const cameraTile = (
    <div className="lc-rr-camera-tile" data-testid="reaction-record-camera-tile">
      <video ref={videoRef} className="lc-rr-camera-video" playsInline />
      <span className="lc-rr-camera-label">You</span>
    </div>
  );

  return (
    <div
      className="lc-reaction-record"
      data-layout={layout}
      data-testid="reaction-record-preview"
      role="status"
      aria-live="polite"
    >
      {layout === "top-bottom" && (
        <>
          <div className="lc-rr-half lc-rr-top">{screenTile}</div>
          <div className="lc-rr-half lc-rr-bottom">{cameraTile}</div>
        </>
      )}
      {layout === "side-by-side" && (
        <>
          <div className="lc-rr-half lc-rr-left">{screenTile}</div>
          <div className="lc-rr-half lc-rr-right">{cameraTile}</div>
        </>
      )}
      {layout === "grid-2x2" && (
        <div className="lc-rr-grid">
          <div className="lc-rr-cell">{screenTile}</div>
          <div className="lc-rr-cell">{cameraTile}</div>
          <div className="lc-rr-cell lc-rr-blank" />
          <div className="lc-rr-cell lc-rr-blank" />
        </div>
      )}
      {(layout === "pip-tr" || layout === "pip-tl" || layout === "pip-br" || layout === "pip-bl") && (
        <div className="lc-rr-pip-frame">
          <div className="lc-rr-pip-bg">{screenTile}</div>
          <div className={`lc-rr-pip-overlay lc-rr-${layout}`}>{cameraTile}</div>
        </div>
      )}
      {layout === "solo" && (
        <div className="lc-rr-solo">{screenTile}</div>
      )}
    </div>
  );
}

export default ReactionRecordPreview;
