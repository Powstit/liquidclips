/**
 * BakeErrorStrip · Phase 6C · Block 2 extend (2026-07-11)
 *
 * Ported from the inline error strip inside legacy BottomCockpit. Listens
 * for engine:error events; renders a Design OS GlassCard warning banner with
 * Retry. Auto-dismisses on engine:complete for the same slug/idx pair.
 *
 * No generic red SaaS bar — fuchsia/red brand-tonal language.
 *
 * Block 2 · 2026-07-11 · also handles `kind: "ingest"` so a Dropbox stub
 * / 0-byte / unreadable / mid-stage ffprobe failure surfaces a real
 * error card with "Try another video" + "Reveal source in Finder"
 * recovery CTAs. Previously ingest errors emitted engine:error on the
 * bus but no visible UI subscribed — the user watched a stuck StageRail.
 */

import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../components";
import { bus, useEvent } from "../bridge";
import { sidecar } from "./sidecar-stub";
import { describeError } from "../errors/customerSafeErrors";
import { clearPersistedSession } from "../state/engineSessionPersistence";
import "./BakeErrorStrip.css";

interface ActiveError {
  kind: string;
  message: string;
  human?: string;
  slug?: string;
  idx?: number;
  sourcePath?: string;
}

export function BakeErrorStrip() {
  const [active, setActive] = useState<ActiveError | null>(null);

  useEvent("engine:error", (p) => {
    // Surface bake/regenerate + thumbnail-batch + export + ingest errors
    // here. sidecar-died routes through the toast host (see effect below).
    if (
      p.kind !== "bake" &&
      p.kind !== "regenerate" &&
      p.kind !== "thumbnail-batch" &&
      p.kind !== "export" &&
      p.kind !== "ingest"
    ) return;
    setActive({
      kind: p.kind,
      message: p.error,
      human: p.human,
      slug: p.slug,
      idx: p.idx,
      sourcePath: p.source_path,
    });
  });

  useEvent("engine:complete", (p) => {
    if (active && p.slug === active.slug && p.idx === active.idx) {
      setActive(null);
    }
  });

  // Listen for sidecar:died indirectly via a global toast — no inline retry.
  useEffect(() => {
    return bus.on("engine:error", (p) => {
      if (p.kind === "sidecar-died") {
        bus.emit("toast", {
          kind: "error",
          title: "Engine restarted",
          body: "The clip engine restarted itself. Give it 2 seconds and try again.",
        });
      }
    });
  }, []);

  // 2026-07-09 · route every incoming error through the customer-safe
  // classifier so the strip never renders `RuntimeError`, `HTTP 502`,
  // or a raw Python traceback. `active.human` gets preferred when the
  // sidecar pre-classified; otherwise we generate a clean sentence
  // from the raw message. Technical detail stays on the diagnostic ring.
  const safe = useMemo(
    () => active ? describeError(active.human ?? active.message, { scenario: "clip" }) : null,
    [active],
  );

  if (!active || !safe) return null;

  const onRetry = () => {
    if (active.slug && active.idx != null) {
      void sidecar.startOverlayBake(active.slug, active.idx, {});
    }
    setActive(null);
  };

  // Block 2 · 2026-07-11 · "Try another video" for ingest failures.
  // Wipes the persisted session (kills the stuck stage rail) + opens the
  // upload panel on Home so the user can pick a different source.
  const onTryAnother = () => {
    clearPersistedSession();
    bus.emit("nav:click", { route: "home" });
    window.setTimeout(
      () => bus.emit("home:open-panel", { tab: "upload" }),
      60,
    );
    setActive(null);
  };

  // Block 2 · 2026-07-11 · "Reveal source in Finder" — native reveal via
  // plugin-opener. Silently no-ops if we don't have a path (drag/drop
  // without payload path) or Tauri isn't available.
  const onRevealSource = async () => {
    if (!active.sourcePath) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(active.sourcePath);
    } catch {
      // Silent · the user still has the error card + Try another CTA.
    }
  };

  const isIngest = active.kind === "ingest";

  return (
    <GlassCard density="default" className="lc-bake-error">
      <div className="lc-bake-error-icon" aria-hidden="true">!</div>
      <div className="lc-bake-error-body">
        <span className="lc-bake-error-eb">{safe.title}</span>
        <span className="lc-bake-error-msg">
          {safe.body}
        </span>
      </div>
      {isIngest ? (
        <>
          <button
            type="button"
            className="lc-bake-error-retry"
            onClick={onTryAnother}
          >
            Try another video
          </button>
          {active.sourcePath && (
            <button
              type="button"
              className="lc-bake-error-retry"
              onClick={() => { void onRevealSource(); }}
              style={{ marginLeft: 8 }}
            >
              Reveal in Finder
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="lc-bake-error-retry"
          onClick={onRetry}
        >
          Retry
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
