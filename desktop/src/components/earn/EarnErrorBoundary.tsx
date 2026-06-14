// v0.7.56 P0 — Earn surface error boundary.
//
// Catches React render exceptions inside the Earn deck and surfaces a
// recoverable error card instead of a blank or crashed surface. The recovery
// card gives the customer four clear actions: Retry, open the rewards page in
// a browser, copy diagnostics, or reload the app. This boundary preserves the
// native Earn shell feel even when an unexpected render failure occurs.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { humanError } from "../../lib/sidecar";

// Live fallback for the retired /earn route: /embed/earn is reachable while
// native Earn is the primary surface.
const EMBED_BROWSER_FALLBACK_URL = "https://account.liquidclips.app/embed/earn";

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
                className="btn-primary"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={this.handleOpenInBrowser}
                className="btn-secondary"
              >
                Open in browser
              </button>
              <button
                type="button"
                onClick={this.handleCopyDiagnostics}
                className="btn-ghost"
              >
                Copy diagnostics
              </button>
              <button
                type="button"
                onClick={this.handleReloadApp}
                className="btn-danger"
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
