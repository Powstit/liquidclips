/**
 * Liquid Clips · Asset Registry · Stage A consolidation (locked 2026-06-25)
 *
 * One source of truth for every visual asset the app uses. Built by
 * CONSOLIDATING prior asset audits (six markdown reports in
 * desktop-2/docs/, plus the existing `brandAssets.ts`, `WorldLayer.tsx`,
 * `KadeController.tsx`, `ClipCard.css` hardcoded paths) — NOT by
 * re-auditing the filesystem from scratch.
 *
 * Stage A scope:
 *   · Inventory + structured manifest. No wiring changes.
 *   · `WorldLayer` / `ClipCard` / `KadeController` still own their
 *     hardcoded path maps; Stage B will swap them to read from here.
 *   · Validator lives at scripts/asset-registry-validate.mjs and runs
 *     against every entry below.
 *
 * Status taxonomy:
 *   · `active`    — wired and visible in the shipping product
 *   · `candidate` — file exists, was once wired, now off after the
 *                   one-cockpit-room lock (re-wirable for future
 *                   second-room concepts)
 *   · `unused`    — file exists, never wired anywhere in the current
 *                   render path (Daniel's "we paid to generate this
 *                   and it's buried in a folder")
 *   · `legacy`    — wired in the legacy outer shell only; hidden under
 *                   `body[data-design-os="active"]` by AppShell.css and
 *                   not visible in the shipping product
 *   · `missing`   — referenced in code but no file on disk (validator
 *                   adds these dynamically — none expected at Stage A)
 *
 * Category taxonomy:
 *   world / kade / kade-tier / kade-sequence / clip-card-fallback /
 *   logo / nav-badge / nav-icon / action-icon / canvas-icon /
 *   metric-icon / deck / sponsored / reward / tier / achievement /
 *   invader / leaderboard / clip-fx / allowance / intro / atmosphere
 *
 * Source-of-truth references (already in repo, do not re-audit):
 *   · desktop-2/docs/p1-2b-a-asset-coverage-audit-2026-06-19.md
 *   · desktop-2/docs/community-parity-and-asset-gap-audit.md
 *   · desktop-2/docs/ux-1-a-whole-app-visual-motion-asset-audit-2026-06-19.md
 *   · desktop-2/docs/asset-source-foundation-audit.md
 *   · desktop-2/src/brand/brandAssets.ts (partial registry, pre-this-file)
 *   · desktop-2/src/design-os/components/WorldLayer.tsx · PATH_FOR
 *   · desktop-2/src/design-os/components/KadeController.tsx · POSE_PATH
 *   · desktop-2/src/design-os/engine/ClipCard.css · nth-child(6n+N) cycle
 */

export type AssetCategory =
  | "world"
  | "kade"
  | "kade-tier"
  | "kade-sequence"
  | "clip-card-fallback"
  | "logo"
  | "nav-badge"
  | "nav-icon"
  | "action-icon"
  | "canvas-icon"
  | "metric-icon"
  | "deck"
  | "sponsored"
  | "reward"
  | "tier"
  | "achievement"
  | "invader"
  | "leaderboard"
  | "clip-fx"
  | "allowance"
  | "intro"
  | "atmosphere";

export type AssetStatus = "active" | "candidate" | "unused" | "legacy" | "missing";

export interface AssetEntry {
  /** Stable id used by helpers. Format: `<category>.<slug>`. */
  id: string;
  category: AssetCategory;
  /** Path served by Vite + the runtime:// scheme. */
  publicPath: string;
  /** Free-form tags for asset-browser filtering. */
  tags: readonly string[];
  /** One-sentence description of where this asset belongs. */
  intendedPlacement: string;
  /** Optional rank within a fallback chain (clip-card cycle, etc.). */
  fallbackRank?: number;
  /** Known consumers in code (file:line where stable; component name
   *  when the consumer is dynamic). Stage A captures what's currently
   *  hardcoded — Stage B will collapse to one consumer per asset. */
  currentUsage?: readonly string[];
  status: AssetStatus;
  /** Captured for hot assets only (worlds, key cockpit images, intro).
   *  All known worlds are 1536x1024 per the validator run. */
  dimensions?: { w: number; h: number };
}

/** Absolute repo path for an entry — used by the validator + asset
 *  browser. Same convention as Vite's public/ root resolution. */
export function sourcePathFor(entry: AssetEntry): string {
  return `desktop-2/public${entry.publicPath}`;
}

