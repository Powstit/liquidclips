/**
 * CampaignPanel · Composer Phase 1b · F7 flowCampaign
 *
 * Brief card (Uncle Daniel · 015 · locked / 4 rule labels checked/warning) +
 * campaign picker chip row (3 chips, first fuchsia).
 *
 * Cockpit hook: none (campaign selection lives outside CockpitSettings ·
 * routed via the campaign store in Phase 1c). onPick surfaces the picked
 * campaign id to Composer.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const RULES = [
  { label: "Aspect · 9:16", ok: true },
  { label: "Watermark · on", ok: true },
  { label: "Duration · ≤ 60s", ok: true },
  { label: "Handle · @you", ok: false },
] as const;

const CAMPAIGNS = [
  { id: "015-uncle-daniel", label: "015 · Uncle Daniel", picked: true },
  { id: "021-hormozi", label: "021 · Hormozi" },
  { id: "024-open", label: "024 · Open" },
] as const;

export function CampaignPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const [picked, setPicked] = useState<string>(CAMPAIGNS[0].id);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Campaign",
      body: "Match the brief · get paid on submit.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F7</span>
        <span className="param-panel-title">Campaign · Brief</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Brief · Uncle Daniel · 015</div>
        <div className="param-input" style={{ padding: "8px 10px" }}>
          <div style={{ marginBottom: 4 }}>
            <b>Locked</b> · 60s max · vertical
          </div>
          {RULES.map((r) => (
            <div
              key={r.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "2px 0",
                color: r.ok ? "var(--money-green)" : "var(--fuchsia)",
              }}
            >
              <span>{r.label}</span>
              <span>{r.ok ? "OK" : "!"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Pick campaign</div>
        <div className="param-chip-row">
          {CAMPAIGNS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="param-chip"
              data-picked={picked === c.id ? "true" : "false"}
              onClick={() => {
                setPicked(c.id);
                onPick("campaign", c.id);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CampaignPanel;
