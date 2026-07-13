/**
 * Crew onboarding gate · Path A (marker persistence · no false repeat).
 *
 * Extracted from `WelcomeRoute.tsx` so the gate contract can be
 * exercised in isolation. Product intent (verbatim from
 * `docs/POST_RC1_EXECUTION_PLAN.md` § 4):
 *
 *   - marker persistence — a user who ran the crew flywheel never
 *     re-sees the hook, even after reload
 *   - no false repeat — dismissed / shown / completed all short-
 *     circuit the gate; only a wholly fresh user re-enters
 *
 * Source of truth · `GET /onboarding/crew` returns
 * `{shown_at, completed_at, dismissed_at}` (see junior-backend
 * `app/routers/onboarding.py`). Any populated marker suppresses the
 * gate.
 */

/** Marker envelope returned by `GET /onboarding/crew`. */
export interface CrewOnboardingMarkers {
  /** ISO-8601 when the crew route was first shown to this user. */
  shown_at: string | null;
  /** ISO-8601 when the user completed the crew flow. */
  completed_at: string | null;
  /** ISO-8601 when the user explicitly dismissed the hook. */
  dismissed_at: string | null;
}

/**
 * Returns `true` when the crew flywheel should mount as an
 * interstitial before Home. Returns `false` when the user has
 * already engaged with (or dismissed) the flywheel.
 *
 * `null` markers → gate fails safe (do not show); this covers the
 * "JWT missing / network fail" branch in the WelcomeRoute wrapper.
 */
export function shouldShowCrewOnboarding(
  markers: CrewOnboardingMarkers | null,
): boolean {
  if (!markers) return false; // Fail-safe: JWT missing or network fail → go home
  if (markers.dismissed_at) return false;
  if (markers.completed_at) return false;
  if (markers.shown_at) return false;
  return true;
}
