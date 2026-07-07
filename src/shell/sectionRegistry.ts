// Liquid Clips 2.0 — typed section registry.
// One source of truth for every section the shell can render. Adding a new
// section requires: an ID here, a route, a label, and a component import.
// Sections do not import each other's stores. Cross-section reads go through
// read-only selectors (defined in CONTRACT_ACCOUNT_SELECTORS.md and similar).

import type { ComponentType } from "react";
import type { FlowId } from "../contracts/flowRegistry";
import { FLOW_IDS } from "../contracts/flowRegistry";
import { SECTION_IDS, type SectionId } from "./sectionIds";

import { HomeSection } from "../sections/home/HomeSection";
// UX-1-b · 7 legacy sections (Create · Channels · Schedule · Community · Earn ·
// Clipper · Settings) intentionally NOT imported here so their hash slugs
// fall through to HomeSection → SimulatorRouter → Design-OS routes. The
// component files in `sections/create`, `sections/channels`, etc. remain on
// disk · they are simply unreferenced. See `docs/ux-1-a-whole-app-visual-
// motion-asset-audit-2026-06-19.md` rows R-06 / R-17 / R-19 / R-21 / R-23 /
// R-27 / R-34.
import { BrowseSection } from "../sections/browse/BrowseSection";
import { EditorSection } from "../sections/editor/EditorSection";
import { ProjectsSection } from "../sections/projects/ProjectsSection";
import { CampaignsSection } from "../sections/campaigns/CampaignsSection";
import { AccountSection } from "../sections/account/AccountSection";
import { DiagnosticsSection } from "../sections/diagnostics/DiagnosticsSection";
import { HQBridgeSection } from "../sections/hq/HQBridgeSection";
// Port #8a · Section B · demo-video-placement grid.
import { LearnTab } from "../routes/learn";
// Phase 8 · Mount #2 · warm-peer money-moment surface.
import { OutreachSection } from "../sections/outreach/OutreachSection";

export interface SectionEntry {
  id: SectionId;
  route: string;
  label: string;
  description: string;
  flowIds: FlowId[];
  /** True if the section appears in the side nav. HQ Bridge is router-only. */
  navVisible: boolean;
  component: ComponentType;
}

