import { ArrowUpRight, Compass } from "../../components/icons/BrandGlyphs";
import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { useBrowseOverlay, WHOP_REWARDS_URL } from "../../state/browseOverlay";

export function BrowseSection() {
  const openBrowser = useBrowseOverlay((s) => s.openWith);

  return (
    <>
      <div className="lc-section-header">
        <div>
          <span className="lc-section-eyebrow">
            <span className="lc-section-eyebrow-dot" /> youtube · drive · url
          </span>
          <h1 className="lc-section-title">Browse</h1>
          <p className="lc-section-subtitle">
            Pick a source. Pre-selects the import destination — Create or a Project.
          </p>
          <div className="lc-section-pills">
            <span className="lc-id-pill">{SECTION_IDS.SECTION_BROWSE}</span>
            <span className="lc-id-pill">{FLOW_IDS.FLOW_015_BROWSE_YOUTUBE_DRIVE_IMPORT}</span>
          </div>
        </div>
      </div>

      {/* S0 blocker fix 2026-06-17 — make the browser overlay obvious from
          the side-nav "Browse" entry. Clicking the sidebar item landed
          users on this source-picker without any sign that the in-app
          browser exists. Explain + provide a launcher. */}
      <div className="lc-hud-card lc-mt-24" data-browse-launcher="root">
        <span className="lc-hud-eyebrow">In-app browser</span>
        <h3 className="lc-hud-title">Browser opens as an overlay on top of the app</h3>
        <p className="lc-hud-body">
          Launch it from Home, Earn, Campaigns, or Community to browse rewards
          and Whop pages without leaving the app. <em>Use in Engine ↗</em> hands
          the page off to the Editor when you find a clip-worthy source.
        </p>
        <div className="lc-section-pills lc-mt-24">
          <button
            type="button"
            className="lc-btn"
            data-variant="primary"
            data-browse-launcher="cta"
            onClick={() => openBrowser(WHOP_REWARDS_URL, "browse-campaign")}
          >
            <Compass size={14} /> Open browser overlay →
          </button>
          <span className="lc-id-pill">
            <ArrowUpRight size={12} /> esc to close
          </span>
        </div>
      </div>

      <div className="lc-grid lc-grid-3 lc-mt-24">
        <div className="lc-hud-card">
          <span className="lc-hud-eyebrow">YouTube</span>
          <h3 className="lc-hud-title">My channel · 142 vids</h3>
          <p className="lc-hud-body">Most-viewed first · last 90 days.</p>
        </div>
        <div className="lc-hud-card">
          <span className="lc-hud-eyebrow">Drive</span>
          <h3 className="lc-hud-title">All my recordings</h3>
          <p className="lc-hud-body">Studio session folders surfaced automatically.</p>
        </div>
        <div className="lc-hud-card">
          <span className="lc-hud-eyebrow">URL</span>
          <h3 className="lc-hud-title">Paste anywhere</h3>
          <p className="lc-hud-body">Same allowlist as Create.</p>
        </div>
      </div>
    </>
  );
}
