// Earn redesign — right rail.
// Three stacked sections: Active brief, Your clips (top 3), Your campaigns (top 5).
// Each has an expand toggle for power use; default state shows all three open.
//
// Empty states nudge toward the next action instead of leaving dead space:
//   - No active brief        → "Open browser" pill
//   - No clips logged        → "Log a post" entry already lives in section header
//   - No campaigns saved     → "Add" entry already lives in section header

import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Pill } from "../primitives";
import { useActiveBrief, type AllowedPlatform, type PayoutProvider } from "../../lib/briefs";
import { openBrowsePanel, WHOP_REWARDS_URL } from "../../lib/browse";
import { humanError } from "../../lib/sidecar";
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
  const [openError, setOpenError] = useState<string | null>(null);

  async function openBrowser(): Promise<void> {
    // PREVENTS — the in-app Browse panel silently failing (Tauri webview
    // disallowed, plugin denied). Fall back to the system browser; if THAT
    // also fails, surface a recoverable error inline.
    try {
      await openBrowsePanel(WHOP_REWARDS_URL);
      setOpenError(null);
    } catch (panelErr) {
      try {
        await openExternal(WHOP_REWARDS_URL);
        setOpenError(null);
      } catch (extErr) {
        setOpenError(`${humanError(panelErr)} (and external browser: ${humanError(extErr)})`);
      }
    }
  }

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
        // Cockpit pass: bracket-frame empty state instead of dashed plate.
        <div className="earn-frame relative p-3">
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
          <p className="font-sans text-[12px] text-ink">No campaign attached.</p>
          <button
            type="button"
            onClick={() => void openBrowser()}
            className="mt-2 inline-flex items-center gap-1.5 bg-transparent px-1 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia hover:text-fuchsia-bright"
          >
            <ExternalLink size={11} /> Open browser
          </button>
          {openError && (
            <p role="alert" className="mt-1 font-sans text-[11px] text-[#F87171]">
              Couldn&apos;t open browser — {openError}
            </p>
          )}
        </div>
      )}

      {active && (
        // Cockpit pass: bracket-frame active campaign tile, no glow plate.
        <div className="earn-frame library-card relative p-3" data-hot="true">
          <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
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
                  <span key={p} className="bg-transparent px-1 py-0.5">
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
