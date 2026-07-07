/**
 * useArcadeLeaderboard · live splash-screen leaderboard hook
 *
 * Batch 3E of SELF_ONBOARDING_RELEASE_MASTER.md §Step 3. Replaces the
 * MOCK_AGENCIES / MOCK_CLIPPERS / MOCK_COUNTERS arrays in
 * `overlays/invaders/mockLeaderboard.ts` with a live fetch against
 * `GET /leaderboard/arcade`.
 *
 * The endpoint is unauthenticated so the hook runs pre-JWT — the
 * splash needs numbers before the desktop has activated. If the fetch
 * fails or the DB has no arcade scorers yet, `clippers` and `agencies`
 * come back as empty arrays and the caller renders an honest empty
 * state ("First to 1000 wins Founder tier") instead of fabricated
 * winners.
 */

import { useEffect, useState } from "react";

export interface ArcadeRow {
  handle: string;
  score: number;
  /** 1-10 · client maps to `/brand/splash/avatars/avatar-XX-*.png`. */
  avatarIndex: number;
}

export interface ArcadeCounters {
  total: number;
  deltaToday: number;
}

export interface ArcadeSnapshot {
  clippers: ArcadeRow[];
  agencies: ArcadeRow[];
  counters: {
    clippers: ArcadeCounters;
    agencies: ArcadeCounters;
  };
  loading: boolean;
  error: string | null;
}

const EMPTY_COUNTERS: ArcadeCounters = { total: 0, deltaToday: 0 };
const EMPTY_SNAPSHOT: Omit<ArcadeSnapshot, "loading" | "error"> = {
  clippers: [],
  agencies: [],
  counters: { clippers: EMPTY_COUNTERS, agencies: EMPTY_COUNTERS },
};

function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

interface BackendRow {
  handle?: string;
  score?: number;
  avatar_index?: number;
}
interface BackendCounters {
  total?: number;
  delta_today?: number;
}
interface BackendResponse {
  clippers?: BackendRow[];
  agencies?: BackendRow[];
  counters?: {
    clippers?: BackendCounters;
    agencies?: BackendCounters;
  };
}

function adaptRow(r: BackendRow): ArcadeRow | null {
  if (typeof r.handle !== "string" || typeof r.score !== "number") return null;
  const avatarIndex =
    typeof r.avatar_index === "number" && r.avatar_index >= 1 && r.avatar_index <= 10
      ? r.avatar_index
      : 1;
  return { handle: r.handle, score: r.score, avatarIndex };
}

function adaptCounters(c: BackendCounters | undefined): ArcadeCounters {
  return {
    total: typeof c?.total === "number" ? c.total : 0,
    deltaToday: typeof c?.delta_today === "number" ? c.delta_today : 0,
  };
}

/**
 * Fetch the public arcade leaderboard once per mount. No polling —
 * splash is short-lived so a single fetch is enough. If the fetch
 * fails, the hook returns empty arrays + a captured `error` string
 * so the caller can render a "network still coming up" message
 * without inventing winners.
 */
export function useArcadeLeaderboard(limit: number = 5): ArcadeSnapshot {
  const [snapshot, setSnapshot] = useState<ArcadeSnapshot>({
    ...EMPTY_SNAPSHOT,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${lcBackendUrl()}/leaderboard/arcade?limit=${limit}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!cancelled) {
            setSnapshot({
              ...EMPTY_SNAPSHOT,
              loading: false,
              error: `HTTP ${res.status}`,
            });
          }
          return;
        }
        const data = (await res.json()) as BackendResponse;
        if (cancelled) return;
        const clippers = (data.clippers ?? [])
          .map(adaptRow)
          .filter((r): r is ArcadeRow => r !== null);
        const agencies = (data.agencies ?? [])
          .map(adaptRow)
          .filter((r): r is ArcadeRow => r !== null);
        setSnapshot({
          clippers,
          agencies,
          counters: {
            clippers: adaptCounters(data.counters?.clippers),
            agencies: adaptCounters(data.counters?.agencies),
          },
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setSnapshot({
          ...EMPTY_SNAPSHOT,
          loading: false,
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return snapshot;
}

const AVATAR_FILENAMES: Record<number, string> = {
  1: "avatar-01-king-kade.png",
  2: "avatar-02-cape-clipper.png",
  3: "avatar-03-visor-vibe.png",
  4: "avatar-04-cyan-soldier.png",
  5: "avatar-05-star-striker.png",
  6: "avatar-06-purple-wizard.png",
  7: "avatar-07-ninja-clipper.png",
  8: "avatar-08-rainbow-runner.png",
  9: "avatar-09-gold-medalist.png",
  10: "avatar-10-bowtie-boss.png",
};

/**
 * Map the server-issued avatar index onto a real brand-asset path.
 * Falls back to avatar-01 for any out-of-range value so an unknown
 * index never renders as a broken image.
 */
export function avatarPathFor(index: number): string {
  const filename = AVATAR_FILENAMES[index] ?? AVATAR_FILENAMES[1];
  return `/brand/splash/avatars/${filename}`;
}
