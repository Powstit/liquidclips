/**
 * ConsoleNav · the left rail
 *
 * 10 main nav items + Support footer. Click fires `nav:click` for the host
 * route to swap. Hover stays CSS-only so the rail remains responsive. We do NOT touch
 * desktop-2's hash router here — wiring lives in CommandRoom.
 *
 * Phase 4B-rev rules:
 *   - Compact pills; never DSEG.
 *   - No pill collisions: badge sits to the right, label truncates.
 *   - Use Phase 4A nav SVGs where shipped.
 */

import { useEffect, useState } from "react";
import { bus, useMode, type AppMode, type KadeState, type RouteId } from "../bridge";
import { markNavClick } from "../../lib/navPerf";
import "./ConsoleNav.css";

interface NavItem {
  route: RouteId;
  label: string;
  icon: string;
  badge?: number;
  status?: "Coming soon" | "Assisted";
  kade: KadeState;
  /** UI-3 · which TopHud modes show this row. Default = both. */
  modes?: AppMode[];
}

/* UX-4 · nav trim · outcome-led rows only.
 *  Removed: Engine, Studio, Thumbs, Export (all aliased to My Clips /
 *  cockpit dock now), Library (folded into My Clips). My Journey is
 *  promoted for clippers; Analytics is added for agencies. */
/* FEATURE-002 · removed hardcoded badge counts on Campaigns (12),
 * Submissions (3) and Schedule (5). They were UI scaffolding from the
 * design-os mock phase that looked live to the customer. Real badge
 * counts will land per-route when each backend hook starts surfacing
 * unseen-count state (out of FEATURE-002 scope · polish-only). */
const ITEMS: ReadonlyArray<NavItem> = [
  { route: "home",        label: "Home",        icon: "/brand/icons/nav/home.svg",       kade: "idle" },
  { route: "create",      label: "Create",      icon: "/brand/icons/nav/create.svg",     kade: "create-clips" },
  { route: "workstation", label: "My Clips",    icon: "/brand/icons/nav/engine.svg",     kade: "cutting-clips" },
  { route: "campaigns",   label: "Campaigns",   icon: "/brand/icons/nav/campaigns.svg",  kade: "campaign-mode" },
  { route: "clipper",     label: "My Journey",  icon: "/brand/icons/nav/clipper.svg",    kade: "campaign-mode", modes: ["clipper"] },
  // Block 3 · 2026-07-11 · Learn tab surfaced in nav between My Journey
  // and Wallet. Was Section-pipeline registered but never nav-linked,
  // so every user missed the 7 walkthrough demos. Icon reuses the
  // existing `library.svg` (book glyph) until a dedicated learn.svg
  // drops. Kade "reading-brief" pose fits the "before you cash out,
  // here's how it works" framing.
  { route: "learn",       label: "Learn",       icon: "/brand/icons/nav/library.svg",    kade: "reading-brief" },
  // Phase 1 · 7-category purge Category 4 (2026-07-10) · Submissions
  // nav entry removed. The SubmissionsReview route rendered a
  // "Submissions · coming soon" honest-stub pane awaiting the real
  // `/campaigns/:slug/submissions` backend wire. Rather than tease
  // an unshipped feature in the nav, hide it. Route file stays
  // in-tree so a hash deep-link resolves rather than 404s. Nav will
  // re-add when the backend wire lands.
  { route: "analytics",   label: "Analytics",   icon: "/brand/icons/nav/studio.svg",     kade: "settings-mode", modes: ["agency"] },
  // 2026-07-10 · Chapter 3 (Lane A · Product surface) — Earn nav item
  // now resolves to the Section-pipeline WalletDetail (approved HTML at
  // `desktop-2/docs/mockups/approved/wallet-detail.html`) rather than
  // the Design-OS EarnRoute. Label renamed "Earn" → "Wallet" to match
  // the approved mockup title. The `route: "earn"` id is preserved so
  // Kade pose + bus events + deep-links keep firing; SimulatorRouter
  // `SURFACE_FOR.earn` is rewired to render `<WalletDetail />` via a
  // Watchdog + EngineErrorBoundary wrapper.
  { route: "earn",        label: "Wallet",      icon: "/brand/icons/nav/earn.svg",       kade: "earn-mode",     modes: ["clipper"] },
  { route: "community",   label: "Community",   icon: "/brand/icons/nav/community.svg",  kade: "community-mode" },
  { route: "channels",    label: "Channels",    icon: "/brand/icons/nav/channels.svg",   kade: "publishing" },
  { route: "schedule",    label: "Schedule",    icon: "/brand/icons/nav/schedule.svg",   kade: "publishing", status: "Assisted" },
];

const FOOTER: ReadonlyArray<NavItem> = [
  { route: "settings",   label: "Settings",   icon: "/brand/icons/nav/settings.svg",   kade: "settings-mode" },
  { route: "support",    label: "Support",    icon: "/brand/icons/nav/support.svg",    kade: "idle" },
];

export interface ConsoleNavProps {
  activeRoute: RouteId;
}

