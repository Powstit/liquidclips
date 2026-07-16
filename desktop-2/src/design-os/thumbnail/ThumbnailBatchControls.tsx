/**
 * ThumbnailBatchControls · Phase 6F
 *
 * IG-010 non-blocking batch pair UI. Renders:
 *   - "Generate batch" CTA (X variants × Y quality)
 *   - active batch progress with AllowanceBar
 *   - Cancel button (writes the cancel marker through stub.batchCancel)
 *   - Retry on error (re-issues batchStart with last spec)
 *   - "Studio preview" honesty tag — NEVER claims real production success
 */

import { humanError } from "../../lib/humanError";
import { useEffect, useState } from "react";
import { GlassCard, AllowanceBar } from "../components";
import { useEngineSession } from "../state/useEngineSession";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { thumbnail } from "../engine/sidecar-stub";
import { bus, useEvent } from "../bridge";
import {
  type ThumbnailItem, type ThumbnailQuality,
  COST_USD,
} from "./types";
import { ThumbnailQuotaBadge } from "./ThumbnailQuotaBadge";
import "./ThumbnailBatchControls.css";

export interface ThumbnailBatchControlsProps {
  slug: string;
  /** Title that drives every variant's `text` field. */
  title: string;
  /** Default batch size · audit recommends 8 (matches legacy default). */
  defaultBatchSize?: number;
  defaultQuality?: ThumbnailQuality;
  defaultAccent?: string;
}

interface LastSpec {
  items: ThumbnailItem[];
  size: number;
  quality: ThumbnailQuality;
}

export function ThumbnailBatchControls({
  slug, title,
  defaultBatchSize = 8,
  defaultQuality = "medium",
  defaultAccent = "fuchsia",
}: ThumbnailBatchControlsProps) {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();

  const [size, setSize] = useState(defaultBatchSize);
  const [quality, setQuality] = useState<ThumbnailQuality>(defaultQuality);
  const [accent, setAccent] = useState(defaultAccent);
  const [running, setRunning] = useState(false);
  const [lastSpec, setLastSpec] = useState<LastSpec | null>(null);
  const [errored, setErrored] = useState<string | null>(null);

  // Listen for batch lifecycle on the bus
  useEvent("engine:complete", (p) => {
    if (p.kind === "thumbnail-batch" && p.slug === slug) {
      setRunning(false);
      setErrored(null);
    }
  });
  useEvent("engine:error", (p) => {
    if (p.kind === "thumbnail-batch" && p.slug === slug) {
      setRunning(false);
      setErrored(p.human ?? p.error);
    }
  });
  // Auto-clear running flag if session resets
  useEffect(() => {
    if (session.phase === "idle") setRunning(false);
  }, [session.phase]);

  const cost = size * COST_USD[quality];

  const buildItems = (): ThumbnailItem[] =>
    Array.from({ length: size }, (_, i) => ({
      text: title || "Untitled clip",
      accent,
      quality,
      order: i + 1,
    }));

  const onStart = async () => {
    const items = buildItems();
    setLastSpec({ items, size, quality });
    setErrored(null);
    setRunning(true);
    try {
      await thumbnail.batchStart(slug, items);
      bus.emit("toast", {
        kind: "info",
        title: "Batch queued",
        body: `${size} × ${quality} · Studio preview only.`,
      });
    } catch (e) {
      setRunning(false);
      setErrored(humanError(e));
    }
  };

  const onCancel = async () => {
    await thumbnail.batchCancel(slug);
    setRunning(false);
    bus.emit("toast", {
      kind: "info",
      title: "Batch cancelled",
      body: "Cancel marker written. Engine will stop after current variant.",
    });
  };

  const onRetry = async () => {
    if (!lastSpec) return;
    setErrored(null);
    setRunning(true);
    await thumbnail.batchStart(slug, lastSpec.items);
    bus.emit("toast", {
      kind: "info",
      title: "Retrying batch",
      body: `${lastSpec.size} × ${lastSpec.quality}.`,
    });
  };

  const activePct = running && session.stage === "thumbnail" && session.percent != null
    ? session.percent
    : 0;
  const stateForBar = errored
    ? "empty" as const
    : running ? "low" as const
    : "healthy" as const;

  return (
    <GlassCard density="default" className="lc-tbc">
      <header className="lc-tbc-head">
        <div>
          <span className="lc-tbc-eb">Batch · IG-010 non-blocking</span>
          <span className="lc-tbc-sub">
            {runtime.mode === "mock" ? "Studio preview · mock pipeline" : "Live engine"}
          </span>
        </div>
        {runtime.mode === "mock" && (
          <span className="lc-tbc-tag">Studio preview</span>
        )}
      </header>

      {/* Spec */}
      <div className="lc-tbc-spec">
        <label className="lc-tbc-field">
          <span>Variants</span>
          <input
            type="number"
            min={1} max={12}
            value={size}
            onChange={(e) => setSize(Math.max(1, Math.min(12, parseInt(e.target.value || "1", 10))))}
            disabled={running}
          />
        </label>
        <div className="lc-tbc-field">
          <span>Quality</span>
          <div className="lc-tbc-pills">
            {(["low", "medium", "high"] as const).map((q) => (
              <button
                key={q}
                type="button"
                aria-pressed={quality === q}
                className={`lc-tbc-pill ${quality === q ? "is-active" : ""}`}
                onClick={() => setQuality(q)}
                disabled={running}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="lc-tbc-field">
          <span>Accent</span>
          <select
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            disabled={running}
            className="lc-tbc-select"
          >
            {["fuchsia", "cyan", "amber", "emerald", "indigo", "rose", "ivory", "ink"].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="lc-tbc-field lc-tbc-field-cost">
          <span>Estimate</span>
          <strong>${cost.toFixed(2)}</strong>
        </div>
      </div>

      {/* Progress (always present when running) */}
      {running && (
        <div className="lc-tbc-progress">
          <AllowanceBar
            state={stateForBar}
            used={Math.round(activePct * size)}
            total={size}
            label={session.note ?? `Generating · ${Math.round(activePct * 100)}%`}
          />
        </div>
      )}

      {errored && (
        <p className="lc-tbc-error">{errored}</p>
      )}

      {/* Footer · CTAs */}
      <footer className="lc-tbc-foot">
        {/* v2.2.17 · quota badge · hides for BYO-key (Solo) tiers.
         *  Click sends the user to the $9 boost pack checkout. */}
        <ThumbnailQuotaBadge />
        {!running && !errored && (
          <button
            type="button"
            className="lc-tbc-btn"
            onClick={onStart}
            disabled={!title.trim() || size < 1}
          >
            Generate {size} variants
          </button>
        )}
        {running && (
          <button type="button" className="lc-tbc-btn lc-tbc-btn-quiet" onClick={onCancel}>
            Cancel batch
          </button>
        )}
        {errored && (
          <>
            <button type="button" className="lc-tbc-btn" onClick={onRetry} disabled={!lastSpec}>
              Retry batch
            </button>
            <button
              type="button"
              className="lc-tbc-btn lc-tbc-btn-quiet"
              onClick={() => setErrored(null)}
            >
              Dismiss
            </button>
          </>
        )}
        <p className="lc-tbc-foot-note">
          {runtime.mode === "mock"
            ? "No real OpenAI call. Real batch lands with sidecar runtime."
            : "Real batch · IG-010 non-blocking pair."}
        </p>
      </footer>
    </GlassCard>
  );
}
