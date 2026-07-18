/**
 * kadeSilence · Composer Sprint 3 E5 · progressive silence rule.
 *
 * ⚠ IRON GATE IG-COMPOSER-Q · Silence rule contract.
 *
 * Kade talks a lot at the start of a session so the user learns the
 * cadence. After N successful flows in the same session, dialogue
 * frequency drops to a fraction so Kade doesn't wear the user out.
 *
 * Contract:
 *   - Before SILENCE_THRESHOLD flows, shouldEmit() ALWAYS returns true.
 *   - At or past the threshold, shouldEmit() returns true with
 *     probability SILENCE_RATE (default 1-in-3).
 *   - useSilenceCounter is the React hook Composer wires in.
 *   - shouldEmitFor(count, roll) is the deterministic core used by
 *     tests + the hook, so a test can pin the random roll and assert
 *     the emit decision.
 */

import { useCallback, useState } from "react";

/** After this many successful flows, dialogue emission drops to
 *  SILENCE_RATE. Locked at 5 per master plan §5 row E5. */
export const SILENCE_THRESHOLD = 5;

/** Fraction of the time dialogue lines still emit once the threshold
 *  is passed. 1-in-3 per master plan. */
export const SILENCE_RATE = 1 / 3;

/**
 * Pure decision function. Given the running success count and a random
 * roll in [0, 1), decide whether to emit the dialogue line. Extracted
 * so tests can pin the roll to a fixed number and assert the outcome.
 */
export function shouldEmitFor(count: number, roll: number): boolean {
  if (count < SILENCE_THRESHOLD) return true;
  return roll < SILENCE_RATE;
}

export interface UseSilenceCounter {
  count: number;
  increment: () => void;
  reset: () => void;
  shouldEmit: () => boolean;
}

/**
 * React hook · owns the per-session success counter. Composer calls
 * `increment()` on every successful flow and `shouldEmit()` right
 * before dispatching a kade:speak / pickLine() call.
 */
export function useSilenceCounter(): UseSilenceCounter {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount((n) => n + 1), []);
  const reset = useCallback(() => setCount(0), []);
  const shouldEmit = useCallback(() => shouldEmitFor(count, Math.random()), [count]);
  return { count, increment, reset, shouldEmit };
}
