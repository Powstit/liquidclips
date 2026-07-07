/**
 * EngineEmptyState · the "no source, no session" state for ClippingEngine
 *
 * Phase 6C-Lockdown. Renders a clear empty state with:
 *   - Kade explanation
 *   - "Open Create Clips" CTA
 *   - "Resume last session" CTA if persisted (handled by EngineActions)
 *
 * Used by ClippingEngine when session.phase === "idle" AND no persisted
 * resume is available. Replaces the previous "Pending tiles" rendering as
 * the entire-route emptiness signal.
 */

import { GlassCard } from "../components";
import "./EngineEmptyState.css";

export interface EngineEmptyStateProps {
  onGoCreate?: () => void;
}

export function EngineEmptyState({ onGoCreate }: EngineEmptyStateProps) {
  return (
    <GlassCard density="default" className="lc-eng-empty" data-testid="workstation-empty">
      <span className="lc-eng-empty-eb">Cutting floor · empty</span>
      <h2 className="lc-eng-empty-h">No source on the bench yet.</h2>
      <p className="lc-eng-empty-sub">
        Open Create Clips, paste a YouTube / TikTok / IG link or drop a file.
        I'll ingest it, scan for hooks, and bring the candidates back here.
      </p>
      <div className="lc-eng-empty-actions">
        <button
          type="button"
          className="lc-eng-empty-cta"
          data-testid="workstation-empty-cta"
          onClick={onGoCreate}
        >
          Open Create Clips
        </button>
      </div>
    </GlassCard>
  );
}
