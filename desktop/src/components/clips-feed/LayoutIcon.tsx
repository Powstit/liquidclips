// Small SVG glyphs for the overlay layouts. Filled rectangles = b-roll cells,
// empty rectangles = main video. Rendered ~26x34px inside per-card pickers.

import type { OverlayType } from "../../lib/sidecar";

export type LayoutKey = OverlayType | "none";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg width="26" height="34" viewBox="0 0 26 34" fill="none" aria-hidden>
      <rect x="1" y="1" width="24" height="32" rx="3" stroke="currentColor" strokeWidth="1.4" />
      {children}
    </svg>
  );
}

export function LayoutIcon({ kind, className = "" }: { kind: LayoutKey; className?: string }) {
  const fill = "currentColor";
  let inner: React.ReactNode = null;
  switch (kind) {
    case "none":
      inner = null;
      break;
    case "stack-bottom":
      inner = <rect x="2.5" y="18" width="21" height="14" rx="2" fill={fill} opacity="0.85" />;
      break;
    case "stack-top":
      inner = <rect x="2.5" y="2" width="21" height="14" rx="2" fill={fill} opacity="0.85" />;
      break;
    case "split-left":
      inner = <rect x="2.5" y="2" width="10" height="30" rx="2" fill={fill} opacity="0.85" />;
      break;
    case "split-right":
      inner = <rect x="13.5" y="2" width="10" height="30" rx="2" fill={fill} opacity="0.85" />;
      break;
    case "pip-br":
      inner = <rect x="14" y="22" width="9" height="9" rx="1.5" fill={fill} opacity="0.85" />;
      break;
    case "pip-bl":
      inner = <rect x="3" y="22" width="9" height="9" rx="1.5" fill={fill} opacity="0.85" />;
      break;
  }
  return <span className={className}>{<Frame>{inner}</Frame>}</span>;
}

// The 4 layouts a clipper sees in the picker. split-h lands when the backend
// OverlayType is extended (planned: same PR that adds the ffmpeg filter).
export const LAYOUTS: { key: LayoutKey; label: string; short: string }[] = [
  { key: "none",         label: "No overlay",         short: "Full"    },
  { key: "stack-bottom", label: "Stack · bottom",     short: "Stack ↓" },
  { key: "stack-top",    label: "Stack · top",        short: "Stack ↑" },
  { key: "split-left",   label: "Split · b-roll left", short: "Split ←" },
  { key: "split-right",  label: "Split · b-roll right", short: "Split →" },
  { key: "pip-br",       label: "PiP · bottom-right", short: "PiP"     },
  { key: "pip-bl",       label: "PiP · bottom-left",  short: "PiP L"   },
];
