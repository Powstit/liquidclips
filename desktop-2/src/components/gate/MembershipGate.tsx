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

// P1-002 fix (2026-07-17) · budget on Sync-now retries. After N restarts
// of the polling window without a tier flip, we stop restarting and show
// a hard-stop card that points at support. Prevents an infinite polling
// loop if the webhook is truly dead.
const SYNC_NOW_MAX_RESTARTS = 3;

export function MembershipGate(): ReactElement | null {
  const me = useMe();
  // P0-3 (RC1 · 2026-07-11) — was `hasJwt()` at render time. Reactive
  // hook so the gate re-evaluates on the same tick as TopHud + SideNav.
  const { hasJwt } = useAuth();
  const [ready, setReady] = useState(false);
  const [dismissedInSession, setDismissedInSession] = useState(false);
  const [postActivateAt, setPostActivateAt] = useState<number | null>(null);
  const [syncNowCount, setSyncNowCount] = useState(0);

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
      setSyncNowCount(0);
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
  // 2026-07-17 · Liquid Studio · analysis-hours billing. `planTier` is
  // the new orthogonal clipping tier vocabulary. When it's studio or
  // studio_unlimited the user is entitled to clipping · dismiss the
  // panel. Legacy `tier`/`status` checks retained so Agency-tier +
  // legacy paying users continue to short-circuit unchanged.
  const planTier = (snap.planTier || "").toLowerCase();
  const studioTierActive = planTier === "studio" || planTier === "studio_unlimited";
  const activated = studioTierActive
    || (tier && tier !== "free" && tier !== "clipper")
    || status === "active"
    || status === "trialing";
  if (activated) {
    if (postActivateAt != null) {
      // Real success · fire-and-forget cleanup.
      setPostActivateAt(null);
      setSyncNowCount(0);
      setDismissedInSession(true);
    }
    return null;
  }

  // 2026-07-17 · post-45s stuck fallback. If Whop webhook lags past
  // the poll window without a tier flip, we surface a dedicated
  // "still confirming" card with a manual Sync CTA + support email
  // so the user is never stranded on a silent "Confirming…" state.
  //
  // P1-002 fix (2026-07-17) · Sync-now restarts the polling window
  // rather than one-shot reloading. Budget capped at
  // SYNC_NOW_MAX_RESTARTS so a truly dead webhook doesn't loop.
  // /me reload failures surface via toast rather than silently
  // swallowing.
  if (postActivateAt != null) {
    const elapsed = Date.now() - postActivateAt;
    if (elapsed >= POST_ACTIVATE_POLL_MAX_MS) {
      const exhausted = syncNowCount >= SYNC_NOW_MAX_RESTARTS;
      return (
        <StuckConfirmingCard
          exhausted={exhausted}
          onSyncNow={async () => {
            try {
              await me.reload();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              bus.emit("toast", {
                kind: "warning",
                title: "Sync failed",
                body: `Couldn't reach the server (${msg}). Try again in a moment.`,
              });
              return;
            }
            // Restart the polling window (up to SYNC_NOW_MAX_RESTARTS).
            // The parent effect at line ~78 sees the new
            // postActivateAt and spawns a fresh interval.
            if (syncNowCount < SYNC_NOW_MAX_RESTARTS) {
              setSyncNowCount((n) => n + 1);
              setPostActivateAt(Date.now());
            }
          }}
          onDismiss={() => {
            setPostActivateAt(null);
            setSyncNowCount(0);
            setDismissedInSession(true);
          }}
        />
      );
    }
  }

  // B1 · 2026-07-17 · delay the pitch until AFTER the user's first
  // value moment. Free users don't see the panel until Whisper has
  // run at least once (allowanceUsedSeconds > 0) OR the free bundle
  // state has moved past `available`. Cold-invited founders drop a
  // video → see 10 clips → THEN see the upgrade pitch. Non-free
  // users skip this gate (the earlier `activated` short-circuit at
  // line ~118 already dismissed them).
  //
  // P2-003 note: planTier === "" only occurs when /me hasn't hydrated
  // yet — safe to treat as free for delay purposes since the panel
  // would be suppressed either way until we have a real snapshot.
  if (planTier === "free" || planTier === "") {
    const usedAny = snap.allowanceUsedSeconds > 0;
    const fbs = (snap.freeBundleState || "available").toLowerCase();
    const bundleTouched = fbs !== "" && fbs !== "available";
    if (!usedAny && !bundleTouched) return null;
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

/**
 * StuckConfirmingCard · surfaces after 45s of webhook silence so the
 * user is never stranded. Manual Sync CTA calls /me directly · gives
 * the user a controllable way out. Post-P1-002 (2026-07-17): Sync-now
 * restarts the polling window (capped at SYNC_NOW_MAX_RESTARTS in
 * MembershipGate). When the retry budget is exhausted the card
 * switches to a hard-stop state pointing the user at support.
 */
function StuckConfirmingCard(props: {
  exhausted: boolean;
  onSyncNow: () => void;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div
      className="lc-activate-panel"
      role="region"
      aria-label="Confirming your Founder Access payment"
      data-testid="activate-founder-stuck"
    >
      <button
        type="button"
        className="lc-activate-close"
        aria-label="Dismiss activation nudge"
        onClick={props.onDismiss}
        data-testid="activate-founder-stuck-close"
      >
        ×
      </button>
      <img
        src="/brand/kade/kade-checking.png"
        alt=""
        className="lc-activate-art lc-activate-art--processing"
        loading="eager"
        decoding="async"
      />
      <p className="lc-activate-eb">
        {props.exhausted ? "Needs a hand" : "Still confirming"}
      </p>
      <h2 className="lc-activate-title">
        {props.exhausted ? "Send us a message." : "Whop's a little slow."}
      </h2>
      <p className="lc-activate-sub">
        {props.exhausted ? (
          <>
            We tried a few times and the webhook still hasn&rsquo;t landed.
            Your payment is safe · we&rsquo;ll unlock manually. Email{" "}
            <a
              href="mailto:founder@liquidclips.app"
              style={{ color: "#ff66b8", textDecoration: "underline" }}
            >
              founder@liquidclips.app
            </a>{" "}
            with your Whop receipt.
          </>
        ) : (
          <>
            Your payment landed but the webhook is still catching up.
            Sync manually below · if it stays stuck, drop us a line at{" "}
            <a
              href="mailto:founder@liquidclips.app"
              style={{ color: "#ff66b8", textDecoration: "underline" }}
            >
              founder@liquidclips.app
            </a>
            .
          </>
        )}
      </p>
      <div className="lc-activate-actions">
        {!props.exhausted && (
          <button
            type="button"
            className="lc-activate-cta"
            onClick={props.onSyncNow}
            data-testid="activate-founder-stuck-sync"
          >
            Sync now
          </button>
        )}
        <button
          type="button"
          className="lc-activate-later"
          onClick={props.onDismiss}
          data-testid="activate-founder-stuck-later"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
