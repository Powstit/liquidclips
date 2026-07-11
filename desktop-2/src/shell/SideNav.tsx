import { useMemo, useState } from "react";
import { SECTION_REGISTRY } from "./sectionRegistry";
import type { SectionId } from "./sectionIds";
import { navigateTo } from "./routes";
import { navBadgeFor, tier as tierBadge } from "../brand/brandAssets";
import { SafeImg } from "../components/safe";
import { useMe } from "../design-os/state/useMe";
import { useTierCaps } from "../design-os/state/useTierCaps";

interface SideNavProps {
  activeId: SectionId;
}

/* R7 · 2026-07-11 · SideNav identity strip pulled off the canonical
 * `useMe()` + `useTierCaps()` state so it never drifts from the TopHud
 * pill. Previous version hardcoded "GU" / "Guest" / "Free" regardless
 * of who was signed in — a full-frame lie the moment a real user
 * signed in. The strip now shows:
 *   - initials from the /me email local-part (up to 2 chars) OR "GU"
 *     when no snapshot yet (honest anonymous placeholder)
 *   - handle (@local-part) when signed in, "Guest" when not
 *   - real tier label from useTierCaps (matches TopHud's `resolvedTier`)
 *   - tier crown badge (free / pro / growth / agency) from brandAssets
 */
function useIdentityStrip(): {
  initials: string;
  handle: string;
  tierLabel: string;
  tierAsset: string;
} {
  const me = useMe();
  const caps = useTierCaps();
  return useMemo(() => {
    const email = me.snapshot?.email ?? null;
    const local = email ? email.split("@")[0]?.trim() : null;
    const initials = local && local.length > 0
      ? local.slice(0, 2).toUpperCase()
      : "GU";
    const handle = local && local.length > 0 ? `@${local}` : "Guest";
    // Same derivation the TopHud pill uses (see TopHud.tsx:resolvedTier).
    let tierLabel: string;
    if (caps.platformRole === "admin") tierLabel = "Admin";
    else if (caps.tier === "clipper") tierLabel = "Free";
    else tierLabel = caps.tier.charAt(0).toUpperCase() + caps.tier.slice(1);
    // Tier crown asset — "clipper" maps to the "free" crown.
    const tierAssetName = caps.tier === "clipper" ? "free" : caps.tier;
    return { initials, handle, tierLabel, tierAsset: tierBadge(tierAssetName) };
  }, [me.snapshot?.email, caps.tier, caps.platformRole]);
}

export function SideNav({ activeId }: SideNavProps) {
  const [collapsed, setCollapsed] = useState(false);
  const items = SECTION_REGISTRY.filter((s) => s.navVisible);
  const identity = useIdentityStrip();

  return (
    <aside
      className="lc-sidenav"
      aria-label="Primary navigation"
      data-collapsed={collapsed}
    >
      <div className="lc-sidenav-logo">
        <SafeImg
          className="lc-sidenav-brand-glyph"
          src="/brand/assets/glyph.png"
          alt="Liquid Clips"
          draggable={false}
        />
      </div>

      <button
        type="button"
        className="lc-sidenav-collapse"
        aria-label="Collapse sidebar"
        title="Collapse / expand"
        onClick={() => setCollapsed((c) => !c)}
      >
        ‹
      </button>

      <nav className="lc-sidenav-list" aria-label="Sections">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="lc-sidenav-item"
            data-active={item.id === activeId}
            onClick={() => navigateTo(item.id)}
          >
            <span className="lc-sidenav-halo" />
            <span className="lc-sidenav-bar" />
            <SafeImg
              className="lc-sidenav-icon"
              src={navBadgeFor(item.id) ?? "/brand/assets/glyph.png"}
              fallback="/brand/assets/glyph.png"
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <span className="lc-sidenav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="lc-sidenav-divider" />

      {/* R7 · 2026-07-11 · Wired to useMe() + useTierCaps() so identity
        * matches the TopHud pill instant-for-instant. Prior version
        * hardcoded "GU" / "Guest" / "Free" regardless of auth state. */}
      <div
        className="lc-nav-user"
        data-testid="sidenav-user"
        data-signed-in={identity.handle === "Guest" ? "0" : "1"}
      >
        <div className="lc-nav-user-avatar" data-testid="sidenav-avatar">
          {identity.initials}
          <SafeImg
            className="lc-nav-user-crown"
            src={identity.tierAsset}
            fallback="hide"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </div>
        <div className="lc-nav-user-text">
          <div className="lc-nav-user-name" data-testid="sidenav-user-name">{identity.handle}</div>
          <div className="lc-nav-user-tier" data-testid="sidenav-user-tier">{identity.tierLabel}</div>
        </div>
      </div>
    </aside>
  );
}
