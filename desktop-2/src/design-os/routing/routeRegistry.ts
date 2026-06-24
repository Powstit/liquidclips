/**
 * Liquid Clips · Design OS · Route Registry
 *
 * Maps each RouteId to its world background + default Kade state +
 * placement. The actual page components are imported by SimulatorRouter
 * and switched on routeId.
 *
 * kadePlacement (Phase 5B item 5):
 *   center        → upper viewport, big, hero-anchored. Lobby/mission routes.
 *   helper-right  → medium, right rail. Workspace routes (Studio, Engine).
 *   bottom-right  → docked corner. Stop Pages + dense ops.
 */

import type { KadeState, RouteId } from "../bridge";
import type { WorldKey } from "../components/WorldLayer";
import type { KadePlacement } from "../components/StickyKade";

export interface RouteSpec {
  world: WorldKey;
  defaultKade: KadeState;
  /** Where Kade sits in the first viewport. Defaults handled at consumer. */
  kadePlacement: KadePlacement;
  /** Most routes are "primary" — Kade visible above the fold.
   *  Login/Onboarding renders Kade inside its own boot panel. */
  hideStickyKade?: boolean;
}

export const ROUTE_REGISTRY: Record<RouteId, RouteSpec> = {
  home:        { world: "cockpit-home",     defaultKade: "idle",                kadePlacement: "center" },
  workstation: { world: "cutting-floor",    defaultKade: "cutting-clips",       kadePlacement: "helper-right" }, // UI-1 · unified engine + studio + export + schedule
  submissions: { world: "cockpit-home",     defaultKade: "reading-brief",       kadePlacement: "helper-right" }, // UI-3 · agency-only review surface
  analytics:   { world: "cockpit-home",     defaultKade: "idle",                kadePlacement: "helper-right" }, // UX-4 · agency analytics stub
  create:    { world: "source-bay",       defaultKade: "create-clips",        kadePlacement: "center" },        // near source/drop zone
  engine:    { world: "cutting-floor",    defaultKade: "cutting-clips",       kadePlacement: "center" },        // near scan/candidate area
  studio:    { world: "studio-deck",      defaultKade: "generating-captions", kadePlacement: "helper-right" },  // workspace dominates
  thumbnail: { world: "studio-deck",      defaultKade: "reading-brief",       kadePlacement: "helper-right" },  // dense workspace · shares studio-deck
  export:    { world: "studio-deck",      defaultKade: "exporting",           kadePlacement: "helper-right" },  // dense queue/history surface
  campaigns: { world: "mission-pedestal", defaultKade: "reading-brief",       kadePlacement: "helper-right" },  // UX-1-c R-30/R-31 · was "center" · Kade overlapped featured card + filter row at 1440×900
  clipper:   { world: "cockpit-home",     defaultKade: "campaign-mode",       kadePlacement: "center" },        // overlay-only world
  earn:      { world: "cockpit-home",     defaultKade: "earn-mode",           kadePlacement: "center" },        // near vault/payout panel
  community: { world: "squad-lounge",     defaultKade: "community-mode",      kadePlacement: "center" },        // near squad/rank panel
  library:   { world: "cockpit-home",     defaultKade: "idle",                kadePlacement: "helper-right" },  // dense archive
  channels:  { world: "relay-tower",      defaultKade: "publishing",          kadePlacement: "helper-right" },  // dense connections grid
  schedule:  { world: "cockpit-home",     defaultKade: "publishing",          kadePlacement: "helper-right" },  // dense calendar
  settings:  { world: "cockpit-home",     defaultKade: "settings-mode",       kadePlacement: "helper-right" },  // dense forms
  support:   { world: "cockpit-home",     defaultKade: "idle",                kadePlacement: "helper-right" },
};
