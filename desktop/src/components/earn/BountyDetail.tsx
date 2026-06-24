import { useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { PanelRightOpen, Copy } from "lucide-react";
import { ExternalLink, Check } from "../icons/BrandGlyphs";
import type { WhopBounty } from "../../lib/sidecar";
import { PlatformIcon } from "../PlatformIcon";
import { allowedPlatforms, formatPayout, whopBountyUrl } from "./types";
import { openBrowsePanel } from "../../lib/browse";
import { BROWSE_PANEL_ENABLED } from "../../lib/flags";

// Detail view — cockpit pass. Outer frame is the same transparent + four
// HUD-bracket-corner library-card chrome used on the Earn wall, and every
// inner section (Brief / Eligibility / Rewards) repeats the same brackets
// so the surface reads as one cohesive HUD instead of a stack of paper
// panels. Primary CTA stays solid fuchsia; secondary buttons go transparent
// with a fuchsia-on-hover line — same discipline as LibraryWall.

export function BountyDetail({
  bounty,
  onBack,
  onStart,
  isStarted = false,
}: {
  bounty: WhopBounty;
  onBack: () => void;
  onStart: () => void;
  /** v0.7.76 — When true, the action button reads "Resume Project →"
   *  instead of "Start clipping →". Set by EarnTab when an active
   *  (non-done) bounty project already exists for this whop_bounty_id. */
  isStarted?: boolean;
}) {
  const platforms = allowedPlatforms(bounty);
  const sym = bounty.currency === "GBP" ? "£" : bounty.currency === "USD" ? "$" : "";
  const briefUrl = whopBountyUrl(bounty);
  const [briefOpenError, setBriefOpenError] = useState<string | null>(null);
  const [briefCopied, setBriefCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  // Whop's API occasionally returns null for numeric fields the TS type
  // marks as non-null. Coerce here so a single missing value can't TypeError
  // and blank the whole detail view.
  const num = (v: unknown, d = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  const spotsRemaining = num(bounty.spotsRemaining);
  const spotsLimit = num(bounty.acceptedSubmissionsLimit);
  const budget = num(bounty.budgetAmount);
  const views = num(bounty.viewCount);
  const totalPaid = num(bounty.totalPaid);
  const status = bountyStatusLabel(bounty, spotsRemaining);

  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-6">
      <button
        onClick={onBack}
        className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
      >
        ← earn
      </button>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* v0.7.76 — Status is a label, not an action. Pre-fix this
                was an `<HudChip onClick={() => {}}>` — a dead button that
                bug-hunt-lens flagged in v0.7.70. Static span keeps the
                cockpit chrome (fuchsia border + mono caps) without the
                click affordance. */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/60 bg-fuchsia-soft/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia-deep">
              {status}
            </span>
            {isStarted && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
                started
              </span>
            )}
          </div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            {bounty.title}
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
            by @{bounty.user.username ?? "unknown"}
          </p>
        </div>
        {briefUrl && (
          <div className="flex flex-col items-end gap-1.5">
            <button
              onClick={async () => {
                setBriefOpenError(null);
                let panelOk = false;
                if (BROWSE_PANEL_ENABLED) {
                  try {
                    await openBrowsePanel(briefUrl);
                    panelOk = true;
                  } catch (e) {
                    console.error("[bounty-detail] Browse panel failed, falling back to system browser:", e);
                  }
                }
                if (panelOk) return;
                try {
                  await openExternal(briefUrl);
                } catch (e) {
                  console.error("[bounty-detail] Failed to open brief externally:", e);
                  setBriefOpenError("Couldn't open brief — copy link instead");
                }
              }}
              className="btn-secondary"
              title={BROWSE_PANEL_ENABLED
                ? "Open the brand's brief in the side panel — clip alongside it."
                : "Open the brand's brief on Whop. Use this when the source video lives in a discussion post Liquid Clips can't read directly."}
            >
              {BROWSE_PANEL_ENABLED ? "Open brief in panel" : "Open brief on Whop"}
              {BROWSE_PANEL_ENABLED
                ? <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={2} />
                : <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />}
            </button>
            {briefOpenError && (
              <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--color-danger)]">
                <span>{briefOpenError}</span>
                <button
                  onClick={async () => {
                    try {
                      await writeText(briefUrl);
                      setBriefCopied(true);
                      setTimeout(() => setBriefCopied(false), 1500);
                    } catch (e) {
                      console.error("[bounty-detail] clipboard write failed:", e);
                    }
                  }}
                  className="btn-secondary px-2.5 py-0.5 text-[11px]"
                >
                  {briefCopied ? <><Check size={11} strokeWidth={2.5} /> Copied</> : <><Copy size={11} strokeWidth={2.25} /> Copy link</>}
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Brief — campaign thumbnail + experience id. */}
        <section className="library-card relative bg-transparent p-5">
          <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
            brief
          </h2>
          <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl bg-transparent">
            {bounty.thumbnail ? (
              <img
                src={bounty.thumbnail}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="grid h-full place-items-center font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                no campaign image
              </div>
            )}
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            experience id
          </p>
          <p className="font-mono text-[12px] text-ink">
            {bounty.experience?.id ?? "—"}
          </p>
        </section>

        {/* Eligibility — rules + allowed platforms. */}
        <section className="library-card relative bg-transparent p-5">
          <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
            eligibility
          </h2>
          <ul className="mt-3 space-y-2 font-sans text-[13px] leading-relaxed text-ink">
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-fuchsia" />
              <span>{bounty.description}</span>
            </li>
          </ul>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            platforms
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {platforms.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-transparent px-3 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary"
              >
                <PlatformIcon id={p} className="h-3 w-3" />
                {p}
              </span>
            ))}
          </div>
        </section>

        {/* Rewards summary — payout, spots, budget, views, paid. */}
        <section className="library-card relative bg-transparent p-5">
          <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
          <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
            rewards
          </h2>
          <div className="mt-3 space-y-3 font-mono text-[12px] text-text-secondary">
            <div className="flex items-center justify-between">
              <span>payout</span>
              <span className="font-display text-[16px] font-semibold text-ink">
                {formatPayout(bounty)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>spots left</span>
              <span className="text-ink">
                {spotsRemaining} of {spotsLimit}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>budget</span>
              <span className="text-ink">
                {sym}{budget.toFixed(0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>views so far</span>
              <span className="text-ink">{views.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>paid so far</span>
              <span className="text-ink">
                {sym}{totalPaid.toFixed(2)}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={async () => {
            if (starting) return;
            setStarting(true);
            try {
              await Promise.resolve(onStart());
            } finally {
              // onStart usually navigates away, but if it stays on this view
              // we still want the button enabled again.
              setStarting(false);
            }
          }}
          disabled={starting}
          className="btn-primary disabled:opacity-60"
        >
          {starting
            ? isStarted
              ? "Resuming…"
              : "Starting…"
            : isStarted
              ? "Resume Project →"
              : "Start clipping →"}
        </button>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        {isStarted
          ? "You already started this bounty. Resume opens the project where your clips live."
          : "Liquid Clips imports the source, runs your pipeline, and tags every clip with this reward."}
      </p>
    </div>
  );
}

// Live / Coming Soon / Closed / Manual — derived from the bounty's `status`
// plus spots-left so a "live" bounty with zero spots reads as Closed without
// needing a separate field from Whop. Manual bounties bypass spots logic and
// always read as "Manual" so clippers don't see a hand-typed bounty marked
// "Closed" just because spotsRemaining synthesized to 0.
function bountyStatusLabel(bounty: WhopBounty, spotsRemaining: number): string {
  if (bounty.bountyType === "manual") return "Manual";
  const s = (bounty.status ?? "").toLowerCase();
  if (s === "draft" || s === "scheduled" || s === "upcoming") return "Coming Soon";
  if (s === "closed" || s === "ended" || s === "expired" || s === "completed") return "Closed";
  if (spotsRemaining <= 0) return "Closed";
  return "Live";
}
