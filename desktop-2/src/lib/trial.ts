/**
 * Trial state client · v2.2.15
 *
 * Reads trial-relevant fields from /sync (remaining_exports +
 * trial_days_remaining + trial_convert_pending) and posts the
 * "Approve upgrade now" click to /me/trial/approve.
 *
 * Single hook shape: `useTrial()` returns the snapshot the TopHud pill,
 * the UpgradeApprovalModal, and the FirstLaunchTrialCard all read from.
 * All three surfaces stay coherent because they consume the same source.
 */
import { useCallback, useEffect, useState } from "react";
import { getJwt } from "./authStorage";
import { useEvent } from "../design-os/bridge";

export type TrialState = "trial" | "trialing" | "active" | "canceled" | "expired" | "refunded" | "unknown";

export interface TrialSnapshot {
  status: TrialState;
  clipsRemaining: number | null;
  daysRemaining: number | null;
  approvePending: boolean;
  isTrialing: boolean;
  isPaidActive: boolean;
}

const EMPTY: TrialSnapshot = {
  status: "unknown",
  clipsRemaining: null,
  daysRemaining: null,
  approvePending: false,
  isTrialing: false,
  isPaidActive: false,
};

function backendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

interface SyncSnapshot {
  tier?: string;
  subscription_status?: string;
  remaining_exports?: number | null;
  trial_days_remaining?: number | null;
  trial_convert_pending?: boolean;
}

async function fetchSync(): Promise<SyncSnapshot | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    const r = await fetch(`${backendUrl()}/sync`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as SyncSnapshot;
  } catch { return null; }
}

function toSnapshot(sync: SyncSnapshot | null): TrialSnapshot {
  if (!sync) return EMPTY;
  const status = (sync.subscription_status ?? "unknown") as TrialState;
  const isTrialing = status === "trial" || status === "trialing";
  const isPaidActive = status === "active" && (sync.tier ?? "free") !== "free";
  return {
    status,
    clipsRemaining: sync.remaining_exports ?? null,
    daysRemaining: sync.trial_days_remaining ?? null,
    approvePending: !!sync.trial_convert_pending,
    isTrialing,
    isPaidActive,
  };
}

const POLL_MS = 30_000;

export function useTrial(): {
  trial: TrialSnapshot;
  refresh: () => Promise<void>;
} {
  const [trial, setTrial] = useState<TrialSnapshot>(EMPTY);

  const refresh = useCallback(async () => {
    const sync = await fetchSync();
    setTrial(toSnapshot(sync));
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEvent("activation:complete", () => { void refresh(); });

  return { trial, refresh };
}

export interface ApproveTrialResult {
  state: "already_paid" | "not_trialing" | "approved" | "unavailable" | "network";
  detail: string;
}

export async function approveTrialConversion(): Promise<ApproveTrialResult> {
  const jwt = getJwt();
  if (!jwt) return { state: "network", detail: "Sign in required." };
  try {
    const r = await fetch(`${backendUrl()}/me/trial/approve`, {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      },
    });
    if (!r.ok) {
      return { state: "network", detail: `Approve failed · ${r.status}` };
    }
    const data = (await r.json()) as { state: ApproveTrialResult["state"]; detail: string };
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { state: "network", detail: msg };
  }
}
