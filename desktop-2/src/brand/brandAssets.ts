import { SECTION_IDS, type SectionId } from "../shell/sectionIds";

export const logoGlyph = "/brand/assets/glyph.png";
export const logoWordmark = "/brand/assets/wordmark.png";
export const madeWithLiquidClips = "/brand/made-with-liquid-clips.svg";

// FRAME-10 fix · 2026-07-05 · added missing entries for
// SECTION_ACCOUNT · SECTION_DIAGNOSTICS · SECTION_HQ_BRIDGE ·
// SECTION_OUTREACH so those tabs don't fall to the generic glyph and
// SECTION_LEARN atmosphere so the Learn tab renders an atmosphere.
const NAV_BADGE_MAP: Record<string, string | null> = {
  [SECTION_IDS.SECTION_HOME]: "/brand/nav-badges/workspace.png",
  [SECTION_IDS.SECTION_CREATE]: "/brand/nav-badges/upload.png",
  [SECTION_IDS.SECTION_BROWSE]: "/brand/nav-badges/library.png",
  [SECTION_IDS.SECTION_EDITOR]: "/brand/nav-badges/workspace.png",
  [SECTION_IDS.SECTION_PROJECTS]: "/brand/nav-badges/library.png",
  [SECTION_IDS.SECTION_SCHEDULE]: "/brand/nav-badges/schedule.png",
  [SECTION_IDS.SECTION_CHANNELS]: "/brand/nav-badges/payouts.png",
  [SECTION_IDS.SECTION_COMMUNITY]: "/brand/nav-badges/community.png",
  [SECTION_IDS.SECTION_EARN]: "/brand/nav-badges/earn.png",
  [SECTION_IDS.SECTION_CAMPAIGNS]: "/brand/nav-badges/upload.png",
  [SECTION_IDS.SECTION_SETTINGS]: "/brand/nav-badges/settings.png",
  [SECTION_IDS.SECTION_LEARN]: "/brand/nav-badges/learn.png",
  [SECTION_IDS.SECTION_ACCOUNT]: "/brand/nav-badges/settings.png",
  [SECTION_IDS.SECTION_DIAGNOSTICS]: "/brand/nav-badges/settings.png",
  [SECTION_IDS.SECTION_HQ_BRIDGE]: "/brand/nav-badges/settings.png",
  [SECTION_IDS.SECTION_OUTREACH]: "/brand/nav-badges/community.png",
};

const ATMOSPHERE_MAP: Record<string, string | null> = {
  [SECTION_IDS.SECTION_HOME]: "/brand/atmospheres/atmosphere-workspace.png",
  [SECTION_IDS.SECTION_CREATE]: "/brand/atmospheres/atmosphere-workspace.png",
  [SECTION_IDS.SECTION_BROWSE]: "/brand/atmospheres/atmosphere-library.png",
  [SECTION_IDS.SECTION_EDITOR]: "/brand/atmospheres/atmosphere-workspace.png",
  [SECTION_IDS.SECTION_PROJECTS]: "/brand/atmospheres/atmosphere-library.png",
  [SECTION_IDS.SECTION_SCHEDULE]: "/brand/atmospheres/atmosphere-schedule.png",
  [SECTION_IDS.SECTION_CHANNELS]: "/brand/atmospheres/atmosphere-schedule.png",
  [SECTION_IDS.SECTION_COMMUNITY]: "/brand/atmospheres/atmosphere-library.png",
  [SECTION_IDS.SECTION_EARN]: "/brand/atmospheres/atmosphere-earn.png",
  [SECTION_IDS.SECTION_CAMPAIGNS]: "/brand/atmospheres/atmosphere-workspace.png",
  [SECTION_IDS.SECTION_CLIPPER]: "/brand/atmospheres/atmosphere-earn.png",
  [SECTION_IDS.SECTION_SETTINGS]: "/brand/atmospheres/atmosphere-settings.png",
  [SECTION_IDS.SECTION_ACCOUNT]: "/brand/atmospheres/atmosphere-settings.png",
  [SECTION_IDS.SECTION_DIAGNOSTICS]: "/brand/atmospheres/atmosphere-settings.png",
  [SECTION_IDS.SECTION_HQ_BRIDGE]: "/brand/atmospheres/atmosphere-settings.png",
  [SECTION_IDS.SECTION_LEARN]: "/brand/atmospheres/atmosphere-library.png",
  [SECTION_IDS.SECTION_OUTREACH]: "/brand/atmospheres/atmosphere-library.png",
};

const DECK_MAP: Record<string, string | null> = {
  [SECTION_IDS.SECTION_HOME]: "/brand/decks/workspace.png",
  [SECTION_IDS.SECTION_CREATE]: "/brand/decks/upload.png",
  [SECTION_IDS.SECTION_EDITOR]: "/brand/decks/workspace.png",
  [SECTION_IDS.SECTION_CAMPAIGNS]: "/brand/decks/workspace.png",
  [SECTION_IDS.SECTION_CLIPPER]: "/brand/decks/upload.png",
  [SECTION_IDS.SECTION_EARN]: "/brand/decks/earn.png",
  [SECTION_IDS.SECTION_SCHEDULE]: "/brand/decks/schedule.png",
  [SECTION_IDS.SECTION_SETTINGS]: "/brand/decks/settings.png",
};

export function navBadgeFor(sectionId: SectionId): string | null {
  return NAV_BADGE_MAP[sectionId] ?? null;
}

export function atmosphereFor(sectionId: SectionId): string | null {
  return ATMOSPHERE_MAP[sectionId] ?? null;
}

export function deckFor(sectionId: SectionId): string | null {
  return DECK_MAP[sectionId] ?? null;
}

export function achievement(name: string): string {
  return `/brand/achievement-badges/${name}.png`;
}

export function tier(name: string): string {
  return `/brand/tiers/${name}.png`;
}

export function sponsored(name: string): string {
  return `/brand/sponsored/${name}.png`;
}

export function intro(name: string): string {
  return `/brand/intro/${name}.png`;
}
