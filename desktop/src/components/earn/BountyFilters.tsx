import { PlatformIcon } from "../PlatformIcon";
import type { ConnectedPlatform, SortKey } from "./types";

// Sort + filter chrome above the Available list. Optimized for clipper
// decision-making: what's the highest-earning thing I can finish today on
// the platforms I actually post to?

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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-tertiary">sort by</span>
        {sortOptions.map((o) => (
          <button
            key={o.key}
            onClick={() => onSortChange(o.key)}
            className={`rounded-full border px-3 py-1 transition-colors ${
              sort === o.key
                ? "border-fuchsia bg-fuchsia text-white"
                : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-tertiary">platforms</span>
        {platforms.map((p) => {
          const active = filterPlatforms.includes(p);
          return (
            <button
              key={p}
              onClick={() => onPlatformToggle(p)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors ${
                active
                  ? "border-fuchsia bg-fuchsia text-white"
                  : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
              }`}
              title={p}
            >
              <PlatformIcon id={p} className="h-3 w-3" />
              {p}
            </button>
          );
        })}
        <button
          onClick={() => onOpenOnlyChange(!openOnly)}
          className={`rounded-full border px-3 py-1 transition-colors ${
            openOnly
              ? "border-fuchsia bg-fuchsia text-white"
              : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
          }`}
        >
          open only
        </button>
      </div>
    </div>
  );
}
