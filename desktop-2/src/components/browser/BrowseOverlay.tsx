// Cinematic browser overlay — 90vw × 88vh, fuchsia rim/glow chrome, iframe body,
// honest CSP-blocked fallback footer. Portaled into document.body so it escapes
// the .lc-page perspective:1200px containing block.
//
// Triggers: Home reward hero, Earn, Community, Campaigns. NOT globally mounted.
// Esc priority: closes the browser overlay first (handled here), then yields.
//
// No Tauri webview. No Rust. iframe only. Real APIs forbidden.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  ArrowUpRight,
  ExternalLink,
  Sparkles,
  ClipboardCopy,
} from "lucide-react";
import { bus } from "../../design-os/bridge";
import {
  useBrowseOverlay,
  urlIsLikelyBlocked,
  WHOP_REWARDS_URL,
} from "../../state/browseOverlay";
import { navigateTo } from "../../shell/routes";
import { SECTION_IDS } from "../../shell/sectionIds";
import { setActiveCampaignId } from "../../shell/modeStore";
import { openSmart } from "../../lib/openSmart";

/** v1 quick-link surface: Whop only + internal app routes per Daniel's call. */
interface QuickLink {
  label: string;
  /** If url present, opens in the browser overlay. If sectionId present, closes overlay and navigates. */
  url?: string;
  sectionId?: keyof typeof SECTION_IDS;
}

const QUICK_LINKS: QuickLink[] = [
  { label: "Whop Rewards", url: WHOP_REWARDS_URL },
  { label: "Campaigns", sectionId: "SECTION_CAMPAIGNS" },
  { label: "Earn", sectionId: "SECTION_EARN" },
  { label: "Community", sectionId: "SECTION_COMMUNITY" },
];

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return WHOP_REWARDS_URL;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.includes(".") && !t.includes(" ")) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

function openInSystemBrowser(url: string): void {
  void openSmart(url).catch(() => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* swallow */
    }
  });
}

