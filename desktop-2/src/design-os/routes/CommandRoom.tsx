/**
 * CommandRoom · Route 01 · Home
 *
 * IRON GATE IG-HOME-REDESIGN · 2026-07-22
 * ---------------------------------------------------------------
 * Locked design language per `desktop-2/docs/HEURISTIC_EVAL_2026-07-22.md`:
 *
 *   L1 · Shell architecture (VSCode Workbench)   — Home is the default view
 *        inside the workbench. It renders inside the Editor Group region
 *        only. The Activity Bar, sidebars, panel + status bar are owned
 *        by the shell (AppShell / ConsoleNav / TopHud) and are NOT
 *        touched by this route.
 *   L2 · Base + content layering (Fluent 2)      — the 4 tiles are content
 *        floating on a calm base. One background acrylic blur value:
 *        blur(24px).
 *   L4 · Kade integration (Cursor pattern)       — Kade is REMOVED from
 *        the Home surface. He is summonable via ⌘K only, which routes
 *        to the Composer where he lives. No Kade robot on Home. No
 *        Kade panel. No "QUICK ACTIONS" tied to Kade.
 *   L7 · One primary action per view             — each tile has ONE
 *        primary CTA. No secondary buttons inside tiles.
 *
 * 4-tile grid:
 *   Make       → Composer (paste URL / file / screen record)
 *   Library    → My clips (workstation / library)
 *   Earn       → Bounties (campaigns · Whop-native paid gigs)
 *   Community  → Talk to clippers, share wins, get help.
 *
 * Below the grid: a small status bar (backend health + Whop link) sits
 * inside the route — actual system-status chrome (TopHud) is still owned
 * by the shell and untouched.
 *
 * ⌘K anywhere on the Home surface routes to Composer (Kade summon).
 *
 * NOTE: numeric testids (home-tile-1..4) are preserved for downstream
 * Playwright specs (activation-flow, home-dashboard, brand-consistency,
 * etc.) that assert home-tile-1 visibility. Semantic testids
 * (home-tile-make/library/earn/community) are the redesign contract.
 */

import { useEffect } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { CockpitTile } from "../components/CockpitTile";
import { bus } from "../bridge";
import { presets } from "../motion";
import { useMoneyRollup } from "../../lib/moneyRollup";
import "./CommandRoom.css";

// 2026-06-25 · InlineCreatePanel mount lifted to src/shell/AppShell.tsx so
// the lc:browse-url-handoff event from BrowseOverlay (anywhere) lands in
// a panel that's still mounted. Previously mounted here, but navigateTo
// during handoff unmounted CommandRoom + lost the panel state mid-handoff.
export function CommandRoom() {
  // IG-HOME-REDESIGN · Kade is removed from Home. `hideStickyKade` tells
  // the persistent shell to suppress the StickyKade avatar + speech
  // bubble on this route. `defaultKade="idle"` remains because the shell
  // API requires it; the actual visible-avatar suppression is driven by
  // `hideStickyKade`.
  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="home"
      defaultKade="idle"
      hideStickyKade
    >
      <HomeContent />
    </DesignOSAppShell>
  );
}

