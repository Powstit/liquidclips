// Persistent right-edge pull-tab. Mounted once in <AppShell> so every
// section gets the same always-on Browser affordance — Daniel's call:
// "should be similar to old app where there's a tab on right of screen."
//
// Clicking the tab opens the centered BrowseOverlay (90vw × 88vh modal,
// dims the workspace, no permanent right-rail reservation).
//
// 2026-06-25 · Lane 1 guard UPDATED (see docs/lc2/COMPLETE_CLIPPER_APP_GAP_MAP.md §11):
// the behaviour-based rule now PERMITS the Rust browse_panel commands as long
// as the webview bounds are caller-provided (not fixed 560px right-rail).
// What's still FORBIDDEN: any `paddingRight: 566px` or equivalent fixed-width
// rail layout that squashes the workspace. The native Rust child webview
// inside the centered overlay sidesteps the original "squashed workspace"
// concern entirely.
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
