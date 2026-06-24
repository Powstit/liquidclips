/**
 * CaptionModule · cockpit · UI-2 + BUG-035
 *
 * Pick caption text, style preset, screen position. Apply fires
 * `sidecar.editCaptions(slug, idx, { text, style, position })` and the
 * button's `data-caption-state` machine (idle → applying → done / error)
 * is the harness-visible verdict. Mirrors the BUG-032 P0 / BUG-033 /
 * BUG-034 patterns exactly.
 *
 * Persistence: settings.caption.{text,style,position,letterSpacing}
 * already round-trip through `clipSettingsStore` (BUG-031 Patch A), so
 * per-clip restore on clip switch is owned by CockpitContext.
 *
 * Letter-spacing is COMING SOON honestly: no backend contract exists
 * (no `\fsp` field in any caption RPC), so the slider is wrapped in a
 * disabled affordance with a label so the customer is not lied to about
 * what the export will carry.
 */

import { useEffect, useState } from "react";
import { bus, useEvent } from "../../bridge";
import { sidecar } from "../sidecar-stub";
import { useEngineSession } from "../../state/useEngineSession";
import { useCockpit, type CaptionStyleKey, type CaptionPositionKey } from "./CockpitContext";
import { notify as inboxNotify } from "../../../inbox";
import "./modules.css";

const STYLE_OPTIONS: ReadonlyArray<{ id: CaptionStyleKey; label: string }> = [
  { id: "fuchsia-pop", label: "Fuchsia pop" },
  { id: "mono-clean",  label: "Mono clean" },
  { id: "amber-soft",  label: "Amber soft" },
  { id: "cyan-bold",   label: "Cyan bold" },
];

const POSITION_OPTIONS: ReadonlyArray<{ id: CaptionPositionKey; label: string }> = [
  { id: "top",    label: "Top" },
  { id: "mid",    label: "Mid" },
  { id: "bottom", label: "Bottom" },
];