/* ──────────────────────────────────────────────────────────────────
 * WORLDS · cinematic cockpit backdrops · 1536×1024 webp
 *
 * Cockpit-home is the locked product standard post-2026-06-25 (one
 * cockpit room). The other seven worlds are bundled, decoded by the
 * runtime, and reusable for future second-room concepts — but no
 * customer route resolves to them today. Login is the one exception:
 * it still uses boot-sequence for the kinetic boot moment.
 * ────────────────────────────────────────────────────────────────── */

export const WORLDS: readonly AssetEntry[] = [
  {
    id: "world.cockpit-home",
    category: "world",
    publicPath: "/brand/worlds/cockpit-home.webp",
    tags: ["cockpit", "home", "canonical", "richer-cockpit"],
    intendedPlacement:
      "The one cockpit room. WorldLayer mounts this as the full-bleed " +
      "scene on every customer-facing route post-cockpit-room-lock.",
    currentUsage: [
      "src/design-os/components/WorldLayer.tsx:29",
      "src/design-os/routing/routeRegistry.ts (every route after 2026-06-25)",
    ],
    status: "active",
    dimensions: { w: 1536, h: 1024 },
  },
  {
    id: "world.boot-sequence",
    category: "world",
    publicPath: "/brand/worlds/boot-sequence.webp",
    tags: ["cockpit", "login", "onboarding", "kinetic"],
    intendedPlacement: "LoginOnboarding boot moment only.",
    currentUsage: ["src/design-os/routes/LoginOnboarding.tsx:101"],
    status: "active",
    dimensions: { w: 1536, h: 1024 },
  },
  {
    id: "world.source-bay",
    category: "world",
    publicPath: "/brand/worlds/source-bay.webp",
    tags: ["cockpit", "intake", "drop-zone"],
    intendedPlacement:
      "Pre-lock backdrop for the Create / source-intake surface. Now " +
      "off-rotation — registry pinned to cockpit-home. Reusable as a " +
      "drop-target second room if Create ever splits out again.",
    status: "candidate",
    dimensions: { w: 1536, h: 1024 },
  },
  {
    id: "world.cutting-floor",
    category: "world",
    publicPath: "/brand/worlds/cutting-floor.webp",
    tags: ["cockpit", "engine", "editor", "workshop"],
    intendedPlacement:
      "Pre-lock backdrop for Workstation / ClippingEngine. Dim-mood " +
      "machine room. Off-rotation post-lock; reusable for a deep " +
      "render/encode room.",
    status: "candidate",
    dimensions: { w: 1536, h: 1024 },
  },
  {
    id: "world.studio-deck",
    category: "world",
    publicPath: "/brand/worlds/studio-deck.webp",
    tags: ["cockpit", "studio", "timeline", "thumbnail", "export"],
    intendedPlacement:
      "Pre-lock backdrop for Studio / Thumbnail / Export. Off-rotation.",
    status: "candidate",
    dimensions: { w: 1536, h: 1024 },
  },
  {
    id: "world.mission-pedestal",
    category: "world",
    publicPath: "/brand/worlds/mission-pedestal.webp",
    tags: ["cockpit", "campaigns", "mission"],
    intendedPlacement:
      "Pre-lock backdrop for Campaigns. Off-rotation post-lock.",
    status: "candidate",
    dimensions: { w: 1536, h: 1024 },
  },
  {
    id: "world.squad-lounge",
    category: "world",
    publicPath: "/brand/worlds/squad-lounge.webp",
    tags: ["cockpit", "community", "squad"],
    intendedPlacement:
      "Pre-lock backdrop for Community. Off-rotation post-lock.",
    status: "candidate",
    dimensions: { w: 1536, h: 1024 },
  },
  {
    id: "world.relay-tower",
    category: "world",
    publicPath: "/brand/worlds/relay-tower.webp",
    tags: ["cockpit", "channels", "broadcast"],
    intendedPlacement:
      "Pre-lock backdrop for Channels. Off-rotation post-lock.",
    status: "candidate",
    dimensions: { w: 1536, h: 1024 },
  },
] as const;

/** Resolve a world by its WorldKey. */
export function getWorld(key: string): AssetEntry | undefined {
  return WORLDS.find((w) => w.id === `world.${key}`);
}

/* ──────────────────────────────────────────────────────────────────
 * KADE POSES · the 18 KadeState union members.
 *
 * All ACTIVE — KadeController.tsx wires every one. Audit
 * `p1-2b-a-asset-coverage-audit-2026-06-19.md` §1.2 confirmed
 * coverage. No fallback needed; missing pose = missing KadeState.
 * ────────────────────────────────────────────────────────────────── */

