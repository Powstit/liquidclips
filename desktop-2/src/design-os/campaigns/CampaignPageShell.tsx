/**
 * CampaignPageShell · Phase 6N-B
 *
 * Detail "page" for one Campaign. Mounted via the existing `<Drawer>`
 * chrome (right side, portal-to-body) so it slides in beside the
 * discovery grid without a full route navigation. When a dedicated
 * `/campaigns/<slug>` URL lands later, the same component renders inside
 * a full-page container.
 *
 * 9 sections (locked by brief):
 *   1. Hero banner
 *   2. Campaign description
 *   3. Reward section
 *   4. Payout section
 *   5. Deadline section
 *   6. Asset sources section (READ-ONLY surfacing · no ingestion UI yet)
 *   7. Discussion section (campaignToDiscussion → existing Whop mirror)
 *   8. Leaderboard preview
 *   9. Submission CTA
 *
 * Out of scope (per brief):
 *   - Agency creation
 *   - Native discussion
 *   - Asset ingestion (Drive/Dropbox OAuth handshake)
 *   - Payment integration
 */

import { useState } from "react";
import { Drawer, GlassCard } from "../components";
import { bus } from "../bridge";
import { openInApp } from "../../lib/openInApp";
import { useTierCaps } from "../state/useTierCaps";
import { RoomDetailDrawer, LeaderboardSection } from "../community";
import { CampaignAssetLinksList } from "../campaign-asset-links";
// mo-16 · 2026-07-06 · Watchdog wrap · Sovereign-Operator Protocol.
// DEMO tier: campaign detail page opens a Whop reward URL + polls status.
// A crash inside the 9-section shell must render the KadeRepairScreen instead
// of white-screening the drawer chrome so the user can still close and retry.
import { Watchdog } from "../../lib/watchdog/Watchdog";
// Ransom-paywall (Max · trigger #6 · 2026-07-07) · earn campaign
// publish. Clipper submits their clip to a Whop reward · deflect
// when the 10-clip guest quota is exhausted so Agency unlock is the
// path to keep earning through the in-app rail.
import { AssetRansomPaywall } from "../../components/paywall/AssetRansomPaywall";
// Lane 2 (Max · SPRINT_FINAL §1C · 2026-07-07) · agency posts a clip
// job to Whop's marketplace via openWhopAction which auto-routes into
// the persistent-cookie in-app browser (session survives from Gate 1
// authorization · one-click). No iframe attempts.
import { openWhopAction, WhopAction } from "../../lib/openWhopAction";
import { useMe } from "../state/useMe";
import {
  fmtUsdCents,
  CAMPAIGN_TYPE_LABEL,
  CAMPAIGN_STATUS_LABEL,
  type Campaign,
  type PayoutRule,
  hasWhopSnapshot,
  rewardPoolCents,
  fundedPct,
  payoutLine,
  snapshotQualifier,
} from "./types";
import { WhopRewardCard } from "../agency-creation/WhopRewardCard";
import { campaignToDiscussion } from "./discussion";
import "./CampaignPageShell.css";

export interface CampaignPageShellProps {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
}