export function CaptionModule() {
  const { focusedClip, settings, setCaption } = useCockpit();
  const { text, style, position, letterSpacing } = settings.caption;

  const session = useEngineSession();
  const slug = session.project?.slug ?? session.slug ?? undefined;

  const [captionState, setCaptionState] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [captionError, setCaptionError] = useState<string | null>(null);

  // The "committed" snapshot — captured from the last successful Apply.
  // Dirty = current values diverge from the committed snapshot. Apply is
  // disabled until something is dirty so the customer can't no-op the RPC.
  const [committed, setCommitted] = useState<{
    text: string; style: CaptionStyleKey; position: CaptionPositionKey;
  }>({ text, style, position });
  // Re-sync committed when the focused clip identity changes; the saved
  // settings restored by clipSettingsStore become the new baseline.
  useEffect(() => {
    setCommitted({ text, style, position });
    setCaptionState("idle");
    setCaptionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedClip.idx]);

  useEvent("engine:complete", (p) => {
    if (p.kind !== "captions") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setCaptionState("done");
    setCommitted({ text, style, position });
    /* FEATURE-001 · in-app only. */
    inboxNotify({
      kind: "caption-apply-complete",
      title: "Captions ready",
      body: "Your caption style and copy are baked into the vertical clip.",
    });
  });
  useEvent("engine:error", (p) => {
    if (p.kind !== "captions") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setCaptionState("error");
    setCaptionError(p.human ?? p.error ?? "Caption update failed");
  });

  // After "done" lands, drop back to idle so the next dirty edit can fire.
  useEffect(() => {
    if (captionState !== "done") return;
    const t = window.setTimeout(() => setCaptionState("idle"), 2400);
    return () => window.clearTimeout(t);
  }, [captionState]);

  const dirty =
    text !== committed.text ||
    style !== committed.style ||
    position !== committed.position;
  const canApply = dirty && captionState !== "applying";

  async function onApply() {
    if (captionState === "applying") return;
    if (!slug) {
      bus.emit("toast", {
        kind: "error",
        title: "No project bound",
        body: "Generate clips first, then edit captions.",
      });
      return;
    }
    setCaptionState("applying");
    setCaptionError(null);
    try {
      await sidecar.editCaptions(slug, focusedClip.idx, { text, style, position });
      // The "done" transition lands via the engine:complete listener above.
    } catch (e) {
      setCaptionState("error");
      const msg = e instanceof Error ? e.message : String(e);
      setCaptionError(msg);
    }
  }

  return (
    <section className="lc-cd-mod">
      {/* LEFT · controls */}
      <div>
        <header className="lc-cd-mod-head">
          <span className="lc-cd-mod-eb">Caption</span>
          <span className="lc-cd-mod-sub">One line. Make it land in the first second.</span>
        </header>

        <div className="lc-cd-section">
          <span className="lc-cd-lbl">Line</span>
          <input
            className="lc-cd-text-input"
            data-testid="caption-text"
            type="text"
            value={text}
            maxLength={120}
            onChange={(e) => setCaption({ text: e.target.value })}
          />
        </div>

        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <span className="lc-cd-lbl">Style</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Caption style">
            {STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                data-testid={`caption-style-${opt.id}`}
                aria-checked={style === opt.id}
                className={`lc-cd-chip ${style === opt.id ? "on" : ""}`}
                onClick={() => setCaption({ style: opt.id })}
              >{opt.label}</button>
            ))}
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <span className="lc-cd-lbl">Position</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Caption position">
            {POSITION_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                data-testid={`caption-position-${opt.id}`}
                aria-checked={position === opt.id}
                className={`lc-cd-chip ${position === opt.id ? "on" : ""}`}
                onClick={() => setCaption({ position: opt.id })}
              >{opt.label}</button>
            ))}
          </div>
        </div>

        {/* BUG-035 · letter-spacing has no backend / export contract today.
            Wrap honestly so the customer is not led to expect their export
            will carry the value. Slider stays so the dock-preview can still
            reflect the choice for the customer's own eye, but a clear
            "Coming soon · not exported yet" label sets the right expectation. */}
        <div className="lc-cd-section" style={{ marginTop: 14 }}>
          <span className="lc-cd-lbl" data-testid="caption-letter-spacing-label">
            Letter spacing
            <span
              data-testid="caption-letter-spacing-coming-soon"
              style={{
                marginLeft: 8,
                fontSize: 9,
                letterSpacing: ".15em",
                padding: "2px 6px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,.18)",
                color: "rgba(255,255,255,.66)",
                textTransform: "uppercase",
              }}
            >
              Coming soon · not exported yet
            </span>
          </span>
          <div className="lc-cd-row">
            <input
              className="lc-cd-slider"
              data-testid="caption-letter-spacing"
              type="range"
              min={0} max={12} step={1}
              value={letterSpacing}
              onChange={(e) => setCaption({ letterSpacing: Number(e.target.value) })}
              aria-label="Letter spacing"
            />
            <span className="lc-cd-slider-val">{letterSpacing}px</span>
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 18 }}>
          <button
            type="button"
            data-testid="caption-apply"
            data-caption-state={captionState}
            className={`lc-cd-chip ${canApply ? "on" : ""}`}
            disabled={!canApply}
            onClick={onApply}
            style={{ minWidth: 160, justifyContent: "center" }}
          >
            {captionState === "applying"
              ? "Applying captions…"
              : captionState === "done"
                ? "Applied ✓"
                : captionState === "error"
                  ? "Retry caption"
                  : "Apply captions"}
          </button>
          {captionError && (
            <span
              data-testid="caption-error"
              style={{ fontSize: 11, color: "#ff7aa0", marginLeft: 12 }}
            >
              {captionError}
            </span>
          )}
        </div>
      </div>

      {/* RIGHT · live preview + readout */}
      <div className="lc-cd-readout" aria-label="Caption preview">
        <span className="lc-cd-readout-key">Live preview</span>
        <div
          className={`lc-cd-cap-preview pos-${position}`}
          data-testid="caption-preview"
          data-style={style}
          data-position={position}
          style={{ letterSpacing: `${letterSpacing}px` }}
        >
          <span className="lc-cd-cap-text" data-testid="caption-preview-text">{text || "Paste your hook here"}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Style</span>
          <span className="lc-cd-readout-val" data-testid="caption-readout-style">{STYLE_OPTIONS.find((s) => s.id === style)?.label}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Position</span>
          <span className="lc-cd-readout-val" data-testid="caption-readout-position">{POSITION_OPTIONS.find((p) => p.id === position)?.label}</span>
        </div>
      </div>
    </section>
  );
}
