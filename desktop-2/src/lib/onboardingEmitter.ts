/**
 * Onboarding milestone emitter · Sprint G.2 (2026-07-02).
 *
 * The single source of `onboarding:milestone` bus events. Route handlers
 * NEVER call `bus.emit("onboarding:milestone", …)` directly — instead,
 * they stamp a timestamp on `User.onboarding_status` via the backend
 * `mark_milestone` helper. On the next `/sync` response, this emitter
 * diffs the fresh snapshot against a persisted `seen.v1` snapshot in
 * localStorage and fires an event for every null → timestamp transition.
 *
 * Discipline (enforced by `scripts/lint_kade_decoupling.sh`):
 *   · Only this file may `bus.emit("onboarding:milestone", …)`
 *   · Only this file may write to the `lc.onboarding.seen.v1` key
 *   · Routes / components observing milestones use `useEvent(...)`
 *
 * Pose-spam prevention:
 *   · Fresh install with existing DB milestones (backfill) → on the
 *     very first observation, EVERY server-side timestamp is written
 *     to `seen.v1` WITHOUT firing events. Kade does not celebrate
 *     yesterday's milestones.
 *   · Only null → timestamp transitions during a live session fire.
 *   · Local persistence guards against re-fire on app relaunch even
 *     when JWT rotates + a fresh `/sync` response arrives.
 */
import {
  ALL_ONBOARDING_MILESTONES,
  bus,
  type OnboardingMilestone,
} from "../design-os/bridge/events";

const STORAGE_KEY = "lc.onboarding.seen.v1";

/** Shape mirrors the backend `/sync.onboarding_status` field. Every
 *  canonical milestone key is present; unstamped keys are `null`. */
export type OnboardingSnapshot = Partial<Record<OnboardingMilestone, string | null>>;

interface SeenRecord {
  /** Milestone → timestamp string at first-observation time. Never
   *  overwritten once written. */
  seen: Record<string, string>;
  /** `1` after the initial backfill wipe (see below) has run. Guarantees
   *  a fresh install with pre-existing server milestones does not spam
   *  Kade with poses for events the user already lived through. */
  backfilled: 1 | 0;
}

function canUseStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function readSeen(): SeenRecord {
  if (!canUseStorage()) return { seen: {}, backfilled: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { seen: {}, backfilled: 0 };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { seen: {}, backfilled: 0 };
    const rec = parsed as Partial<SeenRecord>;
    return {
      seen: (rec.seen && typeof rec.seen === "object") ? { ...rec.seen } as Record<string, string> : {},
      backfilled: rec.backfilled === 1 ? 1 : 0,
    };
  } catch {
    return { seen: {}, backfilled: 0 };
  }
}

function writeSeen(rec: SeenRecord): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    /* private mode / quota — degrade silently */
  }
}

/**
 * Consume a fresh `/sync.onboarding_status` snapshot. Fires
 * `onboarding:milestone` for each milestone whose value transitioned
 * from null (or absent) → a real timestamp since the last observation.
 *
 * Returns the list of milestones that fired this call — useful for
 * tests and for callers that want to react without subscribing to the
 * bus (e.g., PostHog capture).
 *
 * Idempotent within a session: calling with the same snapshot twice
 * fires nothing on the second call.
 */
export function consumeSyncSnapshot(snapshot: OnboardingSnapshot | null | undefined): OnboardingMilestone[] {
  if (!snapshot || typeof snapshot !== "object") return [];

  const record = readSeen();
  const nextSeen: Record<string, string> = { ...record.seen };
  let seenMutated = false;
  const fired: OnboardingMilestone[] = [];

  // Backfill pass: on the very first observation, snapshot every
  // server-persisted timestamp into `seen.v1` WITHOUT firing an event.
  // Kade does not celebrate history — only live transitions.
  if (record.backfilled === 0) {
    for (const key of ALL_ONBOARDING_MILESTONES) {
      const ts = snapshot[key];
      if (typeof ts === "string" && ts.length > 0) {
        nextSeen[key] = ts;
        seenMutated = true;
      }
    }
    writeSeen({ seen: nextSeen, backfilled: 1 });
    return [];
  }

  // Steady state: fire an event for every `null → timestamp` transition
  // that this emitter hasn't observed before.
  for (const key of ALL_ONBOARDING_MILESTONES) {
    const ts = snapshot[key];
    if (typeof ts !== "string" || ts.length === 0) continue;
    if (nextSeen[key]) continue; // already fired in a prior session
    nextSeen[key] = ts;
    seenMutated = true;
    fired.push(key);
    bus.emit("onboarding:milestone", { milestone: key, at: ts });
  }

  if (seenMutated) {
    writeSeen({ seen: nextSeen, backfilled: 1 });
  }
  return fired;
}

/** Test seam · resets the emitter's local memory so a suite can simulate
 *  a fresh install / re-hydration cycle. Never call from production code. */
export function __resetOnboardingEmitterForTests(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
