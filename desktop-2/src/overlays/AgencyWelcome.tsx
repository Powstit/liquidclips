/**
 * Sprint E · Agency welcome modal · first-run agency-tier greeting.
 *
 * Fires ONCE per user when all three preconditions hold:
 *   1. Client-resolved tier is "agency" (any of the 3 backend sub-tiers)
 *   2. `lc.onboarding.agency-welcome.seen.v1` localStorage key is absent
 *   3. Not currently inside a modal-hostile surface (login / splash)
 *
 * Renders three CTAs pointing at the shipped surfaces:
 *   · "Create your first campaign"   → nav to campaign-builder route
 *   · "Invite your first clipper"    → nav to settings + jump to Roster panel
 *   · "Read the deck brief"          → external link to /agencies
 *
 * Never blocks the app — user can dismiss without touching a CTA and it
 * still marks itself as seen (nag-free UX). Also gated on
 * `AGENCY_WELCOME_DISABLED` env for smoke tests and Playwright runs.
 */
import { useCallback, useEffect, useState } from "react";
import { bus } from "../design-os/bridge";
import { useTierCaps } from "../design-os/state/useTierCaps";
import { openInApp } from "../lib/openInApp";

const SEEN_KEY = "lc.onboarding.agency-welcome.seen.v1";

function hasBeenSeen(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // fail-closed so a broken localStorage never spams the modal
  }
}

function markSeen(): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SEEN_KEY, "1");
    }
  } catch {
    /* private mode / quota — no-op */
  }
}

function isDisabled(): boolean {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const env = (import.meta as any).env;
    if (env?.VITE_AGENCY_WELCOME_DISABLED === "1" || env?.VITE_AGENCY_WELCOME_DISABLED === "true") {
      return true;
    }
  } catch {
    /* noop */
  }
  return false;
}

export function AgencyWelcomeOverlay(): JSX.Element | null {
  const tier = useTierCaps();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isDisabled()) return;
    if (hasBeenSeen()) return;
    // Trusted source only — never fire on the fixture-fallback tier
    // (would surface for every Vite dev boot before /me resolves).
    if (tier.tier !== "agency") return;
    if (tier.source !== "real-http" && tier.source !== "session-cache") return;
    setOpen(true);
  }, [tier.tier, tier.source]);

  const handleDismiss = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  const handleCreateCampaign = useCallback(() => {
    markSeen();
    setOpen(false);
    bus.emit("nav:click", { route: "campaign-builder" });
  }, []);

  const handleInviteClipper = useCallback(() => {
    markSeen();
    setOpen(false);
    bus.emit("nav:click", { route: "settings" });
    // Wait for Settings to mount, then activate the actual Roster tab.
    // Scrolling alone is insufficient because inactive panels are
    // display:none under the Settings tab contract.
    window.setTimeout(() => {
      bus.emit("settings:open-tab", { tab: "roster" });
    }, 120);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="agency-welcome-title"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(5, 5, 7, 0.62)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        padding: 24,
      }}
      onClick={handleDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "var(--color-paper-elev, #14141b)",
          border: "1px solid var(--color-line, rgba(255,255,255,0.10))",
          borderRadius: 16,
          padding: "28px 28px 24px",
          boxShadow:
            "0 30px 80px -20px rgba(0,0,0,0.65), 0 0 0 1px color-mix(in srgb, var(--color-fuchsia, #FF1A8C) 22%, transparent), 0 0 48px -14px color-mix(in srgb, var(--color-fuchsia, #FF1A8C) 45%, transparent)",
          color: "var(--color-ink, #F5EFE7)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--color-fuchsia, #FF1A8C)",
            marginBottom: 12,
          }}
        >
          agency mode · unlocked
        </div>
        <h2 id="agency-welcome-title" style={{ margin: "0 0 10px", fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Your agency is live.
        </h2>
        <p style={{ margin: "0 0 22px", color: "var(--color-text-secondary, #B5AFA8)", fontSize: 14, lineHeight: 1.55 }}>
          You bypass the affiliate qualification gate · build campaigns, invite
          clippers, and run analytics rollups from day one. Three moves to make it real:
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <WelcomeAction
            eyebrow="one"
            title="Create your first campaign"
            body="Draft a brief · paste a Whop reward URL · publish when funding lands."
            cta="Open campaign builder →"
            onClick={handleCreateCampaign}
            primary
          />
          <WelcomeAction
            eyebrow="two"
            title="Invite your first clipper"
            body="Send a roster invite by email · 14-day expiry · attribution is auto-stamped."
            cta="Open roster →"
            onClick={handleInviteClipper}
          />
          <WelcomeAction
            eyebrow="three"
            title="Read the deck brief"
            body="Ladder mechanics · campaign builder · payout wiring · all one page."
            cta="Read the brief ↗"
            onClick={() => {
              markSeen();
              setOpen(false);
              void openInApp("https://liquidclips.app/agencies", {
                intent: "read-only",
              });
            }}
          />
        </div>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="lc-btn"
            data-variant="ghost"
            onClick={handleDismiss}
            style={{ fontSize: 12, opacity: 0.75 }}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

interface WelcomeActionProps {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
  primary?: boolean;
}

function WelcomeAction(p: WelcomeActionProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={p.onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--color-line, rgba(255,255,255,0.10))",
        background: p.primary
          ? "color-mix(in srgb, var(--color-fuchsia, #FF1A8C) 14%, transparent)"
          : "transparent",
        color: "inherit",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: 10,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--color-fuchsia, #FF1A8C)",
        }}
      >
        {p.eyebrow}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</span>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary, #B5AFA8)" }}>{p.body}</span>
      </span>
      <span style={{ fontSize: 12, color: "var(--color-fuchsia, #FF1A8C)", fontWeight: 600 }}>
        {p.cta}
      </span>
    </button>
  );
}
