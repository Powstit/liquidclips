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

import { useCallback, useState } from "react";
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
import { setPendingComposerIntent } from "../../lib/pendingComposerIntent";
import "./CommandRoom.css";

/**
 * Phase 1c · Composer opt-in switch.
 *
 * Keeps the Composer surface invisible for cohorts that haven't opted in
 * — clicking the "Try new Composer" tile flips the flag on and lands the
 * user on `#/composer`. Reading directly from localStorage means we never
 * add a global store dependency for a single toggle.
 */
function useComposerOptIn(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("lc:composer-optin") === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem("lc:composer-optin", v ? "1" : "0");
    } catch {
      /* storage disabled · state still flips */
    }
    setOn(v);
  }, []);
  return [on, set];
}

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
  // Phase 1c · Composer opt-in state. Reads localStorage once on mount,
  // writes back on tile click. `optIn` currently drives ONLY the
  // navigation act — the tile is always visible so any user can enrol.
  const [, setOptIn] = useComposerOptIn();
  const openPanel = (tab: "url" | "upload") =>
    bus.emit("home:open-panel", { tab });
  const goWorkstation = () => bus.emit("nav:click", { route: "workstation" });
  const goCampaigns   = () => bus.emit("nav:click", { route: "campaigns" });
  const goSubmissions = () => bus.emit("nav:click", { route: "submissions" });
  const goAnalytics   = () => bus.emit("nav:click", { route: "analytics" });
  const goEarn        = () => bus.emit("nav:click", { route: "earn" });
  // 2026-07-18 · Composer tile re-mounted after A/B/C/D/E all-classes
  // pass shipped (37 of 41 features locked, 33 iron gates). goComposer
  // + IconSparkle are live consumers of the Slot 5 tile · no more void
  // silencing.
  const goComposer = () => {
    setOptIn(true);
    bus.emit("nav:click", { route: "composer" });
  };
  // FINISH-8 (2026-07-20) · Home tile → composer with a queued
  // `record my screen` intent. Composer.tsx consumes the buffer on
  // mount + auto-submits, so the record.capture ask panel opens
  // immediately without the user hunting for the quick-action.
  const goScreenRecord = () => {
    setOptIn(true);
    setPendingComposerIntent("record my screen");
    bus.emit("nav:click", { route: "composer" });
  };
  // FINISH-9 (2026-07-20) · Home tile → composer with a queued
  // `record tutorial` intent (extract regex maps to source=tutorial per
  // capabilities.ts:3636 · "Kade stays in frame · watermark visible · get
  // paid twice"). Directly surfaces the viral-flywheel record mode.
  const goKadeTutorial = () => {
    setOptIn(true);
    setPendingComposerIntent("record tutorial");
    bus.emit("nav:click", { route: "composer" });
  };
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

        {/* Slot 5 · Composer tile · RESTORED 2026-07-18.
         *  Every flywheel feature now has real bytes behind it
         *  (A/B/C/D/E · 37 of 41 features locked · Sprint 1-3 shipped
         *  with 33 iron gates guarding regressions). Composer route
         *  is now user-reachable · Kade speaks · library thumbnails
         *  live · watermark burns real referral URL · export pipeline
         *  ready. */}
        <fm.div variants={presets.staggerItem} data-testid="home-tile-5">
          <CockpitTile
            testId="home-command-composer"
            label="Composer"
            hint="talk to Kade · make a clip"
            icon={<IconSparkle />}
            onClick={goComposer}
            tone="engine"
          />
        </fm.div>

        {/* Slot 6 · Screen Record · FINISH-8 (2026-07-20). Direct entry
         *  to the record.capture ask panel. Auto-queues "record my
         *  screen" intent so the source picker opens on mount. */}
        <fm.div variants={presets.staggerItem} data-testid="home-tile-6">
          <CockpitTile
            testId="home-command-screen-record"
            label="Screen Record"
            hint="capture your screen · Kade guides you"
            icon={<IconRecord />}
            onClick={goScreenRecord}
            tone="engine"
          />
        </fm.div>

        {/* Slot 7 · Kade Tutorial · FINISH-9 (2026-07-20). Direct entry
         *  to the tutorial-recording flow. Kade stays in frame + watermark
         *  visible + auto-suggests 3 clips (Tool IS the content · F2 viral
         *  flywheel per liquid_clips_tool_is_the_content_flywheel.md). */}
        <fm.div variants={presets.staggerItem} data-testid="home-tile-7">
          <CockpitTile
            testId="home-command-kade-tutorial"
            label="Tutorial Mode"
            hint="record with Kade · get paid twice"
            icon={<IconTutorial />}
            onClick={goKadeTutorial}
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
/**
 * Phase 1c · four-point star for the Composer opt-in tile. Matches the
 * existing inline-brand-icon pattern (no Lucide default). `currentColor`
 * inherits the tile foreground token so the halo/hover states stay
 * brand-consistent.
 *
 * 2026-07-18 · component kept but tile removed from UI (see
 * COMPOSER_REAL_BUILD_SCOPE.md). Re-mount when features land.
 * Registered on the module scope below via `void` to silence tsc.
 */
function IconSparkle() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" />
      <circle cx="18.5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="5.5"  cy="18.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

// FINISH-8 · Screen Record tile icon · REC circle inside a display frame.
function IconRecord() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4.5" width="19" height="13" rx="2" />
      <path d="M8 20.5 L16 20.5" />
      <path d="M12 17.5 L12 20.5" />
      <circle cx="12" cy="11" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// FINISH-9 · Kade Tutorial tile icon · Kade avatar silhouette with a
// play glyph (tutorial = Kade guides you through a real recording).
function IconTutorial() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4 20 C4 15 7.5 12.5 12 12.5 C16.5 12.5 20 15 20 20" />
      <path d="M10.5 6.5 L14 8 L10.5 9.5 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 2026-07-18 · Composer tile re-mounted · IconSparkle now has a live
// consumer at Slot 5 (CockpitTile icon prop).
