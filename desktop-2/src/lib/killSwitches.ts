/**
 * Kill switches · client mirror · v2.3.70
 *
 * Reads the `kill_switches` field from /sync and exposes it via a small
 * hook the app consumes. Mirrors the announcements.ts pattern —
 * one GET, no polling timer, refresh on `activation:complete` so a
 * fresh login lands the latest flag state without waiting for the
 * next session.
 *
 * Default-empty semantics are load-bearing: when /sync doesn't
 * include the field (legacy backend, no JWT yet, mocked /sync in
 * visual tests) the hook returns `{}`. Every consumer defaults to
 * "feature is available" when the flag is absent or false — never
 * assume killed on missing data. The server-side gate at each
 * handler enforces the real truth; this client mirror is UX only.
 *
 * Fires:
 *   - useKillSwitches() → live map + refresh fn
 *   - useKillSwitch("clip_submissions") → boolean, true when killed
 *   - isKilled("publishing", snapshot) → static-check helper
 *
 * Known flag names (mirror of app/kill_switches.py KILL_SWITCH_FLAGS):
 *   clip_submissions · clip_generation · publishing · wallet_withdrawal
 *   · ai_transcribe · ai_llm · community_chat · whop_redirect
 */
import { useEffect, useState } from "react";

import { getJwt } from "./authStorage";
import { authedFetch } from "./authedFetch";
import { useEvent } from "../design-os/bridge";

/** Union of the flag names the backend registers. Adding a new one
 *  here without a backend counterpart is safe — the value just stays
 *  `false` because /sync never returns it. Kept as a string union so
 *  TypeScript catches typos at call sites (`useKillSwitch("clipsub")`
 *  is a compile error). */
export type KillSwitchFlag =
  | "clip_submissions"
  | "clip_generation"
  | "publishing"
  | "wallet_withdrawal"
  | "ai_transcribe"
  | "ai_llm"
  | "community_chat"
  | "whop_redirect";

export type KillSwitchesSnapshot = Partial<Record<KillSwitchFlag, boolean>>;

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

/** Static helper for consumers that already have a snapshot in scope
 *  (e.g. mode store, telemetry event). Never throws — a malformed
 *  snapshot returns `false` (feature available) for the flag. */
export function isKilled(flag: KillSwitchFlag, snapshot: KillSwitchesSnapshot | null | undefined): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  return snapshot[flag] === true;
}

function normaliseSnapshot(raw: unknown): KillSwitchesSnapshot {
  if (!raw || typeof raw !== "object") return {};
  const out: KillSwitchesSnapshot = {};
  const r = raw as Record<string, unknown>;
  const known: readonly KillSwitchFlag[] = [
    "clip_submissions",
    "clip_generation",
    "publishing",
    "wallet_withdrawal",
    "ai_transcribe",
    "ai_llm",
    "community_chat",
    "whop_redirect",
  ];
  for (const flag of known) {
    if (r[flag] === true) out[flag] = true;
  }
  return out;
}

/** 2026-08-31 · last-known snapshot, updated by every fetchKillSwitches()
 *  call regardless of caller. Exists so non-React call sites (e.g.
 *  openWhopAction.ts, which fires synchronously on click) can check
 *  kill-switch state without adding a network round-trip to every click.
 *  `whop_redirect` in particular has NO backend endpoint to gate — the
 *  action is a direct in-app-browser open, not an API call — so the
 *  "server-side gate enforces the real truth" note below doesn't apply
 *  to it; this cache is the only enforcement point that flag has. */
let lastKnownSnapshot: KillSwitchesSnapshot = {};

/** Best-effort synchronous read of the last fetched snapshot. Empty
 *  object (never killed) before the first successful fetch — same
 *  fail-open default every other consumer in this file uses. */
export function getLastKnownKillSwitches(): KillSwitchesSnapshot {
  return lastKnownSnapshot;
}

/** Fetch the current kill-switch snapshot. Empty object when unauthed,
 *  when /sync omits the field, or on any error — never throws. */
export async function fetchKillSwitches(): Promise<KillSwitchesSnapshot> {
  const jwt = getJwt();
  if (!jwt) return {};
  try {
    const r = await authedFetch(`${lcBackendUrl()}/sync`, {
      cache: "no-store",
    });
    if (!r.ok) return {};
    const data: unknown = await r.json();
    if (!data || typeof data !== "object") return {};
    const raw = (data as Record<string, unknown>).kill_switches;
    const snapshot = normaliseSnapshot(raw);
    lastKnownSnapshot = snapshot;
    return snapshot;
  } catch {
    return {};
  }
}

/** Mount-once hook. Refreshes on `activation:complete`. No polling —
 *  kill switches are incident-response levers, not real-time state.
 *  Consumers who need faster refresh call `refresh()` explicitly. */
export function useKillSwitches(): {
  snapshot: KillSwitchesSnapshot;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<KillSwitchesSnapshot>({});

  useEffect(() => {
    let alive = true;
    fetchKillSwitches()
      .then((s) => {
        if (alive) setSnapshot(s);
      })
      .catch(() => {
        /* swallow · hook is best-effort */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEvent("activation:complete", () => {
    fetchKillSwitches()
      .then(setSnapshot)
      .catch(() => {
        /* swallow */
      });
  });

  const refresh = (): void => {
    fetchKillSwitches()
      .then(setSnapshot)
      .catch(() => {
        /* swallow */
      });
  };

  return { snapshot, refresh };
}

/** Convenience hook · returns `true` when the given flag is killed.
 *  Component-level shortcut for the common case of gating a single
 *  button or surface. Re-computes on any snapshot change. */
export function useKillSwitch(flag: KillSwitchFlag): boolean {
  const { snapshot } = useKillSwitches();
  return isKilled(flag, snapshot);
}
