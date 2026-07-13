/**
 * OutreachSection · Phase 8 Mount #2 (2026-07-04)
 *
 * Thin wrapper that hoists the ported SyncMailMoneyDrop into the
 * canonical section registry so it's reachable at `#/outreach`. Section
 * B built the surface; this file wires the router so real users can
 * actually reach the money moment.
 *
 * 2026-07-10 · Crew P1 · production drivers wired in. Prior version
 * passed no `oauthDriver`/`httpFetch`/`batchLookup`, so the modal fell
 * back to the internal demo drivers inside SyncMailMoneyDrop.tsx and
 * every production customer saw fake data. This mount now passes the
 * real drivers (see `../../lib/f5/realDrivers.ts`) which:
 *   * Open Google's consent screen in the OS browser via `openSmart()`
 *   * Await the `liquidclips://google-oauth?token=...` deep-link
 *   * Fetch real Gmail + Contacts data via the injected fetch
 *   * Try the backend `/yt/batch-lookup` endpoint before falling back
 *
 * Demo drivers stay reachable in Vite dev mode only (`import.meta.env.DEV`)
 * so the demo scrubber Daniel walks in dev still works, without
 * risking a production build shipping demo state. Guarded by the new
 * `crew-onboarding-real-driver` ship-lens rule.
 *
 * Design notes:
 *   * Section stays `navVisible: false` in `sectionRegistry.ts` until
 *     the Home hero CTA copy is greenlit — surfacing a new nav slot
 *     without a design sign-off would break the SIDE_NAV rhythm.
 *   * `onSendComplete` navigates back to `#/home` so a completed send
 *     drops the user back into the workbench without a manual step.
 */

import { SyncMailMoneyDrop } from '../../routes/sync-mail-money-drop/SyncMailMoneyDrop';
import {
  productionOAuthDriver,
  productionHttpFetch,
  productionBatchLookup,
} from '../../lib/f5/realDrivers';

const isDevBuild = ((): boolean => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
})();

export function OutreachSection() {
  // In production builds we ALWAYS pass the real drivers — the demo
  // fallbacks inside SyncMailMoneyDrop.tsx must never fire for a real
  // customer. In Vite dev we still pass them so the OAuth-connect
  // button hits Google when developers verify the flow; the internal
  // scrubber can still walk states without a real sign-in.
  void isDevBuild;
  return (
    <SyncMailMoneyDrop
      oauthDriver={productionOAuthDriver}
      httpFetch={productionHttpFetch}
      batchLookup={productionBatchLookup}
      onSendComplete={() => {
        window.location.hash = '#/home';
      }}
    />
  );
}
