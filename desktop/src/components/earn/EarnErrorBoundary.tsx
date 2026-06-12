// v0.7.56 P0 — Earn surface error boundary.
//
// Wraps EarnPanelMount so a React render exception (bad message shape from
// the embed, hydration mismatch, a thrown effect cleanup) never leaves the
// Earn tab as a pure black screen — the native child webview floats above
// this container, so if the React tree crashes the page below is bare
// (which the WKWebView would paint black on top of). When this boundary
// catches an error, it explicitly hides — by virtue of the parent React
// state still rendering — the recovery card with the same 4 CTAs the
// EarnPanelMount uses for its own timeout fallback.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { humanError } from "../../lib/sidecar";

const EMBED_BROWSER_FALLBACK_URL = "https://account.liquidclips.app/earn";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class EarnErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[earn] render exception", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleOpenInBrowser = () => {
    void openExternal(EMBED_BROWSER_FALLBACK_URL).catch((e) => {
      console.error("[earn] open-in-browser failed:", e);
    });
  };

  private handleCopyDiagnostics = () => {
    const e = this.state.error;
    const diagnostics = {
      surface: "earn",
      kind: "render-exception",
      app_version: "0.7.56",
      message: e?.message ?? null,
      stack: e?.stack ?? null,
      now_ts: Date.now(),
    };
    const text = JSON.stringify(diagnostics, null, 2);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
    }
    window.dispatchEvent(
      new CustomEvent("lc:toast", {
        detail: { kind: "info", message: "Earn diagnostics copied." },
      }),
    );
  };

  private handleReloadApp = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="relative h-full w-full" role="alert">
        <div className="absolute inset-0 grid place-items-center bg-paper px-6">
          <div className="max-w-[420px] rounded-2xl border border-ink/10 bg-paper-elev p-6 text-center shadow-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
              Earn hit a snag
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-text-primary">
              Rewards did not load. You can retry or open the rewards page in
              your browser.
            </p>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-text-tertiary">
              {humanError(this.state.error)}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="rounded-full bg-fuchsia px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:opacity-90"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={this.handleOpenInBrowser}
                className="rounded-full border border-ink/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-primary hover:bg-ink/5"
              >
                Open in browser
              </button>
              <button
                type="button"
                onClick={this.handleCopyDiagnostics}
                className="rounded-full border border-ink/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary hover:bg-ink/5"
              >
                Copy diagnostics
              </button>
              <button
                type="button"
                onClick={this.handleReloadApp}
                className="rounded-full border border-ink/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary hover:bg-ink/5"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
