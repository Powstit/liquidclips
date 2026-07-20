/**
 * pendingComposerIntent · one-shot text intent buffer for Home → Composer nav
 *
 * FINISH-8/9 (2026-07-20) · Daniel wants direct-from-Home entry points for
 * screen recording + Kade tutorial mode. Both routes land on the Composer
 * and want to auto-fire the `record.capture` intent (with `source=tutorial`
 * for the tutorial variant).
 *
 * Simplest race-free wire: singleton pointer. Caller sets before navigating;
 * Composer consumes + clears on mount. If the user backs out or refreshes
 * between set and consume, the buffer clears on the next read anyway — no
 * ghost intents.
 *
 * Do NOT persist across sessions. This is a soft handoff, not user state.
 */

let pendingText: string | null = null;

/**
 * Queue an intent text for the Composer's command bar to auto-submit on
 * its next mount. Overwrites any earlier queued text (last-write-wins).
 */
export function setPendingComposerIntent(text: string | null): void {
  pendingText = text && text.trim().length > 0 ? text.trim() : null;
}

/**
 * Read + clear the queued intent. Called by Composer on mount. Returns
 * null if none is queued.
 */
export function consumePendingComposerIntent(): string | null {
  const t = pendingText;
  pendingText = null;
  return t;
}

/**
 * Test-only peek — does NOT clear.
 */
export function peekPendingComposerIntent(): string | null {
  return pendingText;
}
