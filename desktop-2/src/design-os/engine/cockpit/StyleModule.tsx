/**
 * StyleModule · cockpit · UI-2 + BUG-037
 *
 * Brand preset + accent are persisted per-clip via clipSettingsStore but
 * have no backend / export contract today, so they are wrapped in honest
 * COMING SOON badges — same pattern as caption letter-spacing (BUG-035).
 * The previous Style watermark toggle has been REMOVED — PublishModule is
 * the single source of truth post-BUG-036, and a duplicate toggle would
 * be a divergent lie.
 *
 * Readout's "Watermark" row READS the effective decision from
 * (tier.caps.watermarkLocked || publish.watermark), so the customer sees
 * the same number in the Style summary as on the Publish CTA and the
 * preview badge. One value. One promise.
 */

import { bus } from "../../bridge";
import { useTierCaps } from "../../state/useTierCaps";
import { useCockpit, type StylePresetKey, type StyleAccentKey } from "./CockpitContext";
import "./modules.css";

const PRESETS: ReadonlyArray<{
  id: StylePresetKey;
  label: string;
  blurb: string;
  bg: string;
  fg: string;
}> = [
  { id: "uncle-daniel", label: "Uncle Daniel", blurb: "Stamped campaign look", bg: "linear-gradient(180deg, #2a0e1a 0%, #110611 100%)", fg: "#ff66b8" },
  { id: "mono",         label: "Mono",         blurb: "Black on white, calm",  bg: "linear-gradient(180deg, #f4f1ea 0%, #ddd8cf 100%)", fg: "#0a0a10" },
  { id: "loud",         label: "Loud",         blurb: "Yellow on black, bold", bg: "linear-gradient(180deg, #1b1b22 0%, #0a0a10 100%)", fg: "#f5d142" },
];

const ACCENTS: ReadonlyArray<{ id: StyleAccentKey; label: string; color: string }> = [
  { id: "fuchsia", label: "Fuchsia", color: "#ff1a8c" },
  { id: "cyan",    label: "Cyan",    color: "#3ad5ff" },
  { id: "amber",   label: "Amber",   color: "#f59e0b" },
];

const COMING_SOON_PILL: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 9,
  letterSpacing: ".15em",
  padding: "2px 6px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.18)",
  color: "rgba(255,255,255,.66)",
  textTransform: "uppercase",
};

export function StyleModule() {
  const { settings, setStyle } = useCockpit();
  const { preset, accent } = settings.style;

  // BUG-037 single source of truth · effective watermark mirrors
  // PublishModule.deriveWatermarkPromise so the Style readout cannot
  // disagree with the toggle, the badge, or the export.
  const tier = useTierCaps();
  const effectiveWatermark =
    tier.loading
    || tier.source === "unknown"
    || tier.source === "fixture-fallback"
    || tier.caps.watermarkLocked
    || settings.publish.watermark;

  return (
    <section className="lc-cd-mod">
      <div>
        <header className="lc-cd-mod-head">
          <span className="lc-cd-mod-eb">Style</span>
          <span className="lc-cd-mod-sub">Brand preset, accent. Watermark lives in Publish.</span>
        </header>

        {/* BUG-037 · Brand preset · COMING SOON honesty. Chips stay
            interactive so persistence across clip switch is verifiable,
            but the visible badge tells the customer the export doesn't
            carry them yet. Same pattern as caption letter-spacing (BUG-035). */}
        <div className="lc-cd-section">
          <span
            className="lc-cd-lbl"
            data-testid="style-preset-label"
          >
            Brand preset
            <span
              data-testid="style-preset-coming-soon"
              style={COMING_SOON_PILL}
            >
              Coming soon · not exported yet
            </span>
          </span>
          <div className="lc-cd-row">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid={`style-preset-${p.id}`}
                aria-pressed={preset === p.id}
                className={`lc-cd-card lc-cd-style-card ${preset === p.id ? "on" : ""}`}
                onClick={() => setStyle({ preset: p.id })}
                style={{ background: p.bg }}
              >
                <span className="lc-cd-card-eb">{p.label}</span>
                <span className="lc-cd-style-cap" style={{ color: p.fg }}>Aa</span>
                <span className="lc-cd-style-blurb">{p.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        {/* BUG-037 · Accent · COMING SOON honesty. */}
        <div className="lc-cd-section" style={{ marginTop: 16 }}>
          <span
            className="lc-cd-lbl"
            data-testid="style-accent-label"
          >
            Accent
            <span
              data-testid="style-accent-coming-soon"
              style={COMING_SOON_PILL}
            >
              Coming soon · not exported yet
            </span>
          </span>
          <div className="lc-cd-row">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                data-testid={`style-accent-${a.id}`}
                aria-pressed={accent === a.id}
                className={`lc-cd-chip lc-cd-accent-chip ${accent === a.id ? "on" : ""}`}
                onClick={() => setStyle({ accent: a.id })}
              >
                <span className="lc-cd-accent-dot" style={{ background: a.color, boxShadow: `0 0 10px ${a.color}` }} />
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* BUG-037 · Watermark POINTER, not a toggle. The duplicate
            Style watermark toggle has been REMOVED — Publish is the
            single source of truth per BUG-036. */}
        <div className="lc-cd-section" style={{ marginTop: 16 }}>
          <p
            data-testid="style-watermark-pointer"
            className="lc-cd-mod-sub"
          >
            Watermark is set in the Publish tab.{" "}
            <button
              type="button"
              data-testid="style-watermark-jump"
              onClick={() => bus.emit("clip:open-export", { clipIdx: 0 })}
              style={{
                background: "transparent",
                border: "none",
                color: "#ff66b8",
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
              }}
            >
              Open Publish
            </button>
          </p>
        </div>
      </div>

      <div className="lc-cd-readout" aria-label="Style summary">
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Preset</span>
          <span className="lc-cd-readout-val" data-testid="style-readout-preset">
            {PRESETS.find((p) => p.id === preset)?.label}
          </span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Accent</span>
          <span className="lc-cd-readout-val" data-testid="style-readout-accent">
            {ACCENTS.find((a) => a.id === accent)?.label}
          </span>
        </div>
        {/* BUG-037 · readout reflects the EFFECTIVE watermark decision —
            same value PublishModule and ClipPreviewShell read. */}
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Watermark</span>
          <span
            className="lc-cd-readout-val"
            data-testid="style-readout-watermark"
            data-effective={String(effectiveWatermark)}
          >
            {effectiveWatermark ? "On (set in Publish)" : "Off (set in Publish)"}
          </span>
        </div>
      </div>
    </section>
  );
}
