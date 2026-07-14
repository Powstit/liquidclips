/**
 * IngestErrorStrip · Block 2 · 2026-07-11
 *
 * Global (AppShell-mounted) surface for `engine:error { kind: "ingest" }`.
 * Complements BakeErrorStrip — that strip stays scoped to bake/regenerate/
 * thumbnail-batch/export because those errors are per-clip. Ingest errors
 * happen BEFORE a session even starts (preflight) or during the first
 * pipeline stage, both of which can hit while the user is anywhere in the
 * shell (Home, Wallet, Settings). Mounting in AppShell means the strip is
 * always visible when it fires, regardless of route.
 *
 * Ship-lens Block-2 findings addressed:
 *   - P0-01 · bypass `describeError` for preflight codes so the Daniel-
 *     locked copy (Dropbox / empty / not-found / unreadable / unsupported)
 *     reaches the customer verbatim
 *   - P0-02 · durable UI on Home drag-drop preflight failure — this strip
 *     mounts globally, replacing the 4.5s toast-then-gone gap
 *   - P1-01 · same code path repair as P0-01
 *   - P1-02 · vitest-target render test mounts THIS strip
 */

import { useMemo, useState } from "react";
import { GlassCard } from "../components";
import { bus, useEvent } from "../bridge";
import { describeError } from "../errors/customerSafeErrors";
import { clearPersistedSession } from "../state/engineSessionPersistence";
import "./BakeErrorStrip.css";

interface ActiveIngestError {
  message: string;
  human?: string;
  code?: string;
  sourcePath?: string;
}

/** True when the sidecar/preflight already produced a customer-safe
 *  humanMessage that must NOT be re-classified. */
function isDanielLocked(code: string | undefined): boolean {
  return typeof code === "string" && code.startsWith("PREFLIGHT_");
}

export function IngestErrorStrip() {
  const [active, setActive] = useState<ActiveIngestError | null>(null);

  useEvent("engine:error", (p) => {
    if (p.kind !== "ingest") return;
    setActive({
      message: p.error,
      human: p.human,
      code: p.code,
      sourcePath: p.source_path,
    });
  });

  // Clear when the pipeline moves past ingest (a new run started, or
  // an ingest-complete arrived).
  useEvent("engine:complete", (p) => {
    if (active && p.kind === "ingest") setActive(null);
  });

  useEvent("engine:progress", (p) => {
    if (active && p.stage !== "ingest") setActive(null);
  });

  const rendered = useMemo(() => {
    if (!active) return null;

    // Ship-lens P0-01 · when preflight generated the copy, use it
    // VERBATIM. The classifier would fold "…is stored in Dropbox but
    // hasn't downloaded to this Mac yet. In Finder, right-click it
    // and choose Make Available Offline, then try again." into a
    // generic UNKNOWN → "Something went sideways" — which is the
    // whole reason Block 2 was built.
    if (isDanielLocked(active.code) && active.human) {
      return {
        title: "Can't use that video",
        body: active.human,
      };
    }

    // Sidecar-emitted human copy still gets preferred; only raw error
    // strings from unclassified failures go through describeError.
    const safe = describeError(active.human ?? active.message, { scenario: "clip" });
    return { title: safe.title, body: safe.body };
  }, [active]);

  if (!active || !rendered) return null;

  const onTryAnother = () => {
    clearPersistedSession();
    bus.emit("nav:click", { route: "home" });
    window.setTimeout(
      () => bus.emit("home:open-panel", { tab: "upload" }),
      60,
    );
    setActive(null);
  };

  const onRevealSource = async () => {
    if (!active.sourcePath) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(active.sourcePath);
    } catch {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't reveal the file",
        body: "It may have moved or been renamed. Try browsing to it directly in Finder.",
      });
    }
  };

  return (
    <GlassCard density="default" className="lc-bake-error" data-testid="ingest-error-strip">
      <div className="lc-bake-error-icon" aria-hidden="true">!</div>
      <div className="lc-bake-error-body">
        <span className="lc-bake-error-eb">{rendered.title}</span>
        <span className="lc-bake-error-msg">{rendered.body}</span>
      </div>
      <button
        type="button"
        className="lc-bake-error-retry"
        onClick={onTryAnother}
        data-testid="ingest-error-try-another"
      >
        Try another video
      </button>
      {active.sourcePath && (
        <button
          type="button"
          className="lc-bake-error-retry"
          onClick={() => { void onRevealSource(); }}
          data-testid="ingest-error-reveal"
          style={{ marginLeft: 8 }}
        >
          Reveal in Finder
        </button>
      )}
      <button
        type="button"
        className="lc-bake-error-dismiss"
        onClick={() => setActive(null)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </GlassCard>
  );
}