interface KadePoseSpec {
  state: string;
  tags: readonly string[];
  status?: AssetStatus;
}
const KADE_POSE_SPECS: readonly KadePoseSpec[] = [
  { state: "idle",                tags: ["resting", "default"] },
  { state: "hover",               tags: ["transition", "anticipation"] },
  { state: "create-clips",        tags: ["intake", "create"] },
  { state: "import-footage",      tags: ["intake", "import"] },
  { state: "reading-brief",       tags: ["campaigns", "study"] },
  { state: "cutting-clips",       tags: ["engine", "editor"] },
  { state: "generating-captions", tags: ["studio", "captions"] },
  { state: "exporting",           tags: ["render", "export"] },
  { state: "publishing",          tags: ["distribution", "publish"] },
  { state: "campaign-mode",       tags: ["campaigns", "mission"] },
  { state: "earn-mode",           tags: ["earn", "payout"] },
  { state: "community-mode",      tags: ["community", "squad"] },
  { state: "settings-mode",       tags: ["settings", "config"] },
  { state: "shooter",             tags: ["invaders", "game"] },
  { state: "success",             tags: ["positive", "complete"] },
  { state: "celebration",         tags: ["positive", "highlight"] },
  { state: "warning",             tags: ["state", "caution"] },
  { state: "error",               tags: ["state", "negative"] },
];

export const KADE_POSES: readonly AssetEntry[] = [
  ...KADE_POSE_SPECS.map((s) => ({
    id: `kade.${s.state}`,
    category: "kade" as AssetCategory,
    publicPath: `/brand/kade/kade-${s.state}.webp`,
    tags: s.tags,
    intendedPlacement: `Kade ${s.state} pose. Driven by KadeState bus events.`,
    currentUsage: ["src/design-os/components/KadeController.tsx"],
    status: (s.status ?? "active") as AssetStatus,
  })),
  {
    id: "kade.base",
    category: "kade" as AssetCategory,
    publicPath: "/brand/kade/kade-base.png",
    tags: ["base", "topHud", "background"],
    intendedPlacement: "TopHud background wash · structural base PNG.",
    currentUsage: ["src/design-os/components/TopHud.css:125"],
    status: "active" as AssetStatus,
  },
];

/** Resolve a Kade pose by its KadeState value. */
export function getKade(state: string): AssetEntry | undefined {
  return KADE_POSES.find((p) => p.id === `kade.${state}`);
}

/* ──────────────────────────────────────────────────────────────────
 * KADE TIER POSES · 5 tier-themed Kade overlays.
 *
 * Per audit, these surface on tier-up celebration + leaderboard tier
 * chrome. Active in leaderboard tier display + tier confirmation flow.
 * ────────────────────────────────────────────────────────────────── */

