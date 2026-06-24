// Persistent right-edge pull-tab. Mounted once in <AppShell> so every
// section gets the same always-on Browser affordance — Daniel's call:
// "should be similar to old app where there's a tab on right of screen."
//
// Clicking the tab opens the centered BrowseOverlay. We DO NOT re-introduce
// the old right-anchored panel architecture (the Lane 1 guard forbids both
// the fixed right-rail padding offset and the Rust browse_panel commands).
//
// The tab returns null while the overlay is open so it doesn't compete with
// the chrome's close button for the same gesture.

import { Compass, ArrowUpRight } from "../icons/BrandGlyphs";
import { useBrowseOverlay, WHOP_REWARDS_URL } from "../../state/browseOverlay";

export function BrowseRailTab(): JSX.Element | null {
  const open = useBrowseOverlay((s) => s.open);
  const openWith = useBrowseOverlay((s) => s.openWith);
  if (open) return null;
  return (
    <button
      type="button"
      className="lc-browse-rail-tab"
      data-browse-rail-tab="root"
      aria-label="Open in-app browser"
      title="Open Browser ↗"
      onClick={() => openWith(WHOP_REWARDS_URL, "browse-campaign")}
    >
      <span className="lc-browse-rail-tab-glow" aria-hidden="true" />
      <Compass size={16} strokeWidth={1.7} />
      <span className="lc-browse-rail-tab-label">Browse</span>
      <ArrowUpRight size={11} strokeWidth={1.9} />
    </button>
  );
}
