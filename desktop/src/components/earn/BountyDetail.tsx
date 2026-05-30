import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ExternalLink, PanelRightOpen } from "lucide-react";
import type { WhopBounty } from "../../lib/sidecar";
import { PlatformIcon } from "../PlatformIcon";
import { allowedPlatforms, formatPayout, whopBountyUrl } from "./types";
import { openBrowsePanel } from "../../lib/browse";
import { BROWSE_PANEL_ENABLED } from "../../lib/flags";

// Detail view: 3 columns — Source · Rules · Money. Then one CTA. Designed
// for fast decision-making, not exploration.

export function BountyDetail({
  bounty,
  onBack,
  onStart,
}: {
  bounty: WhopBounty;
  onBack: () => void;
  onStart: () => void;
}) {
  const platforms = allowedPlatforms(bounty);
  const sym = bounty.currency === "GBP" ? "£" : bounty.currency === "USD" ? "$" : "";
  const briefUrl = whopBountyUrl(bounty);
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

  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-6">
      <button
        onClick={onBack}
        className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
      >
        ← earn
      </button>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            {bounty.title}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
            by @{bounty.user.username ?? "unknown"}
          </p>
        </div>
        {briefUrl && (
          <button
            onClick={async () => {
              if (BROWSE_PANEL_ENABLED) {
                try {
                  await openBrowsePanel(briefUrl);
                  return;
                } catch (e) {
                  console.error("[bounty-detail] Browse panel failed, falling back to system browser:", e);
                }
              }
              try {
                await openExternal(briefUrl);
              } catch (e) {
                console.error("[bounty-detail] Failed to open brief externally:", e);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
            title={BROWSE_PANEL_ENABLED
              ? "Open the brand's brief in the side panel — clip alongside it."
              : "Open the brand's brief on Whop. Use this when the source video lives in a discussion post Liquid Clips can't read directly."}
          >
            {BROWSE_PANEL_ENABLED ? "Open brief in panel" : "Open brief on Whop"}
            {BROWSE_PANEL_ENABLED
              ? <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={2} />
              : <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />}
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            campaign
          </h2>
          <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl bg-paper-warm">
            {bounty.thumbnail ? (
              <img src={bounty.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center font-mono text-[11px] text-paper/40">
                no campaign image
              </div>
            )}
          </div>
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">
            experience id
          </p>
          <p className="font-mono text-[12px] text-ink">
            {bounty.experience?.id ?? "—"}
          </p>
        </section>

        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            rules
          </h2>
          <ul className="mt-3 space-y-2 font-sans text-[13px] leading-relaxed text-ink">
            <li className="flex items-start gap-2">
              <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-fuchsia" />
              <span>{bounty.description}</span>
            </li>
          </ul>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            platforms
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {platforms.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-warm/40 px-3 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary"
              >
                <PlatformIcon id={p} className="h-3 w-3" />
                {p}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            money
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

      <button
        onClick={onStart}
        className="self-start rounded-full bg-fuchsia px-6 py-3 font-sans text-[15px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
      >
        Start clipping →
      </button>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        Liquid Clips imports the source, runs your pipeline, and tags every clip with this reward.
      </p>
    </div>
  );
}
