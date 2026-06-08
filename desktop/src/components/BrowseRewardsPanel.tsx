// ship-lens v0.7.8: E6 — chrome now reflects `loading` from the singleton store, surfaces a "Still loading…" prompt with a Reload button if loading stays true for 10s, and subscribes to `subscribeBrowsePanelError` so Rust-emitted (or timeout-fallback) errors land as an inline toast. Pre-fix the panel had no honest loading state and silently lied on Rust errors.
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
  ensureBrowsePanelEventBridge,
  openBrowsePanel,
  subscribeBrowsePanelError,
  useBrowsePanel,
  WHOP_REWARDS_URL,
} from "../lib/browse";
import { humanError } from "../lib/sidecar";
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
  const { open, currentUrl, loading } = useBrowsePanel();
  const [draft, setDraft] = useState(currentUrl ?? WHOP_REWARDS_URL);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);

  useEffect(() => {
    if (currentUrl) setDraft(currentUrl);
  }, [currentUrl]);

  // v0.7.8 fix E6 — subscribe to Rust-side panel errors AND the 10s
  // timeout's soft "still loading" signal. Both flow through the same bus,
  // so the UI handler treats them the same way: surface inline copy with a
  // Reload affordance instead of pretending the navigation succeeded.
  // Bridge boot is idempotent — multiple mounts only attach the Tauri
  // listeners once.
  useEffect(() => {
    void ensureBrowsePanelEventBridge();
    const unsubscribe = subscribeBrowsePanelError((msg) => {
      setErr(msg || "Couldn't load this page — try Reload.");
    });
    return () => {
      unsubscribe();
    };
  }, []);

  if (!open) return null;

  async function go(url: string = draft) {
    setBusy(true);
    setErr(null);
    try {
      const next = normalize(url);
      setDraft(next);
      await openBrowsePanel(next);
    } catch (e) {
      setErr(humanError(e));
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
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  // v0.7.8 fix E6 — the singleton store flips `loading` off after 10s and
  // emits a soft error onto the bus. When BOTH flags are present
  // (loading false + err set + currentUrl set) we render a Reload button
  // alongside the error copy. The plain `loading` state alone gets a
  // subtle "loading…" pill so the user knows something is happening.
  async function reload() {
    if (!currentUrl) return;
    setErr(null);
    await go(currentUrl);
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
        <button
          type="button"
          onClick={() => setShowSaveForm(true)}
          disabled={busy}
          title="Save this page as a campaign"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-paper px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors enabled:hover:border-fuchsia enabled:hover:text-fuchsia disabled:cursor-not-allowed disabled:opacity-35"
        >
          <BookmarkPlus size={12} />
          Save
        </button>
        <ChromeIconButton onClick={() => void close()} disabled={busy} label="Close browser">
          <X size={14} />
        </ChromeIconButton>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
        <span>quick</span>
        <QuickLink
          label="Whop Rewards"
          url={WHOP_REWARDS_URL}
          title="Browse Whop's official Content Rewards campaigns"
          onOpen={go}
        />
        <QuickLink
          label="Clipping.net"
          url="https://clipping.net"
          title="Browse Clipping.net — independent reward platform"
          onOpen={go}
        />
        <QuickLink
          label="Klipy"
          url="https://klipy.com"
          title="Browse Klipy — TikTok / Shorts campaign marketplace"
          onOpen={go}
        />
        <QuickLink
          label="Opus"
          url="https://opus.pro"
          title="Browse Opus.pro — AI clipping platform with campaigns"
          onOpen={go}
        />
        {/* v0.7.8 fix E6 — loading + error states. Loading is a subtle pill
            so the chrome doesn't yell; error gets the inline reload button. */}
        {loading && !err && (
          <span className="ml-auto inline-flex items-center gap-1 text-fuchsia">
            <span className="pulse-dot inline-block h-1 w-1 rounded-full bg-fuchsia" />
            loading…
          </span>
        )}
        {err && (
          <span className="ml-auto inline-flex items-center gap-2 truncate text-[#DC2626]">
            <span className="truncate">{err}</span>
            <button
              type="button"
              onClick={() => void reload()}
              className="shrink-0 rounded-full border border-[#DC2626]/40 px-2 py-0.5 text-[#DC2626] transition-colors hover:bg-[#DC2626]/10"
            >
              Reload
            </button>
          </span>
        )}
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
  title,
  onOpen,
}: {
  label: string;
  url: string;
  title?: string;
  onOpen: (url: string) => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onOpen(url)}
      title={title ?? label}
      className="rounded-full border border-line px-2 py-0.5 text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia"
    >
      {label}
    </button>
  );
}