function fmtUsd(cents: number): string {
  return fmtUsdCents(cents);
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function PayoutTable({ rule }: { rule: PayoutRule }) {
  switch (rule.kind) {
    case "flat":
      return (
        <Row label="Flat" value={fmtUsd(rule.amountCents)} sub="per approved submission" />
      );
    case "rpm":
      return (
        <>
          <Row label="RPM" value={`${fmtUsd(rule.rpmCents)}`} sub="per 1,000 verified views" />
          <Row label="Min views" value={rule.minVerifiedViews.toLocaleString()} sub="before payout starts" />
          {rule.maxPayoutCents !== undefined && (
            <Row label="Max" value={fmtUsd(rule.maxPayoutCents)} sub="cap per submission" />
          )}
        </>
      );
    case "tiered":
      return (
        <>
          {(["free", "pro", "agency"] as const).map((t) => {
            const sub = rule.byTier[t];
            const v = sub.kind === "flat"
              ? `${fmtUsd(sub.amountCents)} flat`
              : `${fmtUsd(sub.rpmCents)} per 1k views`;
            return <Row key={t} label={t.toUpperCase()} value={v} />;
          })}
        </>
      );
    case "bonus":
      return (
        <>
          <Row
            label="Base"
            value={rule.base.kind === "flat"
              ? `${fmtUsd(rule.base.amountCents)} flat`
              : `${fmtUsd(rule.base.rpmCents)} RPM`}
          />
          {rule.bonuses.map((b, i) => (
            <Row
              key={i}
              label={`+ ${b.label}`}
              value={b.extra.kind === "flat"
                ? fmtUsd(b.extra.amountCents)
                : `${fmtUsd(b.extra.rpmCents)} RPM`}
              sub={b.triggerCondition.kind === "first_n_submissions"
                ? `first ${b.triggerCondition.n} submissions`
                : b.triggerCondition.kind === "top_retention_pct"
                  ? `top ${b.triggerCondition.pct}% retention`
                  : `viral above ${b.triggerCondition.views.toLocaleString()} views`}
            />
          ))}
        </>
      );
    case "capacity_limited":
      return (
        <>
          <Row label="Per action" value={fmtUsd(rule.perActionCents)} />
          <Row label="Capacity" value={rule.capacityTotal.toLocaleString()} sub="actions" />
          <Row label="Window opens" value={shortDate(rule.windowStartIso)} />
          <Row label="Window closes" value={shortDate(rule.windowEndIso)} />
        </>
      );
  }
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="lc-camp-shell-row">
      <span className="lc-camp-shell-row-k">{label}</span>
      <span className="lc-camp-shell-row-v">{value}</span>
      {sub && <span className="lc-camp-shell-row-sub">{sub}</span>}
    </div>
  );
}