// v2.2.18 sprint · collapsible sidebar. Persists across mounts so it
//   survives a re-nav. `⌘\` (Cmd+backslash) also toggles it — mirrors
//   VS Code muscle memory that clippers usually already have.
const COLLAPSE_KEY = "lc.nav.collapsed.v1";

function useNavCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; }
    catch { return false; }
  });
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); }
      catch { /* private mode */ }
      return next;
    });
  };
  useEffect(() => {
    document.documentElement.dataset.navCollapsed = collapsed ? "1" : "0";
    return () => { delete document.documentElement.dataset.navCollapsed; };
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [collapsed, toggle];
}

export function ConsoleNav({ activeRoute }: ConsoleNavProps) {
  const mode = useMode();
  const inMode = (item: NavItem) => !item.modes || item.modes.includes(mode);
  const [collapsed, toggleCollapsed] = useNavCollapsed();

  return (
    // 2026-07-14 · BLOCK 5 follow-up P2 · accessibility landmark parity.
    // The Section-pipeline sidebar labels itself "Primary navigation";
    // the Design-OS sidebar previously left the aside unnamed, so
    // VoiceOver / other screen readers reported an anonymous
    // complementary landmark instead of a labelled navigation surface.
    // Adding aria-label brings the Design-OS shell into parity with the
    // Section-pipeline shell — see POST_RC1_BLOCK5_AUDIT.md § finding 3.
    <aside
      className="lc-rail"
      data-collapsed={collapsed ? "1" : "0"}
      aria-label="Primary navigation"
    >
      <div className="lc-brand-block">
        <div className="lc-brand-glyph" aria-hidden="true" />
        <div className="lc-brand-text">
          <span className="lc-brand-eb">liquid · clips</span>
          <span className="lc-brand-wm">liquid<span className="lc-slash">/</span>clips</span>
        </div>
        <button
          type="button"
          className="lc-nav-collapse-btn"
          aria-label={collapsed ? "Expand sidebar (⌘\\)" : "Collapse sidebar (⌘\\)"}
          aria-expanded={!collapsed}
          aria-controls="lc-console-navigation"
          title={collapsed ? "Expand (⌘\\)" : "Collapse (⌘\\)"}
          onClick={toggleCollapsed}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <div className="lc-rail-section">
        <div className="lc-rail-label">Console · {mode === "agency" ? "Agency" : "Clipper"}</div>
        <nav className="lc-nav" id="lc-console-navigation">
          {ITEMS.filter(inMode).map((item) => (
            <NavRow
              key={item.route}
              item={item}
              active={item.route === activeRoute}
            />
          ))}
        </nav>
      </div>

      <div className="lc-rail-foot">
        {FOOTER.filter(inMode).map((item) => (
          <NavRow
            key={item.route}
            item={item}
            active={item.route === activeRoute}
          />
        ))}
      </div>
    </aside>
  );
}

function NavRow({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  return (
    <button
      type="button"
      className={`lc-nav-item ${active ? "is-active" : ""}`}
      data-route={item.route}
      /* D1 (2026-07-13) · Design-OS nav rows are BUTTONS, not anchors,
       * because per the two-pipeline rule (desktop-2/CLAUDE.md) Design-OS
       * routes are reached via `bus.emit("nav:click", …)` — never via the
       * outer hash. A hash-href anchor rendered as
       * `http://localhost:1800/?skipIntro=1#/<route>` was mis-classified
       * by the button-audit as an external NON-whitelisted URL (correct:
       * localhost is not in the whitelist and the design-os pipeline
       * should not depend on the outer hash at all). Buttons are natively
       * Tab-focusable + Space/Enter-activatable so keyboard accessibility
       * is preserved. aria-current signals the active tab. */
      aria-current={active ? "page" : undefined}
      onClick={() => {
        if (active) return;
        // Perf Phase 1 · MARK 1 · fire BEFORE bus.emit so the mark
        // captures the true click t0, not the bus receipt tick. Every
        // downstream mark (route_mount_start · fcr · interactive_ready)
        // measures back to this timestamp.
        markNavClick(item.route);
        bus.emit("nav:click", { route: item.route });
        // 2026-07-13 · Post-RC1 · Support-nav clicks are the
        // canonical "user asked for help" signal. Fire the
        // `support.request` HqEvent so HQ dashboards + Codex
        // support-lane classifiers see it with the full envelope.
        // Other route clicks stay silent — those are covered by the
        // existing nav perf marks.
        if (item.route === "support") {
          void import("../../lib/hqEmit").then((h) => {
            h.emitHqEvent({
              category: "support.request",
              severity: "info",
              topic: "nav.support.clicked",
              data: { route: item.route },
            });
          }).catch(() => {
            /* HQ emit is best-effort */
          });
        }
      }}
    >
      <img className="lc-nav-ico" src={item.icon} alt="" />
      <span className="lc-nav-label">{item.label}</span>
      {item.badge !== undefined && <span className="lc-nav-badge">{item.badge}</span>}
      {item.status && <span className="lc-nav-status">{item.status}</span>}
    </button>
  );
}
