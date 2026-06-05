import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { SideNavItem } from "./SideNavItem";
import glyphUrl from "../../assets/brand/glyph.png";
import workspaceBadge from "../../assets/nav-badges/workspace.png";
import libraryBadge from "../../assets/nav-badges/library.png";
import earnBadge from "../../assets/nav-badges/earn.png";
import learnBadge from "../../assets/nav-badges/learn.png";
import scheduleBadge from "../../assets/nav-badges/schedule.png";
import uploadBadge from "../../assets/nav-badges/upload.png";
import payoutsBadge from "../../assets/nav-badges/payouts.png";
import communityBadge from "../../assets/nav-badges/community.png";
import settingsBadge from "../../assets/nav-badges/settings.png";

const COLLAPSE_KEY = "lc:sidenav:collapsed";

// v0.6.3 — Game-tier nav badges replace the v0.6.2 lucide stroke glyphs.
// Each badge is a Riot-rank-card style emblem rendered via gpt-image-1
// (single fuchsia line, HUD bracket corners, transparent bg, pixel-art).
// The CSS in index.css gives them an idle bob + hover lift + active pulse
// so the rail reads as a game inventory, not a SaaS dashboard.
//
// v0.6.7 — Account removed (duplicated Settings target + lucide outlier
// that broke the rail's badge rhythm). User identity surfaces inside Settings.
// v0.7.0 — "community" is a native in-app view (not a webview embed). The
// initial attempt embedded Whop's hub via Tauri child webview, but Whop
// returns a "Product not found" frame for /<slug>/chat which felt broken.
// Owning the page in-app lets us pin announcements, surface campaign
// briefs inline, and grow into a real feed without depending on Whop's URL
// surface.
export type SideNavKey =
  | "workspace"
  | "library"
  | "earn"
  | "learn"
  | "schedule"
  | "upload"
  | "payouts"
  | "community"
  | "settings";

export function SideNav({
  activeKey,
  onSelect,
  onOpenSettings,
}: {
  activeKey: SideNavKey | null;
  onSelect: (key: Exclude<SideNavKey, "settings">) => void;
  onOpenSettings: () => void;
}) {
  // v0.6.35 — Persisted collapse state. The 2× icons make the rail richer
  // but also wider; collapsing reverts to a tighter icon-only column for
  // sessions where Daniel wants the workspace to breathe.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage?.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage?.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode / quota — non-fatal */
    }
  }, [collapsed]);

  return (
    <aside
      className="lc-sidenav"
      aria-label="Primary navigation"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className="lc-sidenav-logo">
        <img
          src={glyphUrl}
          alt="Liquid Clips"
          title="Liquid Clips"
          draggable={false}
          className="lc-sidenav-brand-glyph select-none"
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="lc-sidenav-collapse"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand" : "Collapse"}
      >
        <ChevronLeft className="h-3 w-3" strokeWidth={2.25} />
      </button>

      <nav className="lc-sidenav-list" aria-label="Sections">
        <SideNavItem
          label="Workspace"
          active={activeKey === "workspace"}
          onClick={() => onSelect("workspace")}
          iconSrc={workspaceBadge}
        />
        <SideNavItem
          label="Library"
          active={activeKey === "library"}
          onClick={() => onSelect("library")}
          iconSrc={libraryBadge}
        />
        <SideNavItem
          label="Earn"
          active={activeKey === "earn"}
          onClick={() => onSelect("earn")}
          iconSrc={earnBadge}
        />
        <SideNavItem
          label="Learn"
          active={activeKey === "learn"}
          onClick={() => onSelect("learn")}
          iconSrc={learnBadge}
        />
        <SideNavItem
          label="Schedule"
          active={activeKey === "schedule"}
          onClick={() => onSelect("schedule")}
          iconSrc={scheduleBadge}
        />
        <SideNavItem
          label="Upload"
          active={activeKey === "upload"}
          onClick={() => onSelect("upload")}
          iconSrc={uploadBadge}
        />
        <SideNavItem
          label="Payouts"
          active={activeKey === "payouts"}
          onClick={() => onSelect("payouts")}
          iconSrc={payoutsBadge}
        />
        <SideNavItem
          label="Community"
          active={activeKey === "community"}
          onClick={() => onSelect("community")}
          iconSrc={communityBadge}
        />
      </nav>

      <div className="lc-sidenav-divider" aria-hidden="true" />

      <div className="lc-sidenav-bottom">
        <SideNavItem
          label="Settings"
          active={activeKey === "settings"}
          onClick={onOpenSettings}
          iconSrc={settingsBadge}
        />
      </div>
    </aside>
  );
}
