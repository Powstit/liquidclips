/**
 * ConsoleNav · the left rail
 *
 * 10 main nav items + Support footer. Each hover fires `nav:hover` with the
 * route's matching Kade state (so KadeController can react USER-DRIVEN).
 * Click fires `nav:click` for the host route to swap. We do NOT touch
 * desktop-2's hash router here — wiring lives in CommandRoom.
 *
 * Phase 4B-rev rules:
 *   - Compact pills; never DSEG.
 *   - No pill collisions: badge sits to the right, label truncates.
 *   - Use Phase 4A nav SVGs where shipped.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { bus, useMode, type AppMode, type KadeState, type RouteId } from "../bridge";
import { NAV_KADE_BRIEF } from "../copy/copyMap";
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
  { route: "submissions", label: "Submissions", icon: "/brand/icons/nav/community.svg",  kade: "reading-brief", modes: ["agency"] },
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

  // VAL.1 · sliding active pill. One element travels between rows instead of
  // each row painting its own background. Position computed against the
  // shared `.lc-rail` container so the pill can live in either the main nav
  // or the footer section.
  //
  // Item 3 follow-up — Option B chase-hover: the pill now tracks the
  // hovered row when one is set, and falls back to the active route when
  // the cursor leaves the rail. Click still updates activeRoute (the
  // host's hash router consumes `nav:click`); pill returns to it on
  // rail-leave.
  const railRef = useRef<HTMLElement | null>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  const [hoveredRoute, setHoveredRoute] = useState<RouteId | null>(null);
  const pillRoute: RouteId = hoveredRoute ?? activeRoute;

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const update = () => {
      const target = rail.querySelector<HTMLElement>(
        `.lc-nav-item[data-route="${pillRoute}"]`,
      );
      if (!target) { setPill(null); return; }
      // Offsets are relative to `.lc-rail` (position:relative anchors below).
      const railRect = rail.getBoundingClientRect();
      const rowRect = target.getBoundingClientRect();
      setPill({
        top: rowRect.top - railRect.top + rail.scrollTop,
        height: rowRect.height,
      });
    };
    update();
    // Recompute on rail scroll / window resize so the pill stays in sync.
    rail.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      rail.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pillRoute, mode]);

  return (
    <aside
      className="lc-rail"
      ref={railRef}
      onMouseLeave={() => setHoveredRoute(null)}
      data-collapsed={collapsed ? "1" : "0"}
    >
      {pill && (
        <span
          className="lc-nav-active-pill"
          aria-hidden="true"
          style={{ top: pill.top, height: pill.height }}
        />
      )}

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
              pillTarget={item.route === pillRoute}
              onHoverRoute={setHoveredRoute}
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
            pillTarget={item.route === pillRoute}
            onHoverRoute={setHoveredRoute}
          />
        ))}
      </div>
    </aside>
  );
}

function NavRow({
  item,
  active,
  pillTarget,
  onHoverRoute,
}: {
  item: NavItem;
  active: boolean;
  /** True when the sliding pink pill is currently sitting on this row —
   *  either because it's the active route OR because the cursor is over
   *  it (Option B chase-hover). Drives the white text/icon treatment so
   *  the row reads on the bright fuchsia background. */
  pillTarget: boolean;
  /** Push the hovered route up to the rail so the pill can chase. */
  onHoverRoute: (route: RouteId) => void;
}) {
  const [hovered, setHovered] = useState(false);
  /* P1-2B-b · Tier A · viewport-fixed tooltip coords computed from the
   * row's bounding rect at hover-time. Escapes the stacking-context +
   * overflow trap that pinned `.lc-nav-tip` behind route frames. */
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLAnchorElement>(null);
  const brief = NAV_KADE_BRIEF[item.route];

  const handleEnter = () => {
    setHovered(true);
    onHoverRoute(item.route);
    bus.emit("nav:hover", { route: item.route, kade: item.kade });
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) {
      setTipPos({
        top: rect.top + rect.height / 2,  // vertical center of the row
        left: rect.right + 14,            // 14px right of the row's right edge
      });
    }
  };

  return (
    <a
      ref={rowRef}
      className={`lc-nav-item ${active ? "is-active" : ""} ${pillTarget ? "is-pill-target" : ""} ${hovered ? "is-hover" : ""}`}
      data-route={item.route}
      /* Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · every row
       * needs href so it's Tab-focusable + keyboard-activatable. Prior
       * anchors had no href → the entire primary nav was invisible to
       * keyboard users. onClick still preventDefault + emits `nav:click`;
       * href is a fallback for right-click / open-in-new-window / user
       * agents that ignore JS. aria-current signals the active tab. */
      href={`#/${item.route}`}
      aria-current={active ? "page" : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.preventDefault();
        bus.emit("nav:click", { route: item.route });
      }}
    >
      <img className="lc-nav-ico" src={item.icon} alt="" />
      <span className="lc-nav-label">{item.label}</span>
      {item.badge !== undefined && <span className="lc-nav-badge">{item.badge}</span>}
      {item.status && <span className="lc-nav-status">{item.status}</span>}

      {/* Kade brief tooltip · position: fixed (CSS) + computed viewport
          coords (inline style) so the tooltip floats above route frames.
          pointer-events:none keeps mouse-tracking clean. */}
      <span
        className="lc-nav-tip"
        role="tooltip"
        aria-hidden={!hovered}
        style={tipPos ? { top: tipPos.top, left: tipPos.left } : undefined}
      >
        <span className="lc-nav-tip-eb">Kade</span>
        <span className="lc-nav-tip-body">{brief}</span>
      </span>
    </a>
  );
}