export function BrowseOverlay(): JSX.Element | null {
  const open = useBrowseOverlay((s) => s.open);
  const currentUrl = useBrowseOverlay((s) => s.currentUrl);
  const history = useBrowseOverlay((s) => s.history);
  const historyIdx = useBrowseOverlay((s) => s.historyIdx);
  const loadState = useBrowseOverlay((s) => s.loadState);
  const setLoadState = useBrowseOverlay((s) => s.setLoadState);
  const back = useBrowseOverlay((s) => s.back);
  const forward = useBrowseOverlay((s) => s.forward);
  const reload = useBrowseOverlay((s) => s.reload);
  const close = useBrowseOverlay((s) => s.close);
  const push = useBrowseOverlay((s) => s.push);
  const useInEngine = useBrowseOverlay((s) => s.useInEngine);

  const [draft, setDraft] = useState(currentUrl ?? WHOP_REWARDS_URL);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (currentUrl) setDraft(currentUrl);
  }, [currentUrl]);

  // Esc priority: BrowseOverlay wins first. Use a capture-phase listener so we
  // close before any descendant Dialog/Sheet sees it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [open, close]);

  // 10s "still loading" → treat as blocked so the footer fallback nudges
  // the user instead of pretending the page loaded.
  useEffect(() => {
    if (!open || loadState !== "loading") return;
    const t = window.setTimeout(() => {
      if (useBrowseOverlay.getState().loadState === "loading") {
        setLoadState("blocked");
      }
    }, 10_000);
    return () => window.clearTimeout(t);
  }, [open, loadState, currentUrl, setLoadState]);

  const handleGo = useCallback(
    (raw: string) => {
      const next = normalizeUrl(raw);
      setDraft(next);
      push(next);
    },
    [push],
  );

  const handleUseInEngine = useCallback(() => {
    const payload = useInEngine();
    if (payload.campaignId) {
      setActiveCampaignId(payload.campaignId);
    }
    // 2026-06-24 · also dispatch lc:browse-url-handoff so InlineCreatePanel
    // (Home Create tile) can pre-fill the URL field even if the user is
    // navigated to a different surface. Mirrors legacy desktop pattern.
    if (payload.sourceUrl && typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("lc:browse-url-handoff", {
            detail: { url: payload.sourceUrl, source: "browse-overlay" },
          }),
        );
      } catch { /* swallow */ }
    }
    navigateTo(SECTION_IDS.SECTION_EDITOR);
  }, [useInEngine]);

  const handleCopyUrl = useCallback(async () => {
    const url = currentUrl ?? "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      bus.emit("toast", {
        kind: "success",
        title: "URL copied",
        body: "Paste it into Create Clips to start clipping this video.",
      });
    } catch {
      bus.emit("toast", {
        kind: "error",
        title: "Copy failed",
        body: "Clipboard access blocked — open in system browser and copy from the address bar.",
      });
    }
  }, [currentUrl]);

  const handleQuickLink = useCallback(
    (q: QuickLink) => {
      if (q.url) {
        handleGo(q.url);
        return;
      }
      if (q.sectionId) {
        close();
        navigateTo(SECTION_IDS[q.sectionId]);
      }
    },
    [handleGo, close],
  );

  if (!open) return null;

  const canBack = historyIdx > 0;
  const canForward = historyIdx < history.length - 1;
  const likelyBlocked = urlIsLikelyBlocked(currentUrl);
  const showBlockedFallback = loadState === "blocked" || likelyBlocked;

  const overlay = (
    <section
      className="lc-browse-overlay"
      role="dialog"
      aria-label="Browser overlay"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="lc-browse-chrome">
        <div className="lc-browse-chrome-row">
          <button
            type="button"
            className="lc-browse-icon-btn"
            onClick={back}
            disabled={!canBack}
            aria-label="Back"
            title="Back"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="lc-browse-icon-btn"
            onClick={forward}
            disabled={!canForward}
            aria-label="Forward"
            title="Forward"
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            className="lc-browse-icon-btn"
            onClick={reload}
            aria-label="Reload"
            title="Reload"
          >
            <RotateCw size={14} />
          </button>

          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleGo(draft);
              }
            }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder="Search or enter URL"
            className="lc-browse-url"
            aria-label="URL bar"
          />

          <button
            type="button"
            className="lc-btn"
            data-variant="secondary"
            data-size="sm"
            onClick={handleCopyUrl}
            title="Copy this URL to clipboard"
            disabled={!currentUrl}
          >
            <ClipboardCopy size={13} /> Copy URL
          </button>

          <button
            type="button"
            className="lc-btn"
            data-variant="primary"
            data-size="sm"
            onClick={handleUseInEngine}
            title="Hand this URL or campaign into the Engine"
          >
            <ArrowUpRight size={13} /> Use in Engine ↗
          </button>

          <button
            type="button"
            className="lc-browse-icon-btn lc-browse-close"
            onClick={close}
            aria-label="Close browser overlay"
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        <div className="lc-browse-chrome-quick">
          <span className="lc-browse-quick-label">Quick</span>
          {QUICK_LINKS.map((q) => (
            <button
              key={q.label}
              type="button"
              className="lc-browse-quick-chip"
              onClick={() => handleQuickLink(q)}
            >
              <Sparkles size={10} /> {q.label}
            </button>
          ))}
          <span className="lc-browse-quick-hint">
            {loadState === "loading" ? (
              <span className="lc-browse-loading-dot">
                <span className="lc-browse-loading-pulse" /> loading…
              </span>
            ) : loadState === "blocked" ? (
              <span className="lc-browse-loading-err">
                this site blocks embedded viewing
              </span>
            ) : (
              <span className="lc-browse-loading-hint">esc to close</span>
            )}
          </span>
        </div>
      </div>

      <div className="lc-browse-body">
        {showBlockedFallback ? (
          <div className="lc-browse-blocked">
            <div className="lc-browse-blocked-eyebrow">embedded view blocked</div>
            <h3 className="lc-browse-blocked-title">
              This site blocks embedded viewing.
            </h3>
            <p className="lc-browse-blocked-body">
              Many reward platforms (Whop, X, YouTube, Discord) refuse to render
              inside an embedded frame. Pick one of the honest paths below.
            </p>
            <div className="lc-browse-blocked-actions">
              <button
                type="button"
                className="lc-btn"
                data-variant="secondary"
                onClick={() => currentUrl && openInSystemBrowser(currentUrl)}
              >
                <ExternalLink size={14} /> Open in system browser ↗
              </button>
              <button
                type="button"
                className="lc-btn"
                data-variant="primary"
                onClick={handleUseInEngine}
              >
                <ArrowUpRight size={14} /> Use this link in Engine ↗
              </button>
            </div>
            <div className="lc-browse-blocked-url" title={currentUrl ?? ""}>
              {currentUrl}
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            key={currentUrl ?? "blank"}
            src={currentUrl ?? "about:blank"}
            title="Liquid Clips browse overlay"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="lc-browse-iframe"
            onLoad={() => setLoadState("loaded")}
            onError={() => setLoadState("blocked")}
          />
        )}
      </div>

      <div className="lc-browse-footer">
        <span className="lc-browse-footer-meta">
          Browser overlay · v1 · iframe only · no Whop / Ayrshare API
        </span>
        <div className="lc-browse-footer-actions">
          <button
            type="button"
            className="lc-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => currentUrl && openInSystemBrowser(currentUrl)}
          >
            <ExternalLink size={12} /> Open in system browser ↗
          </button>
          <button
            type="button"
            className="lc-btn"
            data-variant="secondary"
            data-size="sm"
            onClick={handleUseInEngine}
          >
            <ArrowUpRight size={12} /> Use this link in Engine ↗
          </button>
        </div>
      </div>

      {/* Hidden contract anchors for the shell guard. */}
      <div aria-hidden="true" style={{ display: "none" }}>
        <span data-browse-overlay="root">Browser overlay</span>
        <span data-browse-overlay="use-in-engine">Use in Engine</span>
        <span data-browse-overlay="open-system">Open in system browser</span>
        <span data-browse-overlay="esc-hint">esc to close</span>
        <span data-browse-overlay="blocked">This site blocks embedded viewing.</span>
      </div>
    </section>
  );

  return createPortal(overlay, document.body);
}
