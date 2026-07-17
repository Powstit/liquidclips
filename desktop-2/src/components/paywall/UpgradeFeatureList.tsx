/**
 * UpgradeFeatureList · shared "what you unlock at Founder Access" list.
 *
 * Single source of truth for the Founder Access ($99.99/mo) pitch,
 * imported by both:
 *   - ActivateFounderPanel (pre-first-drop membership nudge)
 *   - AssetRansomPaywall (asset-completion ransom paywall)
 *
 * Copy stays in sync across every paywall surface. Editing this file
 * updates every place the pitch is shown.
 */
import type { ReactElement } from "react";

const FEATURES: ReadonlyArray<{ label: string; sub?: string }> = [
  { label: "100 hours of AI clipping / month" },
  { label: "Watermark off" },
  { label: "Unlimited clips + thumbnails" },
  { label: "Custom captions + scheduling" },
  { label: "Agency campaigns · earn from sponsored posts" },
];

export function UpgradeFeatureList({ compact = false }: { compact?: boolean }): ReactElement {
  return (
    <ul className={compact ? "lc-upgrade-features lc-upgrade-features--compact" : "lc-upgrade-features"}>
      {FEATURES.map((f) => (
        <li key={f.label} className="lc-upgrade-feature">
          <span className="lc-upgrade-feature-dot" aria-hidden="true" />
          <span className="lc-upgrade-feature-label">{f.label}</span>
        </li>
      ))}
      <style>{UPGRADE_FEATURE_STYLES}</style>
    </ul>
  );
}

const UPGRADE_FEATURE_STYLES = `
.lc-upgrade-features {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lc-upgrade-features--compact { gap: 4px; margin-bottom: 12px; }
.lc-upgrade-feature {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: "Inter", system-ui, sans-serif;
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(244, 241, 234, 0.86);
}
.lc-upgrade-feature-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #ff66b8;
  box-shadow: 0 0 8px rgba(255, 102, 184, 0.6);
  flex: 0 0 auto;
}
.lc-upgrade-feature-label { font-weight: 500; }
`;
