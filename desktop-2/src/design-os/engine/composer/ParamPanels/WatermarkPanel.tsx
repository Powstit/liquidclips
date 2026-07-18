/**
 * WatermarkPanel · Composer Phase 1b · F12 flowWatermark
 *
 * 3-card preset picker (Corner-BR · Corner-BL · Full-bar) + handle input +
 * QR toggle + stats row (mocked: views · signups · MRR).
 *
 * Cockpit hook: `setStyle` from `useCockpit()` — flips the boolean
 * `style.watermark` field. Preset key, handle, QR toggle are NOT part of
 * CockpitSettings today — flagged for Agent 3 to extend
 * CockpitSettings.baseWindow.
 */

/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-J · Watermark preset contract · LOCKED 2026-07-18
   ─────────────────────────────────────────────────────────────────────
   WatermarkPanel writes the `watermark` boolean via `setStyle` from
   `useCockpit()` · shares CockpitSettings.style with the existing
   ExportPanel watermark render. The 3-preset picker is a UX layer on
   top of the boolean · full BR/BL/full-bar preset variants graduate
   when the referral-flywheel wiring (feature C3) lands and ExportPanel
   exposes preset render fields. Until then, all 3 chips write the
   same `watermark: true` bool · that's honest, not theater.
   Regression test `Composer.watermarkpanel.test.ts` + lint invariants
   #59–62 enforce.
   ═════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit } from "../../cockpit/CockpitContext";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const PRESETS: ReadonlyArray<{
  value: "corner-br" | "corner-bl" | "full-bar";
  label: string;
  hint: string;
}> = [
  { value: "corner-br", label: "Corner · BR", hint: "60%" },
  { value: "corner-bl", label: "Corner · BL", hint: "90%" },
  { value: "full-bar", label: "Full bar", hint: "100%" },
];

export function WatermarkPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const { settings, setStyle } = useCockpit();
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["value"]>(
    "corner-br",
  );
  const [handle, setHandle] = useState<string>("@you");
  const [qr, setQr] = useState<boolean>(false);
  const on = settings.style.watermark;

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Watermark",
      body: "This is how you get paid on every re-post.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F12</span>
        <span className="param-panel-title">Watermark</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Preset</div>
        <div className="param-grid param-grid-3">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className="param-tile"
              data-picked={preset === p.value ? "true" : "false"}
              onClick={() => {
                setPreset(p.value);
                setStyle({ watermark: true });
                onPick("preset", p.value);
              }}
            >
              <div>{p.label}</div>
              <div style={{ fontSize: "8.5px", opacity: 0.6 }}>{p.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Handle</div>
        <input
          className="param-input"
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onBlur={() => onPick("handle", handle)}
          aria-label="Watermark handle"
          spellCheck={false}
        />
      </div>

      <div className="param-section">
        <div className="param-toggle-row">
          <span className="param-toggle-label">QR link</span>
          <button
            type="button"
            className="param-toggle"
            data-on={qr ? "true" : "false"}
            aria-pressed={qr}
            onClick={() => {
              const next = !qr;
              setQr(next);
              onPick("qr", next);
            }}
          />
        </div>
        <div className="param-toggle-row">
          <span className="param-toggle-label">Watermark on</span>
          <button
            type="button"
            className="param-toggle"
            data-on={on ? "true" : "false"}
            aria-pressed={on}
            onClick={() => {
              const next = !on;
              setStyle({ watermark: next });
              onPick("watermark", next);
            }}
          />
        </div>
      </div>

      <div className="param-stats" aria-live="polite">
        <span>
          <b>324</b> views
        </span>
        <span>
          <b>4</b> signups
        </span>
        <span>
          <b>MRR</b> live
        </span>
      </div>
    </div>
  );
}

export default WatermarkPanel;
