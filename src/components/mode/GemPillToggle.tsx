// Gem-pill mode toggle — replaces the flat text mode strip.
// Two large gem nodes (Clipper / Agency). Active gem has a pink halo + bright
// inner face. Inactive gem is dimmed but obviously clickable. Click to switch.
//
// Pairs visually with the existing mode-skin strip below it, which shows the
// 4-step mini path for the active mode (Join → Clip → Post → Submit, or
// Create → Invite → Review → Grow).

import { Scissors, Briefcase } from "../icons/BrandGlyphs";
import { useModeStore, type UserMode } from "../../state/mode";

interface GemConfig {
  mode: UserMode;
  label: string;
  caption: string;
  icon: JSX.Element;
}

const GEMS: GemConfig[] = [
  {
    mode: "clipper",
    label: "Clipper",
    caption: "I am clipping for a campaign",
    icon: <Scissors size={22} strokeWidth={1.6} />,
  },
  {
    mode: "agency",
    label: "Agency",
    caption: "I am creating a campaign",
    icon: <Briefcase size={22} strokeWidth={1.6} />,
  },
];

export function GemPillToggle(): JSX.Element {
  const { mode, setMode } = useModeStore();

  return (
    <div
      className="lc-gem-toggle"
      role="group"
      aria-label="Select user mode"
    >
      <div className="lc-gem-toggle-rail" aria-hidden="true" />
      {GEMS.map((gem) => {
        const active = mode === gem.mode;
        return (
          <button
            key={gem.mode}
            type="button"
            className="lc-gem-node"
            data-active={active ? "true" : "false"}
            data-mode={gem.mode}
            onClick={() => setMode(gem.mode)}
            aria-pressed={active}
            title={gem.caption}
          >
            <span className="lc-gem-halo" aria-hidden="true" />
            <span className="lc-gem-face">
              {gem.icon}
            </span>
            <span className="lc-gem-label">{gem.label}</span>
            <span className="lc-gem-caption">{gem.caption}</span>
          </button>
        );
      })}
    </div>
  );
}
