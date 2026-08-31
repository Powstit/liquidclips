/**
 * WalletOnboardBanner · post-payment nudge to onboard the Whop wallet.
 *
 * Renders a slim persistent banner at the top of the app when the
 * user is PAID but has NOT yet completed the Whop sub-merchant
 * onboarding. Without a sub-merchant, ANY future earning event
 * (referral commission · premium bonus · activation carrot) has
 * nowhere to land — the payout call fails with "wallet not
 * onboarded" and the user has to hunt for the Earn tab to fix it.
 *
 * This banner deep-links straight to the onboarding flow so a paid
 * user's wallet is ready BEFORE their first earning event.
 *
 * Dismissible per-day via localStorage so a user who's mid-onboarding
 * isn't nagged on every reload — but reappears daily until onboarded
 * so an actual laggard eventually acts.
 *
 * Mount site: `AppShell.tsx` (design-os) right below AnnouncementBanner.
 * Renders null when: user isn't paid · wallet already onboarded ·
 * carrot fetch hasn't landed · user dismissed today.
 */

import { useCallback, useEffect, useState } from "react";
import { bus } from "../bridge";
import { openInApp } from "../../lib/openInApp";
import { onboardCarrot } from "../../lib/carrot";
import { useMe } from "../state/useMe";
import { useCarrot } from "../earn/useCarrot";
import { useAnnouncements } from "../../lib/announcements";

const DISMISS_KEY_PREFIX = "lc.wallet-onboard-banner.dismissed:";

function todayKey(): string {
  const d = new Date();
  return `${DISMISS_KEY_PREFIX}${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readDismissedToday(): boolean {
  try {
    return localStorage.getItem(todayKey()) === "1";
  } catch {
    return false;
  }
}

function writeDismissedToday(): void {
  try {
    localStorage.setItem(todayKey(), "1");
  } catch {
    /* quota or SSR · noop */
  }
}

export function WalletOnboardBanner(): JSX.Element | null {
  const me = useMe();
  const carrot = useCarrot();
  // 2026-08-31 audit fix. Yield to the AnnouncementBanner when a
  // system-wide announcement is showing — stacking both eats ~12% of
  // vertical viewport at 680px. Wallet onboarding is important but
  // not urgent-vs-outage; the announcement wins the top slot and
  // this banner resurfaces on the next viewport without an active
  // announcement (or the next day, whichever comes first).
  const announcements = useAnnouncements();
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissedToday());
  const [opening, setOpening] = useState(false);

  // Re-check the dismissed flag on mount so a page refresh across
  // midnight boundary resurfaces the banner.
  useEffect(() => {
    setDismissed(readDismissedToday());
  }, []);

  const handleOnboard = useCallback(async () => {
    setOpening(true);
    try {
      const res = await onboardCarrot();
      if (!("onboarding_url" in res)) {
        bus.emit("toast", {
          kind: "warning",
          title: "Couldn't open onboarding",
          body: res.error,
        });
        return;
      }
      try {
        await openInApp(res.onboarding_url);
      } catch {
        /* opener failure · toast handled elsewhere */
      }
      bus.emit("toast", {
        kind: "info",
        title: "Whop wallet onboarding opened",
        body: res.is_live
          ? "Complete the steps on Whop · we'll auto-detect when you're done."
          : "Payout setup is not live yet · this is a preview.",
      });
    } finally {
      setOpening(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    writeDismissedToday();
    setDismissed(true);
  }, []);

  // Gate the render on ALL of: dismissed today, snapshot loaded, paid,
  // wallet still not onboarded. Any missing signal → render null · we
  // don't nag until we know we should.
  if (dismissed) return null;
  const meSnap = me.snapshot;
  if (!meSnap) return null;
  const isPaid = meSnap.subscriptionStatus === "active"
    || meSnap.subscriptionStatus === "trialing";
  if (!isPaid) return null;
  if (carrot.state.source !== "live") return null;
  if (carrot.state.data.wallet?.onboarded) return null;
  // Yield to announcement banner if one is showing · avoid banner stack.
  if (announcements.items.length > 0) return null;

  return (
    <div
      role="status"
      data-testid="wallet-onboard-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 22px",
        background: "rgba(255, 78, 205, 0.08)",
        borderBottom: "1px solid rgba(255, 78, 205, 0.28)",
        color: "rgba(255, 255, 255, 0.92)",
        fontSize: 14,
        lineHeight: 1.4,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "3px 10px",
          borderRadius: 999,
          background: "rgba(255, 78, 205, 0.22)",
          color: "rgba(255, 255, 255, 0.98)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          flexShrink: 0,
        }}
      >
        Setup needed
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>Set up your payout wallet.</b> You're paid up — connect your Whop
        wallet so future earnings (referrals · premium bonuses · activation
        reward) land automatically. Takes ~2 minutes.
      </span>
      <button
        type="button"
        onClick={handleOnboard}
        disabled={opening}
        style={{
          padding: "6px 14px",
          borderRadius: 8,
          border: "1px solid rgba(255, 78, 205, 0.55)",
          background: "linear-gradient(140deg, #ff4ecd 0%, #c93aa8 100%)",
          color: "white",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.02em",
          cursor: opening ? "wait" : "pointer",
          flexShrink: 0,
          opacity: opening ? 0.7 : 1,
        }}
      >
        {opening ? "Opening…" : "Connect Whop wallet"}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss (returns tomorrow)"
        title="Dismiss (returns tomorrow)"
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          color: "rgba(255, 255, 255, 0.6)",
          fontSize: 16,
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
