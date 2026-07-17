/**
 * CommandRoom · Route 01 · Home
 *
 * UX-4 reconciliation · outcome-led tile labels (replaces the system-led
 * labels from UI-3). The route id is unchanged so deep-links survive.
 *
 * Clipper mode → 4 tiles + Earn strip:
 *   Create Clips · My Clips · Find Rewards · Track Earnings
 *   + "$X earned · Y pending · via Whop" strip beneath
 *
 * Agency mode → 4 tiles, no strip:
 *   Create Campaign · Manage Campaigns · Review Submissions · Analytics
 *
 * Mounted: InlineCreatePanel (slide-up panel for the Create / Create Campaign
 * tiles in URL / Upload tabs).
 */

import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { CockpitTile } from "../components/CockpitTile";
import { HomeBanner } from "../components/HomeBanner";
import { WhopStatusChip } from "../components/WhopStatusChip";
import { FounderInviteHero, useFounderInviteHeroVisible } from "../../components/founder/FounderInviteHero";
import { bus, useMode } from "../bridge";
import { presets } from "../motion";
import { useEarnSummary } from "../state/useEarnSummary";
import { SponsoredRewardStrip } from "../earn";
import { useBrowseOverlay, WHOP_REWARDS_URL } from "../../state/browseOverlay";
import "./CommandRoom.css";

/**
 * BUG-040 · Home earn strip is the FIRST customer-visible earnings number
 * before they navigate to Earn. It MUST derive from the canonical hook
 * (`useEarnSummary`) so the two surfaces cannot disagree. Previously a
 * hardcoded EARN_SNAPSHOT = { 9.34, 2.10 } silently lied to the customer
 * while the Earn route showed real numbers from useRewardClips.
 */
function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// 2026-06-25 · InlineCreatePanel mount lifted to src/shell/AppShell.tsx so
// the lc:browse-url-handoff event from BrowseOverlay (anywhere) lands in
// a panel that's still mounted. Previously mounted here, but navigateTo
// during handoff unmounted CommandRoom + lost the panel state mid-handoff.
export function CommandRoom() {
  return (
    <DesignOSAppShell world="cockpit-home" route="home" defaultKade="idle" kadePlacement="helper-right">
      <HomeContent />
    </DesignOSAppShell>
  );
}

