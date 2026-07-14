/**
 * MembershipGate · P0 first-run access · shell-before-Whop · 2026-07-08
 *
 * Mounts inside App.tsx alongside AppShell (post splashAcked +
 * welcomeAcked + AuthGate). Watches the user's tier/subscription
 * status via useMe · when the user is free-tier without an active
 * subscription AND has a JWT (Clerk exchange has landed OR LC-ID
 * redeem, OR Whop deep-link), it mounts the ActivateFounderPanel
 * after a short settle delay so the shell truly renders first.
 *
 * Never blocks the shell. Never full-screen-modals. Free tier stays a
 * real product surface · the panel is a nudge that dismisses to a 24h
 * cooldown.
 *
 * Ship-lens P1-G03 fix (2026-07-08) · when the Whop iframe reports
 * onComplete we DON'T assume the webhook has landed. The panel flips
 * to a "processing" chip while we poll `/me` for the tier flip · once
 * seen, the panel dismisses. Max poll window 45s · after that we bail
 * to a "still processing…" note the user can dismiss.
 *
 * Ship-lens P1-G02 fix · subscribes to `auth:signed-out` and resets
 * `dismissedInSession` so a full sign-out cycle within a single mount
 * (e.g. session ending mid-flight) doesn't leave the nudge hidden
 * against a fresh sign-in.
 */
import { useEffect, useState, type ReactElement } from "react";
import { useMe } from "../../design-os/state/useMe";
import { useAuth } from "../../lib/useAuth";
import { bus } from "../../design-os/bridge";
import {
  ActivateFounderPanel,
  isNudgeDismissed,
} from "./ActivateFounderPanel";

// Shell paints in 400-800ms warm dev / 1500-2500ms cold packaged.
// Ship-lens P2-G05 · bump from 1200 to 2500 so cold Tauri boots don't
// race the shell's first paint. This is a nudge · a later mount is
// always the safer bias.
const NUDGE_SETTLE_MS = 2500;

// Ship-lens P1-G03 · Whop webhook processing lag budget. Poll /me
// every 3s for up to 45s after onActivated fires. If tier hasn't
// flipped by then, panel stays visible with a "still processing" note
// so users don't experience a silent-success lie.
const POST_ACTIVATE_POLL_INTERVAL_MS = 3000;
const POST_ACTIVATE_POLL_MAX_MS = 45_000;

export function MembershipGate(): ReactElement | null {
  const me = useMe();
  // P0-3 (RC1 · 2026-07-11) — was `hasJwt()` at render time. Reactive
  // hook so the gate re-evaluates on the same tick as TopHud + SideNav.
  const { hasJwt } = useAuth();
  const [ready, setReady] = useState(false);
  const [dismissedInSession, setDismissedInSession] = useState(false);
  const [postActivateAt, setPostActivateAt] = useState<number | null>(null);

  // Delay the eligibility check until after shell settles. Never
  // blocks first paint.
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), NUDGE_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Ship-lens P1-G02 fix · reset dismissed-in-session on sign-out so
  // a fresh sign-in within the same mount surfaces the panel again.
  useEffect(() => {
    const off = bus.on("auth:signed-out", () => {
      setDismissedInSession(false);
      setPostActivateAt(null);
    });
    return () => {
      try { off(); } catch { /* noop */ }
    };
  }, []);

  // Ship-lens P1-G03 fix · while in post-activate polling, reload /me
  // periodically until tier flips or we hit the window ceiling.
  useEffect(() => {
    if (postActivateAt == null) return;
    const started = postActivateAt;
    const iv = window.setInterval(() => {
      const elapsed = Date.now() - started;
      if (elapsed >= POST_ACTIVATE_POLL_MAX_MS) {
        window.clearInterval(iv);
        return;
      }
      void me.reload();
    }, POST_ACTIVATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(iv);
  }, [postActivateAt, me]);

  if (!ready) return null;
  if (dismissedInSession) return null;
  if (isNudgeDismissed()) return null;

  // Must be signed in · without a JWT the sign-in surface (WelcomeGate)
  // is what should be rendering, not this panel.
  if (!hasJwt) return null;

  const snap = me.snapshot;
  if (!snap) return null;

  // Tier flipped after post-activate polling? Dismiss cleanly and
  // stop the loop.
  const tier = (snap.effectiveTier || snap.rawTier || "").toLowerCase();
  const status = (snap.subscriptionStatus || "").toLowerCase();
  const activated = (tier && tier !== "free" && tier !== "clipper") || status === "active" || status === "trialing";
  if (activated) {
    if (postActivateAt != null) {
      // Real success · fire-and-forget cleanup.
      setPostActivateAt(null);
      setDismissedInSession(true);
    }
    return null;
  }

  return (
    <ActivateFounderPanel
      email={snap.email ?? undefined}
      onActivated={() => {
        // Whop iframe reported success · DO NOT assume webhook lag.
        // Start the polling window · panel shows "processing" chip
        // until tier flips or the window closes.
        setPostActivateAt(Date.now());
      }}
      onDismiss={() => setDismissedInSession(true)}
    />
  );
}
