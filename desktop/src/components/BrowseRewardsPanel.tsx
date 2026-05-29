// Chrome bar pinned to the top of the embedded Browse Rewards webview.
// The native WKWebView (owned by Rust — see src-tauri/src/browse.rs) sits
// 72px below this bar inside the same Liquid Clips window.
//
// React owns:
//   - Back / Forward / Reload controls
//   - URL bar with smart routing (bare domain → https://, search phrase → Google)
//   - Go / Close buttons
//   - Quick links to known reward platforms
//
// Visibility: only renders when the browse panel is open. The fuchsia edge
// tab in App.tsx is the opener; this chrome's Close button is the closer.

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookmarkPlus, RotateCw, X } from "lucide-react";
import {
  browseBack,
  browseForward,
  browseReload,
  closeBrowsePanel,
  openBrowsePanel,
  useBrowsePanel,
  WHOP_REWARDS_URL,
} from "../lib/browse";
import { BriefForm } from "./earn/BriefForm";

// Must match src-tauri/src/browse.rs constants.
const PANEL_WIDTH = 560;
const RESIZE_GUTTER = 6;
const CHROME_HEIGHT = 72;

function normalize(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return WHOP_REWARDS_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowseRewardsPanel() {
  const { open, currentUrl } = useBrowsePanel();
  const [draft, setDraft] = useState(currentUrl ?? WHOP_REWARDS_URL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);

  useEffect(() => {
    if (currentUrl) setDraft(currentUrl);
  }, [currentUrl]);

  if (!open) return null;

  async function go(url: string = draft) {
    setBusy(true);
    setErr(null);
    try {
      const next = normalize(url);
      setDraft(next);
      await openBrowsePanel(next);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    setErr(null);
    try {
      await closeBrowsePanel();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed top-0 z-30 flex flex-col gap-1.5 border-b border-l border-fuchsia/40 bg-paper-elev px-3 py-2 shadow-[var(--shadow-e2)]"
      style={{
        right: RESIZE_GUTTER,
        width: PANEL_WIDTH,
        height: CHROME_HEIGHT,
      }}
    >
      <div className="flex items-center gap-1.5">
        <ChromeIconButton onClick={() => void browseBack()} disabled={busy} label="Back">
          <ArrowLeft size={14} />
        </ChromeIconButton>
        <ChromeIconButton onClick={() => void browseForward()} disabled={busy} label="Forward">
          <ArrowRight size={14} />
        </ChromeIconButton>
        <ChromeIconButton onClick={() => void browseReload()} disabled={busy} label="Reload">
          <RotateCw size={13} />
        </ChromeIconButton>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void go();
            }
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder="Search or enter URL"
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-text-tertiary focus:border-fuchsia focus:shadow-[var(--glow-sm)]"
        />
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="inline-flex h-7 items-center rounded-md bg-fuchsia px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-white transition-colors hover:bg-fuchsia-bright disabled:opacity-50"
        >
          {busy ? "…" : "Go"}
        </button>
        <ChromeIconButton
          onClick={() => setShowSaveForm(true)}
          disabled={busy}
          label="Save as brief"
        >
          <BookmarkPlus size={14} />
        </ChromeIconButton>
        <ChromeIconButton onClick={() => void close()} disabled={busy} label="Close browser">
          <X size={14} />
        </ChromeIconButton>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
        <span>quick</span>
        <QuickLink label="Whop Rewards" url={WHOP_REWARDS_URL} onOpen={go} />
        <QuickLink label="Clipping.net" url="https://clipping.net" onOpen={go} />
        <QuickLink label="Klipy" url="https://klipy.com" onOpen={go} />
        <QuickLink label="Opus" url="https://opus.pro" onOpen={go} />
        {err && <span className="ml-auto truncate text-[#DC2626]">{err}</span>}
      </div>
      {showSaveForm && (
        <BriefForm
          brief={null}
          initialSourceUrl={currentUrl ?? draft}
          onClose={() => setShowSaveForm(false)}
          onSaved={() => setShowSaveForm(false)}
        />
      )}
    </div>
  );
}

function ChromeIconButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-paper text-text-secondary transition-colors enabled:hover:border-fuchsia enabled:hover:text-fuchsia disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function QuickLink({
  label,
  url,
  onOpen,
}: {
  label: string;
  url: string;
  onOpen: (url: string) => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onOpen(url)}
      className="rounded-full border border-line px-2 py-0.5 text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia"
    >
      {label}
    </button>
  );
}
