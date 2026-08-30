/**
 * useCarrot · React hook over the real /me/carrot backend endpoint.
 *
 * Replaces the pure-mock `useActivationBonus` snapshot as the source
 * of truth for anything user-visible. Keeps `useActivationBonus`
 * alongside as the safe fallback so a backend outage doesn't take
 * down the Earn / Home / Campaigns surfaces.
 *
 * Fetches:
 *   - on mount
 *   - on 'activation:complete' bus event (post-signin refresh)
 *   - via `reload()` from consumers after mutating actions
 *
 * Returns a discriminated snapshot:
 *   { source: "live", data: CarrotSnapshot }
 *   { source: "loading" }
 *   { source: "error", error: string }
 *
 * Consumers pattern-match on `source` · the SponsoredReward* surfaces
 * render real numbers when source === "live" and fall back to the
 * legacy mock display otherwise.
 *
 * Zero polling · one-shot fetch + explicit reload. Carrot state does
 * NOT need to be real-time · a manual reload after claim or the
 * webhook-driven notification is enough.
 */
import { useCallback, useEffect, useState } from "react";
import { useEvent } from "../bridge";
import { getCarrot, type CarrotSnapshot } from "../../lib/carrot";

export type CarrotHookState =
  | { source: "loading" }
  | { source: "live"; data: CarrotSnapshot }
  | { source: "error"; error: string };

export interface UseCarrotReturn {
  state: CarrotHookState;
  reload: () => Promise<void>;
}

export function useCarrot(): UseCarrotReturn {
  const [state, setState] = useState<CarrotHookState>({ source: "loading" });

  const reload = useCallback(async () => {
    try {
      const snap = await getCarrot();
      if (snap === null) {
        setState({ source: "error", error: "carrot endpoint returned null" });
        return;
      }
      setState({ source: "live", data: snap });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ source: "error", error: message });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh on post-signin activation so a freshly-JWT'd user sees
  // their true state on the first Earn / Home render without waiting
  // for the next manual refresh.
  useEvent("activation:complete", () => {
    void reload();
  });

  return { state, reload };
}

/**
 * Pending-balance helper · returns the total the user is watching
 * for on the Earn / Card / Strip surfaces:
 *
 *   pending = premium-bonus-ledger cents unpaid to date
 *           + carrot activation bonus net (if state is `approved`
 *             or `pending_clearance` — money owed but not withdrawn)
 *
 * When the /me/carrot fetch hasn't landed, returns null so consumers
 * render a "checking…" placeholder instead of $0.
 */
export function computePendingBalanceUsdCents(state: CarrotHookState): number | null {
  if (state.source !== "live") return null;
  const snap = state.data;
  const ledger = snap.pending_bonus_ledger_cents ?? 0;
  // Carrot activation bonus counts as pending when Whop has approved
  // it but the transfer hasn't fired — money the user has EARNED but
  // hasn't received. Once `paid`, `lifetime_paid_usd` reflects it and
  // pending drops.
  const carrotOwed =
    snap.state === "approved" || snap.state === "pending_clearance"
      ? Math.round(snap.economics.net_to_clipper_usd * 100)
      : 0;
  return ledger + carrotOwed;
}

/** Format cents as `$X.XX` · returns em-dash for null. */
export function formatUsdCents(cents: number | null): string {
  if (cents === null) return "—";
  const dollars = cents / 100;
  if (dollars >= 100) return `$${dollars.toFixed(0)}`;
  return `$${dollars.toFixed(2)}`;
}
