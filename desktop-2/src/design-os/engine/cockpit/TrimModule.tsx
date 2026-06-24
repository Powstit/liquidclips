/**
 * TrimModule · cockpit · UI-2 + BUG-034
 *
 * Drag-style trim handles + a static waveform bar + Apply Trim CTA that
 * fires `sidecar.regenerateClip(slug, idx, in, out)`. The button's
 * `data-trim-state` machine (idle → regenerating → done / error) is the
 * harness-visible verdict. Mirrors the ReactionModule Apply pattern
 * (BUG-032 P0) and the PublishModule export pattern (BUG-033).
 *
 * Persistence: settings.trim.{inS,outS} already round-trip through
 * `clipSettingsStore` (BUG-031 Patch A), so per-clip restore on clip
 * switch is owned by CockpitContext, not this module.
 */

import { useEffect, useMemo, useState } from "react";
import { bus, useEvent } from "../../bridge";
import { useCockpit } from "./CockpitContext";
import { sidecar } from "../sidecar-stub";
import { useEngineSession } from "../../state/useEngineSession";
import { notify as inboxNotify } from "../../../inbox";
import "./modules.css";

export function TrimModule() {
  const { focusedClip, settings, setTrim } = useCockpit();
  const { inS, outS } = settings.trim;
  const clipStart = focusedClip.start;
  const clipEnd = focusedClip.end;
  const dur = Math.max(1, outS - inS);

  const session = useEngineSession();
  const slug = session.project?.slug ?? session.slug ?? undefined;

  const [trimState, setTrimState] = useState<"idle" | "regenerating" | "done" | "error">("idle");
  const [trimError, setTrimError] = useState<string | null>(null);

  useEvent("engine:complete", (p) => {
    if (p.kind !== "regenerate") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setTrimState("done");
    /* FEATURE-001 · in-app only. */
    inboxNotify({
      kind: "trim-regenerate-complete",
      title: "Trim updated",
      body: "Your new in/out range is rendered and ready to export.",
    });
  });
  useEvent("engine:error", (p) => {
    if (p.kind !== "regenerate") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setTrimState("error");
    setTrimError(p.human ?? p.error ?? "Trim failed");
  });

  // After we land "done", reset the badge back to "idle" the next time the
  // customer touches a slider, so the affordance reflects the live state.
  useEffect(() => {
    if (trimState !== "done") return;
    const t = window.setTimeout(() => setTrimState("idle"), 2400);
    return () => window.clearTimeout(t);
  }, [trimState]);

  // Deterministic bar pattern per clip so the waveform doesn't reshuffle.
  const bars = useMemo(() => buildBars(focusedClip.idx), [focusedClip.idx]);

  async function onApply() {
    if (trimState === "regenerating") return;
    if (!slug) {
      bus.emit("toast", {
        kind: "error",
        title: "No project bound",
        body: "Generate clips first, then trim.",
      });
      return;
    }
    if (outS <= inS) {
      bus.emit("toast", {
        kind: "error",
        title: "Invalid trim range",
        body: "Out must be greater than In.",
      });
      return;
    }
    setTrimState("regenerating");
    setTrimError(null);
    try {
      await sidecar.regenerateClip(slug, focusedClip.idx, inS, outS);
      // The "done" transition lands via the engine:complete listener above
      // (mock fallback fires it ~1.2s after the call; real sidecar fires it
      // when ffmpeg finishes). Keeps a single source of truth for "done".
    } catch (e) {
      setTrimState("error");
      const msg = e instanceof Error ? e.message : String(e);
      setTrimError(msg);
    }
  }

  const dirty = inS !== focusedClip.start || outS !== focusedClip.end;
  const canApply = dirty && trimState !== "regenerating";

  return (
    <section className="lc-cd-mod">
      <div>
        <header className="lc-cd-mod-head">
          <span className="lc-cd-mod-eb">Trim</span>
          <span className="lc-cd-mod-sub">Tighten the start and end.</span>
        </header>

        <div className="lc-cd-section">
          <div className="lc-cd-wave" aria-label="Waveform">
            {bars.map((h, i) => {
              const t = clipStart + (i / bars.length) * (clipEnd - clipStart);
              const within = t >= inS && t <= outS;
              return (
                <span
                  key={i}
                  className={`lc-cd-wave-bar ${within ? "in" : "out"}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
            <span
              className="lc-cd-wave-handle in"
              style={{ left: pctOf(inS, clipStart, clipEnd) }}
              aria-hidden="true"
            />
            <span
              className="lc-cd-wave-handle out"
              style={{ left: pctOf(outS, clipStart, clipEnd) }}
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <div className="lc-cd-row">
            <span className="lc-cd-lbl">In</span>
            <input
              className="lc-cd-slider"
              data-testid="trim-in"
              type="range"
              min={clipStart}
              max={Math.max(clipStart, outS - 1)}
              step={1}
              value={inS}
              onChange={(e) => setTrim({ inS: Number(e.target.value) })}
              aria-label="Trim in"
            />
            <span className="lc-cd-slider-val" data-testid="trim-in-val">{fmtSec(inS)}</span>
          </div>
          <div className="lc-cd-row">
            <span className="lc-cd-lbl">Out</span>
            <input
              className="lc-cd-slider"
              data-testid="trim-out"
              type="range"
              min={Math.min(clipEnd, inS + 1)}
              max={clipEnd}
              step={1}
              value={outS}
              onChange={(e) => setTrim({ outS: Number(e.target.value) })}
              aria-label="Trim out"
            />
            <span className="lc-cd-slider-val" data-testid="trim-out-val">{fmtSec(outS)}</span>
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 18 }}>
          <button
            type="button"
            data-testid="trim-apply"
            data-trim-state={trimState}
            className={`lc-cd-chip ${canApply ? "on" : ""}`}
            disabled={!canApply}
            onClick={onApply}
            style={{ minWidth: 160, justifyContent: "center" }}
          >
            {trimState === "regenerating"
              ? "Re-cutting…"
              : trimState === "done"
                ? "Trimmed ✓"
                : trimState === "error"
                  ? "Retry trim"
                  : "Apply trim"}
          </button>
          {trimError && (
            <span
              data-testid="trim-error"
              style={{ fontSize: 11, color: "#ff7aa0", marginLeft: 12 }}
            >
              {trimError}
            </span>
          )}
        </div>
      </div>

      <div className="lc-cd-readout" aria-label="Trim summary">
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Duration</span>
          <span className="lc-cd-readout-val" data-testid="trim-duration">{fmtSec(dur)}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Range</span>
          <span className="lc-cd-readout-val">{fmtSec(inS)} → {fmtSec(outS)}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Source</span>
          <span className="lc-cd-readout-val">{fmtSec(clipStart)} → {fmtSec(clipEnd)}</span>
        </div>
      </div>
    </section>
  );
}

function pctOf(v: number, lo: number, hi: number): string {
  if (hi <= lo) return "0%";
  return `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Deterministic bar heights — looks musical without needing audio decode. */
function buildBars(seed: number): number[] {
  const n = 64;
  const out: number[] = [];
  let x = (seed + 1) * 13.37;
  for (let i = 0; i < n; i++) {
    x = (Math.sin(x) * 10000) % 1;
    const v = Math.abs(x);
    out.push(18 + Math.round(v * 70));
  }
  return out;
}
