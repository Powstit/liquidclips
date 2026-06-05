// v0.6.38 — Cockpit-pass refactor.
//
// Sort + platform + open-only filters all swap to HudChip so Earn speaks
// the same chrome as Library + Workstation. Layout structure unchanged —
// each row keeps its label + button list, just transparent fill, fuchsia
// bracket corners on active state, springy hover.

import { PlatformIcon } from "../PlatformIcon";
import { HudChip } from "../cockpit/HudChip";
import type { ConnectedPlatform, SortKey } from "./types";

export function BountyFilters({
  sort,
  onSortChange,
  filterPlatforms,
  onPlatformToggle,
  openOnly,
  onOpenOnlyChange,
}: {
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  filterPlatforms: ConnectedPlatform[];
  onPlatformToggle: (p: ConnectedPlatform) => void;
  openOnly: boolean;
  onOpenOnlyChange: (v: boolean) => void;
}) {
  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "best_match", label: "best match" },
    { key: "highest_payout", label: "highest £/1k" },
    { key: "most_spots", label: "most spots left" },
    { key: "closing_soon", label: "closing soon" },
  ];

  const platforms: ConnectedPlatform[] = ["youtube", "tiktok", "instagram", "x"];

  return (
    <div className="flex flex-col gap-3 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-text-tertiary">sort by</span>
        {sortOptions.map((o) => (
          <HudChip key={o.key} active={sort === o.key} onClick={() => onSortChange(o.key)}>
            {o.label}
          </HudChip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-text-tertiary">platforms</span>
        {platforms.map((p) => (
          <HudChip
            key={p}
            active={filterPlatforms.includes(p)}
            onClick={() => onPlatformToggle(p)}
          >
            <PlatformIcon id={p} className="h-3 w-3" />
            <span>{p}</span>
          </HudChip>
        ))}
        <HudChip active={openOnly} onClick={() => onOpenOnlyChange(!openOnly)}>
          open only
        </HudChip>
      </div>
    </div>
  );
}
