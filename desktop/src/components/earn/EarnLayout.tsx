// Earn redesign — layout spine.
//
// Three-zone shell that fits within the default 1280×820 window without
// scrolling: ticker (60px) across the top, icon rail (60px) down the left,
// main feed in the middle, sidebar (300px) on the right.
//
// Below 1100px the sidebar slides into an icon-toggle drawer so the no-scroll
// rule survives narrow window resizes. Above 1100px both rails are always
// visible.

import { useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

type Props = {
  ticker: ReactNode;
  rail: ReactNode;
  main: ReactNode;
  sidebar: ReactNode;
};

const SIDEBAR_BREAKPOINT_PX = 1100;

export function EarnLayout({ ticker, rail, main, sidebar }: Props) {
  // Open by default on first paint; user can collapse to maximise grid width
  // in narrow windows.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Ticker — 60px row that never scrolls */}
      <div className="shrink-0 border-b border-line bg-paper-elev/80 backdrop-blur-[12px]">
        {ticker}
      </div>

      {/* Three-column body: rail | main | sidebar */}
      <div className="flex min-h-0 flex-1">
        {/* Icon rail — always visible */}
        <aside className="flex w-[60px] shrink-0 flex-col items-stretch border-r border-line bg-paper-elev/40">
          {rail}
        </aside>

        {/* Main feed — scrolls if rows exceed grid height */}
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="px-5 py-4">{main}</div>

          {/* Narrow-window sidebar toggle — sits inside the main pane so users
              can find it even when the sidebar is hidden. Hidden on wide. */}
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            className={`absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-paper text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia min-[${SIDEBAR_BREAKPOINT_PX}px]:hidden`}
          >
            {sidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
        </main>

        {/* Right sidebar — collapses below the breakpoint when closed */}
        <aside
          className={`shrink-0 overflow-y-auto border-l border-line bg-paper-elev/30 transition-[width,opacity] duration-200 ${
            sidebarOpen ? "w-[300px] opacity-100" : "w-0 opacity-0"
          }`}
        >
          <div className="w-[300px] px-4 py-4">{sidebar}</div>
        </aside>
      </div>
    </div>
  );
}
