/**
 * BakeErrorStrip · Phase 6C
 *
 * Ported from the inline error strip inside legacy BottomCockpit. Listens
 * for engine:error events; renders a Design OS GlassCard warning banner with
 * Retry. Auto-dismisses on engine:complete for the same slug/idx pair.
 *
 * No generic red SaaS bar — fuchsia/red brand-tonal language.
 */

import { useEffect, useState } from "react";
import { GlassCard } from "../components";
import { bus, useEvent } from "../bridge";
import { sidecar } from "./sidecar-stub";
import "./BakeErrorStrip.css";

interface ActiveError {
  kind: string;
  message: string;
  human?: string;
  slug?: string;
  idx?: number;
}

export function BakeErrorStrip() {
  const [active, setActive] = useState<ActiveError | null>(null);

  useEvent("engine:error", (p) => {
    // Surface bake/regenerate + thumbnail-batch + export errors here.
    // sidecar-died routes through the toast host; ingest/lift land elsewhere.
    if (p.kind !== "bake" && p.kind !== "regenerate" && p.kind !== "thumbnail-batch" && p.kind !== "export") return;
    setActive({
      kind: p.kind,
      message: p.error,
      human: p.human,
      slug: p.slug,
      idx: p.idx,
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
          body: p.human ?? "The clipping engine restarted. Try again.",
        });
      }
    });
  }, []);

  if (!active) return null;

  const onRetry = () => {
    if (active.slug && active.idx != null) {
      void sidecar.startOverlayBake(active.slug, active.idx, {});
    }
    setActive(null);
  };

  return (
    <GlassCard density="default" className="lc-bake-error">
      <div className="lc-bake-error-icon" aria-hidden="true">!</div>
      <div className="lc-bake-error-body">
        <span className="lc-bake-error-eb">Bake failed</span>
        <span className="lc-bake-error-msg">
          {active.human ?? active.message}
        </span>
      </div>
      <button
        type="button"
        className="lc-bake-error-retry"
        onClick={onRetry}
      >
        Retry
      </button>
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
