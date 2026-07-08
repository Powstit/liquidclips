/**
 * BootErrorBoundary · 2026-07-08 · v2.2.34 hotfix
 *
 * Absolute top-level React error boundary. Wraps EVERYTHING (including
 * ClerkProvider). If any child throws during mount — including Clerk
 * throwing on empty publishable key, or a third-party runtime crash —
 * we render a Kade-branded contact panel instead of the browser's blank
 * white-screen. That's the difference between "user is stuck with
 * nothing" and "user knows exactly how to reach us."
 *
 * Never logs the error object beyond its name+message. Never touches
 * localStorage. Never redirects. Just gives the user a real next step.
 */
import React, { Component, type ReactNode } from "react";

interface BootErrorBoundaryProps {
  children: ReactNode;
}
interface BootErrorBoundaryState {
  err: Error | null;
}

export class BootErrorBoundary extends Component<
  BootErrorBoundaryProps,
  BootErrorBoundaryState
> {
  override state: BootErrorBoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): BootErrorBoundaryState {
    return { err };
  }

  override componentDidCatch(err: Error): void {
    // Keep the log tight · no full stack · never anything that could
    // include a token / code / key.
    // eslint-disable-next-line no-console
    console.error("[boot] fatal boundary caught", err.name, "·", err.message.slice(0, 200));
  }

  private handleRetry = (): void => {
    // Full window reload · clears any bad Clerk instance in memory.
    try {
      window.location.reload();
    } catch { /* Tauri webview may block · non-fatal */ }
  };

  private handleCopyDiag = (): void => {
    const err = this.state.err;
    const diag = [
      "Liquid Clips beta · boot crash",
      `at=${new Date().toISOString()}`,
      `name=${err?.name ?? "unknown"}`,
      `msg=${(err?.message ?? "unknown").slice(0, 200)}`,
      `agent=${navigator.userAgent}`,
    ].join(" · ");
    try {
      void navigator.clipboard.writeText(diag);
    } catch { /* clipboard denied · non-fatal */ }
  };

  override render(): ReactNode {
    if (this.state.err === null) return this.props.children;
    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <img
            src="/brand/kade/kade-error.webp"
            alt=""
            aria-hidden
            style={styles.avatar}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <p style={styles.eyebrow}>Beta · boot error</p>
          <h1 style={styles.title}>Kade hit a snag.</h1>
          <p style={styles.body}>
            The app couldn&rsquo;t finish starting. This is a beta build and we&rsquo;re
            watching every crash directly. Reach us at any of the channels
            below and we&rsquo;ll get you back inside.
          </p>
          <div style={styles.actions}>
            <button type="button" style={styles.btnPrimary} onClick={this.handleRetry}>
              Try again
            </button>
            <button type="button" style={styles.btnQuiet} onClick={this.handleCopyDiag}>
              Copy diagnostics
            </button>
          </div>
          <div style={styles.contactRow}>
            <a href="mailto:support@liquidclips.app?subject=Liquid%20Clips%20beta%20boot%20crash" style={styles.link}>
              support@liquidclips.app
            </a>
            <span style={styles.sep}>·</span>
            <a
              href="https://t.me/liquidclips_support"
              target="_blank"
              rel="noreferrer noopener"
              style={styles.link}
            >
              Telegram · @liquidclips_support
            </a>
          </div>
          <p style={styles.footer}>
            {this.state.err?.name}
            {this.state.err?.message ? ` · ${this.state.err.message.slice(0, 120)}` : ""}
          </p>
        </div>
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    background: "#0b0b16",
    color: "#f4f1ea",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif",
    padding: 24,
    zIndex: 999999,
  },
  card: {
    maxWidth: 520,
    width: "100%",
    padding: 32,
    borderRadius: 20,
    background: "linear-gradient(180deg, #140612 0%, #0a0308 100%)",
    border: "1px solid rgba(255, 26, 140, 0.28)",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.55)",
    textAlign: "left" as const,
  },
  avatar: {
    display: "block",
    width: 96,
    height: 96,
    marginBottom: 12,
    filter: "drop-shadow(0 12px 32px rgba(255,26,140,0.42))",
  },
  eyebrow: {
    margin: 0,
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 11,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "#ff66b8",
  },
  title: {
    margin: "8px 0 12px",
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "#f4f1ea",
  },
  body: {
    margin: "0 0 22px",
    fontSize: 14,
    lineHeight: 1.62,
    color: "rgba(244, 241, 234, 0.75)",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 10,
    marginBottom: 20,
  },
  btnPrimary: {
    padding: "12px 22px",
    borderRadius: 12,
    border: 0,
    background: "linear-gradient(180deg, #ff1a8c, #d40d70)",
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnQuiet: {
    padding: "12px 18px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "transparent",
    color: "rgba(244,241,234,0.85)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  contactRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap" as const,
    marginBottom: 12,
  },
  link: {
    color: "#ff66b8",
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    textDecoration: "none",
  },
  sep: {
    color: "rgba(244,241,234,0.32)",
  },
  footer: {
    margin: 0,
    paddingTop: 12,
    borderTop: "1px solid rgba(255,255,255,0.06)",
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 10,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "rgba(244,241,234,0.45)",
  },
};