function HomeContent() {
  const mode = useMode();
  const openPanel = (tab: "url" | "upload") =>
    bus.emit("home:open-panel", { tab });
  const goWorkstation = () => bus.emit("nav:click", { route: "workstation" });
  const goCampaigns   = () => bus.emit("nav:click", { route: "campaigns" });
  const goSubmissions = () => bus.emit("nav:click", { route: "submissions" });
  const goAnalytics   = () => bus.emit("nav:click", { route: "analytics" });
  const goEarn        = () => bus.emit("nav:click", { route: "earn" });
  // 2026-06-24 · Find Rewards opens the in-app browser at Whop content rewards
  // so clippers can scout real paying bounties without leaving the app.
  // The Copy URL + Use buttons inside the browser hand the campaign back
  // into the workspace.
  const openBrowser   = useBrowseOverlay((s) => s.openWith);
  const goFindRewards = () => openBrowser(WHOP_REWARDS_URL, "browse-campaign");

  const isAgency = mode === "agency";
  // 2026-07-17 · Suppress HomeBanner while the founder empty-state hero
  // is visible so we don't double-Kade the pre-first-drop moment. Both
  // banners reappear the moment Whisper runs.
  const founderHeroVisible = useFounderInviteHeroVisible();

  // BUG-040 · single source of truth · Earn strip reads the same hook
  // the Earn route reads. Same number on Home == same number on Earn.
  const earn = useEarnSummary();

  return (
    <fm.div
      className="lc-home-stage"
      data-route-title="Home"
      data-kade-anchor
      variants={presets.routeEnter}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 2026-07-17 · closed-door founder empty-state hero.
          Renders above HomeBanner ONLY for free-tier users who
          haven't dropped their first video yet. Auto-hides the
          moment Whisper runs. Non-invasive to HomeBanner behaviour. */}
      {!isAgency && <FounderInviteHero />}

      {/* 2026-06-24 · clipper-only brand banner above the 4-tile grid.
          Promotes the new in-app browser + Whop bounty hunt. Agency mode
          keeps its tile grid uncluttered.
          2026-07-17 · Also suppressed while FounderInviteHero is visible
          so we don't stack two Kade greetings back-to-back. */}
      {!isAgency && !founderHeroVisible && <HomeBanner />}

      {/* BUG-014 · Train A2 (2026-07-12) · Home hero Whop CTA.
          Reads useMe().snapshot.whopUserId internally so it self-hides
          for linked users AND anonymous users (no-jwt state). Only
          renders the "Connect Whop to activate paid clips" hero when the
          user has a JWT but no Whop link. Bug-004 chip in TopHud covers
          the linked / linking states in the persistent chrome. Kept
          outside the tile grid so tile ordering is untouched. */}
      {!isAgency && (
        <fm.div variants={presets.staggerItem}>
          <WhopStatusChip mountSite="home-hero" />
        </fm.div>
      )}

      <fm.div
        className="lc-home-grid"
        variants={presets.staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* Slot 1 · Create */}
        <fm.div variants={presets.staggerItem} data-testid="home-tile-1">
          <CockpitTile
            testId="home-command-create"
            label={isAgency ? "Create Campaign" : "Create Clips"}
            hint={isAgency ? "post a paid skill" : "paste a video URL"}
            icon={<IconPlus />}
            onClick={isAgency ? goCampaigns : () => openPanel("url")}
          />
        </fm.div>

        {/* Slot 2 · Manage / My Clips */}
        <fm.div variants={presets.staggerItem} data-testid="home-tile-2">
          <CockpitTile
            testId="home-command-library"
            label={isAgency ? "Manage Campaigns" : "My Clips"}
            hint={isAgency ? "status and invites" : "everything you've made"}
            icon={isAgency ? <IconManage /> : <IconLibrary />}
            onClick={isAgency ? goCampaigns : goWorkstation}
          />
        </fm.div>

        {/* Slot 3 · Find Rewards / Review Submissions */}
        <fm.div variants={presets.staggerItem} data-testid="home-tile-3">
          <CockpitTile
            testId="home-command-rewards"
            label={isAgency ? "Review Submissions" : "Find Rewards"}
            hint={isAgency ? "approve clippers' work" : "browse paid Whop skills"}
            icon={isAgency ? <IconReview /> : <IconReward />}
            onClick={isAgency ? goSubmissions : goFindRewards}
          />
        </fm.div>

        {/* Slot 4 · Analytics / Track Earnings */}
        <fm.div variants={presets.staggerItem} data-testid="home-tile-4">
          <CockpitTile
            testId="home-command-earn"
            label={isAgency ? "Analytics" : "Track Earnings"}
            hint={isAgency ? "how your campaigns perform" : "see what you've earned"}
            icon={isAgency ? <IconAnalytics /> : <IconCoins />}
            onClick={isAgency ? goAnalytics : goEarn}
            tone="engine"
          />
        </fm.div>
      </fm.div>

      {/* 2026-06-23 · $50 Sponsored Reward strip · clipper-only ·
          IG-SOV-2.2-001 · deep-links to Earn route for full programme
          dashboard. SOVEREIGN-2.2 marker. */}
      {!isAgency && (
        <fm.div variants={presets.staggerItem} style={{ marginTop: 16 }}>
          <SponsoredRewardStrip viewCount={Math.max(0, earn.summary.totalClicks ?? 0)} />
        </fm.div>
      )}

      {/* BUG-040 · Earn strip · clipper-only · reads useEarnSummary() so
          Home and the Earn route share one source of truth. While the
          hook is loading, surface a clearly-honest "—" instead of a
          fixture number. The strip exposes data-* attrs the harness reads. */}
      {!isAgency && (
        <fm.button
          type="button"
          data-testid="home-earn-strip"
          data-earn-loading={String(earn.loading)}
          data-earn-earned={String(earn.summary.totalEarnedUsd)}
          data-earn-pending={String(earn.summary.pendingPayoutsUsd)}
          className="lc-home-earn"
          variants={presets.staggerItem}
          onClick={goEarn}
          aria-label="Track earnings · open Earn"
        >
          <span className="lc-home-earn-amt" data-testid="home-earn-earned">
            {earn.loading
              ? "— earned"
              : `${formatUsd(earn.summary.totalEarnedUsd)} earned`}
          </span>
          <span className="lc-home-earn-sep" aria-hidden="true">·</span>
          <span className="lc-home-earn-pen" data-testid="home-earn-pending">
            {earn.loading
              ? "— pending"
              : `${formatUsd(earn.summary.pendingPayoutsUsd)} pending`}
          </span>
          <span className="lc-home-earn-sep" aria-hidden="true">·</span>
          <span className="lc-home-earn-via">via Whop</span>
          <span className="lc-home-earn-arrow" aria-hidden="true">→</span>
        </fm.button>
      )}
    </fm.div>
  );
}

/* ---- Inline brand icons (bespoke-craft · no Lucide defaults) ---- */

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="12" y1="5"  x2="12" y2="19" />
      <line x1="5"  y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconLibrary() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="6" height="16" rx="1.4" />
      <rect x="11" y="4" width="4" height="16" rx="1.4" />
      <path d="M16.5 5.5 L20.5 6.6 L17 19 L13 17.9 Z" />
    </svg>
  );
}
function IconReward() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="9" r="6" />
      <path d="M9 13 L7 22 L12 19 L17 22 L15 13" />
    </svg>
  );
}
function IconCoins() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="7" rx="7" ry="2.6" />
      <path d="M5 7 v5 a7 2.6 0 0 0 14 0 v-5" />
      <path d="M5 12 v5 a7 2.6 0 0 0 14 0 v-5" />
    </svg>
  );
}
function IconManage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5"  width="18" height="4" rx="1" />
      <rect x="3" y="11" width="18" height="4" rx="1" />
      <rect x="3" y="17" width="18" height="4" rx="1" />
      <circle cx="18" cy="7"  r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9"  cy="13" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="14" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconReview() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 11 l3 3 l7 -7" />
    </svg>
  );
}
function IconAnalytics() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20 V 4" />
      <path d="M4 20 H 20" />
      <rect x="7"  y="13" width="3" height="6" />
      <rect x="11" y="9"  width="3" height="10" />
      <rect x="15" y="6"  width="3" height="13" />
    </svg>
  );
}
