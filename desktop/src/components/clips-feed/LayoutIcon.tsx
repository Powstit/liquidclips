// Reaction layout glyphs. Two-tone cells so the user can read "main vs
// reaction" at a glance: main = soft fill (35%), reaction = vivid fill (95%),
// frame = outline. viewBox is 24x24 so the same SVG sits cleanly in both the
// compact toolbar (16px) and the labelled tile (20px).

import type { OverlayType } from "../../lib/sidecar";

export type LayoutKey = OverlayType | "none";

const MAIN_OPACITY = 0.32;
const REACT_OPACITY = 0.95;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="3" stroke="currentColor" strokeWidth="1.5" />
      {children}
    </svg>
  );
}

export function LayoutIcon({ kind, className = "" }: { kind: LayoutKey; className?: string }) {
  const c = "currentColor";
  let inner: React.ReactNode = null;
  switch (kind) {
    case "none":
      inner = <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" fill={c} opacity={MAIN_OPACITY} />;
      break;
    case "stack-bottom":
      // main top, reaction bottom
      inner = (
        <>
          <rect x="4.5" y="4.5"  width="15" height="6.75" rx="1.2" fill={c} opacity={MAIN_OPACITY} />
          <rect x="4.5" y="12.75" width="15" height="6.75" rx="1.2" fill={c} opacity={REACT_OPACITY} />
        </>
      );
      break;
    case "stack-top":
      // reaction top, main bottom
      inner = (
        <>
          <rect x="4.5" y="4.5"  width="15" height="6.75" rx="1.2" fill={c} opacity={REACT_OPACITY} />
          <rect x="4.5" y="12.75" width="15" height="6.75" rx="1.2" fill={c} opacity={MAIN_OPACITY} />
        </>
      );
      break;
    case "split-left":
      // reaction left, main right
      inner = (
        <>
          <rect x="4.5"   y="4.5" width="6.75" height="15" rx="1.2" fill={c} opacity={REACT_OPACITY} />
          <rect x="12.75" y="4.5" width="6.75" height="15" rx="1.2" fill={c} opacity={MAIN_OPACITY} />
        </>
      );
      break;
    case "split-right":
      // main left, reaction right
      inner = (
        <>
          <rect x="4.5"   y="4.5" width="6.75" height="15" rx="1.2" fill={c} opacity={MAIN_OPACITY} />
          <rect x="12.75" y="4.5" width="6.75" height="15" rx="1.2" fill={c} opacity={REACT_OPACITY} />
        </>
      );
      break;
    case "pip-br":
      inner = (
        <>
          <rect x="4.5" y="4.5"  width="15" height="15" rx="1.5" fill={c} opacity={MAIN_OPACITY} />
          <rect x="12.5" y="12.5" width="6.5" height="6.5" rx="1" fill={c} opacity={REACT_OPACITY} />
        </>
      );
      break;
    case "pip-bl":
      inner = (
        <>
          <rect x="4.5" y="4.5"  width="15" height="15" rx="1.5" fill={c} opacity={MAIN_OPACITY} />
          <rect x="5"   y="12.5" width="6.5" height="6.5" rx="1" fill={c} opacity={REACT_OPACITY} />
        </>
      );
      break;
  }
  return <span className={`inline-flex shrink-0 ${className}`}>{<Frame>{inner}</Frame>}</span>;
}

// The 7 layouts a clipper sees in the editor. Vocabulary: "reaction", never
// "b-roll" or "overlay" (those words may still appear in backend/internal code).
export const LAYOUTS: { key: LayoutKey; label: string; short: string }[] = [
  { key: "none",         label: "Full",        short: "Full"         },
  { key: "stack-bottom", label: "Stack below", short: "Stack below"  },
  { key: "stack-top",    label: "Stack above", short: "Stack above"  },
  { key: "split-left",   label: "Split left",  short: "Split left"   },
  { key: "split-right",  label: "Split right", short: "Split right"  },
  { key: "pip-br",       label: "PiP right",   short: "PiP right"    },
  { key: "pip-bl",       label: "PiP left",    short: "PiP left"     },
];