export const KADE_TIER_POSES: readonly AssetEntry[] = [
  { tier: "rookie",  tags: ["tier", "starter"] },
  { tier: "solo",    tags: ["tier", "solo"] },
  { tier: "pro",     tags: ["tier", "pro"] },
  { tier: "growth",  tags: ["tier", "growth"] },
  { tier: "climber", tags: ["tier", "climber"] },
].map((t) => ({
  id: `kade-tier.${t.tier}`,
  category: "kade-tier" as AssetCategory,
  publicPath: `/brand/kade/kade-tier-${t.tier}.webp`,
  tags: t.tags,
  intendedPlacement: `Kade in ${t.tier} tier garb. Tier celebration + leaderboard tier display.`,
  currentUsage: [
    "src/design-os/campaigns/LeaderboardSection.tsx (via tier prop)",
  ],
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * KADE UP-SEQUENCE · 6-frame animated rise (png + webp pairs).
 *
 * Status: UNUSED. Generated for a Kade entry-cinematic concept that
 * never shipped. High-value art — preserved here as a pointer so the
 * next motion pass can wire it (e.g. Home greeting moment, ignite
 * splash) instead of regenerating.
 * ────────────────────────────────────────────────────────────────── */

export const KADE_UP_SEQUENCE: readonly AssetEntry[] = Array.from({ length: 6 }, (_, i) => i + 1).flatMap(
  (n) =>
    [
      {
        id: `kade-sequence.up-${n}.webp`,
        category: "kade-sequence" as AssetCategory,
        publicPath: `/brand/kade/up-sequence/kade-up-${n}.webp`,
        tags: ["sequence", "kinetic", "entry", "unused", "high-value"],
        intendedPlacement: `Frame ${n}/6 of the Kade up-sequence. Candidate Home greeting / ignite moment.`,
        fallbackRank: n,
        status: "unused" as AssetStatus,
      },
      {
        id: `kade-sequence.up-${n}.png`,
        category: "kade-sequence" as AssetCategory,
        publicPath: `/brand/kade/up-sequence/kade-up-${n}.png`,
        tags: ["sequence", "kinetic", "entry", "unused", "png-mirror"],
        intendedPlacement: `Frame ${n}/6 PNG mirror of the webp.`,
        fallbackRank: n,
        status: "unused" as AssetStatus,
      },
    ] as const,
);

/* ──────────────────────────────────────────────────────────────────
 * CLIP-CARD FALLBACKS · 6-pose Kade cycle (the "no real thumbnail
 * yet" Liquid Clips character world).
 *
 * Wired via `.lc-clip-card:nth-child(6n+N)` rules in ClipCard.css.
 * Re-uses Kade pose files — entries here just record the cycle, not
 * the file (the file is already in KADE_POSES). Stage B will replace
 * the CSS cycle with a registry lookup.
 * ────────────────────────────────────────────────────────────────── */

export const CLIP_CARD_FALLBACK_CYCLE = [
  "celebration",
  "shooter",
  "publishing",
  "cutting-clips",
  "success",
  "reading-brief",
] as const;

export const CLIP_CARD_FALLBACKS: readonly AssetEntry[] = CLIP_CARD_FALLBACK_CYCLE.map((state, i) => ({
  id: `clip-card-fallback.${i + 1}`,
  category: "clip-card-fallback" as AssetCategory,
  publicPath: `/brand/kade/kade-${state}.webp`,
  tags: ["clip-card", "fallback", "kade-cycle"],
  intendedPlacement: `Clip card #${i + 1} of every 6 — uses Kade ${state} pose as fallback when no real thumbnail.`,
  fallbackRank: i + 1,
  currentUsage: [`src/design-os/engine/ClipCard.css :nth-child(6n+${i + 1})`],
  status: "active" as AssetStatus,
}));

/** Pick a Kade-themed fallback for a clip card by zero-based index. */
export function getClipCardFallback(idx: number): AssetEntry {
  return CLIP_CARD_FALLBACKS[idx % CLIP_CARD_FALLBACKS.length];
}

/* ──────────────────────────────────────────────────────────────────
 * LOGOS / BRAND MARKS
 * ────────────────────────────────────────────────────────────────── */

export const LOGOS: readonly AssetEntry[] = [
  {
    id: "logo.glyph",
    category: "logo",
    publicPath: "/brand/assets/glyph.png",
    tags: ["mark", "primary"],
    intendedPlacement: "Compact app glyph — top-left brand block + favicon contexts.",
    currentUsage: ["src/brand/brandAssets.ts:3 (logoGlyph)"],
    status: "active",
  },
  {
    id: "logo.wordmark",
    category: "logo",
    publicPath: "/brand/assets/wordmark.png",
    tags: ["mark", "primary", "wordmark"],
    intendedPlacement: "Full liquid/clips wordmark — splash + brand block.",
    currentUsage: ["src/brand/brandAssets.ts:4 (logoWordmark)"],
    status: "active",
  },
  {
    id: "logo.made-with",
    category: "logo",
    publicPath: "/brand/made-with-liquid-clips.svg",
    tags: ["mark", "watermark", "export"],
    intendedPlacement: "Outbound watermark stamped on user exports.",
    currentUsage: ["src/brand/brandAssets.ts:5 (madeWithLiquidClips)"],
    status: "active",
  },
  {
    id: "logo.splash-jpg",
    category: "logo",
    publicPath: "/brand/assets/splash.jpg",
    tags: ["splash", "wide"],
    intendedPlacement: "Wide splash artwork — boot / intro context.",
    status: "candidate",
  },
] as const;

/* ──────────────────────────────────────────────────────────────────
 * NAV BADGES · legacy outer-shell only.
 *
 * Per `brandAssets.ts NAV_BADGE_MAP`. Hidden under
 * `body[data-design-os="active"]` per AppShell.css. STATUS = legacy.
 * ────────────────────────────────────────────────────────────────── */

export const NAV_BADGES: readonly AssetEntry[] = [
  "community", "earn", "learn", "library", "payouts", "schedule", "settings", "upload", "workspace",
].map((name) => ({
  id: `nav-badge.${name}`,
  category: "nav-badge" as AssetCategory,
  publicPath: `/brand/nav-badges/${name}.png`,
  tags: ["nav", "legacy-shell", name],
  intendedPlacement: `Legacy outer-shell sidenav badge for ${name}.`,
  currentUsage: ["src/brand/brandAssets.ts NAV_BADGE_MAP"],
  status: "legacy" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * NAV ICONS · current design-os ConsoleNav rail.
 * ────────────────────────────────────────────────────────────────── */

export const NAV_ICONS: readonly AssetEntry[] = [
  "campaigns", "channels", "clipper", "community", "create", "earn",
  "engine", "export", "home", "library", "schedule", "settings",
  "studio", "support", "thumbs",
].map((name) => ({
  id: `nav-icon.${name}`,
  category: "nav-icon" as AssetCategory,
  publicPath: `/brand/icons/nav/${name}.svg`,
  tags: ["nav", "console-nav", name],
  intendedPlacement: `ConsoleNav rail icon for ${name}.`,
  currentUsage: ["src/design-os/components/ConsoleNav.tsx"],
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * ACTION ICONS · campaign + split-screen sets.
 * ────────────────────────────────────────────────────────────────── */

const CAMPAIGN_ACTIONS = [
  "approved", "finish-on-whop", "mission", "needs-changes", "open-external",
  "reward", "rules", "submission", "watermark-locked",
];
const SPLIT_SCREEN_ACTIONS = [
  "before-after", "facecam-corner", "green-screen", "podcast-commentary",
  "quote-reaction", "reaction-under-clip", "side-by-side", "top-bottom",
];
export const ACTION_ICONS: readonly AssetEntry[] = [
  ...CAMPAIGN_ACTIONS.map((name) => ({
    id: `action-icon.campaign.${name}`,
    category: "action-icon" as AssetCategory,
    publicPath: `/brand/icons/action/campaign/${name}.svg`,
    tags: ["action", "campaign", name],
    intendedPlacement: `Campaign action icon · ${name}.`,
    status: "active" as AssetStatus,
  })),
  ...SPLIT_SCREEN_ACTIONS.map((name) => ({
    id: `action-icon.split-screen.${name}`,
    category: "action-icon" as AssetCategory,
    publicPath: `/brand/icons/action/split-screen/${name}.svg`,
    tags: ["action", "split-screen", "reaction-layout", name],
    intendedPlacement: `Split-screen layout picker icon · ${name}.`,
    status: "active" as AssetStatus,
  })),
];

/* ──────────────────────────────────────────────────────────────────
 * CANVAS + METRIC ICONS
 * ────────────────────────────────────────────────────────────────── */

export const CANVAS_ICONS: readonly AssetEntry[] = [
  "safe-area-face", "safe-area-title",
].map((name) => ({
  id: `canvas-icon.${name}`,
  category: "canvas-icon" as AssetCategory,
  publicPath: `/brand/icons/canvas/${name}.svg`,
  tags: ["canvas", "editor", "safe-area"],
  intendedPlacement: `Editor canvas safe-area marker · ${name}.`,
  status: "active" as AssetStatus,
}));

export const METRIC_ICONS: readonly AssetEntry[] = [
  "clips-shipped", "coins-earned", "crown", "streak-flame", "trophy", "views",
].map((name) => ({
  id: `metric-icon.${name}`,
  category: "metric-icon" as AssetCategory,
  publicPath: `/brand/icons/metric/${name}.svg`,
  tags: ["metric", "scoreboard", name],
  intendedPlacement: `Scoreboard / stat tile icon · ${name}.`,
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * DECKS · CommandRoom + banner pickers.
 * ────────────────────────────────────────────────────────────────── */

export const DECKS: readonly AssetEntry[] = [
  "earn", "learn", "minecraft-submission", "payouts", "schedule",
  "settings", "upload", "workspace",
].map((name) => ({
  id: `deck.${name}`,
  category: "deck" as AssetCategory,
  publicPath: `/brand/decks/${name}.png`,
  tags: ["deck", "banner", name],
  intendedPlacement: `Per-section deck artwork · ${name}.`,
  currentUsage: ["src/brand/brandAssets.ts DECK_MAP"],
  status: name === "learn" || name === "minecraft-submission" ? "candidate" : "active",
}));

/* ──────────────────────────────────────────────────────────────────
 * SPONSORED CARD THUMBS · sponsored campaigns + placeholder.
 * ────────────────────────────────────────────────────────────────── */

export const SPONSORED: readonly AssetEntry[] = [
  { slug: "thumb-business", tags: ["thumb", "vertical-business"], status: "active" as AssetStatus },
  { slug: "thumb-creator",  tags: ["thumb", "vertical-creator"],  status: "active" as AssetStatus },
  { slug: "thumb-fitness",  tags: ["thumb", "vertical-fitness"],  status: "active" as AssetStatus },
  { slug: "thumb-tech",     tags: ["thumb", "vertical-tech"],     status: "active" as AssetStatus },
  { slug: "badge-sponsored", tags: ["badge", "ribbon"],          status: "active" as AssetStatus },
  { slug: "placeholder",     tags: ["fallback"],                  status: "active" as AssetStatus },
].map((s) => ({
  id: `sponsored.${s.slug}`,
  category: "sponsored" as AssetCategory,
  publicPath: `/brand/sponsored/${s.slug}.png`,
  tags: ["sponsored", ...s.tags],
  intendedPlacement: `Sponsored card · ${s.slug}.`,
  status: s.status,
}));

/* ──────────────────────────────────────────────────────────────────
 * REWARD · chest / coin / stamps / mission badges.
 * ────────────────────────────────────────────────────────────────── */

const REWARD_FILES: ReadonlyArray<{ file: string; tags: readonly string[]; place: string }> = [
  { file: "chest-reward.webp",            tags: ["chest", "drop"],             place: "Earn drop animation · reward unlock state." },
  { file: "coin-stack.webp",              tags: ["coin", "balance"],           place: "Earn balance display + payout chrome." },
  { file: "badge-premium-mission.svg",    tags: ["badge", "premium"],          place: "Premium mission card badge." },
  { file: "badge-sponsored-mission.svg",  tags: ["badge", "sponsored"],        place: "Sponsored mission card badge." },
  { file: "badge-verified-campaign.svg",  tags: ["badge", "verified"],         place: "Verified campaign mark." },
  { file: "shield-watermark-locked.svg",  tags: ["shield", "watermark-gate"],  place: "Watermark-locked state on free tier." },
  { file: "stamp-approved.svg",           tags: ["stamp", "approved"],         place: "Submission approved stamp." },
  { file: "stamp-needs-changes.svg",      tags: ["stamp", "revision"],         place: "Submission revision-request stamp." },
  { file: "stamp-payout.svg",             tags: ["stamp", "payout"],           place: "Payout receipt stamp." },
  { file: "stamp-rejected.svg",           tags: ["stamp", "rejected"],         place: "Submission rejected stamp." },
];
export const REWARD: readonly AssetEntry[] = REWARD_FILES.map((r) => ({
  id: `reward.${r.file.replace(/\.(svg|webp|png)$/, "")}`,
  category: "reward" as AssetCategory,
  publicPath: `/brand/reward/${r.file}`,
  tags: ["reward", ...r.tags],
  intendedPlacement: r.place,
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * TIERS · free → legend ladder.
 * ────────────────────────────────────────────────────────────────── */

export const TIERS: readonly AssetEntry[] = [
  "autopilot", "climber", "free", "growth", "legend", "pro", "rookie", "solo", "titan",
].map((name) => ({
  id: `tier.${name}`,
  category: "tier" as AssetCategory,
  publicPath: `/brand/tiers/${name}.png`,
  tags: ["tier", name],
  intendedPlacement: `${name} tier badge — useTierCaps display surfaces.`,
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * ACHIEVEMENT BADGES · phase 6L-D scope per audit.
 * ────────────────────────────────────────────────────────────────── */

export const ACHIEVEMENT: readonly AssetEntry[] = [
  "first-clip", "first-payout", "first-publish", "first-referral",
  "hundred-clips", "hundred-dollars", "top-100-leaderboard", "viral-clip",
].map((name) => ({
  id: `achievement.${name}`,
  category: "achievement" as AssetCategory,
  publicPath: `/brand/achievement-badges/${name}.png`,
  tags: ["achievement", "badge", name],
  intendedPlacement: `Achievement badge · ${name}. Awarded via badge-grant pipeline.`,
  status: "candidate" as AssetStatus, // wiring deferred to 6L-D per audit
}));

/* ──────────────────────────────────────────────────────────────────
 * INVADERS · minigame sprites.
 *
 * v1 set is ACTIVE in InvadersOverlay. v2 spritesheet folder is the
 * next-rev candidate — not currently consumed.
 * ────────────────────────────────────────────────────────────────── */

const INVADERS_V1 = [
  "boss", "bullet-invader", "bullet-player", "drone", "elite", "grunt",
  "invader-wasp", "mothership", "player_ship", "player-ship", "splash-bg",
];
const INVADERS_V2 = [
  "sprite-00", "sprite-01", "sprite-02", "sprite-03", "sprite-04",
  "sprite-05", "sprite-06", "sprite-07", "sprite-08", "sprite-09",
  "sprite-10", "spritesheet",
];
export const INVADERS: readonly AssetEntry[] = [
  ...INVADERS_V1.map((name) => ({
    id: `invader.v1.${name}`,
    category: "invader" as AssetCategory,
    publicPath: `/brand/invaders/${name}.png`,
    tags: ["invaders", "v1", name],
    intendedPlacement: `Invaders v1 sprite · ${name}.`,
    currentUsage: ["src/overlays/invaders/InvadersOverlay.tsx"],
    status: "active" as AssetStatus,
  })),
  ...INVADERS_V2.map((name) => ({
    id: `invader.v2.${name}`,
    category: "invader" as AssetCategory,
    publicPath: `/brand/invaders/v2/${name}.png`,
    tags: ["invaders", "v2", "candidate", name],
    intendedPlacement: `Invaders v2 sprite (next-rev) · ${name}.`,
    status: "candidate" as AssetStatus,
  })),
];

/* ──────────────────────────────────────────────────────────────────
 * LEADERBOARD · rank + tier overlay art.
 * ────────────────────────────────────────────────────────────────── */

const LEADERBOARD_FILES: ReadonlyArray<{ file: string; tags: readonly string[] }> = [
  { file: "badge-crown.svg",   tags: ["crown", "top-rank"] },
  { file: "badge-shield.svg",  tags: ["shield", "rank-defender"] },
  { file: "badge-trophy.svg",  tags: ["trophy", "milestone"] },
  { file: "rank-1-gold.svg",   tags: ["rank", "gold"] },
  { file: "rank-2-silver.svg", tags: ["rank", "silver"] },
  { file: "rank-3-bronze.svg", tags: ["rank", "bronze"] },
  { file: "rank-numeric.svg",  tags: ["rank", "numeric-template"] },
  { file: "tier-climber.webp", tags: ["tier", "overlay"] },
  { file: "tier-growth.webp",  tags: ["tier", "overlay"] },
  { file: "tier-pro.webp",     tags: ["tier", "overlay"] },
  { file: "tier-rookie.webp",  tags: ["tier", "overlay"] },
  { file: "tier-solo.webp",    tags: ["tier", "overlay"] },
];
export const LEADERBOARD: readonly AssetEntry[] = LEADERBOARD_FILES.map((l) => ({
  id: `leaderboard.${l.file.replace(/\.(svg|webp|png)$/, "")}`,
  category: "leaderboard" as AssetCategory,
  publicPath: `/brand/leaderboard/${l.file}`,
  tags: ["leaderboard", ...l.tags],
  intendedPlacement: `LeaderboardSection chrome · ${l.file}.`,
  currentUsage: ["src/design-os/campaigns/LeaderboardSection.tsx"],
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * CLIP FX · workflow accent art.
 * ────────────────────────────────────────────────────────────────── */

const CLIP_FX_FILES: ReadonlyArray<{ file: string; tags: readonly string[]; place: string }> = [
  { file: "beam-upload.svg",     tags: ["beam", "upload"],     place: "Upload portal beam accent." },
  { file: "caption-bubble.svg",  tags: ["captions"],           place: "Caption editor accent." },
  { file: "card-stack.svg",      tags: ["stack", "library"],   place: "Library card-stack mark." },
  { file: "fragment-shards.png", tags: ["shards", "highlight"],place: "Highlight detection shard burst." },
  { file: "laser-cut-line.svg",  tags: ["cut", "split"],       place: "Cut/trim affordance accent." },
  { file: "marker-hook.svg",     tags: ["marker", "hook"],     place: "Hook marker on the timeline." },
  { file: "marker-viral.svg",    tags: ["marker", "viral"],    place: "Viral-prediction marker." },
  { file: "rocket-export.webp",  tags: ["rocket", "export"],   place: "Export accent · CommandRoom Studio Engine card." },
  { file: "timeline-block.svg",  tags: ["timeline", "block"],  place: "Timeline block accent." },
  { file: "trail-publish.svg",   tags: ["trail", "publish"],   place: "Publish trail flourish." },
];
export const CLIP_FX: readonly AssetEntry[] = CLIP_FX_FILES.map((f) => ({
  id: `clip-fx.${f.file.replace(/\.(svg|webp|png)$/, "")}`,
  category: "clip-fx" as AssetCategory,
  publicPath: `/brand/clip-fx/${f.file}`,
  tags: ["clip-fx", ...f.tags],
  intendedPlacement: f.place,
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * ALLOWANCE · CommandRoom scoreboard state glyphs.
 * ────────────────────────────────────────────────────────────────── */

export const ALLOWANCE: readonly AssetEntry[] = [
  "bar-empty", "bar-healthy", "bar-low", "bar-unlimited",
].map((name) => ({
  id: `allowance.${name}`,
  category: "allowance" as AssetCategory,
  publicPath: `/brand/allowance/${name}.svg`,
  tags: ["allowance", "scoreboard", name],
  intendedPlacement: `Allowance bar state · ${name}.`,
  status: "active" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * INTRO · splash mp4 + still + closing still.
 * ────────────────────────────────────────────────────────────────── */

export const INTRO: readonly AssetEntry[] = [
  { file: "intro.mp4",                tags: ["splash", "current"],  place: "IntroSplash boot reel.",                       status: "active" as AssetStatus },
  { file: "intro-splash.mp4",         tags: ["splash", "alt-cut"],  place: "Alt splash cut. Currently not selected.",       status: "candidate" as AssetStatus },
  { file: "intro.prev-v2-20260623.mp4", tags: ["splash", "archive"],place: "Archived previous cut (kept for comparison).",  status: "unused" as AssetStatus },
  { file: "closing-still.png",        tags: ["closing"],            place: "Closing still frame.",                          status: "candidate" as AssetStatus },
  { file: "oasis-anchor.png",         tags: ["splash", "anchor"],   place: "Splash anchor frame for static fallback.",      status: "candidate" as AssetStatus },
].map((i) => ({
  id: `intro.${i.file.replace(/\.(mp4|png)$/, "")}`,
  category: "intro" as AssetCategory,
  publicPath: `/brand/intro/${i.file}`,
  tags: ["intro", ...i.tags],
  intendedPlacement: i.place,
  status: i.status,
}));

/* ──────────────────────────────────────────────────────────────────
 * ATMOSPHERES · legacy outer-shell parking lot.
 *
 * Wired in `brandAssets.ts ATMOSPHERE_MAP` but visually hidden by
 * `body[data-design-os="active"] .lc-deck-atmosphere { visibility:
 * hidden }` (AppShell.css line 31). Status = legacy. Reusable if the
 * design-os flow ever wants secondary atmospheres on top of the
 * world.
 * ────────────────────────────────────────────────────────────────── */

export const ATMOSPHERES: readonly AssetEntry[] = [
  "earn", "library", "schedule", "settings", "workspace",
].map((name) => ({
  id: `atmosphere.${name}`,
  category: "atmosphere" as AssetCategory,
  publicPath: `/brand/atmospheres/atmosphere-${name}.png`,
  tags: ["atmosphere", "legacy-shell", name],
  intendedPlacement: `Legacy outer-shell atmosphere · ${name}. Hidden under design-os.`,
  currentUsage: ["src/brand/brandAssets.ts ATMOSPHERE_MAP"],
  status: "legacy" as AssetStatus,
}));

/* ──────────────────────────────────────────────────────────────────
 * MASTER REGISTRY
 * ────────────────────────────────────────────────────────────────── */

export const ASSET_REGISTRY: readonly AssetEntry[] = [
  ...WORLDS,
  ...KADE_POSES,
  ...KADE_TIER_POSES,
  ...KADE_UP_SEQUENCE,
  ...CLIP_CARD_FALLBACKS,
  ...LOGOS,
  ...NAV_BADGES,
  ...NAV_ICONS,
  ...ACTION_ICONS,
  ...CANVAS_ICONS,
  ...METRIC_ICONS,
  ...DECKS,
  ...SPONSORED,
  ...REWARD,
  ...TIERS,
  ...ACHIEVEMENT,
  ...INVADERS,
  ...LEADERBOARD,
  ...CLIP_FX,
  ...ALLOWANCE,
  ...INTRO,
  ...ATMOSPHERES,
];

export function getAssetById(id: string): AssetEntry | undefined {
  return ASSET_REGISTRY.find((a) => a.id === id);
}

export function listByCategory(category: AssetCategory): readonly AssetEntry[] {
  return ASSET_REGISTRY.filter((a) => a.category === category);
}

export function listByStatus(status: AssetStatus): readonly AssetEntry[] {
  return ASSET_REGISTRY.filter((a) => a.status === status);
}

/** Summary count by category — useful for the asset-browser surface
 *  and the Stage A consolidation report. */
export function summaryByCategory(): Record<AssetCategory, number> {
  const out = {} as Record<AssetCategory, number>;
  for (const entry of ASSET_REGISTRY) {
    out[entry.category] = (out[entry.category] ?? 0) + 1;
  }
  return out;
}
