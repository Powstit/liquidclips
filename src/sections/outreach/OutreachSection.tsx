/**
 * OutreachSection · Phase 8 Mount #2 (2026-07-04)
 *
 * Thin wrapper that hoists the ported SyncMailMoneyDrop into the
 * canonical section registry so it's reachable at `#/outreach`. Section
 * B built the surface; this file wires the router so real users can
 * actually reach the money moment.
 *
 * Design notes:
 *   * Section stays `navVisible: false` in `sectionRegistry.ts` until
 *     the Home hero CTA copy is greenlit — surfacing a new nav slot
 *     without a design sign-off would break the SIDE_NAV rhythm.
 *   * `onSendComplete` navigates back to `#/home` so a completed send
 *     drops the user back into the workbench without a manual step.
 *     Aligns with the port-8b/8c demo-overlay contract: send happens
 *     inside the modal, user returns to the workspace when it's done.
 *   * No props exposed on this component — Section B kept
 *     `SyncMailMoneyDrop` fully DI'd so tests inject scanners /
 *     drivers / batch-lookups. Wrapping without a prop pass-through
 *     keeps the router entry deterministic; production consumers
 *     always get the real Google OAuth + fetch + batch paths.
 */

import { SyncMailMoneyDrop } from '../../routes/sync-mail-money-drop/SyncMailMoneyDrop';

export function OutreachSection() {
  return (
    <SyncMailMoneyDrop
      onSendComplete={() => {
        window.location.hash = '#/home';
      }}
    />
  );
}
