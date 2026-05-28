// 44px chrome bar that sits ABOVE the native child webview. React owns the
// chrome (back / forward / reload / close); Rust owns the actual browser
// surface below. Together they make a real embedded browser pinned to the
// right 480px of the window.
//
// Visibility is driven by the singleton store in src/lib/browse.ts so the
// chrome stays mounted across tab switches — closing it from any surface
// works because the native webview is single-instance keyed by label.

import { ArrowLeft, ArrowRight, RotateCw, X } from "lucide-react";
import { browseBack, browseForward, browseReload, closeBrowsePanel, useBrowsePanel } from "../lib/browse";

const PANEL_WIDTH = 480; // must match PANEL_WIDTH in src-tauri/src/browse.rs
const CHROME_HEIGHT = 44; // must match CHROME_HEIGHT in src-tauri/src/browse.rs

export function BrowseRewardsPanel() {
  const { open, currentUrl } = useBrowsePanel();
  if (!open) return null;

  return (
    <div
      className="fixed right-0 top-0 z-50 flex items-center gap-1.5 border-b border-l border-line bg-paper-elev px-2"
      style={{ width: PANEL_WIDTH, height: CHROME_HEIGHT }}
    >
      <ChromeButton onClick={() => void browseBack()} label="Back">
        <ArrowLeft size={16} />
      </ChromeButton>
      <ChromeButton onClick={() => void browseForward()} label="Forward">
        <ArrowRight size={16} />
      </ChromeButton>
      <ChromeButton onClick={() => void browseReload()} label="Reload">
        <RotateCw size={14} />
      </ChromeButton>
      <span
        className="flex-1 truncate rounded-full bg-paper/60 px-3 py-1 font-mono text-[11px] text-text-tertiary"
        title={currentUrl ?? ""}
      >
        {prettyUrl(currentUrl)}
      </span>
      <ChromeButton onClick={() => void closeBrowsePanel()} label="Close panel">
        <X size={16} />
      </ChromeButton>
    </div>
  );
}

function ChromeButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-paper hover:text-ink"
    >
      {children}
    </button>
  );
}

function prettyUrl(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}