export const SECTION_REGISTRY: SectionEntry[] = [
  {
    id: SECTION_IDS.SECTION_HOME,
    route: "home",
    label: "Home",
    description: "Read-only digest of every section.",
    flowIds: [FLOW_IDS.FLOW_000_APP_SHELL],
    navVisible: true,
    component: HomeSection,
  },
  // UX-1-b · SECTION_CREATE entry removed · `#/create` now falls through to
  // Design-OS `CreateClipsRoute` via SimulatorRouter.
  {
    id: SECTION_IDS.SECTION_BROWSE,
    route: "browse",
    label: "Browse",
    description: "YouTube / Drive source browser. Isolated full-canvas route.",
    flowIds: [FLOW_IDS.FLOW_015_BROWSE_YOUTUBE_DRIVE_IMPORT],
    navVisible: true,
    component: BrowseSection,
  },
  {
    // P1 (Claude 1 split · 2026-07-06) · #/editor retired from the
    // primary nav (navVisible: false) so it stops being a shallow
    // parallel Editor next to the DesignOS `workstation` + `engine`
    // routes. Ship-lens P0-001 fix (2026-07-06) subsequently deleted
    // the last caller (`CampaignsSection.tsx` "Review · N submissions"
    // button) since its FakeCampaign ids poisoned mode-store. The
    // route stays reachable via direct hash / URL param but has no
    // in-app entry point today. Retire the entry in the follow-up
    // sprint that ports its remaining functionality into workstation.
    id: SECTION_IDS.SECTION_EDITOR,
    route: "editor",
    label: "Engine",
    description: "Preview + export (watermark gated by campaign / tier).",
    flowIds: [
      FLOW_IDS.FLOW_003_EDITOR_PREVIEW,
      FLOW_IDS.FLOW_004_FREE_WATERMARK_EXPORT,
      FLOW_IDS.FLOW_005_PAID_NO_WATERMARK_EXPORT,
      FLOW_IDS.FLOW_018_WATERMARK_COMPOSER,
      FLOW_IDS.FLOW_019_WHOP_REWARDS_HANDOFF,
      FLOW_IDS.FLOW_020_AYRSHARE_PUBLISH_HANDOFF,
    ],
    navVisible: false,
    component: EditorSection,
  },
  {
    id: SECTION_IDS.SECTION_PROJECTS,
    route: "projects",
    label: "Projects",
    description: "Create / add / move / library.",
    flowIds: [FLOW_IDS.FLOW_006_PROJECTS_CREATE_ADD_MOVE],
    navVisible: true,
    component: ProjectsSection,
  },
  // UX-1-b · SECTION_SCHEDULE / SECTION_CHANNELS / SECTION_COMMUNITY /
  // SECTION_EARN entries removed · the corresponding hash slugs now fall
  // through to their Design-OS routes via SimulatorRouter.
  {
    id: SECTION_IDS.SECTION_CAMPAIGNS,
    route: "campaign",
    label: "Campaigns",
    description: "Agency / creator campaign surface.",
    flowIds: [
      FLOW_IDS.FLOW_016_CAMPAIGN_CREATE,
      FLOW_IDS.FLOW_018_WATERMARK_COMPOSER,
    ],
    navVisible: true,
    component: CampaignsSection,
  },
  // UX-1-b · SECTION_SETTINGS / SECTION_CLIPPER entries removed · `#/settings`
  // now resolves to the Design-OS Settings (P1-2/P1-3 work) · `#/clipper`
  // resolves to the Design-OS ClipperJourneyRoute.
  {
    id: SECTION_IDS.SECTION_ACCOUNT,
    route: "account",
    label: "Account",
    description: "Identity + tier (cross-cutting selectors). Now a Settings sub-tab.",
    flowIds: [FLOW_IDS.FLOW_000_APP_SHELL],
    navVisible: false,
    component: AccountSection,
  },
  {
    id: SECTION_IDS.SECTION_DIAGNOSTICS,
    route: "diagnostics",
    label: "Diagnostics",
    description: "Flow trace + health summary. Now a Settings sub-tab.",
    flowIds: [FLOW_IDS.FLOW_014_DIAGNOSTICS_HEALTH_REPORT],
    navVisible: false,
    component: DiagnosticsSection,
  },
  {
    id: SECTION_IDS.SECTION_HQ_BRIDGE,
    route: "hq",
    label: "HQ Bridge",
    description: "Deep-link landing for liquidclips:// verbs. Now a Settings sub-tab.",
    flowIds: [FLOW_IDS.FLOW_013_HQ_WEBSITE_DEEP_LINK_HANDOFF],
    navVisible: false,
    component: HQBridgeSection,
  },
  // Port #8a · Section B · 7-demo grid view. Single-word "Learn" label
  // per liquid_clips_nav_naming memory. Uses /brand/nav-badges/learn.png.
  {
    id: SECTION_IDS.SECTION_LEARN,
    route: "learn",
    label: "Learn",
    description: "7 demo clips — every corner of the app in a video.",
    flowIds: [FLOW_IDS.FLOW_000_APP_SHELL],
    navVisible: true,
    component: LearnTab,
  },
  // Phase 8 · Mount #2 · warm-peer money moment. Section B built the
  // surface (SyncMailMoneyDrop); this entry makes it reachable at
  // `#/outreach`. `navVisible: false` until the Home hero CTA copy is
  // greenlit — router-only for now, so a direct hash navigate mounts it.
  // Reuses FLOW_000_APP_SHELL rather than introducing a new FLOW_ID per
  // Phase 8 guard rail 12 (WIRE only · no new primitives).
  {
    id: SECTION_IDS.SECTION_OUTREACH,
    route: "outreach",
    label: "Outreach",
    description: "Warm-peer money-moment flow · SyncMailMoneyDrop wrapper.",
    flowIds: [FLOW_IDS.FLOW_000_APP_SHELL],
    navVisible: false,
    component: OutreachSection,
  },
];

export function getSectionById(id: SectionId): SectionEntry {
  const entry = SECTION_REGISTRY.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown section: ${id}`);
  return entry;
}

export function getSectionByRoute(route: string): SectionEntry | null {
  return SECTION_REGISTRY.find((s) => s.route === route) ?? null;
}
