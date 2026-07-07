// Small mode badge used on cards, sections, and campaign surfaces.

import { Scissors, Briefcase } from "../icons/BrandGlyphs";
import type { UserMode } from "../../state/mode";

interface ModeBadgeProps {
  mode: UserMode;
  className?: string;
}

export function ModeBadge({ mode, className = "" }: ModeBadgeProps): JSX.Element {
  const isAgency = mode === "agency";

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        isAgency
          ? "border-cyan/40 bg-cyan/10 text-cyan"
          : "border-fuchsia/40 bg-fuchsia/10 text-fuchsia",
        className,
      ].join(" ")}
    >
      {isAgency ? <Briefcase size={12} /> : <Scissors size={12} />}
      {isAgency ? "Agency Mode" : "Clipper Mode"}
    </span>
  );
}
