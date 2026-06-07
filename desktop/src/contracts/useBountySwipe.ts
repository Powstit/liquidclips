// ship-lens v0.7.13 C3 — Contract hook for Kimi K-β (BountySwipe + SwipeCard).
// Kimi's K-β components consume this. Type shape is the CONTRACT.
//
// localStorage persistence in v0.7.13; backend sync moves to /whop/saved
// in v0.7.14.

import { useCallback, useEffect, useState } from "react";
import { sidecar, humanError, type WhopBounty } from "../lib/sidecar";

const SAVED_KEY = "lc:bounty-swipe:saved-ids:v1";
const SKIPPED_KEY = "lc:bounty-swipe:skipped-ids:v1";

export type UseBountySwipeResult = {
  bounties: WhopBounty[];
  savedIds: string[];
  skippedIds: string[];
  loading: boolean;
  error: string | null;
  saveBounty: (id: string) => void;
  skipBounty: (id: string) => void;
  resetSkipped: () => void;
  refresh: () => Promise<void>;
};

function readIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* localStorage full / disabled — degrade silently, in-memory queue still works */
  }
}

export function useBountySwipe(): UseBountySwipeResult {
  const [bounties, setBounties] = useState<WhopBounty[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>(() => readIds(SAVED_KEY));
  const [skippedIds, setSkippedIds] = useState<string[]>(() => readIds(SKIPPED_KEY));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await sidecar.whopListBounties(30);
      if (r.error) {
        setError(r.error);
        setBounties([]);
        return;
      }
      // Pre-filter: exclude bounties the user already saved or actively
      // skipped this session. Saved persists across launches; skipped
      // resets on `resetSkipped()` so the user can reconsider.
      const saved = new Set(readIds(SAVED_KEY));
      const skipped = new Set(readIds(SKIPPED_KEY));
      setBounties(r.bounties.filter((b) => !saved.has(b.id) && !skipped.has(b.id)));
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const saveBounty = useCallback((id: string) => {
    setSavedIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeIds(SAVED_KEY, next);
      return next;
    });
    setBounties((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const skipBounty = useCallback((id: string) => {
    setSkippedIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeIds(SKIPPED_KEY, next);
      return next;
    });
    setBounties((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const resetSkipped = useCallback(() => {
    setSkippedIds([]);
    writeIds(SKIPPED_KEY, []);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { bounties, savedIds, skippedIds, loading, error, saveBounty, skipBounty, resetSkipped, refresh };
}
