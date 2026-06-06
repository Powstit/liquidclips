// Earn redesign — layout spine.
//
// Three-zone shell that fits within the default 1280×820 window without
// scrolling: ticker (60px) across the top, icon rail (60px) down the left,
// main feed in the middle, sidebar (300px) on the right.
//
// Below 1100px the sidebar slides into an icon-toggle drawer so the no-scroll
// rule survives narrow window resizes. Above 1100px both rails are always
// visible.

import { useEffect, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

type Props = {
  ticker: ReactNode;
  rail: ReactNode;
  main: ReactNode;
  sidebar: ReactNode;
};

const SIDEBAR_AUTOHIDE_BELOW = 1100;

export function EarnLayout({ ticker, rail, main, sidebar }: Props) {
  // Auto-hide the sidebar on narrow viewports; the toggle button lets the
  // user pop it back open. Tailwind arbitrary breakpoint classes don't
  // evaluate template-interpolated strings, so we drive the breakpoint via
  // a resize listener instead of a `min-[1100px]` class.
  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window === "undefined" ? true : window.innerWidth >= SIDEBAR_AUTOHIDE_BELOW,
  );
  // PREVENTS — resize listener clobbering an explicit user choice. Once
  // the user has pinned/unpinned the sidebar by hand, the resize-driven
  // auto-collapse stops for the rest of the session.
  const [manualOverride, setManualOverride] = useState(false);

  useEffect(() => {
    function onResize(): void {
      if (manualOverride) return;
      // Only collapse on narrowing; never force-open when the user has
      // explicitly closed it on a wide viewport.
      if (window.innerWidth < SIDEBAR_AUTOHIDE_BELOW) {
        setSidebarOpen(false);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [manualOverride]);

  return (
    // v0.5.1 — Arena Deck. Fuchsia + amber tail at the top edge reads as
    // coliseum / leaderboard energy. The amber tail is scoped to .deck-earn
    // in index.css — we do NOT introduce a new amber brand token.
    // Cockpit pass: layout shell is transparent so the room shows through.
    // The deck-earn top hairline + amber tail (defined in index.css) still
    // tints the surface — column rails keep a 1px line-strong divider but
    // drop their solid paper-elev plates.
    <div className="deck deck-earn flex h-full w-full flex-col bg-transparent">
      {/* Ticker — 60px row that never scrolls */}
      <div className="shrink-0 border-b border-line bg-transparent backdrop-blur-[6px]">
        {ticker}
      </div>

      {/* Three-column body: rail | main | sidebar */}
      <div className="flex min-h-0 flex-1">
        {/* Icon rail — always visible */}
        <aside className="flex w-[60px] shrink-0 flex-col items-stretch border-r border-line bg-transparent">
          {rail}
        </aside>

        {/* Main feed — scrolls if rows exceed grid height */}
        <main className="relative min-w-0 flex-1 overflow-y-auto bg-transparent">
          <div className="px-5 py-4">{main}</div>

          <button
            type="button"
            onClick={() => {
              setManualOverride(true);
              setSidebarOpen((v) => !v);
            }}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-text-secondary transition-colors hover:text-fuchsia"
          >
            {sidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
        </main>

        {/* Right sidebar — collapses to 0 width when closed. The inner
            fixed-width content is hidden via overflow-hidden so it doesn't
            spill out during the transition. */}
        <aside
          className={`shrink-0 overflow-hidden border-l border-line bg-transparent transition-[width,opacity] duration-200 ${
            sidebarOpen ? "w-[300px] opacity-100" : "w-0 border-l-0 opacity-0"
          }`}
        >
          <div className="h-full w-[300px] overflow-y-auto px-4 py-4">{sidebar}</div>
        </aside>
      </div>
    </div>
  );
}
