// Earn redesign — right rail.
// Three stacked sections: Active brief, Your clips (top 3), Your campaigns (top 5).
// Each has an expand toggle for power use; default state shows all three open.
//
// Empty states nudge toward the next action instead of leaving dead space:
//   - No active brief        → "Open browser" pill
//   - No clips logged        → "Log a post" entry already lives in section header
//   - No campaigns saved     → "Add" entry already lives in section header

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Pill } from "../primitives";
import { useActiveBrief, type AllowedPlatform, type PayoutProvider } from "../../lib/briefs";
import { openBrowsePanel, WHOP_REWARDS_URL } from "../../lib/browse";
import { SavedBriefsRow } from "./SavedBriefs";
import { TrackedSubmissionsTable } from "./TrackedSubmissions";

const PAYOUT_LABEL: Record<PayoutProvider, string> = {
  whop: "Whop",
  external_platform: "Platform",
  liquid_clips_stripe: "Liquid Clips",
  unknown: "—",
};

const PLATFORM_LABEL: Record<AllowedPlatform, string> = {
  tiktok: "TikTok",
  instagram: "IG",
  youtube_shorts: "YT",
  x: "X",
};

export function EarnSidebar() {
  return (
    <div className="flex flex-col gap-5">
      <ActiveBriefSection />
      <div className="h-px bg-line" />
      <TrackedSubmissionsTable compact limit={3} showSummary={false} headerLabel="your clips" />
      <div className="h-px bg-line" />
      <SavedBriefsRow compact limit={5} headerLabel="your campaigns" />
    </div>
  );
}

function ActiveBriefSection() {
  const { active } = useActiveBrief();
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          active
        </span>
        {active && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:text-ink"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </header>

      {!active && (
        <div className="rounded-xl border border-dashed border-line bg-paper-elev/40 p-3">
          <p className="font-sans text-[12px] text-ink">No campaign attached.</p>
          <button
            type="button"
            onClick={() => void openBrowsePanel(WHOP_REWARDS_URL)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-fuchsia bg-fuchsia px-3 py-1 font-sans text-[11px] font-medium text-white hover:bg-fuchsia-bright"
          >
            <ExternalLink size={11} /> Open browser
          </button>
        </div>
      )}

      {active && (
        <div className="rounded-xl border border-fuchsia/40 bg-fuchsia-soft/30 p-3 shadow-[var(--glow-sm)]">
          <div className="flex flex-col gap-1">
            <span className="truncate font-sans text-[13px] font-medium text-ink">
              {active.title || "Untitled"}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {active.payout_label && <Pill tone="fuchsia">{active.payout_label}</Pill>}
              <Pill tone="neutral">{PAYOUT_LABEL[active.payout_provider]}</Pill>
            </div>
            {expanded && active.allowed_platforms.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                {active.allowed_platforms.slice(0, 4).map((p) => (
                  <span key={p} className="rounded border border-line px-1.5 py-0.5">
                    {PLATFORM_LABEL[p]}
                  </span>
                ))}
              </div>
            )}
            {expanded && active.rules[0] && (
              <p className="mt-1 line-clamp-2 font-sans text-[11px] text-text-secondary">
                {active.rules[0]}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
