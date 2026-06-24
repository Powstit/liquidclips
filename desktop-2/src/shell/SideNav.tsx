import { useState } from "react";
import { SECTION_REGISTRY } from "./sectionRegistry";
import type { SectionId } from "./sectionIds";
import { navigateTo } from "./routes";
import { navBadgeFor, tier } from "../brand/brandAssets";

interface SideNavProps {
  activeId: SectionId;
}

export function SideNav({ activeId }: SideNavProps) {
  const [collapsed, setCollapsed] = useState(false);
  const items = SECTION_REGISTRY.filter((s) => s.navVisible);

  return (
    <aside
      className="lc-sidenav"
      aria-label="Primary navigation"
      data-collapsed={collapsed}
    >
      <div className="lc-sidenav-logo">
        <img
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
            <img
              className="lc-sidenav-icon"
              src={navBadgeFor(item.id) ?? "/brand/assets/glyph.png"}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <span className="lc-sidenav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="lc-sidenav-divider" />

      <div className="lc-nav-user">
        <div className="lc-nav-user-avatar">
          DD
          <img
            className="lc-nav-user-crown"
            src={tier("free")}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </div>
        <div className="lc-nav-user-text">
          <div className="lc-nav-user-name">Daniel D.</div>
          <div className="lc-nav-user-tier">Free</div>
        </div>
      </div>
    </aside>
  );
}
