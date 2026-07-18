/**
 * WatermarkPanel · Composer Phase 1b · F12 flowWatermark
 *
 * 3-card preset picker (Corner-BR · Corner-BL · Full-bar) + handle input +
 * QR toggle + stats row (mocked: views · signups · MRR).
 *
 * Cockpit hooks: `setStyle` flips `style.watermark`. `setBaseWindow`
 * writes `watermarkPreset` / `watermarkHandle` / `watermarkQr` so the
 * export pipeline can burn the real referral URL. IG-COMPOSER-R lands
 * the deterministic URL via getReferralUrl(handle).
 */

/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-J · Watermark preset contract · LOCKED 2026-07-18
   ─────────────────────────────────────────────────────────────────────
   WatermarkPanel writes the `watermark` boolean via `setStyle` from
   `useCockpit()` · shares CockpitSettings.style with the existing
   ExportPanel watermark render. C3 wire-in (2026-07-18): the panel
   also seeds `watermarkHandle` from useMe().snapshot?.handle and burns
   the deterministic referral URL via getReferralUrl(handle) into
   CockpitSettings.baseWindow so the exporter can lay it into the MP4
   corner without a network round-trip. IG-COMPOSER-R governs the URL
   generator itself.
   Regression test `Composer.watermarkpanel.test.ts` + lint invariants
   #59–62 enforce.
   ═════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit } from "../../cockpit/CockpitContext";
import { useMe } from "../../../state/useMe";
import { getReferralUrl } from "../../../../lib/referralUrl";
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
  const { settings, setStyle, setBaseWindow } = useCockpit();
  const me = useMe();
  const identityHandle = me.snapshot?.handle ?? null;
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["value"]>(
    settings.baseWindow?.watermarkPreset ?? "corner-br",
  );
  const [handle, setHandle] = useState<string>(
    settings.baseWindow?.watermarkHandle ?? identityHandle ?? "@you",
  );
  const [qr, setQr] = useState<boolean>(settings.baseWindow?.watermarkQr ?? false);
  const on = settings.style.watermark;
  const referralUrl = getReferralUrl(handle);

  // Seed baseWindow.watermarkHandle from the identity ladder on first
  // mount. If the user later edits the handle field, the local onBlur
  // handler pushes the override; if they don't, this ensures the
  // export pipeline sees the real signed-in handle rather than "@you".
  useEffect(() => {
    if (!identityHandle) return;
    if (settings.baseWindow?.watermarkHandle) return; // already set
    setBaseWindow({ watermarkHandle: identityHandle });
    setHandle(identityHandle);
  }, [identityHandle, settings.baseWindow?.watermarkHandle, setBaseWindow]);

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
                setBaseWindow({ watermarkPreset: p.value });
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
          onBlur={() => {
            setBaseWindow({ watermarkHandle: handle });
            onPick("handle", handle);
          }}
          aria-label="Watermark handle"
          spellCheck={false}
        />
        <div
          className="param-referral-hint"
          data-testid="watermark-referral-url"
          style={{ marginTop: 6, fontSize: 10, opacity: 0.7 }}
        >
          {referralUrl ?? "claim a handle to burn a referral URL"}
        </div>
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
              setBaseWindow({ watermarkQr: next });
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