export function CampaignPageShell({ campaign, open, onClose }: CampaignPageShellProps) {
  const tier = useTierCaps();
  const [discussionOpen, setDiscussionOpen] = useState(false);
  // Defense-in-depth · Stage 8 carve-out. Mirrors CampaignBanner —
  // a broken banner_url returned by /campaigns (currently 3 slugs
  // point at missing files on prod: uncle-daniel / viral-reaction /
  // proof) falls back to the surrounding hero overlay chrome instead
  // of rendering a broken-image icon. Zero visual change on the
  // happy path.
  const [heroMediaFailed, setHeroMediaFailed] = useState(false);
  // Rules-of-Hooks fix · these two hooks used to live after the
  // `if (!campaign) return` early-exit below, so the component ran a
  // different number of hooks on the "closed" render (campaign null)
  // vs. the "open" render (campaign resolved) — React threw "Rendered
  // more hooks than during the previous render" every time a campaign
  // drawer opened. All hooks must run unconditionally before any
  // early return.
  const me = useMe();
  const [ransomOpen, setRansomOpen] = useState(false);

  if (!campaign) {
    return (
      <Drawer open={false} onClose={onClose} eyebrow="Campaign" title="" width={560} id="campaign-page-shell">
        <div />
      </Drawer>
    );
  }

  const discussion = campaignToDiscussion(campaign, tier.tier, tier.tier === "agency");
  const isLockedForCaller = !campaign.visibilityTiers.includes(
    tier.tier === "agency" ? "agency" : tier.tier === "pro" ? "pro" : "free"
  );

  /* 6N-G · §8 product-lock alignment · Whop owns submission workflow,
   * approval, and payout. LC does NOT mint a /me/reward-clips write
   * path · the Submit CTA opens the Whop reward in our in-app browser
   * (or system browser fallback) so the clipper submits inside Whop. */
  const whopRewardUrl = campaign.whopRewardUrl ?? campaign.whopUrl ?? null;

  /* P0-2 fix · click must never be silent. Two-rung ladder:
   *   1. bus.emit("browse:open") · default subscriber (auto-mounted
   *      from bridge/browseOpenSubscriber) opens the in-app browser.
   *   2. If no subscriber is mounted (deep-link entry / unit test /
   *      stripped module graph), call openInApp directly. */
  const openWhopRewardWithFallback = async (kind: "submit" | "open") => {
    if (!whopRewardUrl) {
      bus.emit("toast", {
        kind: "info",
        title: "No Whop reward connected",
        body: "Submission happens on Whop · this campaign has no Whop URL yet.",
      });
      return;
    }
    if (bus.hasListeners("browse:open")) {
      bus.emit("browse:open", {
        url: whopRewardUrl,
        source: "campaign",
        roomId: campaign.id,
        mirror: "whop",
        title: campaign.title,
      });
      return;
    }
    const successTitle = kind === "submit" ? "Opening Whop reward" : "Opening on Whop";
    try {
      await openInApp(whopRewardUrl);
      bus.emit("toast", {
        kind: "success",
        title: successTitle,
        body: "Submission + payout settle on Whop.",
      });
      return;
    } catch (error) {
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't open Whop reward",
        body: error instanceof Error ? error.message : whopRewardUrl,
      });
    }
  };

  // Lane 2 (Max · SPRINT_FINAL §1C · 2026-07-07) · agency-only.
  // Company id comes from useMe snapshot (backend needs to add
  // whop_company_id column · nullable · frontend gates button
  // presence on it). Prize passed as dollars (Whop expects
  // dollar-scale prefill · we store cents internally).
  const whopCompanyId = me.snapshot?.whopCompanyId;
  const canPostToWhop = tier.tier === "agency" && !!whopCompanyId;
  const handlePostToWhop = () => {
    if (!whopCompanyId) return;
    openWhopAction(WhopAction.BOUNTY_CREATE, {
      companyId: whopCompanyId,
      title: "Post clip job to Whop",
      prefill: {
        prefill_title: campaign.title,
        prefill_prize: Math.round(campaign.rewardPoolCents / 100),
        prefill_criteria: campaign.description ?? "",
      },
    });
  };

  // Ransom-paywall (Max · trigger #6 · 2026-07-07) · used to deflect
  // on the old 10-clip local guest quota. 2026-08-06 — that quota was
  // dead code in production (see WelcomeRoute.tsx history), so this
  // never actually fired; removed. Real counting + the one paywall
  // message now live entirely server-side (POST /usage/clip-exported,
  // sidecar-stub.ts).
  const handleSubmissionCta = () => {
    void openWhopRewardWithFallback("submit");
  };
  const handleOpenWhop = () => { void openWhopRewardWithFallback("open"); };

  const qualifier = snapshotQualifier(campaign);

  return (
    <>
      {/* Ransom-paywall (Max · trigger #6 · 2026-07-07) · asset preview
       *  is the campaign card so the clipper sees exactly what they're
       *  about to submit. onUnlocked calls openWhopRewardWithFallback
       *  directly (no gate closure loop). */}
      <AssetRansomPaywall
        trigger="earn-publish"
        assetPreview={{
          kind: "node",
          content: (
            <div style={{ padding: 40, color: "rgba(255,255,255,0.9)", maxWidth: 480 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.6, marginBottom: 12 }}>
                {campaign.brand ?? "Campaign"}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
                {campaign.title}
              </div>
              <div style={{ fontSize: 14, opacity: 0.75 }}>
                {campaign.description ?? campaign.subtitle ?? ""}
              </div>
            </div>
          ),
        }}
        isOpen={ransomOpen}
        onUnlocked={async () => {
          setRansomOpen(false);
          await openWhopRewardWithFallback("submit");
        }}
        onDismiss={() => setRansomOpen(false)}
      />
      <Drawer
        open={open && !discussionOpen}
        onClose={onClose}
        eyebrow="Campaign"
        title={campaign.title}
        width={560}
        id="campaign-page-shell"
      >
        <Watchdog
          id="money/mo-16/sponsored-campaign-submission"
          label="Sponsored campaign submission"
          cluster="money"
          source="design-os/campaigns/CampaignPageShell.tsx:231"
        >
        <div className="lc-camp-shell">
          {/* 1 · Hero banner */}
          <section className={`lc-camp-shell-hero is-${campaign.placementQuality}`}>
            {!heroMediaFailed && (campaign.bannerUrl || campaign.featuredThumbUrl) && (
              <img
                src={campaign.featuredThumbUrl ?? campaign.bannerUrl ?? ""}
                alt=""
                className="lc-camp-shell-hero-art"
                onError={() => setHeroMediaFailed(true)}
              />
            )}
            <div className="lc-camp-shell-hero-overlay">
              <span className="lc-camp-shell-hero-eb">
                {CAMPAIGN_TYPE_LABEL[campaign.campaignType]} · {campaign.brand ?? "—"}
              </span>
              <span className={`lc-camp-shell-hero-status is-${campaign.status}`}>
                <span className="lc-camp-shell-hero-status-dot" aria-hidden="true" />
                {CAMPAIGN_STATUS_LABEL[campaign.status]}
              </span>
            </div>
          </section>

          {/* 2 · Whop reward (URL-first) · 6N-G §8 reads.
           *  Mounted whenever the campaign carries a Whop reward URL or
           *  id. Renders the snapshot when enriched · the neutral "no
           *  enrichment" empty state otherwise. Whop URL is canonical. */}
          {(campaign.whopRewardUrl || campaign.whopRewardId || campaign.whopUrl) && (
            <WhopRewardCard
              rewardId={campaign.whopRewardId ?? null}
              rewardUrl={whopRewardUrl}
              rewardState={campaign.whopRewardState ?? "unlinked"}
              snapshotStatus={campaign.whopRewardSnapshotStatus}
              snapshot={(campaign.whopRewardSnapshot ?? null) as never}
              syncedAt={campaign.whopRewardSyncedAt}
              variant="full"
            />
          )}

          {/* 3 · Description */}
          <section className="lc-camp-shell-section">
            <span className="lc-camp-shell-eb">About this campaign</span>
            <p className="lc-camp-shell-desc">{campaign.description}</p>
          </section>

          {/* 4 · Reward section · snapshot-first reads · falls back to
           *  legacy mock for unconnected rows. */}
          <GlassCard density="quiet" className="lc-camp-shell-card">
            <span className="lc-camp-shell-eb">
              Reward {qualifier && <em className="lc-camp-shell-qualifier"> · {qualifier}</em>}
            </span>
            <Row label="Pool" value={fmtUsd(rewardPoolCents(campaign))} />
            <Row label="Reward kind" value={campaign.rewardKind.toUpperCase()} />
            <Row label="Funded" value={`${fundedPct(campaign)}%`} />
          </GlassCard>

          {/* 5 · Payout section · snapshot-first single line · table only
           *  when we have no snapshot (legacy rule shape still useful). */}
          <GlassCard density="quiet" className="lc-camp-shell-card">
            <span className="lc-camp-shell-eb">
              Payout {qualifier && <em className="lc-camp-shell-qualifier"> · {qualifier}</em>}
            </span>
            <p className="lc-camp-shell-row-summary">{payoutLine(campaign)}</p>
            {!hasWhopSnapshot(campaign) && <PayoutTable rule={campaign.payoutRules} />}
          </GlassCard>

          {/* 5 · Deadline section */}
          <GlassCard density="quiet" className="lc-camp-shell-card">
            <span className="lc-camp-shell-eb">Timing</span>
            <Row label="Deadline" value={shortDate(campaign.deadline)} />
            {campaign.capacityWindowStart && (
              <Row label="Window opens" value={shortDate(campaign.capacityWindowStart)} />
            )}
            {campaign.capacityWindowEnd && (
              <Row label="Window closes" value={shortDate(campaign.capacityWindowEnd)} />
            )}
            {campaign.capacityTotal !== null && (
              <Row
                label="Capacity"
                value={`${campaign.capacityUsed.toLocaleString()} / ${campaign.capacityTotal.toLocaleString()}`}
                sub="used / total"
              />
            )}
            {campaign.durationLabel && (
              <Row label="At a glance" value={campaign.durationLabel} />
            )}
          </GlassCard>

          {/* 6 · Brief links · Phase 6N-D v1 · read-only
           *  Replaced the inline `campaign.assetSources[]` ingestion-style
           *  list with v1 brief links from the real backend. Agency pastes
           *  external URLs · clipper opens them via the `browse:open` bus
           *  default subscriber. */}
          <section className="lc-camp-shell-section">
            <span className="lc-camp-shell-eb">Brief links</span>
            <CampaignAssetLinksList slug={campaign.slug} />
          </section>

          {/* 7 · Discussion */}
          <GlassCard density="quiet" className="lc-camp-shell-card">
            <span className="lc-camp-shell-eb">Discussion</span>
            <Row label="Provider" value={campaign.discussionProvider === "whop" ? "Whop mirror" : campaign.discussionProvider === "native" ? "Native (LC)" : "Not provisioned"} />
            <button
              type="button"
              className="lc-camp-shell-discussion-btn"
              onClick={() => setDiscussionOpen(true)}
            >
              Open discussion
            </button>
          </GlassCard>

          {/* 8 · Leaderboard preview · reuses the existing community surface */}
          <section className="lc-camp-shell-section">
            <span className="lc-camp-shell-eb">Leaderboard preview</span>
            <LeaderboardSection />
          </section>

          {/* 9 · Submission CTA · 6N-G §8 alignment.
           *  Whop owns submission workflow + approval + payout. The
           *  primary CTA opens the Whop reward (via the in-app browser
           *  when mounted, system browser fallback otherwise). LC does
           *  NOT mint a /me/reward-clips write path. The campaign-side
           *  brief + asset links + leaderboard are LC's contribution. */}
          <footer className="lc-camp-shell-foot">
            {isLockedForCaller ? (
              <button
                type="button"
                className="lc-camp-shell-btn lc-camp-shell-btn-quiet"
                onClick={() => bus.emit("toast", {
                  kind: "info",
                  title: "Upgrade",
                  body: "Billing flow lands in Phase 7+.",
                })}
              >
                Upgrade to participate
              </button>
            ) : (
              <button
                type="button"
                className="lc-camp-shell-btn lc-camp-shell-btn-primary"
                onClick={handleSubmissionCta}
                title={whopRewardUrl ? "Submit on Whop · payouts settle there" : undefined}
              >
                {whopRewardUrl ? "Submit on Whop ↗" : "Submit a clip"}
              </button>
            )}
            {/* P0-1 fix · locked callers must NOT see the secondary
             *  "Open reward on Whop" button · it bypassed the tier gate
             *  the primary CTA respects. Gate symmetrically. */}
            {!isLockedForCaller && whopRewardUrl && (
              <button
                type="button"
                className="lc-camp-shell-btn"
                onClick={handleOpenWhop}
              >
                Open reward on Whop
              </button>
            )}
            {/* Lane 2 (Max · SPRINT_FINAL §1C · 2026-07-07) · agency
             *  syndicates their campaign into Whop's marketplace so
             *  clippers from the wider Whop ecosystem can also earn
             *  from it. Uses openWhopAction which auto-routes into
             *  our persistent-cookie in-app browser (Gate 1 session
             *  survives · one-click submission). Button gates on
             *  agency tier AND presence of whopCompanyId (backend
             *  needs to expose the field · see MeSnapshot doc). */}
            {canPostToWhop && (
              <button
                type="button"
                className="lc-camp-shell-btn"
                onClick={handlePostToWhop}
                title="Post this campaign to the Whop marketplace"
              >
                Post to Whop marketplace ↗
              </button>
            )}
            <button type="button" className="lc-camp-shell-btn lc-camp-shell-btn-quiet" onClick={onClose}>
              Close
            </button>
          </footer>
        </div>
        </Watchdog>
      </Drawer>

      {/* Discussion drawer · reuses 6L-B chrome via the generic Discussion shape. */}
      <RoomDetailDrawer
        discussion={discussionOpen ? discussion : null}
        open={discussionOpen}
        onClose={() => setDiscussionOpen(false)}
      />
    </>
  );
}
