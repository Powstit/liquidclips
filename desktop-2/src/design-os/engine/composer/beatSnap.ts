/**
 * beatSnap · Composer F3 · beat-lock helper.
 *
 * ⚠ IRON GATE IG-COMPOSER-BB · Beat snap contract.
 *
 * Given a target timestamp + a sorted array of beat times, return the
 * nearest beat within a window. Consumed by the Reactions Deep panel
 * (snap-to-beat toggle) so a user's reaction lands on the downbeat
 * instead of a fractional second off.
 *
 * The beat array comes from wavesurfer.js beat detection when F2 lands.
 * Until then, callers can synthesise beats from a known BPM via
 * generateBeatsForBpm() so F3 is exercisable without F2.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class F row F3.
 */

/** Nearest-beat search window in seconds. Beats outside this window
 *  do not snap so a user who lands well between beats gets to keep
 *  their fractional-second precision. */
export const BEAT_SNAP_WINDOW_S = 0.35;

/**
 * Return the nearest beat time in `beats` to `target`, or null if the
 * closest beat is outside BEAT_SNAP_WINDOW_S. Uses binary search so
 * the helper stays cheap on long tracks with thousands of beats.
 */
export function nearestBeat(target: number, beats: readonly number[]): number | null {
  if (beats.length === 0) return null;
  if (!Number.isFinite(target)) return null;

  // Binary search for the insertion point.
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  // Compare against the neighbours on either side of the insertion index.
  const candidates: number[] = [];
  if (lo > 0) candidates.push(beats[lo - 1]);
  if (lo < beats.length) candidates.push(beats[lo]);

  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of candidates) {
    const d = Math.abs(b - target);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  if (best === null) return null;
  if (bestDist > BEAT_SNAP_WINDOW_S) return null;
  return best;
}

/**
 * Generate synthetic beat times from a known BPM up to `durationS`.
 * Useful when F2 waveform / beat detection isn't wired yet · lets the
 * F3 toggle be exercised in the app against a known-good click track.
 */
export function generateBeatsForBpm(bpm: number, durationS: number): number[] {
  if (bpm <= 0 || durationS <= 0) return [];
  const period = 60 / bpm;
  const out: number[] = [];
  for (let t = 0; t <= durationS; t += period) {
    out.push(Number(t.toFixed(3)));
  }
  return out;
}

/**
 * Apply the snap. Returns the snapped timestamp or the original
 * `target` when snapping is disabled or no beat is close enough.
 */
export function snapToBeat(
  target: number,
  beats: readonly number[],
  enabled: boolean,
): number {
  if (!enabled) return target;
  const beat = nearestBeat(target, beats);
  return beat ?? target;
}