function HomeContent() {
  // IG-HOME-REDESIGN · one primary action per tile. Route ids resolve
  // through the design-OS SimulatorRouter (ALIAS_FOR + SURFACE_FOR).
  const goComposer  = () => bus.emit("nav:click", { route: "composer" });
  const goLibrary   = () => bus.emit("nav:click", { route: "library" });
  const goCampaigns = () => bus.emit("nav:click", { route: "campaigns" });
  const goCommunity = () => bus.emit("nav:click", { route: "community" });
  const goWallet    = () => bus.emit("nav:click", { route: "earn" });
  const moneyRollup = useMoneyRollup();
  const balanceCents = moneyRollup.rollup?.wallet_balance_cents ?? 0;
  const pendingCents = moneyRollup.rollup?.payout_eligible_cents ?? 0;
  const balanceUsd = `$${(balanceCents / 100).toFixed(2)}`;
  const pendingUsd = `$${(pendingCents / 100).toFixed(2)}`;

  // IG-HOME-REDESIGN · ⌘K summons Kade by routing to the Composer, which
  // is the only surface that owns the Kade avatar + bubble. Cursor
  // pattern: Kade is invisible until asked for. Bound at the window
  // level so any focus state on Home surfaces the summon.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        goComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <fm.div
      className="lc-home-stage lc-home-stage--redesign"
      data-route-title="Home"
      data-testid="home-redesign-root"
      variants={presets.routeEnter}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <fm.div
        className="lc-home-grid lc-home-grid--redesign"
        variants={presets.staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* Slot 1 · Make · primary CTA → Composer */}
        <fm.div
          variants={presets.staggerItem}
          data-testid="home-tile-1"
        >
          <div data-testid="home-tile-make">
            <CockpitTile
              testId="home-command-composer"
              label="Make a clip"
              hint="Turn a URL, file, or screen recording into TikTok-ready clips."
              icon={<IconMake />}
              onClick={goComposer}
              tone="engine"
              ariaLabel="Make a clip · start creating"
            />
          </div>
        </fm.div>

        {/* Slot 2 · Library · primary CTA → My Clips */}
        <fm.div
          variants={presets.staggerItem}
          data-testid="home-tile-2"
        >
          <div data-testid="home-tile-library">
            <CockpitTile
              testId="home-command-library"
              label="My clips"
              hint="Every clip you've made, ready to post."
              icon={<IconLibrary />}
              onClick={goLibrary}
              ariaLabel="My clips · open library"
            />
          </div>
        </fm.div>

        {/* Slot 3 · Earn · primary CTA → Bounties (Campaigns) */}
        <fm.div
          variants={presets.staggerItem}
          data-testid="home-tile-3"
        >
          <div data-testid="home-tile-earn">
            <CockpitTile
              testId="home-command-bounties"
              label="Bounties"
              hint="Get paid to clip. Real bounties, real payouts."
              icon={<IconEarn />}
              onClick={goCampaigns}
              ariaLabel="Bounties · browse bounties"
            />
          </div>
        </fm.div>

        {/* Slot 4 · Community · primary CTA → Community */}
        <fm.div
          variants={presets.staggerItem}
          data-testid="home-tile-4"
        >
          <div data-testid="home-tile-community">
            <CockpitTile
              testId="home-command-community"
              label="Community"
              hint="Talk to clippers, share wins, get help."
              icon={<IconCommunity />}
              onClick={goCommunity}
              ariaLabel="Community · open community"
            />
          </div>
        </fm.div>
      </fm.div>

      {/* Small status bar (route-local · shell-owned chrome untouched).
          Copy-only band beneath the tiles: reminds the user how to
          summon Kade + how to shortcut into Composer. Non-interactive
          text — every action a user needs sits inside the four tiles. */}
      <div className="lc-home-statusbar" data-testid="home-statusbar">
        <span className="lc-home-statusbar-hint">
          Press <kbd>⌘K</kbd> to talk to Kade
        </span>
      </div>

      <a
        href="#/earn"
        className="lc-home-earn"
        data-testid="home-earn-strip"
        data-money-rollup-loaded={moneyRollup.rollup ? "true" : "false"}
        data-money-rollup-error={moneyRollup.errorReason ?? ""}
        onClick={(event) => {
          event.preventDefault();
          goWallet();
        }}
      >
        <span className="lc-home-earn-amt">{balanceUsd}</span>
        <span className="lc-home-earn-pen">available</span>
        <span className="lc-home-earn-sep">·</span>
        <span className="lc-home-earn-pen">{pendingUsd} eligible</span>
        <span className="lc-home-earn-via">via Whop</span>
        <span className="lc-home-earn-arrow" aria-hidden="true">→</span>
      </a>
    </fm.div>
  );
}

/* ---- Inline brand icons (bespoke-craft · no Lucide defaults) ---- */

function IconMake() {
  // Sparkle · matches the "creation" primitive already used elsewhere.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" />
      <circle cx="18.5" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="5.5"  cy="18.5" r="0.8" fill="currentColor" stroke="none" />
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
function IconEarn() {
  // Stacked coins · the Whop-native paid-gig visual.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="7" rx="7" ry="2.6" />
      <path d="M5 7 v5 a7 2.6 0 0 0 14 0 v-5" />
      <path d="M5 12 v5 a7 2.6 0 0 0 14 0 v-5" />
    </svg>
  );
}
function IconCommunity() {
  // Two overlapping speech shapes · minimal, brand-consistent.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6 h11 a2 2 0 0 1 2 2 v6 a2 2 0 0 1 -2 2 h-6 l-4 3 v-3 h-1 a2 2 0 0 1 -2 -2 v-6 a2 2 0 0 1 2 -2 z" />
      <path d="M9 11 h.01 M12 11 h.01 M15 11 h.01" />
    </svg>
  );
}
