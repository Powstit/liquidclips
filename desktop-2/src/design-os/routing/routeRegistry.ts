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

// PRODUCT STANDARD (locked 2026-06-25): ONE cockpit room. Routes change
// the content panel inside the room, not the room itself. Daniel's call:
// "This is a simple clipping app … Build one unified shell, then place
// the clipping features inside it." Every world below is `cockpit-home`
// by design — do not reintroduce per-route worlds. Kade placement still
// varies because Kade is a CHARACTER inside the room, not a room.
export const ROUTE_REGISTRY: Record<RouteId, RouteSpec> = {
  home:        { world: "cockpit-home", defaultKade: "idle",                kadePlacement: "helper-right" },
  workstation: { world: "cockpit-home", defaultKade: "cutting-clips",       kadePlacement: "helper-right" },
  // Phase 1c · Composer route. Same cockpit-home world so shell chrome is
  // shared with Workstation; Kade defaults to `idle` because the Composer
  // canvas materializes on user command rather than on route enter.
  composer:    { world: "cockpit-home", defaultKade: "idle",                kadePlacement: "helper-right" },
  submissions: { world: "cockpit-home", defaultKade: "reading-brief",       kadePlacement: "helper-right" },
  analytics:   { world: "cockpit-home", defaultKade: "idle",                kadePlacement: "helper-right" },
  create:    { world: "cockpit-home", defaultKade: "create-clips",        kadePlacement: "center" },
  engine:    { world: "cockpit-home", defaultKade: "cutting-clips",       kadePlacement: "center" },
  studio:    { world: "cockpit-home", defaultKade: "generating-captions", kadePlacement: "helper-right" },
  thumbnail: { world: "cockpit-home", defaultKade: "reading-brief",       kadePlacement: "helper-right" },
  export:    { world: "cockpit-home", defaultKade: "exporting",           kadePlacement: "helper-right" },
  campaigns: { world: "cockpit-home", defaultKade: "reading-brief",       kadePlacement: "helper-right" },
  // Sprint D · agency-mode surface. Uses the same cockpit-home world so
  // the shell chrome is identical; Kade defaults to the "campaign-mode"
  // pose to signal "you're inside the builder, not the discovery grid."
  "campaign-builder": { world: "cockpit-home", defaultKade: "campaign-mode", kadePlacement: "helper-right" },
  clipper:   { world: "cockpit-home", defaultKade: "campaign-mode",       kadePlacement: "center" },
  learn:     { world: "cockpit-home", defaultKade: "reading-brief",       kadePlacement: "helper-right" },
  earn:      { world: "cockpit-home", defaultKade: "earn-mode",           kadePlacement: "center" },
  community: { world: "cockpit-home", defaultKade: "community-mode",      kadePlacement: "center" },
  library:   { world: "cockpit-home", defaultKade: "idle",                kadePlacement: "helper-right" },
  channels:  { world: "cockpit-home", defaultKade: "publishing",          kadePlacement: "helper-right" },
  schedule:  { world: "cockpit-home", defaultKade: "publishing",          kadePlacement: "helper-right" },
  settings:  { world: "cockpit-home", defaultKade: "settings-mode",       kadePlacement: "helper-right" },
  support:   { world: "cockpit-home", defaultKade: "idle",                kadePlacement: "helper-right" },
};
