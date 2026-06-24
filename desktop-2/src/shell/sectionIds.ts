// Liquid Clips 2.0 — section IDs live in their own file to avoid circular
// imports between the registry, the router, and individual sections.

/* BUG-047 · the following SECTION_* identifiers are intentionally
 * DEPRECATED. They are no longer registered in `sectionRegistry.ts`,
 * so passing them to `navigateTo()` is a silent no-op (the same bug
 * AvatarOrbit hit pre-BUG-046).
 *
 *   DEPRECATED · DO NOT pass to navigateTo():
 *     SECTION_CREATE   · use bus.emit("nav:click", { route: "create" })
 *     SECTION_SCHEDULE · use bus.emit("nav:click", { route: "schedule" })
 *     SECTION_CHANNELS · use bus.emit("nav:click", { route: "channels" })
 *     SECTION_COMMUNITY· use bus.emit("nav:click", { route: "community" })
 *     SECTION_EARN     · use bus.emit("nav:click", { route: "earn" })
 *     SECTION_CLIPPER  · use bus.emit("nav:click", { route: "clipper" })
 *     SECTION_SETTINGS · use bus.emit("nav:click", { route: "settings" })
 *
 * They are kept here only so the legacy brand-asset maps in
 * `src/brand/brandAssets.ts` (which key visual assets by section-id
 * string) and `src/components/browser/BrowseOverlay.tsx` continue
 * to compile. Both of those surfaces are themselves rendered inside
 * the legacy AppShell which is `visibility: hidden !important` under
 * Design OS (`src/design-os/components/AppShell.css:24-37`), so the
 * dead keys never reach the customer.
 *
 * The harness `tests/e2e/remaining-surfaces.spec.ts` asserts that
 * none of these DEPRECATED ids ever appear in the active section
 * registry. */
export const SECTION_IDS = {
  SECTION_HOME: "SECTION_HOME",
  SECTION_BROWSE: "SECTION_BROWSE",
  SECTION_EDITOR: "SECTION_EDITOR",
  SECTION_PROJECTS: "SECTION_PROJECTS",
  SECTION_CAMPAIGNS: "SECTION_CAMPAIGNS",
  SECTION_ACCOUNT: "SECTION_ACCOUNT",
  SECTION_DIAGNOSTICS: "SECTION_DIAGNOSTICS",
  SECTION_HQ_BRIDGE: "SECTION_HQ_BRIDGE",

  // DEPRECATED · see comment above. Kept for legacy hidden chrome only.
  SECTION_CREATE: "SECTION_CREATE",
  SECTION_SCHEDULE: "SECTION_SCHEDULE",
  SECTION_CHANNELS: "SECTION_CHANNELS",
  SECTION_COMMUNITY: "SECTION_COMMUNITY",
  SECTION_EARN: "SECTION_EARN",
  SECTION_CLIPPER: "SECTION_CLIPPER",
  SECTION_SETTINGS: "SECTION_SETTINGS",
} as const;

/** BUG-047 · enumerated list of deprecated section ids. The harness
 * asserts every entry here is absent from `sectionRegistry.ts`. */
export const DEPRECATED_SECTION_IDS: ReadonlyArray<SectionId> = [
  "SECTION_CREATE",
  "SECTION_SCHEDULE",
  "SECTION_CHANNELS",
  "SECTION_COMMUNITY",
  "SECTION_EARN",
  "SECTION_CLIPPER",
  "SECTION_SETTINGS",
];

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];
