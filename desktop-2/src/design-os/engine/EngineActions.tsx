/**
 * EngineActions · Cancel / Clear / Retry strip
 *
 * Phase 6C-Lockdown. Renders inline above the StageRail. State-aware:
 *   - phase === "running"  → Cancel button enabled
 *   - phase === "error"    → Retry + Clear enabled
 *   - phase === "complete" → Clear enabled
 *   - phase === "idle"     → "Resume last" if persisted, else nothing
 *
 * Reuses bus events + sidecar-stub for the runtime side; clears localStorage
 * via engineSessionPersistence for the data side.
 */

import { useState } from "react";
import { GlassCard } from "../components";
import { bus } from "../bridge";
import { abortActiveSidecarRun, sidecar } from "./sidecar-stub";
import { useEngineSession } from "../state/useEngineSession";
import {
  clearPersistedSession,
  readPersistedSession,
  startPersistedSession,
} from "../state/engineSessionPersistence";
import "./EngineActions.css";

export interface EngineActionsProps {
  /** When the user clicks "Open Create Clips", host route handles the nav. */
  onGoCreate?: () => void;
}

export function EngineActions({ onGoCreate }: EngineActionsProps) {
  const session = useEngineSession();
  const persisted = readPersistedSession();
  const [busy, setBusy] = useState(false);

  const canCancel   = session.phase === "running";
  const canRetry    = session.phase === "error";
  const canClear    = session.phase !== "idle" || !!persisted;
  const canResume   = session.phase === "idle" && !!persisted && persisted.status !== "complete";

  const onCancel = () => {
    abortActiveSidecarRun();
    bus.emit("toast", {
      kind: "info",
      title: "Engine",
      body: "Run cancelled.",
    });
  };

  const onClear = () => {
    abortActiveSidecarRun();
    clearPersistedSession();
    bus.emit("route:enter", { route: "engine" });
  };

  const onRetry = async () => {
    if (!persisted || !persisted.url) {
      bus.emit("toast", {
        kind: "warning",
        title: "Engine",
        body: "Nothing to retry — open Create Clips to start a fresh source.",
      });
      onGoCreate?.();
      return;
    }
    setBusy(true);
    try {
      startPersistedSession(persisted.source, { url: persisted.url, slug: persisted.slug });
      await sidecar.ingestUrl(persisted.url);
      bus.emit("toast", {
        kind: "info",
        title: "Engine",
        body: "Retrying last source…",
      });
    } finally {
      setBusy(false);
    }
  };

  const onResume = async () => {
    if (!persisted || !persisted.url) return;
    setBusy(true);
    try {
      startPersistedSession(persisted.source, { url: persisted.url, slug: persisted.slug });
      await sidecar.ingestUrl(persisted.url);
      bus.emit("toast", {
        kind: "info",
        title: "Engine",
        body: `Resuming · ${persisted.source}`,
      });
    } finally {
      setBusy(false);
    }
  };

  // If nothing to act on, render nothing so we don't add visual noise.
  if (!canCancel && !canRetry && !canClear && !canResume) return null;

  return (
    <GlassCard
      density="quiet"
      className="lc-eng-actions"
      data-testid="engine-actions"
      data-phase={session.phase}
    >
      <span className="lc-eng-actions-eb">Run controls</span>
      <div className="lc-eng-actions-row">
        {canResume && (
          <button
            type="button"
            data-testid="engine-resume"
            className="lc-eng-btn lc-eng-btn-primary"
            disabled={busy}
            onClick={onResume}
          >
            Resume last session
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            data-testid="engine-cancel"
            className="lc-eng-btn"
            onClick={onCancel}
          >
            Cancel run
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            data-testid="engine-retry"
            className="lc-eng-btn lc-eng-btn-primary"
            disabled={busy}
            onClick={onRetry}
          >
            Retry last run
          </button>
        )}
        {canClear && (
          <button
            type="button"
            data-testid="engine-clear"
            className="lc-eng-btn lc-eng-btn-quiet"
            onClick={onClear}
          >
            Clear session
          </button>
        )}
      </div>
      {persisted && (
        <span className="lc-eng-actions-source" title={persisted.source}>
          Last source: {persisted.source}
        </span>
      )}
    </GlassCard>
  );
}
