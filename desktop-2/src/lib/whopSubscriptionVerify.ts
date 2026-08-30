/**
 * whopSubscriptionVerify · webhook-drop resilience polling.
 *
 * When an agency completes checkout on Whop, Whop fires a
 * `payment.success` webhook to our backend. Our webhook handler flips
 * the User row from free → paid and the desktop's next /sync sees
 * the tier bump. In the happy path this whole loop takes ~6 seconds.
 *
 * In the sad path the webhook is delayed 6 minutes, or never fires
 * at all. The user has PAID on Whop's success screen but our app
 * still shows them as free — they rage, refund, screenshot. This
 * module is the belt-and-suspenders fix.
 *
 * The hook:
 *   1. On mount (paywall opens) → immediate POST /whop/verify-my-
 *      subscription. Server-side caches the answer for 15s so a burst
 *      of paywall re-mounts doesn't hammer Whop.
 *   2. Poll every 60s while the hook is mounted.
 *   3. If Whop reports the sub is now active AND our DB just synced
 *      (`changed: true`), the caller can dismiss the paywall + refresh
 *      /sync so the tier + features surface immediately.
 *
 * On unmount (paywall closed) the polling stops. If the user paid but
 * never opened the paywall again, the nightly reconciler cron catches
 * the drift within 24h — this hook is specifically for the "user is
 * staring at the paywall waiting" case.
 *
 * Manual button hook: `useWhopSubscriptionVerify` exposes a `verify()`
 * method so a "I paid, refresh now" button can force an immediate
 * check without waiting for the 60s tick.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getJwt } from "./authStorage";
import { authedFetch } from "./authedFetch";

const DEFAULT_POLL_MS = 60_000;

export interface VerifySubscriptionResult {
  verified: boolean;
  subscription_status: string | null;
  paid_until_iso: string | null;
  changed: boolean;
  reason: string | null;
  checked_at_iso: string;
}

function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

/** One-shot verify call. Safe on unauthed (returns null). Never throws. */
export async function verifyWhopSubscription(): Promise<VerifySubscriptionResult | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    const r = await authedFetch(`${lcBackendUrl()}/whop/verify-my-subscription`, {
      method: "POST",
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data: unknown = await r.json();
    if (!data || typeof data !== "object") return null;
    return data as VerifySubscriptionResult;
  } catch {
    return null;
  }
}

/**
 * Poll `/whop/verify-my-subscription` while mounted.
 *
 * Callers pass `enabled` — set true while a paywall/upgrade surface
 * is visible, false otherwise. When enabled, polls at `intervalMs`
 * (default 60s). Fires an immediate call on enable.
 *
 * `onFlippedToActive` fires the moment Whop confirms the sub is
 * newly active (i.e. our DB just synced from a webhook drop). Use
 * it to close the paywall + refresh app state.
 */
export function useWhopSubscriptionVerify(opts: {
  enabled: boolean;
  intervalMs?: number;
  onFlippedToActive?: (result: VerifySubscriptionResult) => void;
}): {
  lastResult: VerifySubscriptionResult | null;
  verify: () => Promise<VerifySubscriptionResult | null>;
} {
  const { enabled, onFlippedToActive } = opts;
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_MS;
  const [lastResult, setLastResult] = useState<VerifySubscriptionResult | null>(null);
  // Ref keeps the latest callback without re-triggering the effect on
  // every parent re-render.
  const onFlipRef = useRef(onFlippedToActive);
  onFlipRef.current = onFlippedToActive;

  const verify = useCallback(async () => {
    const r = await verifyWhopSubscription();
    if (r) {
      setLastResult(r);
      if (r.changed && (r.subscription_status === "active" || r.subscription_status === "trialing")) {
        onFlipRef.current?.(r);
      }
    }
    return r;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void verify();
    const id = window.setInterval(() => {
      if (cancelled) return;
      void verify();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, intervalMs, verify]);

  return { lastResult, verify };
}
