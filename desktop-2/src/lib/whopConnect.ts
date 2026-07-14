/**
 * whopConnect · shared Whop OAuth activation entry point.
 *
 * Lane B · AU-B-3 (2026-07-10). Extracted from
 * `design-os/routes/Settings.tsx:handleConnectWhop` so multiple
 * surfaces (Wallet, Settings, future carrot upsells) fire the SAME
 * flow — no drift between call sites.
 *
 * Flow:
 *   1. beginActivation() mints a challenge nonce into activation store
 *   2. openInApp(/auth/whop/start?challenge=...) hands off to OS browser
 *      (Whop blocks in-app iframe via CSP frame-ancestors)
 *   3. Backend echoes challenge through OAuth → callback →
 *      liquidclips://activate?token=...&challenge=...&source=whop
 *   4. deepLinkBoot.ts routes into activation state machine
 *   5. `activation:complete` bus event fires — caller re-fetches
 *      whichever surface it owns.
 *
 * Callers should:
 *   - Gate on `me.snapshot?.whopUserId == null` (already linked users
 *     shouldn't see the CTA)
 *   - Emit `connect_whop_clicked { source }` via lcDiag BEFORE calling
 *   - Listen for `activation:complete` to re-fetch AND emit
 *     `connect_whop_completed { source }`
 *   - Catch thrown errors and emit `connect_whop_failed { source, reason }`
 *   - Surface a customer-safe error (no raw err.message in JSX)
 *
 * No new backend endpoints. No new tokens. Same challenge/JWT wire
 * Settings already uses.
 */

import { beginActivation } from "./activation";
import { openInApp } from "./openInApp";

function lcBackendUrl(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/**
 * Fires the Whop OAuth handoff. Returns void — success/failure is
 * observed by the caller through the `activation:complete` bus event
 * or a thrown error from this promise.
 *
 * Throws when the OS browser handoff fails (openInApp rejection).
 * Callers should catch, translate to a customer-safe copy string, and
 * emit the appropriate HQ event.
 */
export async function connectWhop(): Promise<void> {
  const challenge = beginActivation();
  const url = `${lcBackendUrl()}/auth/whop/start?challenge=${encodeURIComponent(challenge)}`;
  await openInApp(url);
}
