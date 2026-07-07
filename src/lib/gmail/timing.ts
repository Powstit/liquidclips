/**
 * F6 · Layer 3 · human-timing jitter.
 *
 * Spec (non-optional):
 *   - 60-140ms per character on field fill
 *   - 6-12s between sends
 *
 * Random function is injected so tests can lock the jitter to a
 * deterministic value.
 */

export type RandomFn = () => number;   // returns [0, 1)

export function perCharDelayMs(rand: RandomFn = Math.random): number {
  const min = 60;
  const max = 140;
  return Math.floor(min + rand() * (max - min + 1));
}

export function betweenSendsDelayMs(rand: RandomFn = Math.random): number {
  const min = 6_000;
  const max = 12_000;
  return Math.floor(min + rand() * (max - min + 1));
}

/**
 * Deterministic seeded random for tests. Not cryptographically random.
 * xorshift32 seed cycle · sufficient for jitter-value bounds testing.
 */
export function seededRandom(seed: number): RandomFn {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // Map to [0, 1)
    return (state >>> 0) / 0xffffffff;
  };
}
