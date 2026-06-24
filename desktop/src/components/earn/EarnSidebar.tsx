// Earn redesign — right rail.
// Three stacked sections: Active brief, Your clips (top 3), Your campaigns (top 5).
// Each has an expand toggle for power use; default state shows all three open.
//
// Empty states nudge toward the next action instead of leaving dead space:
//   - No active brief        → "Open browser" pill
//   - No clips logged        → "Log a post" entry already lives in section header
//   - No campaigns saved     → "Add" entry already lives in section header

import { useCallback, useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ExternalLink } from "../icons/BrandGlyphs";
import { Pill } from "../primitives";
import { useActiveBrief, type AllowedPlatform, type PayoutProvider } from "../../lib/briefs";
import { openBrowsePanel, WHOP_REWARDS_URL } from "../../lib/browse";
import { humanError, sidecar, type BountyProjectSummary } from "../../lib/sidecar";
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

export function EarnSidebar({ onResume }: { onResume?: (slug: string) => void } = {}) {
  return (
    <div className="flex flex-col gap-5">
      <ActiveBriefSection />
      <div className="h-px bg-line" />
      <TrackedSubmissionsTable compact limit={3} showSummary={false} headerLabel="your clips" />
      <div className="h-px bg-line" />
      {/* v0.7.71 — primary "Your Campaigns" preview now reflects active
          bounty Projects (the user's body of work). Manual SavedBriefs is
          kept below as a fallback for users who created briefs by hand. */}
      <ActiveBountyProjectsSection onResume={onResume} />
      <div className="h-px bg-line" />
      {/* v0.7.76 — Header relabeled `saved briefs · manual` so users
          don't confuse this fallback rail (local briefs.json, user-typed
          briefs) with the Whop-backed `your campaigns` rail above. */}
      <SavedBriefsRow compact limit={3} headerLabel="saved briefs · manual" />
    </div>
  );
}

function ActiveBountyProjectsSection({ onResume }: { onResume?: (slug: string) => void }) {
  const [projects, setProjects] = useState<BountyProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { projects } = await sidecar.listBountyProjects();
      setProjects(projects);
      setError(null);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const onRefresh = (): void => void load();
    window.addEventListener("lc:library-refresh", onRefresh);
    return () => window.removeEventListener("lc:library-refresh", onRefresh);
  }, [load]);

  // Most recent first; cap at 3 to respect the sidebar's tight rhythm.
  const recent = (projects ?? [])
    .filter((p) => !p.done)
    .slice()
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 3);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          your campaigns
        </span>
      </header>
      {error && (
        <p className="font-mono text-[11px] text-text-tertiary">
          couldn&rsquo;t load — {error}
        </p>
      )}
      {!error && projects !== null && recent.length === 0 && (
        <div className="earn-frame relative p-3">
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
          <p className="font-sans text-[12px] text-ink">No active campaigns yet.</p>
          <p className="mt-1 font-sans text-[11px] text-text-secondary">
            Choose a campaign above and hit Start to attach your clips.
          </p>
        </div>
      )}
      {!error &&
        recent.map((p) => (
          <BountyProjectRow key={p.slug} project={p} onResume={onResume} />
        ))}
    </section>
  );
}

function BountyProjectRow({
  project,
  onResume,
}: {
  project: BountyProjectSummary;
  onResume?: (slug: string) => void;
}) {
  const rpm =
    typeof project.whop_bounty_reward_per_unit === "number"
      ? project.whop_bounty_reward_per_unit
      : null;
  const currency = (project.whop_bounty_currency || "usd").toUpperCase();
  return (
    <div className="earn-frame library-card relative p-3" data-hot="true">
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      <div className="flex flex-col gap-1">
        <span className="truncate font-sans text-[13px] font-medium text-ink">
          {project.whop_bounty_title || project.source_filename || project.slug}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {rpm !== null && (
            <Pill tone="fuchsia">
              {currency} {rpm.toLocaleString()}
            </Pill>
          )}
          <Pill tone="neutral">{project.clips_count} clip{project.clips_count === 1 ? "" : "s"}</Pill>
        </div>
        {onResume && (
          <button
            type="button"
            onClick={() => onResume(project.slug)}
            className="btn-ghost mt-1 self-start px-2 py-0.5 text-[10px]"
          >
            Resume →
          </button>
        )}
      </div>
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
            className="btn-ghost mt-2 gap-1.5 px-1 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
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
