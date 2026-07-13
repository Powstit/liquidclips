/**
 * Thumbnail quota client · v2.2.17
 *
 * Reads /me/thumbnail-quota and calls /me/thumbnail-quota/spend before
 * every batch. When the server returns 402 the caller opens the
 * BoostPackModal so a $9 one-click purchase tops the user back up.
 */
import { useCallback, useEffect, useState } from "react";
import { getJwt } from "./authStorage";
import { authedFetch } from "./authedFetch";
import { useEvent } from "../design-os/bridge";

export interface ThumbnailQuota {
  tier: string;
  monthly_included: number | null;
  used_this_period: number;
  boost_credit: number;
  remaining_total: number | null;
  can_generate: boolean;
  over_cap: boolean;
  boost_pack_url: string;
  boost_pack_batches: number;
}

const EMPTY: ThumbnailQuota = {
  tier: "free",
  monthly_included: 0,
  used_this_period: 0,
  boost_credit: 0,
  remaining_total: 0,
  can_generate: false,
  over_cap: true,
  boost_pack_url: "https://whop.com/checkout/plan_xLS3gGsJ16455",
  boost_pack_batches: 25,
};

function backendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

export async function fetchThumbnailQuota(): Promise<ThumbnailQuota | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    // L1 · 2026-07-11 · routed through authedFetch so a stale JWT
    // (401) triggers the global expired-session UX instead of the
    // silent `null` that previously left the strip stuck on "0 left".
    const r = await authedFetch(`${backendUrl()}/me/thumbnail-quota`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as ThumbnailQuota;
  } catch { return null; }
}

export interface SpendResult {
  ok: boolean;
  over_cap: boolean;
  boost_pack_url?: string;
  message?: string;
  quota?: ThumbnailQuota;
}

export async function spendBatch(): Promise<SpendResult> {
  const jwt = getJwt();
  if (!jwt) return { ok: false, over_cap: false, message: "Sign in required." };
  try {
    // L1 · 2026-07-11 · authedFetch so 401 during a spend attempt
    // routes through the global expired-session UX and doesn't
    // surface a raw HTTP error to the batch caller.
    const r = await authedFetch(`${backendUrl()}/me/thumbnail-quota/spend`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
      },
    });
    if (r.status === 402) {
      const body = await r.json().catch(() => ({}));
      const detail = body?.detail ?? {};
      return {
        ok: false,
        over_cap: true,
        boost_pack_url: detail.boost_pack_url ?? EMPTY.boost_pack_url,
        message: detail.message ?? "Monthly cap reached.",
      };
    }
    if (!r.ok) return { ok: false, over_cap: false, message: `spend failed · ${r.status}` };
    return { ok: true, over_cap: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, over_cap: false, message: msg };
  }
}

const POLL_MS = 30_000;

export function useThumbnailQuota(): {
  quota: ThumbnailQuota;
  refresh: () => Promise<void>;
} {
  const [quota, setQuota] = useState<ThumbnailQuota>(EMPTY);
  const refresh = useCallback(async () => {
    const next = await fetchThumbnailQuota();
    if (next) setQuota(next);
  }, []);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEvent("activation:complete", () => { void refresh(); });
  return { quota, refresh };
}
